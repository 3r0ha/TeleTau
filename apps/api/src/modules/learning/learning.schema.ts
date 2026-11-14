// Таблицы модуля learning (ADR 0014): забеги уроков и попытки. Ссылки на аккаунты (identity), уроки (content) и
// исходники корпуса — простые uuid/text без внешних ключей. attempts — только вставка (идентификатор — клиентский
// UUIDv7; повтор возвращает сохранённый результат). Повторение слов (FSRS-6, @teletau/domain-rules, векторы
// contracts/test-vectors/srs): srs_cards — текущее состояние слова у аккаунта, srs_reviews — журнал повторений (только
// вставка); карточка пересчитываема из журнала, журнал — из attempts.
import { sql } from "drizzle-orm";
import { boolean, check, date, doublePrecision, index, integer, jsonb, pgEnum, pgTable, primaryKey, real, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { primaryId, timestamps, tstz } from "../../db/columns.js";

export const runStatus = pgEnum("learning_run_status", ["active", "completed"]);
/**
 * Вид забега: узел тропы, review — повторение слов (POST /reviews/runs, lesson_id = «review») или jump — испытание для
 * перехода к закрытому месту (POST /units/{unitId}/jump-runs, lesson_id = id юнита).
 */
export const runKind = pgEnum("learning_run_kind", ["lesson", "help_language", "place_test", "review", "jump"]);
export const attemptVerdict = pgEnum("learning_attempt_verdict", ["correct", "almost", "typo", "wrong", "recorded"]);

/**
 * Забег — одно прохождение узла тропы. id — клиентский UUIDv7 (`runId`): повтор POST /lessons/{id}/runs с тем же id
 * возвращает тот же забег. plan — упражнения в порядке показа с перемешанными плитками и вариантами и сторонами
 * дуэлей (что показано как A и B) — так ответ проверяется по тому, что видел ученик.
 */
export const lessonRuns = pgTable(
  "lesson_runs",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id").notNull(),
    lessonId: text("lesson_id").notNull(),
    kind: runKind("kind").notNull(),
    contentVersion: integer("content_version").notNull(),
    status: runStatus("status").notNull().default("active"),
    plan: jsonb("plan").notNull(),
    startedAt: tstz("started_at").notNull().defaultNow(),
    completedAt: tstz("completed_at"),
    /** Сутки завершения по Уфе и номер завершения этого урока за эти сутки (множитель повтора мёда). */
    completedOn: date("completed_on"),
    completionIndex: smallint("completion_index"),
    accuracy: real("accuracy"),
    /** Итог для повтора POST /lesson-runs/{id}/complete без повторных начислений. */
    summary: jsonb("summary"),
    ...timestamps(),
  },
  (t) => [
    index("lesson_runs_account_idx").on(t.accountId, t.startedAt),
    index("lesson_runs_account_lesson_day_idx").on(t.accountId, t.lessonId, t.completedOn),
    check(
      "lesson_runs_completion_fields",
      sql`(${t.status} = 'completed') = (${t.completedAt} IS NOT NULL AND ${t.completedOn} IS NOT NULL AND ${t.completionIndex} IS NOT NULL AND ${t.summary} IS NOT NULL)`,
    ),
  ],
);

/** Попытка — ответ на упражнение забега. Только вставка. id — клиентский UUIDv7 (`attemptId`). */
export const attempts = pgTable(
  "attempts",
  {
    id: uuid("id").primaryKey(),
    runId: uuid("run_id").notNull(),
    accountId: uuid("account_id").notNull(),
    /** Идентификатор упражнения в забеге (exerciseId API). */
    runExerciseId: text("run_exercise_id").notNull(),
    /** Упражнение контента (content.exercises.id); для дуэлей узла «Помоги языку» — нет. */
    exerciseId: text("exercise_id"),
    answer: jsonb("answer").notNull(),
    verdict: attemptVerdict("verdict").notNull(),
    /** Первая попытка по упражнению в забеге — по ней считается мёд. */
    firstAttempt: boolean("first_attempt").notNull(),
    latencyMs: integer("latency_ms"),
    /**
     * Сколько подсказок к условию ученик открыл до ответа (AttemptRequest.hintsUsed, не больше подсказок упражнения):
     * мёд и точность — как обычно, а слова упражнения идут в повторение не выше Hard (векторы srs/rating.json v2).
     */
    hintsUsed: smallint("hints_used").notNull().default(0),
    /** Ответ API для повтора с тем же attemptId. */
    result: jsonb("result").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("attempts_run_idx").on(t.runId, t.createdAt),
    index("attempts_account_idx").on(t.accountId, t.createdAt),
    uniqueIndex("attempts_run_exercise_first_uq").on(t.runId, t.runExerciseId).where(sql`${t.firstAttempt}`),
    check("attempts_latency_range", sql`${t.latencyMs} IS NULL OR ${t.latencyMs} BETWEEN 0 AND 3600000`),
    check("attempts_hints_used_range", sql`${t.hintsUsed} BETWEEN 0 AND 12`),
  ],
);

