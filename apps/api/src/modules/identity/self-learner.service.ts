// Самостоятельное обучение (ADR 0022): «Учусь сам» без школы и без ПДн, личная карточка входа, почта для взрослого,
// вступление в класс уже вошедшего ученика. Дети не передают ничего личного: ник из словаря и возрастной
// диапазон (без возраста по годам); взрослый может привязать почту, ребёнок — только карточку.
//
// Личная карточка `TP1.<handle>.<secret>.<check>` принадлежит аккаунту, а не месту класса: секрет — SHA-256 для
// проверки за постоянное время и шифртекст AES-256-GCM, чтобы показать QR владельцу снова (как TOTP-секрет, ADR 0015).
// Вход по ней — под теми же лимитами неудач, что карточка места (общий счётчик IP — подбор не удваивается).
import { Inject, Injectable } from "@nestjs/common";
import { buildPersonalCardPayload, generatePersonalCard, parseLoginCard } from "@teletau/auth-codes";
import type { Schema } from "@teletau/contracts";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Principal, RequestMeta } from "../../common/auth.js";
import { decrypt, encrypt, hexEquals, sha256Hex } from "../../common/crypto.js";
import { conflict, forbidden, invalidField, notFound, unauthorized, unprocessable } from "../../common/problem.js";
import { uuidv7 } from "../../common/uuidv7.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { encryptionKey } from "../../config/secrets.js";
import { pgErrorCode, type Db } from "../../db/database.js";
import { RateLimiter, type Limit } from "../../infra/rate-limiter.js";
import { DB } from "../../infra/tokens.js";
import { AuditService } from "../admin/index.js";
import { ClassesService, JoinService } from "../org/index.js";
import { AccountsService, type AccountRow } from "./accounts.service.js";
import { accounts, loginCards } from "./identity.schema.js";
import { nicknameById } from "./nicknames.js";
import { OtpService } from "./otp.service.js";
import { SessionsService, type DeviceInfo, type SessionTokens } from "./sessions.service.js";
import { CLASS_CODE_IP_FAILURES, CLASS_CODE_IP_REQUESTS, QR_CARD_FAILURES, QR_IP_FAILURES } from "./student-login.service.js";

const MINUTE = 60_000;
/** Защита от массового создания аккаунтов «Учусь сам»: 20 в час с одного IP (семья, библиотека, класс за NAT). */
export const SELF_SIGNUP_IP: Limit = { max: 20, windowMs: 60 * MINUTE };
/** Перевыпуск личной карточки — не чаще 10 раз в час на аккаунт. */
export const LOGIN_CARD_ISSUES: Limit = { max: 10, windowMs: 60 * MINUTE };
/** Неверные коды класса при вступлении из профиля — 10 в минуту на аккаунт (как на устройство у входа по коду). */
export const CLASS_JOIN_ACCOUNT_FAILURES: Limit = { max: 10, windowMs: MINUTE };

type LoginCardRow = typeof loginCards.$inferSelect;

export interface SelfSession {
  tokens: SessionTokens;
  accountId: string;
}

