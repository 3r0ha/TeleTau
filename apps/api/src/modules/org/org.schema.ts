// Таблицы модуля org (ADR 0014): справочник районов и школ, классы, места с QR-карточками, членство, заявки на вход.
// Ссылки на аккаунты (модуль identity) — просто uuid без внешнего ключа: модуль не зависит от чужих таблиц,
// целостность обеспечивают сервисы и доменные события (выделение модуля в сервис не потребует ломать схему).
// Секреты — только хешами (ADR 0016): карточка — SHA-256 секрета, код класса — HMAC, токен опроса — SHA-256 (hex).
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgEnum, pgTable, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { hashHex, isHex64, primaryId, timestamps, tstz } from "../../db/columns.js";

export const districtKind = pgEnum("org_district_kind", ["municipal_district", "urban_okrug"]);
export const schoolCategory = pgEnum("org_school_category", ["city_large", "city_small", "rural", "small_rural"]);
export const classProgram = pgEnum("org_class_program", ["native", "state", "elective"]);
export const classStatus = pgEnum("org_class_status", ["active", "archived"]);
/** Статус выпущенной карточки: active — действует; revoked — отозвана или перевыпущена. */
export const cardStatus = pgEnum("org_card_status", ["active", "revoked"]);
export const membershipRole = pgEnum("org_membership_role", ["student", "teacher", "assistant"]);
export const joinRequestStatus = pgEnum("org_join_request_status", ["pending", "approved", "rejected", "expired", "consumed"]);

/** Районы и городские округа РБ. Справочник собирается из открытых источников (поле source). */
export const districts = pgTable(
  "districts",
  {
    id: primaryId(),
    oktmo: text("oktmo").notNull(),
    nameRu: text("name_ru").notNull(),
    nameBa: text("name_ba"),
    kind: districtKind("kind").notNull(),
    /** Откуда запись (например, `oktmo-2026`, `demo`). */
    source: text("source").notNull(),
    isDemo: boolean("is_demo").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("districts_oktmo_uq").on(t.oktmo),
    check("districts_oktmo_digits", sql`${t.oktmo} ~ '^[0-9]{8}([0-9]{3})?$' OR ${t.isDemo}`),
  ],
);

