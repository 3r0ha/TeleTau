// Ограничение частоты в Valkey (ADR 0016 §5–6, 0015 §4). Ключи строит вызывающий; IP в ключ не кладётся открытым
// текстом — только HMAC (см. RateLimiter.ipKey). Все проверки атомарны — Lua-скрипты: параллельная пачка
// запросов не проходит между «проверил» и «засчитал». Два вида лимитов:
// - consume — считается каждое событие (запросы кода, опросы заявки, обновления сессии), окно фиксировано от первого;
// - reserve — считаются только неудачи (неверный QR, неверный код класса, неверный X-Poll-Token). Попытка берёт
//   слот ДО проверки, а после неё вызывающий явно говорит, чем она кончилась: `fail()` — неудача, она остаётся в окне;
//   `release()` — не неудача (проверка прошла или запрос упал посередине — исключение неудачей не считается).
//
// Резерв ведёт два счётчика в одном Lua-скрипте:
// - F — зафиксированные неудачи в окне (`rl:<key>`, фиксированное окно от первой неудачи);
// - P — попытки «в работе» (`rl:<key>:inflight`, sorted set «id → срок»): у каждой своя короткая жизнь (10 с),
//   так что упавший процесс не держит слот дольше этого срока.
// Слот выдаётся, если F + P < max: за окно проверяется не больше `max` неверных попыток при любой параллельности,
// а верные попытки слот неудачи не занимают — по завершении они его возвращают. Если отказ только
// из-за P (неудач ещё меньше max, но слоты заняты попытками «в работе»), сервер коротко ждёт и повторяет резерв
// (до ~2 с): попытки «в работе» длятся миллисекунды. Не дождался — 429 с `Retry-After: 1`, а не остаток окна.
// Если F ≥ max — 429 с остатком окна, в том числе для верной попытки: это и есть блокировка за подбор.
import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { hmacHex } from "../common/crypto.js";
import { tooManyRequests, unavailable } from "../common/problem.js";
import { VALKEY } from "./tokens.js";

/** Засчитать событие: {счётчик, PTTL}. */
const HIT = `local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('PTTL', KEYS[1])}`;

/** Текущее время сервера Valkey в мс: у всех экземпляров API одни часы для сроков попыток «в работе». */
const NOW = `local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)`;

/**
 * Резерв попытки. KEYS: F, P. ARGV: max, id попытки, срок попытки «в работе» (мс).
 * Ответ: {1, F, P} — слот выдан; {0, 1, PTTL(F)} — неудачи исчерпаны; {0, 2, 0} — мешают только попытки «в работе».
 */
const RESERVE = `${NOW}
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
local max = tonumber(ARGV[1])
local f = tonumber(redis.call('GET', KEYS[1]) or '0')
if f >= max then return {0, 1, redis.call('PTTL', KEYS[1])} end
local p = redis.call('ZCARD', KEYS[2])
if f + p >= max then return {0, 2, 0} end
redis.call('ZADD', KEYS[2], now + tonumber(ARGV[3]), ARGV[2])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
return {1, f, p + 1}`;

/** Попытка завершилась не неудачей: слот «в работе» освобождается. KEYS: P. ARGV: id. */
const RELEASE = `return redis.call('ZREM', KEYS[1], ARGV[1])`;

/**
 * Попытка — неудача: слот «в работе» освобождается, неудача засчитывается в окно (окно — от первой неудачи).
 * KEYS: F, P. ARGV: id, окно (мс). Ответ — F.
 */
const FAIL = `redis.call('ZREM', KEYS[2], ARGV[1])
local f = redis.call('INCR', KEYS[1])
if f == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return f`;

export interface Limit {
  /** Сколько событий (для reserve — неудач) разрешено в окне. */
  max: number;
  windowMs: number;
}

/**
 * Зарезервированная попытка. Ровно один исход: `fail()` — неудача (засчитывается в окно) или `release()` — не неудача
 * (проверка прошла, отказ по другой причине или исключение посередине). Повторные вызовы ничего не делают, так что
 * `release()` в `finally` безопасен после `fail()`.
 */
export interface Reservation {
  fail(): Promise<void>;
  release(): Promise<void>;
}

/** Сколько живёт попытка «в работе», если процесс упал и не вернул слот (больше statement_timeout БД с запасом). */
export const INFLIGHT_TTL_MS = 10_000;
/** Сколько сервер ждёт, пока освободятся слоты попыток «в работе», прежде чем ответить 429 с Retry-After: 1. */
export const INFLIGHT_WAIT_MS = 2_000;
const WAIT_STEP_MS = [10, 20, 40, 80, 100];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class RateLimiter {
  constructor(
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Короткий HMAC IP для ключей Valkey: адрес не хранится открыто. */
  ipKey(ip: string): string {
    return hmacHex(this.config.AUTH_SECRET_PEPPER, `ip:${ip}`).slice(0, 24);
  }

  /** Засчитывает событие и даёт 429, если оно сверх лимита. */
  async consume(key: string, limit: Limit): Promise<void> {
    const [count, ttl] = await this.run(() => this.valkey.eval(HIT, 1, `rl:${key}`, String(limit.windowMs)) as Promise<[number, number]>);
    if (count > limit.max) throw tooManyRequests((ttl > 0 ? ttl : limit.windowMs) / 1000);
  }

  /** Засчитывает событие без проверки лимита; возвращает счётчик окна (например, неудачи TOTP сотрудника). */
  async count(key: string, windowMs: number): Promise<number> {
    const [count] = await this.run(() => this.valkey.eval(HIT, 1, `rl:${key}`, String(windowMs)) as Promise<[number, number]>);
    return count;
  }

  /**
   * Резервирует попытку атомарно (схема — в начале файла). Неудачи исчерпаны — 429 с остатком окна; слоты заняты
   * только попытками «в работе» — ждёт до INFLIGHT_WAIT_MS и потом 429 с Retry-After: 1.
   */
  async reserve(key: string, limit: Limit, waitMs = INFLIGHT_WAIT_MS): Promise<Reservation> {
    const failures = `rl:${key}`;
    const inflight = `rl:${key}:inflight`;
    const id = randomUUID();
    const deadline = Date.now() + waitMs;
    for (let attempt = 0; ; attempt++) {
      const [ok, why, ttl] = await this.run(
        () => this.valkey.eval(RESERVE, 2, failures, inflight, String(limit.max), id, String(INFLIGHT_TTL_MS)) as Promise<[number, number, number]>,
      );
      if (ok === 1) break;
      if (why === 1) throw tooManyRequests((ttl > 0 ? ttl : limit.windowMs) / 1000);
      const step = WAIT_STEP_MS[Math.min(attempt, WAIT_STEP_MS.length - 1)]!;
      if (Date.now() + step > deadline) throw tooManyRequests(1);
      await sleep(step);
    }
    let settled = false;
    const settle = async (script: () => Promise<unknown>) => {
      if (settled) return;
      settled = true;
      await script();
    };
    return {
      // Неудачу нельзя потерять молча: Valkey недоступен — 503 (запрос и так не прошёл проверку).
      fail: () => settle(() => this.run(() => this.valkey.eval(FAIL, 2, failures, inflight, id, String(limit.windowMs)))),
      // Сбой Valkey при возврате не мешает запросу: слот «в работе» сам истечёт через INFLIGHT_TTL_MS.
      release: () => settle(() => (this.valkey.eval(RELEASE, 1, inflight, id) as Promise<unknown>).catch(() => undefined)),
    };
  }

  /** Valkey недоступен — 503, а не пропуск запроса без ограничения (ADR 0015, последствия). */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch {
      throw unavailable();
    }
  }
}
