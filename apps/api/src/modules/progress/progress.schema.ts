// Таблицы модуля progress (ADR 0014): журнал мёда, серия, дни занятий, счётчики. Числа мёда и правила серии —
// пакет @teletau/domain-rules (векторы contracts/test-vectors/{xp,streak}). Серия пересчитываема из activity_days;
// streaks — её кеш для быстрых ответов. Ссылки на аккаунты и уроки — простые uuid/text без внешних ключей.
import { sql } from "drizzle-orm";
import { check, date, index, integer, pgEnum, pgTable, primaryKey, real, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { primaryId, timestamps, tstz } from "../../db/columns.js";

/** pending — «мёд созревает» (голос до решения); final — начислен; revoked — отменён (пересчёт Consensus Engine). */
export const xpStatus = pgEnum("progress_xp_status", ["pending", "final", "revoked"]);
export const xpReason = pgEnum("progress_xp_reason", ["lesson", "vote"]);

/** Журнал мёда. Одна запись на (аккаунт, причина, ссылка): повтор начисления не удваивает мёд. */
export const xpLedger = pgTable(
  "xp_ledger",
  {
    id: primaryId(),
    accountId: uuid("account_id").notNull(),
    amount: integer("amount").notNull(),
    reason: xpReason("reason").notNull(),
    /** lesson — id забега (learning.lesson_runs), vote — id голоса (consensus.judgments). */
    refId: uuid("ref_id").notNull(),
    status: xpStatus("status").notNull(),
    /** Сутки начисления по Уфе — для недельных сумм. */
    earnedOn: date("earned_on").notNull(),
    finalizedAt: tstz("finalized_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("xp_ledger_ref_uq").on(t.accountId, t.reason, t.refId),
    index("xp_ledger_account_idx").on(t.accountId, t.earnedOn),
    index("xp_ledger_pending_idx").on(t.refId).where(sql`${t.status} = 'pending'`),
    check("xp_ledger_amount_nonnegative", sql`${t.amount} >= 0`),
  ],
);

/**
 * Дни занятий по Уфе: день активен (серия), если в нём завершён хотя бы один забег. goal_lessons — соты цели дня:
 * уроки, «Испытания места» и повторения (без «Помоги языку»), цель — DAILY_GOAL_LESSONS из @teletau/domain-rules.
 */
export const activityDays = pgTable(
  "activity_days",
  {
    accountId: uuid("account_id").notNull(),
    day: date("day").notNull(),
    lessons: smallint("lessons").notNull().default(0),
    goalLessons: smallint("goal_lessons").notNull().default(0),
    honey: integer("honey").notNull().default(0),
    firstAt: tstz("first_at").notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ name: "activity_days_pk", columns: [t.accountId, t.day] }),
    check("activity_days_lessons_nonnegative", sql`${t.lessons} >= 0`),
    check("activity_days_goal_lessons", sql`${t.goalLessons} BETWEEN 0 AND ${t.lessons}`),
  ],
);

/** Кеш серии (computeStreakFromDays по activity_days). */
export const streaks = pgTable(
  "streaks",
  {
    accountId: uuid("account_id").primaryKey(),
    current: integer("current").notNull().default(0),
    longest: integer("longest").notNull().default(0),
    freezes: smallint("freezes").notNull().default(2),
    lastDay: date("last_day"),
    ...timestamps(),
  },
  (t) => [check("streaks_freezes_range", sql`${t.freezes} BETWEEN 0 AND 2`), check("streaks_longest", sql`${t.longest} >= ${t.current}`)],
);

/** Прохождение уроков аккаунтом: «пройден ли узел», лучшая точность, для прогресса класса. */
export const lessonProgress = pgTable(
  "lesson_progress",
  {
    accountId: uuid("account_id").notNull(),
    lessonId: text("lesson_id").notNull(),
    completions: integer("completions").notNull().default(0),
    bestAccuracy: real("best_accuracy"),
    firstCompletedAt: tstz("first_completed_at").notNull(),
    lastCompletedAt: tstz("last_completed_at").notNull(),
    ...timestamps(),
  },
  (t) => [primaryKey({ name: "lesson_progress_pk", columns: [t.accountId, t.lessonId] }), index("lesson_progress_lesson_idx").on(t.lessonId)],
);

/**
 * Уроки, засчитанные сданным испытанием для перехода (docs/02 §2): урок не проходился, но место за ним открыто. Только
 * вставка, одна строка на (аккаунт, урок). На тропе такой урок пройден (`passedByTest`); в счётчики, прогресс класса
 * у учителя и задания учителя не идёт — там считаются только пройденные уроки (lesson_progress).
 */
export const lessonSkips = pgTable(
  "lesson_skips",
  {
    accountId: uuid("account_id").notNull(),
    lessonId: text("lesson_id").notNull(),
    /** Забег испытания (learning.lesson_runs.id, kind = jump). */
    runId: uuid("run_id").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "lesson_skips_pk", columns: [t.accountId, t.lessonId] })],
);

/** Счётчики панели и профиля: пройдено уроков, новых слов, голосов (всего и созревших). */
export const progressCounters = pgTable(
  "progress_counters",
  {
    accountId: uuid("account_id").primaryKey(),
    lessonsCompleted: integer("lessons_completed").notNull().default(0),
    wordsLearned: integer("words_learned").notNull().default(0),
    votesTotal: integer("votes_total").notNull().default(0),
    votesMatured: integer("votes_matured").notNull().default(0),
    ...timestamps(),
  },
  (t) => [check("progress_counters_votes", sql`${t.votesMatured} <= ${t.votesTotal}`)],
);
