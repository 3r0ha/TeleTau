// Таблицы модуля admin (ADR 0014): журнал аудита.
// audit_log — только вставка (ADR 0017): UPDATE, DELETE и TRUNCATE запрещены триггером, а у роли приложения
// teletau_app нет на них прав (миграция 0002). Поэтому у таблицы нет updated_at — строка не меняется никогда.
// В metadata — только неличные детали (номер места, версия карточки); ПДн, секреты и токены туда не пишутся.
import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { primaryId, tstz } from "../../db/columns.js";

export const auditLog = pgTable(
  "audit_log",
  {
    id: primaryId(),
    createdAt: tstz("created_at").notNull().defaultNow(),
    /** Кто совершил действие (identity.accounts.id); NULL — система. */
    actorAccountId: uuid("actor_account_id"),
    actorKind: text("actor_kind"),
    actorRoles: text("actor_roles").array(),
    /** `<объект>.<событие>`: card.issued, card.reissued, teacher_verification.approved, consent.revoked, session.refresh_reuse_detected… */
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    /** HMAC-SHA-256 IP-адреса с перцем (не сам адрес). */
    ipHash: text("ip_hash"),
    requestId: text("request_id"),
  },
  (t) => [
    index("audit_log_created_idx").on(t.createdAt),
    index("audit_log_actor_idx").on(t.actorAccountId, t.createdAt),
    index("audit_log_target_idx").on(t.targetType, t.targetId),
    index("audit_log_action_idx").on(t.action, t.createdAt),
    check("audit_log_action_format", sql`${t.action} ~ '^[a-z][a-z_]*(\\.[a-z][a-z_]*)+$'`),
    check("audit_log_metadata_object", sql`jsonb_typeof(${t.metadata}) = 'object'`),
    check("audit_log_actor_pair", sql`(${t.actorAccountId} IS NULL) = (${t.actorKind} IS NULL)`),
  ],
);