@Injectable()
export class SelfLearnerService {
  private readonly key: Buffer;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly limiter: RateLimiter,
    private readonly accounts: AccountsService,
    private readonly sessions: SessionsService,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
    private readonly classes: ClassesService,
    private readonly join: JoinService,
  ) {
    this.key = encryptionKey(config);
  }

  // ── «Учусь сам» ──

  /** POST /auth/self: аккаунт без ПДн и первая сессия на устройстве. */
  async signup(body: Schema<"SelfSignupRequest">, meta: RequestMeta): Promise<SelfSession> {
    const nickname = nicknameById(body.nicknameId);
    if (!nickname) throw invalidField("/nicknameId", "Такого ника нет в словаре — выбери из предложенных");
    await this.limiter.consume(`self:ip:${this.limiter.ipKey(meta.ip)}`, SELF_SIGNUP_IP);
    return this.db.transaction(async (tx) => {
      const account = await this.accounts.createSelfLearner(tx, {
        band: body.ageBand,
        nicknameKey: nickname.id,
        nickname: nickname.text,
        ...(body.dailyGoal !== undefined ? { dailyGoal: body.dailyGoal } : {}),
      });
      await this.accounts.touchLogin(tx, account.id);
      const tokens = await this.sessions.issue(tx, { accountId: account.id, kind: account.kind, roles: account.roles }, body.device);
      return { tokens, accountId: account.id };
    });
  }

  // ── личная карточка входа ──

  /**
   * Кому положена личная карточка: аккаунт «Учусь сам» (ребёнок или взрослый) без почты и без ролей учителя
   * и сотрудника. Ученик класса входит по карточке места — её контролирует учитель (перевыпуск, отзыв согласия);
   * взрослый с почтой входит по почте: карточка без второго шага раскрывала бы его адрес.
   */
  async cardAvailable(account: Pick<AccountRow, "id" | "kind" | "roles" | "selfSignup" | "status">, db: Db = this.db): Promise<boolean> {
    if (!account.selfSignup || account.status !== "active" || account.kind === "staff") return false;
    if (account.roles.some((r) => r !== "student")) return false;
    return !(await this.accounts.hasEmail(account.id, db));
  }

  /** Состояние карточки для GET /me: undefined — не положена, none — можно сделать, issued — выпущена. */
  async cardStatus(account: AccountRow): Promise<Schema<"LoginCardStatus"> | undefined> {
    if (!(await this.cardAvailable(account))) return undefined;
    return (await this.liveCard(this.db, account.id)) ? "issued" : "none";
  }

  /** GET /me/login-card: действующая карточка владельцу (секрет — расшифровкой); нет карточки — 404. */
  async myCard(principal: Principal): Promise<Schema<"LoginCard">> {
    await this.requireCardAccount(principal.accountId);
    const card = await this.liveCard(this.db, principal.accountId);
    if (!card) throw notFound();
    return this.view(card, decrypt(this.key, card.secretEnc, `login-card:${card.id}`));
  }

  /**
   * POST /me/login-card: выпуск или перевыпуск. Под блокировкой строки аккаунта (FOR UPDATE) — два нажатия подряд
   * дают два выпуска по очереди, а не два действующих. Прежняя карточка отзывается, сессии аккаунта на других
   * устройствах завершаются (тот, кто вошёл потерянной карточкой, выходит сразу), текущая остаётся.
   */
  async issueCard(principal: Principal, meta: RequestMeta): Promise<Schema<"LoginCard">> {
    await this.requireCardAccount(principal.accountId);
    await this.limiter.consume(`login-card:issue:${principal.accountId}`, LOGIN_CARD_ISSUES);
    const fresh = generatePersonalCard();
    let revoked: string[] = [];
    const row = await this.db.transaction(async (tx) => {
      const [account] = await tx.select().from(accounts).where(eq(accounts.id, principal.accountId)).for("update");
      if (!account || !(await this.cardAvailable(account, tx))) throw forbidden("login_card_unavailable");
      const previous = await this.liveCard(tx, account.id);
      const [last] = await tx
        .select({ version: loginCards.version })
        .from(loginCards)
        .where(eq(loginCards.accountId, account.id))
        .orderBy(desc(loginCards.version))
        .limit(1);
      const now = new Date();
      if (previous) {
        await tx.update(loginCards).set({ revokedAt: now, updatedAt: now }).where(eq(loginCards.id, previous.id));
        revoked = await this.sessions.revokeAccountExcept(tx, account.id, principal.sessionId, "card_reissued");
      }
      const id = uuidv7();
      const [inserted] = await tx
        .insert(loginCards)
        .values({
          id,
          accountId: account.id,
          handle: fresh.handle,
          secretHash: sha256Hex(fresh.secret),
          secretEnc: encrypt(this.key, fresh.secret, `login-card:${id}`),
          version: (last?.version ?? 0) + 1,
        })
        .returning();
      if (previous) {
        await this.audit.record(tx, {
          action: "login_card.reissued",
          actor: principal,
          target: { type: "account", id: account.id },
          metadata: { version: inserted!.version, sessionsRevoked: revoked.length },
          meta,
        });
      }
      return inserted!;
    });
    await this.sessions.blockFamilies(revoked);
    return this.view(row, fresh.secret);
  }

  /**
   * POST /auth/login-card. Порядок — как у карточки места (ADR 0016 §5): разбор и секрет под лимитами неудач (IP —
   * общий с карточкой места, карточка — свой счётчик), затем — карточка действует, аккаунт активен, согласие ни на
   * одном его месте в классе не отозвано (ClassesService.admitAccount). Неудачи — только неверный разбор и секрет.
   */
  async loginWithCard(body: Schema<"LoginCardLoginRequest">, meta: RequestMeta): Promise<SelfSession> {
    const card = await this.checkCard(body.payload, meta);
    return this.db.transaction(async (tx) => {
      const [account] = await tx.select().from(accounts).where(eq(accounts.id, card.accountId));
      if (!account || account.status !== "active") throw forbidden();
      await this.classes.admitAccount(tx, account.id);
      await tx.update(loginCards).set({ lastUsedAt: new Date() }).where(eq(loginCards.id, card.id));
      await this.accounts.touchLogin(tx, account.id);
      const tokens = await this.sessions.issue(tx, { accountId: account.id, kind: account.kind, roles: account.roles }, body.device as DeviceInfo);
      return { tokens, accountId: account.id };
    });
  }

  private async checkCard(payload: string, meta: RequestMeta): Promise<LoginCardRow> {
    const ip = await this.limiter.reserve(`qr:ip:${this.limiter.ipKey(meta.ip)}`, QR_IP_FAILURES);
    try {
      const parsed = parseLoginCard(payload);
      if (!parsed.ok || parsed.kind !== "personal") {
        await ip.fail();
        throw unprocessable("payload_invalid");
      }
      const attempt = await this.limiter.reserve(`login-card:handle:${parsed.handle}`, QR_CARD_FAILURES);
      try {
        const [row] = await this.db.select().from(loginCards).where(eq(loginCards.handle, parsed.handle));
        // Сравнение за постоянное время и для несуществующей карточки (ADR 0016 §3).
        if (!hexEquals(row?.secretHash ?? sha256Hex("teletau:no-such-card"), sha256Hex(parsed.secret)) || !row) {
          await Promise.all([ip.fail(), attempt.fail()]);
          throw unauthorized("card_invalid");
        }
        if (row.revokedAt) throw forbidden("card_revoked");
        return row;
      } finally {
        await attempt.release();
      }
    } finally {
      await ip.release();
    }
  }

  private async requireCardAccount(accountId: string): Promise<AccountRow> {
    const account = await this.accounts.get(accountId);
    if (!account || !(await this.cardAvailable(account))) throw forbidden("login_card_unavailable");
    return account;
  }

  private async liveCard(db: Db, accountId: string): Promise<LoginCardRow | undefined> {
    const [row] = await db
      .select()
      .from(loginCards)
      .where(and(eq(loginCards.accountId, accountId), isNull(loginCards.revokedAt)));
    return row;
  }

  private view(card: LoginCardRow, secret: string): Schema<"LoginCard"> {
    return { payload: buildPersonalCardPayload(card.handle, secret), version: card.version, issuedAt: card.createdAt.toISOString() };
  }

  // ── почта взрослого ──

  /**
   * POST /me/email: взрослый «Учусь сам» без почты привязывает подтверждённый адрес. Адрес другого аккаунта —
   * 409 email_in_use (код из письма при этом израсходован: он подтверждает только владение адресом). Личная
   * карточка отзывается — дальше вход по почте.
   */
  async attachEmail(principal: Principal, body: Schema<"AttachEmailRequest">, meta: RequestMeta): Promise<void> {
    const account = await this.accounts.get(principal.accountId);
    if (!account || account.kind !== "adult") throw forbidden();
    if (await this.accounts.hasEmail(account.id)) throw conflict("email_already_set");
    const { email, subject } = await this.otp.consumeChallenge(body.challengeId, body.code);
    const owner = await this.accounts.findByEmailSubject(subject);
    if (owner) throw conflict(owner.id === account.id ? "email_already_set" : "email_in_use");
    try {
      await this.db.transaction(async (tx) => {
        await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, account.id)).for("update");
        if (await this.accounts.hasEmail(account.id, tx)) throw conflict("email_already_set");
        await this.accounts.attachEmail(tx, account.id, email);
        await tx
          .update(loginCards)
          .set({ revokedAt: sql`now()`, updatedAt: sql`now()` })
          .where(and(eq(loginCards.accountId, account.id), isNull(loginCards.revokedAt)));
        await this.audit.record(tx, { action: "account.email_attached", actor: principal, target: { type: "account", id: account.id }, meta });
      });
    } catch (e) {
      // Гонка с другим аккаунтом за тот же адрес: уникальные индексы credentials и pii.adult_profiles.
      if (pgErrorCode(e) === "23505") throw conflict("email_in_use");
      throw e;
    }
  }

  // ── вступление в класс ──

  /**
   * POST /me/class-join: заявка в класс от уже вошедшего ученика без класса. Код проверяется под теми же лимитами,
   * что вход по коду (неверные — 10 в минуту на аккаунт, 100 с IP; верные — 300 с IP), очередь класса — та же
   * (JoinService.createRequest: 40 ожидающих, с одного устройства — одна). Ник и устройство — из аккаунта и сессии.
   */
  async requestClassJoin(principal: Principal, body: Schema<"ClassJoinRequest">, meta: RequestMeta): Promise<Schema<"ClassJoinTicket">> {
    const account = await this.accounts.get(principal.accountId);
    if (!account || account.kind !== "child" || !account.nickname || !account.nicknameKey) throw forbidden();
    const mine = await this.classes.myClasses({ accountId: account.id, roles: account.roles });
    if (mine.some((c) => c.role === "student")) throw conflict("already_in_class");
    const device = await this.sessions.deviceInfo(account.id, principal.deviceId);
    if (!device) throw unauthorized("session_revoked");
    const ip = this.limiter.ipKey(meta.ip);
    const own = await this.limiter.reserve(`class-code:account:${account.id}`, CLASS_JOIN_ACCOUNT_FAILURES);
    let cls;
    try {
      const network = await this.limiter.reserve(`class-code:ip:${ip}`, CLASS_CODE_IP_FAILURES);
      try {
        cls = await this.join.findClassByCode(body.code);
        if (!cls) {
          await Promise.all([own.fail(), network.fail()]);
          throw notFound("class_code_not_found");
        }
      } finally {
        await network.release();
      }
    } finally {
      await own.release();
    }
    await this.limiter.consume(`class-code:ok:${ip}`, CLASS_CODE_IP_REQUESTS);
    const ticket = await this.join.createRequest(cls, { key: account.nicknameKey, text: account.nickname }, device, account.id);
    // Секрет опроса не отдаём: статус ученик спрашивает по своей сессии (GET /me/class-join/{id}).
    return { requestId: ticket.requestId, status: ticket.status, expiresAt: ticket.expiresAt, pollIntervalSeconds: ticket.pollIntervalSeconds, class: ticket.class };
  }

  async classJoinStatus(principal: Principal, requestId: string): Promise<Schema<"ClassJoinTicket">> {
    const status = await this.join.requesterStatus(principal.accountId, requestId);
    if (!status) throw notFound();
    return status;
  }
}
