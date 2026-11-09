// Таблицы модуля identity (ADR 0014): аккаунты, учётные данные, устройства, сессии; ПДн взрослых — в схеме pii.
// Детские аккаунты псевдонимны (ADR 0009): ни ФИО, ни e-mail, ни телефона; строк в pii для них нет (триггер в 0002).
// Секреты — только хешами (ADR 0015): refresh-токены — SHA-256; e-mail для поиска — HMAC-SHA-256 с перцем.
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgEnum, pgSchema, pgTable, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { hashHex, isHex64, primaryId, timestamps, tstz } from "../../db/columns.js";

/** child — псевдонимный ребёнок; adult — взрослый (учитель, родитель); staff — сотрудник (модератор, администратор). */
export const accountKind = pgEnum("identity_account_kind", ["child", "adult", "staff"]);
/** Роли RBAC (ADR 0017). teacher выдаётся только после одобрения заявки модератором. */
export const accountRole = pgEnum("identity_account_role", ["student", "teacher", "moderator", "admin", "ministry", "fund"]);
export const accountStatus = pgEnum("identity_account_status", ["active", "blocked", "deleted"]);
export const uiMode = pgEnum("identity_ui_mode", ["bee", "bortnik", "keeper"]);
export const accountLocale = pgEnum("identity_locale", ["ru", "ba"]);
/**
 * Тип учётных данных. QR-карточки принадлежат месту в классе (org.class_seats), а не аккаунту.
 * OAuth-провайдеров нет; enum расширяется добавлением значений (аддитивно).
 */
export const credentialType = pgEnum("identity_credential_type", ["email", "totp"]);
export const devicePlatform = pgEnum("identity_device_platform", ["web", "ios", "android", "bot"]);
export const sessionRevokeReason = pgEnum("identity_session_revoke_reason", [
  "logout",
  "logout_all",
  "refresh_reuse",
  "account_blocked",
  "admin",
  // 0003: семейство отозвано из-за чужого устройства (ADR 0015 §2) или отзыва согласия родителем (ADR 0016 §5)
  "device_mismatch",
  "consent_revoked",
  // 0004: перевыпуск карточки места завершает сессии ученика (ADR 0016 §3); преемник refresh-токена заменён
  // в льготном окне потерянного ответа или повторной выдачей сессии по коду класса (ADR 0015 §2, ADR 0016 §6)
  "card_reissued",
  "superseded",
]);

export const accounts = pgTable(
  "accounts",
  {
    id: primaryId(),
    kind: accountKind("kind").notNull(),
    roles: accountRole("roles").array().notNull().default(sql`'{}'::identity_account_role[]`),
    status: accountStatus("status").notNull().default("active"),
    /** Ключ ника в словаре (например, `a012.n034`) и его текст; у детей и взрослых-учеников, не у сотрудников (0010). */
    nicknameKey: text("nickname_key"),
    nickname: text("nickname"),
    uiMode: uiMode("ui_mode"),
    /** Режим выбрал сам пользователь (PATCH /me) — тогда вход по карточке или коду класса его не меняет (0004). */
    uiModeManual: boolean("ui_mode_manual").notNull().default(false),
    locale: accountLocale("locale").notNull().default("ru"),
    /**
     * «Учусь сам» (ADR 0022, 0010): аккаунт создан без школы и без почты (POST /auth/self). Только таким аккаунтам
     * положена личная карточка входа; возраст по годам не хранится — диапазон задан режимом интерфейса (ui_mode).
     */
    selfSignup: boolean("self_signup").notNull().default(false),
    /** Цель дня, выбранная учеником (1–3 соты); NULL — по умолчанию (domain-rules DAILY_GOAL_LESSONS). */
    dailyGoal: smallint("daily_goal"),
    lastLoginAt: tstz("last_login_at"),
    ...timestamps(),
  },
  (t) => [
    // 0010: ник — у детей и у взрослых, которые учатся (лига); у сотрудников ника нет.
    check("accounts_nickname_not_staff", sql`${t.kind} <> 'staff' OR (${t.nickname} IS NULL AND ${t.nicknameKey} IS NULL)`),
    check("accounts_daily_goal_range", sql`${t.dailyGoal} IS NULL OR ${t.dailyGoal} BETWEEN 1 AND 3`),
    check("accounts_nickname_pair", sql`(${t.nickname} IS NULL) = (${t.nicknameKey} IS NULL)`),
    index("accounts_kind_idx").on(t.kind),
  ],
);

