// Таблицы модуля consent (ADR 0014): версии юридических документов и согласия.
// Субъект согласия — взрослый аккаунт (электронное согласие) или место ученика (бумажное согласие родителя,
// отмечает учитель): у ребёнка нет ПДн, поэтому бумажный бланк привязан к месту, а не к личности (ADR 0009).
// Ссылки на аккаунты, классы и места других модулей — uuid без внешних ключей.
import { sql } from "drizzle-orm";
import { check, date, index, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { primaryId, timestamps, tstz } from "../../db/columns.js";

export const legalDocumentKind = pgEnum("consent_document_kind", ["privacy", "terms", "consent_child", "consent_adult"]);
export const consentMethod = pgEnum("consent_method", ["electronic", "paper"]);

export const legalDocuments = pgTable(
  "legal_documents",
  {
    id: primaryId(),
    kind: legalDocumentKind("kind").notNull(),
    /** Версия документа, например `2026-11-01`. */
    version: text("version").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    /** SHA-256 текста версии — доказательство, с каким именно текстом согласились. */
    bodySha256: text("body_sha256"),
    effectiveFrom: tstz("effective_from").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("legal_documents_kind_version_uq").on(t.kind, t.version),
    index("legal_documents_kind_effective_idx").on(t.kind, t.effectiveFrom),
  ],
);

export const consents = pgTable(
  "consents",
  {
    id: primaryId(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => legalDocuments.id, { onDelete: "restrict" }),
    method: consentMethod("method").notNull(),
    /** Взрослый, давший электронное согласие (identity.accounts.id). */
    subjectAccountId: uuid("subject_account_id"),
    /** Место ученика (org.class_seats.id) и его класс — для бумажного согласия. */
    subjectSeatId: uuid("subject_seat_id"),
    subjectClassId: uuid("subject_class_id"),
    /** Кто записал согласие: сам взрослый или учитель (бумажный бланк). */
    givenByAccountId: uuid("given_by_account_id").notNull(),
    scope: text("scope").array().notNull().default(sql`'{}'::text[]`),
    /** Дата подписи на бумажном бланке. */
    signedOn: date("signed_on"),
    givenAt: tstz("given_at").notNull().defaultNow(),
    revokedAt: tstz("revoked_at"),
    revokedByAccountId: uuid("revoked_by_account_id"),
    ...timestamps(),
  },
  (t) => [
    check("consents_one_subject", sql`num_nonnulls(${t.subjectAccountId}, ${t.subjectSeatId}) = 1`),
    check("consents_seat_has_class", sql`${t.subjectSeatId} IS NULL OR ${t.subjectClassId} IS NOT NULL`),
    check("consents_paper_for_seats", sql`(${t.method} = 'paper') = (${t.subjectSeatId} IS NOT NULL)`),
    check("consents_revoked_pair", sql`(${t.revokedAt} IS NULL) = (${t.revokedByAccountId} IS NULL)`),
    uniqueIndex("consents_account_active_uq")
      .on(t.subjectAccountId, t.documentId)
      .where(sql`${t.revokedAt} IS NULL AND ${t.subjectAccountId} IS NOT NULL`),
    uniqueIndex("consents_seat_active_uq")
      .on(t.subjectSeatId, t.documentId)
      .where(sql`${t.revokedAt} IS NULL AND ${t.subjectSeatId} IS NOT NULL`),
    index("consents_subject_account_idx").on(t.subjectAccountId),
    index("consents_subject_seat_idx").on(t.subjectSeatId),
    index("consents_subject_class_idx").on(t.subjectClassId),
  ],
);
