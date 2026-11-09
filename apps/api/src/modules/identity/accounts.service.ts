// Аккаунты (модуль identity) и реализация порта ACCOUNTS_PORT для модулей org, moderation и consent.
// Дети — псевдонимные аккаунты без строк в pii (ADR 0009); ПДн взрослых — только в pii.adult_profiles.
import { Inject, Injectable } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { hmacHex } from "../../common/crypto.js";
import type { AccountsPort, AdultProfileView } from "../../common/ports.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { pgErrorCode, type Db } from "../../db/database.js";
import { DB } from "../../infra/tokens.js";
import { JoinGrants } from "../org/index.js";
import { accounts, adultProfiles, credentials } from "./identity.schema.js";
import { SessionsService } from "./sessions.service.js";

export type AccountRow = typeof accounts.$inferSelect;
export type AgeBand = Schema<"AgeBand">;
type UiMode = NonNullable<AccountRow["uiMode"]>;

/** Режим интерфейса по номеру класса (docs/05 §7): 1–4 — «Пчёлка», 5–8 — «Бортник», 9–11 — «Хранитель». */
export function uiModeForGrade(grade: number): NonNullable<AccountRow["uiMode"]> {
  return grade <= 4 ? "bee" : grade <= 8 ? "bortnik" : "keeper";
}

/** Режим интерфейса по возрастному диапазону (ADR 0022): 7–10 — «Пчёлка», 11–14 — «Бортник», 15–17 и взрослые — «Хранитель». */
export const UI_MODE_BY_BAND: Record<AgeBand, UiMode> = { age_7_10: "bee", age_11_14: "bortnik", age_15_17: "keeper", adult: "keeper" };
const CHILD_BAND_BY_MODE: Record<UiMode, AgeBand> = { bee: "age_7_10", bortnik: "age_11_14", keeper: "age_15_17" };

/**
 * Возрастной диапазон без возраста по годам (ADR 0022): у ребёнка он хранится режимом интерфейса (самостоятельный
 * ученик выбрал его сам, ученику класса режим выставлен по номеру класса), взрослый — `adult`. Сотрудник — нет.
 */
export function ageBandOf(a: Pick<AccountRow, "kind" | "uiMode">): AgeBand | undefined {
  if (a.kind === "adult") return "adult";
  if (a.kind === "child" && a.uiMode) return CHILD_BAND_BY_MODE[a.uiMode];
  return undefined;
}

