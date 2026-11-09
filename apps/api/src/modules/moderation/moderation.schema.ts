// Таблицы модуля moderation (ADR 0014): заявки на подтверждение учителя.
// ФИО и должность заявителя — ПДн, они лежат в pii.adult_profiles (модуль identity); здесь — только ссылки и решение.
// Причина отказа — свободный текст модератора, в нём бывают ПДн («Иванова не работает в школе с …»), поэтому она
// хранится в схеме pii (отдельные права доступа), в таблице модуля moderation `pii.teacher_verification_reasons` (0004).
import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgEnum, pgSchema, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { primaryId, timestamps, tstz } from "../../db/columns.js";

export const teacherVerificationStatus = pgEnum("moderation_teacher_verification_status", ["pending", "approved", "rejected"]);

export const teacherVerifications = pgTable(
  "teacher_verifications",
  {
    id: primaryId(),
    /** Заявитель (identity.accounts.id) и школа (org.schools.id) — без внешних ключей: другие модули. */
    accountId: uuid("account_id").notNull(),
    schoolId: uuid("school_id").notNull(),
    /**
     * Устарело с 0003 и всегда NULL: должность — ПДн, хранится в pii.adult_profiles.position.
     * Колонка удаляется контрактной миграцией, до этого её не читают и не пишут.
     */
    position: text("position"),
    status: teacherVerificationStatus("status").notNull().default("pending"),
    decidedByAccountId: uuid("decided_by_account_id"),
    decidedAt: tstz("decided_at"),
    /**
     * Устарело с 0004 и всегда NULL: причина отказа — в pii.teacher_verification_reasons (данные перенесены миграцией).
     * Колонка удаляется контрактной миграцией, до этого её не читают и не пишут.
     */
    decisionReason: text("decision_reason"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("teacher_verifications_one_pending_uq").on(t.accountId).where(sql`${t.status} = 'pending'`),
    index("teacher_verifications_queue_idx").on(t.status, t.createdAt),
    index("teacher_verifications_account_idx").on(t.accountId),
    check(
      "teacher_verifications_decision_pair",
      sql`(${t.status} = 'pending') = (${t.decidedAt} IS NULL) AND (${t.decidedAt} IS NULL) = (${t.decidedByAccountId} IS NULL)`,
    ),
    check("teacher_verifications_position_unused", sql`${t.position} IS NULL`),
    check("teacher_verifications_reason_unused", sql`${t.decisionReason} IS NULL`),
  ],
);

/** Схема pii — отдельные права доступа (создана миграцией 0000_init); здесь — для таблицы причин отказа. */
const pii = pgSchema("pii");

/** Причина отказа модератора (видна заявителю и модераторам): по строке на отклонённую заявку. */
export const teacherVerificationReasons = pii.table(
  "teacher_verification_reasons",
  {
    verificationId: uuid("verification_id").primaryKey(),
    reason: text("reason").notNull(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({ name: "teacher_verification_reasons_verification_fk", columns: [t.verificationId], foreignColumns: [teacherVerifications.id] }).onDelete("cascade"),
  ],
);
