// Сессии (ADR 0015 §2): непрозрачный одноразовый refresh-токен `ttr_…` (256 бит, в базе — SHA-256), семейство
// ротаций, привязка к устройству, обнаружение повторного использования и стоп-лист семейств в Valkey.
// Стоп-лист обновляется только после фиксации отзыва в базе: сбой Valkey не откатывает отзыв, а даёт 503.
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Principal, RequestMeta } from "../../common/auth.js";
import { randomTokenB64, sha256Hex } from "../../common/crypto.js";
import { ApiError, unauthorized, unavailable } from "../../common/problem.js";
import { uuidv7 } from "../../common/uuidv7.js";
import type { Db } from "../../db/database.js";
import { RateLimiter, type Limit } from "../../infra/rate-limiter.js";
import { DB, VALKEY } from "../../infra/tokens.js";
import { AuditService } from "../admin/index.js";
import { accounts, devices, sessions } from "./identity.schema.js";
import { ACCESS_TOKEN_TTL_SECONDS, TokenService } from "./token.service.js";

type SessionRow = typeof sessions.$inferSelect;
export type RevokeReason = NonNullable<SessionRow["revokeReason"]>;
export type DeviceInfo = Schema<"DeviceInfo">;
/** Пара токенов без аккаунта (аккаунт добавляет вызывающий — `account: Me`). */
export type SessionTokens = Omit<Schema<"AuthSession">, "account">;
export type AccountRef = Pick<Principal, "accountId" | "kind" | "roles">;

const DAY = 24 * 3600_000;
const LIFETIME = {
  default: { sliding: 30 * DAY, absolute: 90 * DAY },
  /** У сотрудников оба срока — 12 часов. */
  staff: { sliding: 12 * 3600_000, absolute: 12 * 3600_000 },
};

/**
 * Льготное окно потерянного ответа (ADR 0015 §2): повтор ротированного токена с того же устройства в течение
 * 60 с после ротации, пока преемник не использован, выдаёт новую пару без отзыва семейства. 60 с покрывают таймаут
 * запроса обновления у клиента (≤ 30 с) и немедленный повтор; это в 15 раз меньше жизни access-токена, а чужой
 * предъявитель всё равно обнаруживается: законный клиент, получивший отозванного преемника, предъявит его — это повтор.
 */