/** Нормализация адреса для поиска и хранения (ADR 0015 §4): trim + нижний регистр. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

@Injectable()
export class AccountsService implements AccountsPort {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly sessions: SessionsService,
    private readonly joinGrants: JoinGrants,
  ) {}

  /** Ключ поиска e-mail: HMAC-SHA-256 с перцем; сам адрес — только в pii.adult_profiles. */
  emailSubject(email: string): string {
    return hmacHex(this.config.AUTH_SECRET_PEPPER, `email:${normalizeEmail(email)}`);
  }

  async get(accountId: string, db: Db = this.db): Promise<AccountRow | undefined> {
    const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    return row;
  }

  async findByEmailSubject(subject: string): Promise<AccountRow | undefined> {
    const [row] = await this.db
      .select({ a: accounts })
      .from(credentials)
      .innerJoin(accounts, eq(accounts.id, credentials.accountId))
      .where(and(eq(credentials.type, "email"), eq(credentials.subject, subject)));
    return row?.a;
  }

  /** Взрослый аккаунт по подтверждённому адресу: e-mail-учётка + строка pii; гонка двух входов — второй находит первый. */
  async findOrCreateAdult(email: string): Promise<AccountRow> {
    const subject = this.emailSubject(email);
    const existing = await this.findByEmailSubject(subject);
    if (existing) return existing;
    try {
      return await this.db.transaction(async (tx) => {
        const [account] = await tx.insert(accounts).values({ kind: "adult" }).returning();
        await tx.insert(credentials).values({ accountId: account!.id, type: "email", subject, verifiedAt: new Date() });
        await tx.insert(adultProfiles).values({ accountId: account!.id, email: normalizeEmail(email) });
        return account!;
      });
    } catch (e) {
      if (pgErrorCode(e) !== "23505") throw e;
      const raced = await this.findByEmailSubject(subject);
      if (!raced) throw e;
      return raced;
    }
  }

  async touchLogin(db: Db, accountId: string): Promise<void> {
    await db.update(accounts).set({ lastLoginAt: new Date() }).where(eq(accounts.id, accountId));
  }

  async update(accountId: string, patch: Partial<Pick<AccountRow, "nicknameKey" | "nickname" | "uiMode" | "uiModeManual" | "locale" | "dailyGoal">>): Promise<void> {
    await this.db.update(accounts).set(patch).where(eq(accounts.id, accountId));
  }

  /**
   * «Учусь сам» (ADR 0022): аккаунт без ПДн — ник из словаря и возрастной диапазон. Диапазоны детей — детский аккаунт
   * с ролью student, `adult` — взрослый без почты (строки pii нет). Режим — по диапазону и «выбран самим» (вход
   * по классу его не меняет).
   */
  async createSelfLearner(db: Db, init: { band: AgeBand; nicknameKey: string; nickname: string; dailyGoal?: number }): Promise<AccountRow> {
    const child = init.band !== "adult";
    const [row] = await db
      .insert(accounts)
      .values({
        kind: child ? "child" : "adult",
        roles: child ? ["student"] : [],
        nicknameKey: init.nicknameKey,
        nickname: init.nickname,
        uiMode: UI_MODE_BY_BAND[init.band],
        uiModeManual: true,
        selfSignup: true,
        dailyGoal: init.dailyGoal ?? null,
      })
      .returning();
    return row!;
  }

  /** Есть ли у аккаунта вход по почте (учётные данные email). */
  async hasEmail(accountId: string, db: Db = this.db): Promise<boolean> {
    const [row] = await db
      .select({ id: credentials.id })
      .from(credentials)
      .where(and(eq(credentials.accountId, accountId), eq(credentials.type, "email")))
      .limit(1);
    return Boolean(row);
  }

  /** Привязать вход по почте (ADR 0022 §10): учётные данные email; взрослому — ещё и адрес в pii. У ребёнка сам адрес не хранится. */
  async attachEmail(db: Db, accountId: string, email: string, kind: "child" | "adult"): Promise<void> {
    await db.insert(credentials).values({ accountId, type: "email", subject: this.emailSubject(email), verifiedAt: new Date() });
    if (kind === "adult") await db.insert(adultProfiles).values({ accountId, email: normalizeEmail(email) });
  }

  /**
   * Режим интерфейса по номеру класса при входе ученика, если ученик не выбирал режим сам (ui_mode_manual).
   * Выставляется при каждом входе: перешёл в 5 класс — «Бортник» без ручной настройки.
   */
  async applyGradeUiMode(db: Db, accountId: string, grade: number): Promise<void> {
    const mode = uiModeForGrade(grade);
    await db
      .update(accounts)
      .set({ uiMode: mode })
      .where(and(eq(accounts.id, accountId), eq(accounts.kind, "child"), eq(accounts.uiModeManual, false), sql`${accounts.uiMode} IS DISTINCT FROM ${mode}`));
  }

  async profile(accountId: string): Promise<AdultProfileView | undefined> {
    return (await this.adultProfiles([accountId])).get(accountId);
  }

  // ── AccountsPort ──

  async createChildAccount(db: Db, init: { nicknameKey?: string; nickname?: string }): Promise<string> {
    const [row] = await db
      .insert(accounts)
      .values({ kind: "child", roles: ["student"], nicknameKey: init.nicknameKey ?? null, nickname: init.nickname ?? null })
      .returning({ id: accounts.id });
    return row!.id;
  }

  async nicknames(accountIds: readonly string[]): Promise<Map<string, string>> {
    if (accountIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: accounts.id, nickname: accounts.nickname })
      .from(accounts)
      .where(and(inArray(accounts.id, [...new Set(accountIds)]), isNotNull(accounts.nickname)));
    return new Map(rows.map((r) => [r.id, r.nickname!]));
  }

  async adultProfiles(accountIds: readonly string[]): Promise<Map<string, AdultProfileView>> {
    if (accountIds.length === 0) return new Map();
    const rows = await this.db.select().from(adultProfiles).where(inArray(adultProfiles.accountId, [...new Set(accountIds)]));
    return new Map(
      rows.map((r) => [
        r.accountId,
        { email: r.email, ...(r.fullName ? { fullName: r.fullName } : {}), ...(r.position ? { position: r.position } : {}) },
      ]),
    );
  }

  async setTeacherProfile(db: Db, accountId: string, profile: { fullName: string; position: string }): Promise<void> {
    await db.update(adultProfiles).set({ fullName: profile.fullName, position: profile.position }).where(eq(adultProfiles.accountId, accountId));
  }

  async grantTeacherRole(db: Db, accountId: string): Promise<void> {
    await db
      .update(accounts)
      .set({ roles: sql`array_append(${accounts.roles}, 'teacher'::identity_account_role)` })
      .where(and(eq(accounts.id, accountId), eq(accounts.kind, "adult"), sql`NOT ('teacher'::identity_account_role = ANY(${accounts.roles}))`));
  }

  /**
   * Все сессии аккаунта — и выдача сессий по его заявкам кода класса: иначе повторный опрос одобренной заявки
   * вернул бы отозванный доступ. Сначала закрываются заявки (их строки блокируются до конца транзакции), потом
   * отзываются сессии: опрос, успевший выдать сессию раньше, её и потеряет, а опрос после — увидит закрытую заявку.
   */
  async revokeAllSessions(db: Db, accountId: string, reason: "consent_revoked" | "account_blocked" | "card_reissued"): Promise<string[]> {
    await this.joinGrants.close(db, accountId);
    return this.sessions.revokeAccount(db, accountId, reason);
  }

  blockSessions(familyIds: readonly string[]): Promise<void> {
    return this.sessions.blockFamilies(familyIds);
  }

  async ageBand(db: Db, accountId: string): Promise<AgeBand | undefined> {
    const [row] = await db.select({ kind: accounts.kind, uiMode: accounts.uiMode }).from(accounts).where(eq(accounts.id, accountId));
    return row ? ageBandOf(row) : undefined;
  }

  async dailyGoalTarget(db: Db, accountId: string): Promise<number | undefined> {
    const [row] = await db.select({ dailyGoal: accounts.dailyGoal }).from(accounts).where(eq(accounts.id, accountId));
    return row?.dailyGoal ?? undefined;
  }

  async republicAccounts(): Promise<{ selfLearnerIds: string[]; teachersVerified: number }> {
    const [self, [teachers]] = await Promise.all([
      this.db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.selfSignup, true), eq(accounts.status, "active"), sql`${accounts.kind} <> 'staff'`)),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(accounts)
        .where(and(eq(accounts.status, "active"), sql`'teacher'::identity_account_role = ANY(${accounts.roles})`)),
    ]);
    return { selfLearnerIds: self.map((r) => r.id), teachersVerified: teachers?.n ?? 0 };
  }
}
