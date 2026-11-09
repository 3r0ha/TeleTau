// Idempotency-Key (контракт, параметр IdempotencyKey): повтор с тем же ключом и телом в течение суток возвращает
// первый результат. Ключ привязан к операции и аккаунту; в Valkey — только SHA-256 ключа клиента, хеш тела запроса
// и тело ответа (без секретов):
// - до выполнения ставится маркер «в работе» (SET NX) — параллельный повтор не выполняет операцию второй раз, а сразу
//   получает 409 request_in_progress с Retry-After (ждать результат на сервере не стали: это держало бы соединение
//   и слот пула под каждым повтором, а клиенту всё равно нужен повтор после таймаута);
// - тот же ключ с другим телом — 422 idempotency_key_reused;
// - операция упала — маркер снимается (только свой, сравнением значения), и клиент может повторить с тем же ключом.
import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import { sha256Hex } from "../common/crypto.js";
import { conflict, unavailable, unprocessable } from "../common/problem.js";
import { VALKEY } from "./tokens.js";

const TTL_SECONDS = 24 * 3600;
/** Маркер «в работе» живёт дольше любой операции с ключом (выпуск 40 карточек — доли секунды). */
export const PENDING_TTL_SECONDS = 60;
/** Через сколько секунд повторить запрос, пока первый ещё выполняется. */
const RETRY_AFTER_SECONDS = 1;

/** Снять маркер «в работе», только если он наш (а не маркер следующего запроса после истечения TTL). */
const RELEASE_IF_OWNED = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

type Stored<T> = { s: "pending"; fp: string; owner: string } | { s: "done"; fp: string; r: T };

/** JSON с отсортированными ключами — отпечаток тела не зависит от порядка полей. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Отпечаток запроса для Idempotency-Key: SHA-256 канонического JSON тела (и параметров пути, если их передать). */
export const requestFingerprint = (value: unknown): string => sha256Hex(stableJson(value));

@Injectable()
export class IdempotencyStore {
  private readonly logger = new Logger(IdempotencyStore.name);

  constructor(@Inject(VALKEY) private readonly valkey: Redis) {}

  /** Выполняет `fn` один раз на (операция, аккаунт, ключ); без ключа — просто выполняет. */
  async run<T>(operation: string, accountId: string, key: string | undefined, fingerprint: string, fn: () => Promise<T>): Promise<T> {
    if (!key) return fn();
    const redisKey = `idem:${operation}:${accountId}:${sha256Hex(key)}`;
    const marker = JSON.stringify({ s: "pending", fp: fingerprint, owner: randomUUID() } satisfies Stored<T>);
    for (let attempt = 0; ; attempt++) {
      const placed = await this.kv(() => this.valkey.set(redisKey, marker, "EX", PENDING_TTL_SECONDS, "NX"));
      if (placed === "OK") break;
      const raw = await this.kv(() => this.valkey.get(redisKey));
      // Маркер успели снять (первый запрос упал) между SET NX и GET — пробуем занять ключ ещё раз.
      if (!raw && attempt < 2) continue;
      const stored = raw ? (JSON.parse(raw) as Stored<T>) : undefined;
      if (stored && stored.fp !== fingerprint) {
        throw unprocessable("idempotency_key_reused", [{ pointer: "#/header/idempotency-key", detail: "Этот ключ уже использован для запроса с другим телом" }]);
      }
      if (stored?.s === "done") return stored.r;
      throw conflict("request_in_progress", undefined, RETRY_AFTER_SECONDS);
    }
    let result: T;
    try {
      result = await fn();
    } catch (e) {
      await (this.valkey.eval(RELEASE_IF_OWNED, 1, redisKey, marker) as Promise<unknown>).catch(() => undefined);
      throw e;
    }
    try {
      await this.valkey.set(redisKey, JSON.stringify({ s: "done", fp: fingerprint, r: result } satisfies Stored<T>), "EX", TTL_SECONDS);
    } catch {
      // Операция уже выполнена — отвечаем её результатом. Маркер «в работе» доживёт свои 60 с: повтор получит 409.
      this.logger.warn(`idempotency result not stored for ${operation}: Valkey unavailable`);
    }
    return result;
  }

  private async kv<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch {
      throw unavailable();
    }
  }
}