export const REFRESH_GRACE_MS = 60_000;
/** Обновлений с одного IP (класс за школьным NAT, перезагрузки страниц) и одного токена (зациклившийся клиент). */
export const REFRESH_IP_LIMIT: Limit = { max: 300, windowMs: 60_000 };
export const REFRESH_TOKEN_LIMIT: Limit = { max: 10, windowMs: 60_000 };

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(VALKEY) private readonly valkey: Redis,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
  ) {}

  /** Новое семейство сессии на устройстве (строка devices — на пару «аккаунт + установка»). */
  async issue(db: Db, account: AccountRef, device: DeviceInfo): Promise<SessionTokens> {
    const now = new Date();
    const [dev] = await db
      .insert(devices)
      .values({ accountId: account.accountId, installId: device.installId, platform: device.platform, appVersion: device.appVersion ?? null, lastSeenAt: now })
      .onConflictDoUpdate({
        target: [devices.accountId, devices.installId],
        set: { platform: device.platform, appVersion: device.appVersion ?? null, lastSeenAt: now, updatedAt: now },
      })
      .returning({ id: devices.id });
    const life = account.kind === "staff" ? LIFETIME.staff : LIFETIME.default;
    const familyId = uuidv7();
    return this.mint(db, account, { familyId, deviceId: dev!.id, familyExpiresAt: new Date(now.getTime() + life.absolute) }, life.sliding, now);
  }

  /** Новое семейство вне транзакции вызывающего (вход по e-mail). */
  start(account: AccountRef, device: DeviceInfo): Promise<SessionTokens> {
    return this.db.transaction((tx) => this.issue(tx, account, device));
  }

  /** Ротация refresh-токена: старый помечается использованным, выпускается новый в том же семействе. */
  async refresh(refreshToken: string, deviceInstallId: string, meta: RequestMeta): Promise<{ tokens: SessionTokens; accountId: string }> {
    const hash = sha256Hex(refreshToken);
    // Лимиты частоты по IP и по токену. Valkey недоступен — дальше идём только затем, чтобы зафиксировать
    // в базе отзыв семейства при повторном использовании или чужом устройстве; обычное обновление — 503.
    let valkeyDown = false;
    try {
      await this.limiter.consume(`refresh:ip:${this.limiter.ipKey(meta.ip)}`, REFRESH_IP_LIMIT);
      await this.limiter.consume(`refresh:token:${hash.slice(0, 32)}`, REFRESH_TOKEN_LIMIT);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 503)) throw e;
      valkeyDown = true;
    }
    const now = new Date();
    const [row] = await this.db.select().from(sessions).where(eq(sessions.refreshHash, hash));
    if (!row) throw valkeyDown ? unavailable() : unauthorized("refresh_invalid");
    const [account] = await this.db.select().from(accounts).where(eq(accounts.id, row.accountId));
    const ref: AccountRef = { accountId: row.accountId, kind: account!.kind, roles: account!.roles };
    if (row.rotatedAt) return this.replayed(row, ref, deviceInstallId, meta, valkeyDown);
    if (row.revokedAt) {
      // Преемник, отозванный льготным окном: его предъявление значит, что ответ не терялся и у токена два владельца.
      if (row.revokeReason === "superseded") return this.reuseDetected(row, ref, meta);
      throw unauthorized(row.revokeReason === "refresh_reuse" ? "refresh_reused" : "session_revoked");
    }

    const [device] = await this.db.select().from(devices).where(eq(devices.id, row.deviceId));
    if (device?.installId !== deviceInstallId) {
      // Токен предъявлен с другого устройства — компрометация: отзываем семейство (ADR 0015 §2).
      await this.db.transaction(async (tx) => {
        await this.revokeFamilyRows(tx, row.familyId, "device_mismatch");
        await this.audit.record(tx, { action: "session.device_mismatch", actor: ref, target: { type: "session", id: row.familyId }, meta });
      });
      await this.blockFamilies([row.familyId]);
      throw unauthorized("refresh_invalid");
    }
    if (valkeyDown) throw unavailable();
    if (row.expiresAt <= now || row.familyExpiresAt <= now) throw unauthorized("refresh_invalid");
    if (account!.status === "blocked") {
      await this.revokeFamilyRows(this.db, row.familyId, "account_blocked");
      await this.blockFamilies([row.familyId]);
      // Заблокированный аккаунт не «заходит по кругу» со «Сессия завершена»: причина названа прямо (M2-UX5).
      throw unauthorized("account_blocked");
    }
    if (account!.status !== "active") {
      await this.revokeFamilyRows(this.db, row.familyId, "account_blocked");
      await this.blockFamilies([row.familyId]);
      throw unauthorized("session_revoked");
    }

    const life = ref.kind === "staff" ? LIFETIME.staff : LIFETIME.default;
    const result = await this.db.transaction(async (tx) => {
      const newId = uuidv7();
      const [rotated] = await tx
        .update(sessions)
        .set({ rotatedAt: now, replacedById: newId })
        .where(and(eq(sessions.id, row.id), isNull(sessions.rotatedAt), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      if (!rotated) return undefined;
      const tokens = await this.mint(tx, ref, row, life.sliding, now, newId);
      await tx.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, row.deviceId));
      return tokens;
    });
    if (result) return { tokens: result, accountId: row.accountId };
    // Параллельное обновление тем же токеном: строку уже ротировали (или отозвали) — решаем по свежему состоянию.
    const [fresh] = await this.db.select().from(sessions).where(eq(sessions.id, row.id));
    if (fresh?.rotatedAt) return this.replayed(fresh, ref, deviceInstallId, meta, false);
    return this.reuseDetected(fresh ?? row, ref, meta);
  }

  /** Выход: семейство текущей сессии или (allDevices) все сессии аккаунта. */
  async logout(principal: Principal, allDevices: boolean): Promise<void> {
    const families = allDevices ? await this.revokeAccount(this.db, principal.accountId, "logout_all") : [];
    if (!allDevices) await this.revokeFamilyRows(this.db, principal.sessionId, "logout");
    // Даже если строк уже нет, текущий access-токен должен перестать работать сразу.
    await this.blockFamilies([...new Set([...families, principal.sessionId])]);
  }

  /**
   * Все сессии аккаунта (отзыв согласия родителем, перевыпуск карточки, блокировка) — в транзакции `db`.
   * Возвращает отозванные семейства: стоп-лист обновляет вызывающий после фиксации (blockFamilies).
   */
  async revokeAccount(db: Db, accountId: string, reason: RevokeReason): Promise<string[]> {
    const rows = await db
      .update(sessions)
      .set({ revokedAt: new Date(), revokeReason: reason })
      .where(and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt)))
      .returning({ familyId: sessions.familyId });
    return [...new Set(rows.map((r) => r.familyId))];
  }

  /**
   * Все сессии аккаунта, кроме семейства `keepFamilyId` (перевыпуск личной карточки владельцем, ADR 0022): тот, кто
   * успел войти потерянной карточкой, выходит на всех устройствах, а владелец остаётся на своём.
   */
  async revokeAccountExcept(db: Db, accountId: string, keepFamilyId: string, reason: RevokeReason): Promise<string[]> {
    const rows = await db
      .update(sessions)
      .set({ revokedAt: new Date(), revokeReason: reason })
      .where(and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt), sql`${sessions.familyId} <> ${keepFamilyId}`))
      .returning({ familyId: sessions.familyId });
    return [...new Set(rows.map((r) => r.familyId))];
  }

  /** Устройство текущей сессии (`did` access-токена) — для заявки в класс уже вошедшего ученика (ADR 0022). */
  async deviceInfo(accountId: string, deviceId: string): Promise<DeviceInfo | undefined> {
    const [row] = await this.db
      .select({ installId: devices.installId, platform: devices.platform, appVersion: devices.appVersion })
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.accountId, accountId)));
    return row ? { installId: row.installId, platform: row.platform, ...(row.appVersion ? { appVersion: row.appVersion } : {}) } : undefined;
  }

  /** Сессии аккаунта на одном устройстве (повторная выдача сессии по коду класса) — как revokeAccount. */
  async revokeDevice(db: Db, accountId: string, installId: string, reason: RevokeReason): Promise<string[]> {
    const rows = await db
      .update(sessions)
      .set({ revokedAt: new Date(), revokeReason: reason })
      .where(
        and(
          eq(sessions.accountId, accountId),
          isNull(sessions.revokedAt),
          sql`${sessions.deviceId} IN (SELECT ${devices.id} FROM ${devices} WHERE ${devices.accountId} = ${accountId} AND ${devices.installId} = ${installId})`,
        ),
      )
      .returning({ familyId: sessions.familyId });
    return [...new Set(rows.map((r) => r.familyId))];
  }

  /** Отозвано ли семейство (стоп-лист проверяется на каждом запросе; Valkey недоступен — 503). */
  async isFamilyRevoked(familyId: string): Promise<boolean> {
    try {
      return (await this.valkey.exists(`sid-revoked:${familyId}`)) === 1;
    } catch {
      throw unavailable();
    }
  }

  /** Стоп-лист семейств на срок жизни access-токена: отозванный access-токен перестаёт работать сразу. */
  async blockFamilies(familyIds: readonly string[]): Promise<void> {
    if (familyIds.length === 0) return;
    try {
      const multi = this.valkey.multi();
      for (const id of familyIds) multi.set(`sid-revoked:${id}`, "1", "EX", ACCESS_TOKEN_TTL_SECONDS);
      await multi.exec();
    } catch (e) {
      this.logger.error(`session stop-list update failed: ${e instanceof Error ? e.message : String(e)}`);
      throw unavailable();
    }
  }

  /** Предъявлен уже ротированный токен: льготное окно потерянного ответа или повторное использование. */
  private async replayed(row: SessionRow, ref: AccountRef, deviceInstallId: string, meta: RequestMeta, valkeyDown: boolean) {
    const successor = await this.graceSuccessor(row, deviceInstallId);
    if (successor) {
      // Похоже на потерянный ответ, но без Valkey обновлять нельзя (лимиты, стоп-лист) — 503, ничего не меняя.
      if (valkeyDown) throw unavailable();
      const tokens = await this.graceRotate(row, successor, ref);
      if (tokens) return { tokens, accountId: row.accountId };
    }
    return this.reuseDetected(row, ref, meta);
  }

  /** Преемник ротированного токена, если повтор подходит под льготное окно (ADR 0015 §2), иначе undefined. */
  private async graceSuccessor(row: SessionRow, deviceInstallId: string): Promise<SessionRow | undefined> {
    const now = Date.now();
    if (!row.rotatedAt || row.revokedAt || !row.replacedById || now - row.rotatedAt.getTime() > REFRESH_GRACE_MS) return undefined;
    if (row.familyExpiresAt.getTime() <= now) return undefined;
    const [device] = await this.db.select({ installId: devices.installId }).from(devices).where(eq(devices.id, row.deviceId));
    if (device?.installId !== deviceInstallId) return undefined;
    const [account] = await this.db.select({ status: accounts.status }).from(accounts).where(eq(accounts.id, row.accountId));
    if (account?.status !== "active") return undefined;
    const [successor] = await this.db.select().from(sessions).where(eq(sessions.id, row.replacedById));
    return successor && !successor.rotatedAt && !successor.revokedAt ? successor : undefined;
  }

  /**
   * Новая пара вместо неполученной: преемник отзывается (`superseded`), новый токен становится преемником `row`.
   * Преемника успели использовать или заменить параллельно — undefined (это уже повторное использование).
   */
  private async graceRotate(row: SessionRow, successor: SessionRow, ref: AccountRef): Promise<SessionTokens | undefined> {
    const now = new Date();
    const life = ref.kind === "staff" ? LIFETIME.staff : LIFETIME.default;
    return this.db.transaction(async (tx) => {
      const [replaced] = await tx
        .update(sessions)
        .set({ revokedAt: now, revokeReason: "superseded" })
        .where(and(eq(sessions.id, successor.id), isNull(sessions.rotatedAt), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      if (!replaced) return undefined;
      const newId = uuidv7();
      const tokens = await this.mint(tx, ref, row, life.sliding, now, newId);
      await tx.update(sessions).set({ replacedById: newId }).where(eq(sessions.id, row.id));
      await tx.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, row.deviceId));
      return tokens;
    });
  }

  /**
   * Повторное использование: семейство отзывается, в аудит — один раз на семейство, при переходе в «отозвано»
   * (тот, у кого есть один старый токен, не может засорять журнал). Переход сериализуется рекомендательной
   * блокировкой семейства. Повтор по уже отозванному семейству — молча 401. Стоп-лист — после фиксации.
   */
  private async reuseDetected(row: SessionRow, ref: AccountRef, meta: RequestMeta): Promise<never> {
    const transitioned = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`teletau:session-family:${row.familyId}`}, 0))`);
      const revoked = await this.revokeFamilyRows(tx, row.familyId, "refresh_reuse");
      if (revoked === 0) return false;
      await this.audit.record(tx, {
        action: "session.refresh_reuse_detected",
        actor: ref,
        target: { type: "session", id: row.familyId },
        metadata: { reason: "refresh_reuse" },
        meta,
      });
      return true;
    });
    if (!transitioned) {
      const [reused] = await this.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.familyId, row.familyId), eq(sessions.revokeReason, "refresh_reuse")))
        .limit(1);
      throw unauthorized(reused ? "refresh_reused" : "session_revoked");
    }
    this.logger.warn(`refresh token reuse detected, session family ${row.familyId} revoked`);
    await this.blockFamilies([row.familyId]);
    throw unauthorized("refresh_reused");
  }

  /** Отзывает действующие строки семейства (без стоп-листа); возвращает, сколько строк отозвано. */
  private async revokeFamilyRows(db: Db, familyId: string, reason: RevokeReason): Promise<number> {
    const rows = await db
      .update(sessions)
      .set({ revokedAt: new Date(), revokeReason: reason })
      .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.length;
  }

  private async mint(
    db: Db,
    account: AccountRef,
    family: Pick<SessionRow, "familyId" | "deviceId" | "familyExpiresAt">,
    slidingMs: number,
    now: Date,
    id: string = uuidv7(),
  ): Promise<SessionTokens> {
    const refreshToken = `ttr_${randomTokenB64(32)}`;
    const expiresAt = new Date(Math.min(now.getTime() + slidingMs, family.familyExpiresAt.getTime()));
    await db.insert(sessions).values({
      id,
      familyId: family.familyId,
      accountId: account.accountId,
      deviceId: family.deviceId,
      refreshHash: sha256Hex(refreshToken),
      expiresAt,
      familyExpiresAt: family.familyExpiresAt,
    });
    const access = await this.tokens.sign({ ...account, sessionId: family.familyId, deviceId: family.deviceId }, now);
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: expiresAt.toISOString(),
      tokenType: "Bearer",
    };
  }
}
