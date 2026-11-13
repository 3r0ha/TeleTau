// Вход взрослых и сотрудников: e-mail + одноразовый код (ADR 0015 §4), для сотрудников ещё TOTP (RFC 6238).
// Почтового сервиса пока нет: в демо-режиме AUTH_DEMO_OTP письмо не отправляется и принимается
// фиксированный код; без демо-режима — 503 email_login_unavailable. Ответ на запрос кода одинаков для любого адреса.
// Вызов кода — хеш Valkey `otp:<challengeId>`: HMAC адреса, адрес под AES-256-GCM (нужен, чтобы завести профиль
// нового взрослого), HMAC кода и счётчик попыток. В логи адрес и код не попадают.
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { and, eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import { verify as verifyTotp } from "otplib";
import type { RequestMeta } from "../../common/auth.js";
import { decrypt, encrypt, hexEquals, hmacHex } from "../../common/crypto.js";
import { tooManyRequests, unauthorized, unavailable } from "../../common/problem.js";
import { uuidv7 } from "../../common/uuidv7.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { demoOtp, demoStaffWithoutTotp, encryptionKey } from "../../config/secrets.js";
import type { Db } from "../../db/database.js";
import { RateLimiter } from "../../infra/rate-limiter.js";
import { DB, VALKEY } from "../../infra/tokens.js";
import { AuditService } from "../admin/index.js";
import { AccountsService, normalizeEmail, type AccountRow } from "./accounts.service.js";
import { credentials } from "./identity.schema.js";

export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_MAX_ATTEMPTS = 5;
const RESEND_AFTER_SECONDS = 30;
const TOTP_STEP_SECONDS = 30;
/** 10 неверных TOTP сотрудника за час — вход заблокирован на час (staff.locked в аудит). */
export const STAFF_TOTP_FAILURES = { max: 10, windowMs: 3600_000 };
export const STAFF_LOCK_SECONDS = 3600;

/**
 * Попытка проверки кода — атомарно: HINCRBY только у существующего вызова (после удаления ключа параллельный
 * запрос не заводит его заново с attempts = 1 и без срока), вместе с полями вызова. Нет вызова — {-1}.
 */
const ATTEMPT = `if redis.call("EXISTS", KEYS[1]) == 0 then return {-1} end
local a = redis.call("HINCRBY", KEYS[1], "attempts", 1)
local v = redis.call("HMGET", KEYS[1], "code", "email", "subject")
return {a, v[1] or "", v[2] or "", v[3] or ""}`;

@Injectable()
export class OtpService {
  private readonly key: Buffer;
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly limiter: RateLimiter,
    private readonly accounts: AccountsService,
    private readonly audit: AuditService,
  ) {
    this.key = encryptionKey(config);
  }

  private codeHmac(challengeId: string, code: string): string {
    return hmacHex(this.config.AUTH_SECRET_PEPPER, `otp:${challengeId}:${code}`);
  }

  async request(email: string, meta: RequestMeta): Promise<Schema<"OtpChallenge">> {
    const demo = demoOtp(this.config);
    if (!demo) throw unavailable("email_login_unavailable");
    const subject = this.accounts.emailSubject(email);
    await this.limiter.consume(`otp:ip:${this.limiter.ipKey(meta.ip)}`, { max: 30, windowMs: 10 * 60_000 });
    await this.limiter.consume(`otp:email:${subject.slice(0, 24)}`, { max: 5, windowMs: 10 * 60_000 });
    const challengeId = uuidv7();
    const key = `otp:${challengeId}`;
    await this.kv(() =>
      this.valkey
        .multi()
        .hset(key, {
          subject,
          email: encrypt(this.key, normalizeEmail(email), `otp-email:${challengeId}`),
          code: this.codeHmac(challengeId, demo),
          attempts: "0",
        })
        .expire(key, OTP_TTL_SECONDS)
        .exec(),
    );
    return {
      challengeId,
      expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString(),
      resendAfterSeconds: RESEND_AFTER_SECONDS,
      codeLength: demo.length,
    };
  }

  /**
   * Проверка кода (и TOTP для сотрудника). Каждая проверка расходует попытку атомарно (скрипт ATTEMPT) — параллельный
   * перебор не обходит лимит в 5 попыток. Верный код «потребляется» атомарно (DEL = 1 только у одного запроса):
   * двойное нажатие даёт одну сессию, второй запрос — otp_expired. Возвращает аккаунт; сессию выдаёт вызывающий.
   */
  async verify(body: Schema<"OtpVerifyRequest">, meta: RequestMeta): Promise<AccountRow> {
    const key = `otp:${body.challengeId}`;
    const [attempts, code, sealedEmail, subject] = await this.kv(() => this.valkey.eval(ATTEMPT, 1, key) as Promise<[number, string?, string?, string?]>);
    if (attempts < 0 || !code || !sealedEmail) throw unauthorized("otp_expired");
    const exhausted = async () => {
      await this.kv(() => this.valkey.del(key));
      return tooManyRequests(OTP_TTL_SECONDS, "otp_attempts_exceeded");
    };
    if (attempts > OTP_MAX_ATTEMPTS) throw await exhausted();
    if (!hexEquals(code, this.codeHmac(body.challengeId, body.code))) {
      throw attempts >= OTP_MAX_ATTEMPTS ? await exhausted() : unauthorized("otp_invalid");
    }

    const email = decrypt(this.key, sealedEmail, `otp-email:${body.challengeId}`);
    const existing = await this.accounts.findByEmailSubject(subject || this.accounts.emailSubject(email));
    if (existing?.kind === "staff" && !demoStaffWithoutTotp(this.config)) {
      // Сотрудник: второй фактор обязателен; без него вызов кода не расходуется до конца — консоль спросит TOTP.
      // Демо AUTH_DEMO_STAFF_WITHOUT_TOTP: показ жюри без аутентификатора — ветка пропускается целиком.
      await this.assertStaffNotLocked(existing.id);
      if (!body.totp) throw unauthorized("totp_required");
      const totp = await this.checkTotp(existing.id, body.totp);
      if (totp !== "ok") {
        const actor = { accountId: existing.id, kind: "staff" as const, roles: existing.roles };
        await this.audit.record(this.db, { action: "staff.login_failed", actor, metadata: { reason: totp === "replayed" ? "totp_replayed" : "totp_invalid" }, meta });
        // К блокировке ведут только неверные коды: повтор верного кода (уже использованный шаг) подбором не является.
        if (totp === "invalid" && (await this.recordTotpFailure(existing.id, actor, meta))) throw tooManyRequests(STAFF_LOCK_SECONDS, "staff_locked");
        throw attempts >= OTP_MAX_ATTEMPTS ? await exhausted() : unauthorized("totp_invalid");
      }
    }
    // Одноразовость: из параллельных запросов с верным кодом дальше проходит только удаливший вызов.
    if ((await this.kv(() => this.valkey.del(key))) !== 1) throw unauthorized("otp_expired");
    const account = existing ?? (await this.accounts.findOrCreateAdult(email));
    // Заблокированный аккаунт: причина — прямо, а не «Сессия завершена» по кругу (M2-UX5). Удалённый — как было.
    if (account.status === "blocked") throw unauthorized("account_blocked");
    if (account.status !== "active") throw unauthorized("session_revoked");
    if (account.kind === "staff") {
      await this.audit.record(this.db, { action: "staff.login", actor: { accountId: account.id, kind: "staff", roles: account.roles }, meta });
    }
    return account;
  }

  /**
   * Проверка кода без входа — привязка почты к аккаунту «Учусь сам» (ADR 0022, POST /me/email). Те же гарантии, что
   * у verify: попытка расходуется атомарно до сравнения, 5 попыток, верный код «потребляется» один раз. Аккаунт
   * не создаётся и не ищется — это решает вызывающий. Возвращает подтверждённый адрес и его ключ поиска.
   */
  async consumeChallenge(challengeId: string, code: string): Promise<{ email: string; subject: string }> {
    const key = `otp:${challengeId}`;
    const [attempts, stored, sealedEmail, subject] = await this.kv(() => this.valkey.eval(ATTEMPT, 1, key) as Promise<[number, string?, string?, string?]>);
    if (attempts < 0 || !stored || !sealedEmail) throw unauthorized("otp_expired");
    const exhausted = async () => {
      await this.kv(() => this.valkey.del(key));
      return tooManyRequests(OTP_TTL_SECONDS, "otp_attempts_exceeded");
    };
    if (attempts > OTP_MAX_ATTEMPTS) throw await exhausted();
    if (!hexEquals(stored, this.codeHmac(challengeId, code))) throw attempts >= OTP_MAX_ATTEMPTS ? await exhausted() : unauthorized("otp_invalid");
    if ((await this.kv(() => this.valkey.del(key))) !== 1) throw unauthorized("otp_expired");
    const email = decrypt(this.key, sealedEmail, `otp-email:${challengeId}`);
    return { email, subject: subject || this.accounts.emailSubject(email) };
  }

  /** Вход сотрудника заблокирован после неверных TOTP — 429 staff_locked с оставшимся сроком. */
  private async assertStaffNotLocked(accountId: string): Promise<void> {
    const ttl = await this.kv(() => this.valkey.ttl(`staff-lock:${accountId}`));
    if (ttl > 0 || ttl === -1) throw tooManyRequests(ttl > 0 ? ttl : STAFF_LOCK_SECONDS, "staff_locked");
  }

  /**
   * Неверный TOTP: счётчик на аккаунт за час; на десятой неудаче — блокировка на час. Запись staff.locked в аудит —
   * один раз на блокировку (SET NX). Возвращает true, если вход теперь заблокирован.
   */
  private async recordTotpFailure(accountId: string, actor: { accountId: string; kind: "staff"; roles: AccountRow["roles"] }, meta: RequestMeta): Promise<boolean> {
    const failures = await this.limiter.count(`totp-fail:${accountId}`, STAFF_TOTP_FAILURES.windowMs);
    if (failures < STAFF_TOTP_FAILURES.max) return false;
    const locked = await this.kv(() => this.valkey.set(`staff-lock:${accountId}`, "1", "EX", STAFF_LOCK_SECONDS, "NX"));
    if (locked === "OK") {
      await this.audit.record(this.db, { action: "staff.locked", actor, metadata: { reason: "totp_failures", failures, lockSeconds: STAFF_LOCK_SECONDS }, meta });
      this.logger.warn(`staff account ${accountId} locked for ${STAFF_LOCK_SECONDS} s after ${failures} wrong TOTP codes`);
    }
    return true;
  }

  /** TOTP: 6 цифр, шаг 30 с, окно ±1 шаг; один и тот же код дважды не принимается (защита от повтора). */
  private async checkTotp(accountId: string, token: string): Promise<"ok" | "invalid" | "replayed"> {
    const [cred] = await this.db
      .select({ secretEnc: credentials.secretEnc })
      .from(credentials)
      .where(and(eq(credentials.accountId, accountId), eq(credentials.type, "totp")));
    if (!cred?.secretEnc) return "invalid";
    let secret: string;
    try {
      secret = decrypt(this.key, cred.secretEnc, `totp:${accountId}`);
    } catch {
      return "invalid";
    }
    const result = await verifyTotp({ secret, token, epochTolerance: TOTP_STEP_SECONDS });
    if (!result.valid) return "invalid";
    const step = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS) + ("delta" in result && typeof result.delta === "number" ? result.delta : 0);
    const fresh = await this.kv(() => this.valkey.set(`totp-used:${accountId}:${step}`, "1", "EX", TOTP_STEP_SECONDS * 4, "NX"));
    if (fresh !== "OK") return "replayed";
    await this.db.update(credentials).set({ lastUsedAt: new Date() }).where(and(eq(credentials.accountId, accountId), eq(credentials.type, "totp")));
    return "ok";
  }

  private async kv<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch {
      throw unavailable();
    }
  }
}