/**
 * Кеш объяснений ошибок (docs/04-ai-gigachat.md §3 сценарий 1): (упражнение контента, класс ошибки) → текст.
 * Кешируются только ответы GigaChat, прошедшие валидатор закрытого словаря в шлюзе; шаблоны не кешируются —
 * при появлении GigaChat объяснение станет живым. Персональных данных нет: ключи — контент и класс ошибки.
 */
export const aiExplanations = pgTable(
  "ai_explanations",
  {
    exerciseId: text("exercise_id").notNull(),
    /** Класс ошибки — вердикт попытки, для которого объясняем: almost / typo / wrong. */
    errorClass: text("error_class").notNull(),
    text: text("text").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "ai_explanations_pk", columns: [t.exerciseId, t.errorClass] }),
    check("ai_explanations_error_class", sql`${t.errorClass} IN ('almost', 'typo', 'wrong')`),
    check("ai_explanations_text_len", sql`char_length(${t.text}) BETWEEN 1 AND 400`),
  ],
);

/** Сколько объяснений ошибок аккаунт взял за учебные сутки по Уфе — лимит docs/04 §5.5 (по умолчанию 10). */
export const aiExplanationUses = pgTable(
  "ai_explanation_uses",
  {
    accountId: uuid("account_id").notNull(),
    day: date("day").notNull(),
    count: integer("count").notNull(),
  },
  (t) => [
    primaryKey({ name: "ai_explanation_uses_pk", columns: [t.accountId, t.day] }),
    check("ai_explanation_uses_range", sql`${t.count} >= 0`),
  ],
);

/**
 * Карточка повторения: слово словаря курса (content.words.id — ключ слова, текстом, без внешнего ключа) у аккаунта.
 * Появляется при завершении урока, где слово было (new_words), обновляется первой попыткой упражнения в забеге
 * повторения. Числа — FSRS-6 (fsrs_version), даты — сутки по Уфе.
 */
export const srsCards = pgTable(
  "srs_cards",
  {
    accountId: uuid("account_id").notNull(),
    wordId: text("word_id").notNull(),
    stability: doublePrecision("stability").notNull(),
    difficulty: doublePrecision("difficulty").notNull(),
    reps: integer("reps").notNull(),
    lapses: integer("lapses").notNull(),
    lastReviewOn: date("last_review_on").notNull(),
    dueOn: date("due_on").notNull(),
    fsrsVersion: text("fsrs_version").notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ name: "srs_cards_pk", columns: [t.accountId, t.wordId] }),
    index("srs_cards_account_due_idx").on(t.accountId, t.dueOn),
    check("srs_cards_stability_range", sql`${t.stability} > 0`),
    check("srs_cards_difficulty_range", sql`${t.difficulty} BETWEEN 1 AND 10`),
    check("srs_cards_reps", sql`${t.reps} >= 1 AND ${t.lapses} >= 0 AND ${t.lapses} < ${t.reps}`),
  ],
);

/** Журнал повторений слова (только вставка): знакомство в уроке или первая попытка упражнения в забеге повторения. */
export const srsReviews = pgTable(
  "srs_reviews",
  {
    id: primaryId(),
    accountId: uuid("account_id").notNull(),
    wordId: text("word_id").notNull(),
    /** Забег (lesson_runs.id): урок, где слово появилось, или повторение. */
    runId: uuid("run_id").notNull(),
    /** Попытка (attempts.id); у знакомства в уроке — нет. */
    attemptId: uuid("attempt_id"),
    /** 1 Again, 2 Hard, 3 Good, 4 Easy. */
    rating: smallint("rating").notNull(),
    reviewedOn: date("reviewed_on").notNull(),
    reviewedAt: tstz("reviewed_at").notNull(),
    /** Дней с прошлого повторения; у знакомства — нет. */
    elapsedDays: integer("elapsed_days"),
    stability: doublePrecision("stability").notNull(),
    difficulty: doublePrecision("difficulty").notNull(),
    dueOn: date("due_on").notNull(),
    fsrsVersion: text("fsrs_version").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("srs_reviews_run_word_uq").on(t.runId, t.wordId),
    index("srs_reviews_account_word_idx").on(t.accountId, t.wordId, t.reviewedAt),
    check("srs_reviews_rating_range", sql`${t.rating} BETWEEN 1 AND 4`),
  ],
);