export const credentials = pgTable(
  "credentials",
  {
    id: primaryId(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    type: credentialType("type").notNull(),
    /** Ключ поиска: для email — HMAC-SHA-256(перец, нормализованный адрес) в hex; сам адрес — только в pii.adult_profiles. */
    subject: hashHex("subject"),
    /** Только для TOTP: секрет, зашифрованный ключом из окружения (AES-256-GCM, base64). Хешем TOTP-секрет хранить нельзя. */
    secretEnc: text("secret_enc"),
    verifiedAt: tstz("verified_at"),
    lastUsedAt: tstz("last_used_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("credentials_type_subject_uq").on(t.type, t.subject).where(sql`${t.subject} IS NOT NULL`),
    index("credentials_account_idx").on(t.accountId),
    check("credentials_subject_hex", sql`${t.subject} IS NULL OR ${isHex64(t.subject)}`),
    check("credentials_email_has_subject", sql`${t.type} <> 'email' OR ${t.subject} IS NOT NULL`),
    check("credentials_totp_has_secret", sql`${t.type} <> 'totp' OR ${t.secretEnc} IS NOT NULL`),
  ],
);

export const devices = pgTable(
  "devices",
  {
    id: primaryId(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** UUID установки, который генерирует клиент (DeviceInfo.installId). Один планшет класса — разные строки для разных детей. */
    installId: uuid("install_id").notNull(),
    platform: devicePlatform("platform").notNull(),
    appVersion: text("app_version"),
    lastSeenAt: tstz("last_seen_at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("devices_account_install_uq").on(t.accountId, t.installId)],
);

/**
 * Строка = один refresh-токен. family_id объединяет цепочку ротаций одного входа и попадает в access-токен как `sid`.
 * Предъявление токена с rotated_at IS NOT NULL — повторное использование: отзывается всё семейство (ADR 0015).
 */
export const sessions = pgTable(
  "sessions",
  {
    id: primaryId(),
    familyId: uuid("family_id").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    /** SHA-256 refresh-токена в hex; сам токен не хранится. */
    refreshHash: hashHex("refresh_hash").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    /** Абсолютный срок семейства: ротация не продлевает сессию дальше него. */
    familyExpiresAt: tstz("family_expires_at").notNull(),
    rotatedAt: tstz("rotated_at"),
    replacedById: uuid("replaced_by_id"),
    revokedAt: tstz("revoked_at"),
    revokeReason: sessionRevokeReason("revoke_reason"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("sessions_refresh_hash_uq").on(t.refreshHash),
    index("sessions_family_idx").on(t.familyId),
    index("sessions_account_idx").on(t.accountId),
    check("sessions_refresh_hash_hex", isHex64(t.refreshHash)),
    check("sessions_revoke_reason_pair", sql`(${t.revokedAt} IS NULL) = (${t.revokeReason} IS NULL)`),
  ],
);

/**
 * Личная карточка входа самостоятельного ученика (ADR 0022, миграция 0010): `TP1.<handle>.<secret>.<check>`.
 * Принадлежит аккаунту, а не месту класса (карточки мест — org.seat_cards). Строка — один выпуск; действующая
 * у аккаунта одна (revoked_at IS NULL). Секрет — SHA-256 для проверки за постоянное время и шифртекст AES-256-GCM
 * (AAD `login-card:<id>`, ключ AUTH_ENCRYPTION_KEY) — чтобы показать QR владельцу снова, как TOTP-секрет (ADR 0015 §4).
 */
export const loginCards = pgTable(
  "login_cards",
  {
    id: primaryId(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** Публичная часть карточки (10 символов Crockford) — ключ поиска и лимита попыток. */
    handle: text("handle").notNull(),
    secretHash: hashHex("secret_hash").notNull(),
    secretEnc: text("secret_enc").notNull(),
    version: integer("version").notNull(),
    revokedAt: tstz("revoked_at"),
    lastUsedAt: tstz("last_used_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("login_cards_handle_uq").on(t.handle),
    uniqueIndex("login_cards_account_live_uq").on(t.accountId).where(sql`${t.revokedAt} IS NULL`),
    uniqueIndex("login_cards_account_version_uq").on(t.accountId, t.version),
    check("login_cards_handle_format", sql`${t.handle} ~ '^[0-9A-HJKMNP-TV-Z]{10}$'`),
    check("login_cards_secret_hash_hex", isHex64(t.secretHash)),
    check("login_cards_version_positive", sql`${t.version} >= 1`),
  ],
);

/** Схема pii — отдельные права доступа (создана миграцией 0000_init; здесь — для Drizzle). */
export const pii = pgSchema("pii");

/**
 * ПДн взрослых: e-mail (в нижнем регистре), ФИО и должность (заявка учителя, 0003).
 * Строк для детских аккаунтов нет — запрещено триггером (миграция 0002).
 */
export const adultProfiles = pii.table(
  "adult_profiles",
  {
    accountId: uuid("account_id")
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    fullName: text("full_name"),
    /** Должность из заявки на подтверждение учителя (ПДн взрослого — поэтому здесь, а не в teacher_verifications). */
    position: text("position"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("adult_profiles_email_uq").on(t.email),
    check("adult_profiles_email_lower", sql`${t.email} = lower(${t.email})`),
  ],
);
