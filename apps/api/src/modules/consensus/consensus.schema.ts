// Таблицы модуля consensus (ADR 0014, 0005, 0019): журнал голосов и производное состояние исходника.
// judgments — только вставка (CLAUDE.md, правило 9): UPDATE, DELETE и TRUNCATE запрещены триггером (миграция 0006,
// как у audit_log), у роли teletau_app на них нет прав. item_state пересчитываем из журнала (duel-v0, затем Consensus
// Engine; у каждой строки — rules_version). Ссылки на аккаунты и варианты — простые uuid без внешних ключей.
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, real, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tstz } from "../../db/columns.js";

/** Группа голосующего на момент голоса (docs/03 §4a): подтверждённый учитель — teacher, взрослый — adult, ребёнок — child. */
export const voterGroup = pgEnum("consensus_voter_group", ["child", "teacher", "adult", "expert"]);
export const judgmentType = pgEnum("consensus_judgment_type", ["pairwise", "expert_decision"]);
export const duelChoice = pgEnum("consensus_duel_choice", ["a", "b", "both", "skip"]);
export const judgmentContext = pgEnum("consensus_judgment_context", ["lesson", "corpus", "telegram"]);
export const itemStatus = pgEnum("consensus_item_status", ["voting", "accepted", "escalated"]);
export const decidedBy = pgEnum("consensus_decided_by", ["rule", "expert"]);

/** Голос в дуэли. id — клиентский UUIDv7 (judgmentId или attemptId урока). Строка не меняется никогда. */
export const judgments = pgTable(
  "judgments",
  {
    id: uuid("id").primaryKey(),
    createdAt: tstz("created_at").notNull().defaultNow(),
    sourceItemId: uuid("source_item_id").notNull(),
    /** Варианты в порядке показа: A и B; choice — относительно них. */
    variantAId: uuid("variant_a_id").notNull(),
    variantBId: uuid("variant_b_id").notNull(),
    judgeAccountId: uuid("judge_account_id").notNull(),
    voterGroup: voterGroup("voter_group").notNull(),
    type: judgmentType("type").notNull().default("pairwise"),
    choice: duelChoice("choice").notNull(),
    context: judgmentContext("context").notNull(),
    /** Забег урока (context = lesson). */
    runId: uuid("run_id"),
    latencyMs: integer("latency_ms"),
    /** Вес голоса на момент голоса (duel-v0: ребёнок 1, взрослый 2, учитель 3; эксперт — без веса). */
    weightSnapshot: real("weight_snapshot"),
    rulesVersion: text("rules_version").notNull(),
  },
  (t) => [
    index("judgments_item_idx").on(t.sourceItemId, t.createdAt),
    index("judgments_judge_idx").on(t.judgeAccountId, t.createdAt),
    uniqueIndex("judgments_one_pairwise_per_judge_uq").on(t.sourceItemId, t.judgeAccountId).where(sql`${t.type} = 'pairwise'`),
    check("judgments_distinct_variants", sql`${t.variantAId} <> ${t.variantBId}`),
    check("judgments_lesson_run", sql`(${t.context} = 'lesson') = (${t.runId} IS NOT NULL)`),
    check("judgments_latency_range", sql`${t.latencyMs} IS NULL OR ${t.latencyMs} BETWEEN 0 AND 3600000`),
  ],
);

/** Состояние исходника по журналу голосов. votes_by_group — сводка для показа (дети / учителя / взрослые). */
export const itemState = pgTable(
  "item_state",
  {
    sourceItemId: uuid("source_item_id").primaryKey(),
    status: itemStatus("status").notNull().default("voting"),
    acceptedVariantIds: uuid("accepted_variant_ids").array().notNull().default(sql`'{}'::uuid[]`),
    mainVariantId: uuid("main_variant_id"),
    /** Вариант с меткой children_prefer (большинство детей — против итога). */
    childrenPreferVariantId: uuid("children_prefer_variant_id"),
    /** { child | teacher | adult: { total, both, skip, variants: { [variantId]: n } } }. */
    votesByGroup: jsonb("votes_by_group").notNull().default(sql`'{}'::jsonb`),
    /** Взвешенные очки вариантов: { [variantId]: число }. */
    scores: jsonb("scores").notNull().default(sql`'{}'::jsonb`),
    decidedBy: decidedBy("decided_by"),
    decidedAt: tstz("decided_at"),
    rulesVersion: text("rules_version").notNull(),
    updatedAt: tstz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("item_state_status_idx").on(t.status),
    check("item_state_decision", sql`(${t.status} = 'accepted') = (${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL)`),
    check("item_state_votes_object", sql`jsonb_typeof(${t.votesByGroup}) = 'object'`),
  ],
);