export const schools = pgTable(
  "schools",
  {
    id: primaryId(),
    districtId: uuid("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "restrict" }),
    nameRu: text("name_ru").notNull(),
    shortNameRu: text("short_name_ru").notNull(),
    nameBa: text("name_ba"),
    inn: text("inn"),
    address: text("address"),
    category: schoolCategory("category"),
    /** Обучение на башкирском; NULL — неизвестно. */
    bashkirMedium: boolean("bashkir_medium"),
    /** Откуда запись (реестр, сайт управления образованием, `demo`). */
    source: text("source").notNull(),
    isDemo: boolean("is_demo").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("schools_inn_uq").on(t.inn).where(sql`${t.inn} IS NOT NULL`),
    index("schools_district_idx").on(t.districtId),
    // Триграммы по тому же выражению, что в поиске (directory.service.ts): свёртка bashkir-text и «№ 1» = «№1».
    // Функция org_search_fold создаётся миграцией 0004 (её тело — порт FOLD_MAP, сверяется тестами).
    index("schools_name_ru_fold_trgm_idx").using("gin", sql`org_search_fold(${t.nameRu}) gin_trgm_ops`),
    index("schools_short_name_ru_fold_trgm_idx").using("gin", sql`org_search_fold(${t.shortNameRu}) gin_trgm_ops`),
    check("schools_inn_digits", sql`${t.inn} IS NULL OR ${t.inn} ~ '^[0-9]{10}$'`),
  ],
);

export const classes = pgTable(
  "classes",
  {
    id: primaryId(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "restrict" }),
    /** Учитель-владелец (identity.accounts.id, без внешнего ключа — другой модуль). */
    teacherAccountId: uuid("teacher_account_id").notNull(),
    grade: smallint("grade").notNull(),
    /** Литера в нормализованном виде (пакет bashkir-text): «Б», «Ә», «1». */
    letter: text("letter").notNull(),
    program: classProgram("program").notNull(),
    /** Год начала учебного года (2026 — для 2026/27). */
    academicYear: smallint("academic_year").notNull(),
    status: classStatus("status").notNull().default("active"),
    /** Действующий код класса: только HMAC-SHA-256 кода в hex и срок; новый код заменяет старый. */
    joinCodeHash: hashHex("join_code_hash"),
    joinCodeExpiresAt: tstz("join_code_expires_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("classes_join_code_hash_uq").on(t.joinCodeHash).where(sql`${t.joinCodeHash} IS NOT NULL`),
    uniqueIndex("classes_teacher_identity_uq").on(t.teacherAccountId, t.schoolId, t.grade, t.letter, t.program, t.academicYear),
    index("classes_school_idx").on(t.schoolId),
    index("classes_teacher_idx").on(t.teacherAccountId),
    check("classes_grade_range", sql`${t.grade} BETWEEN 1 AND 11`),
    check("classes_letter_length", sql`char_length(${t.letter}) BETWEEN 1 AND 3`),
    check("classes_join_code_pair", sql`(${t.joinCodeHash} IS NULL) = (${t.joinCodeExpiresAt} IS NULL)`),
    check("classes_join_code_hex", sql`${t.joinCodeHash} IS NULL OR ${isHex64(t.joinCodeHash)}`),
  ],
);

/**
 * Место в классе. Связь «номер места ↔ ребёнок» знает только учитель (подпись на карточке, ADR 0009).
 * Статус карточки места выводится из seat_cards: есть active — «active»; есть только revoked — «revoked»; нет — «none».
 */
export const classSeats = pgTable(
  "class_seats",
  {
    id: primaryId(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    seatNumber: smallint("seat_number").notNull(),
    /** Ученик на месте (identity.accounts.id); NULL — место ещё никто не занял. */
    accountId: uuid("account_id"),
    boundAt: tstz("bound_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("class_seats_class_number_uq").on(t.classId, t.seatNumber),
    uniqueIndex("class_seats_class_account_uq").on(t.classId, t.accountId).where(sql`${t.accountId} IS NOT NULL`),
    index("class_seats_account_idx").on(t.accountId),
    check("class_seats_number_range", sql`${t.seatNumber} BETWEEN 1 AND 99`),
    check("class_seats_bound_pair", sql`(${t.accountId} IS NULL) = (${t.boundAt} IS NULL)`),
  ],
);

/**
 * QR-карточки мест — история выпусков (ADR 0016). handle — публичный идентификатор из полезной нагрузки
 * (`seat`, 10 символов), secret_hash — SHA-256 секрета. Перевыпуск отзывает активную карточку и добавляет новую,
 * поэтому вход по старой карточке отвечает «card_revoked», а не «card_invalid».
 */
export const seatCards = pgTable(
  "seat_cards",
  {
    id: primaryId(),
    seatId: uuid("seat_id")
      .notNull()
      .references(() => classSeats.id, { onDelete: "cascade" }),
    /** Номер выпуска для места: 1, 2, … */
    version: integer("version").notNull(),
    handle: text("handle").notNull(),
    secretHash: hashHex("secret_hash").notNull(),
    status: cardStatus("status").notNull().default("active"),
    issuedByAccountId: uuid("issued_by_account_id").notNull(),
    issuedAt: tstz("issued_at").notNull().defaultNow(),
    revokedAt: tstz("revoked_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("seat_cards_handle_uq").on(t.handle),
    uniqueIndex("seat_cards_seat_version_uq").on(t.seatId, t.version),
    uniqueIndex("seat_cards_one_active_uq").on(t.seatId).where(sql`${t.status} = 'active'`),
    check("seat_cards_version_positive", sql`${t.version} >= 1`),
    check("seat_cards_handle_format", sql`${t.handle} ~ '^[0-9A-HJKMNP-TV-Z]{10}$'`),
    check("seat_cards_secret_hex", isHex64(t.secretHash)),
    check("seat_cards_revoked_pair", sql`(${t.status} = 'revoked') = (${t.revokedAt} IS NOT NULL)`),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: primaryId(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    role: membershipRole("role").notNull(),
    seatId: uuid("seat_id").references(() => classSeats.id, { onDelete: "set null" }),
    joinedAt: tstz("joined_at").notNull().defaultNow(),
    leftAt: tstz("left_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("memberships_active_uq").on(t.classId, t.accountId).where(sql`${t.leftAt} IS NULL`),
    index("memberships_account_idx").on(t.accountId),
  ],
);

/** Заявки на вход по коду класса: ученик выбрал ник, учитель одобряет на экране. */
export const joinRequests = pgTable(
  "join_requests",
  {
    id: primaryId(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    nicknameKey: text("nickname_key").notNull(),
    nickname: text("nickname").notNull(),
    status: joinRequestStatus("status").notNull().default("pending"),
    /** SHA-256 секрета опроса (заголовок X-Poll-Token). */
    pollTokenHash: hashHex("poll_token_hash").notNull(),
    deviceInstallId: uuid("device_install_id").notNull(),
    devicePlatform: text("device_platform").notNull(),
    appVersion: text("app_version"),
    /** Созданный при одобрении детский аккаунт и выданное место. */
    accountId: uuid("account_id"),
    /**
     * Заявка уже вошедшего ученика «Учусь сам» (POST /me/class-join, ADR 0022, 0010): при одобрении место
     * привязывается к этому аккаунту, нового аккаунта нет. Сессию такая заявка не выдаёт — у ученика она уже есть.
     */
    requesterAccountId: uuid("requester_account_id"),
    seatId: uuid("seat_id").references(() => classSeats.id, { onDelete: "set null" }),
    decidedByAccountId: uuid("decided_by_account_id"),
    decidedAt: tstz("decided_at"),
    expiresAt: tstz("expires_at").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("join_requests_poll_token_uq").on(t.pollTokenHash),
    index("join_requests_class_status_idx").on(t.classId, t.status, t.createdAt),
    // Выдача по заявкам аккаунта (JoinGrants.close при каждом отзыве сессий): без индекса — полный просмотр
    // таблицы, которая не чистится, под блокировками класса и места. Предикат — тот же литерал, что в запросе.
    index("join_requests_account_grant_idx").on(t.accountId).where(sql`${t.status} IN ('approved', 'consumed')`),
    check("join_requests_poll_token_hex", isHex64(t.pollTokenHash)),
    check("join_requests_platform", sql`${t.devicePlatform} IN ('web', 'ios', 'android', 'bot')`),
  ],
);
