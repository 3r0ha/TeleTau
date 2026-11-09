// Таблицы модуля content (ADR 0014): курс из YAML (content/course/**, формат — content/schema/*.schema.json), импорт —
// `pnpm --filter @teletau/api content:import` (идемпотентный, с версией контента). Ключи ответов хранятся только здесь
// и наружу не отдаются: клиент получает упражнения забега без ключей (модуль learning).
// Башкирский текст — с флагом проверки носителем (CLAUDE.md, правило 6); источник каждой строки — в sources.
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, primaryKey, smallint, text, uniqueIndex } from "drizzle-orm/pg-core";
import { primaryId, timestamps, tstz } from "../../db/columns.js";

export const unitStatus = pgEnum("content_unit_status", ["open", "locked"]);
/** Узел тропы: урок, «Помоги языку» (только дуэли), «Испытание места». */
export const nodeKind = pgEnum("content_node_kind", ["lesson", "help_language", "place_test"]);
export const exerciseType = pgEnum("content_exercise_type", ["tiles_ru_ba", "choice_ba_ru", "free_ru_ba", "duel", "match_pairs"]);
/** Проверка носителем: native_rejected не импортируется в показ. */
export const reviewStatus = pgEnum("content_review_status", ["needs_native_review", "native_approved", "native_rejected"]);

/** Версии импортированного контента курса: та же версия с другим хешем — ошибка импорта. */
export const contentVersions = pgTable(
  "content_versions",
  {
    id: primaryId(),
    courseId: text("course_id").notNull(),
    version: integer("version").notNull(),
    /** SHA-256 (hex) канонического JSON всех файлов курса. */
    contentHash: text("content_hash").notNull(),
    importedAt: tstz("imported_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("content_versions_course_version_uq").on(t.courseId, t.version), check("content_versions_version_positive", sql`${t.version} >= 1`)],
);

/** Юнит — место экспедиции. id — slug из unit.yaml («01-ufa»). */
export const units = pgTable(
  "units",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull(),
    position: smallint("position").notNull(),
    status: unitStatus("status").notNull(),
    placeSlug: text("place_slug").notNull(),
    titleRu: text("title_ru").notNull(),
    /** Название места по-башкирски (с источником в title_ba_source). */
    titleBa: text("title_ba"),
    titleBaReview: reviewStatus("title_ba_review"),
    titleBaSource: jsonb("title_ba_source"),
    topicRu: text("topic_ru").notNull(),
    contentVersion: integer("content_version").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("units_course_position_uq").on(t.courseId, t.position),
    check("units_title_ba_pair", sql`(${t.titleBa} IS NULL) = (${t.titleBaReview} IS NULL)`),
  ],
);

/** Узел тропы (урок, «Помоги языку», «Испытание места»). id — slug узла = lessonId API. */
export const lessons = pgTable(
  "lessons",
  {
    id: text("id").primaryKey(),
    unitId: text("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    kind: nodeKind("kind").notNull(),
    titleRu: text("title_ru").notNull(),
    icon: text("icon"),
    /** Только help_language: сколько дуэлей из пула юнита показать. */
    duelCount: smallint("duel_count"),
    /** Новые слова урока: [{ text, review }] — копии строк упражнений. */
    newWords: jsonb("new_words").notNull().default(sql`'[]'::jsonb`),
    contentVersion: integer("content_version").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("lessons_unit_position_uq").on(t.unitId, t.position),
    check("lessons_duel_count", sql`(${t.kind} = 'help_language') = (${t.duelCount} IS NOT NULL)`),
    check("lessons_new_words_array", sql`jsonb_typeof(${t.newWords}) = 'array'`),
  ],
);

/** Упражнение урока: payload — то, что видит ученик (без ключей); answer_key — только для проверки на сервере. */
export const exercises = pgTable(
  "exercises",
  {
    id: text("id").primaryKey(),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    type: exerciseType("type").notNull(),
    payload: jsonb("payload").notNull(),
    /** tiles_ru_ba / free_ru_ba — принятые ответы; choice_ba_ru — индекс верного; match_pairs — порядок пар в payload; duel — нет. */
    answerKey: jsonb("answer_key"),
    /** Худший статус проверки среди башкирских строк упражнения. */
    review: reviewStatus("review").notNull(),
    /** Источники строк упражнения: [{ ref, title, url?, page?, locator, license }]. */
    sources: jsonb("sources").notNull().default(sql`'[]'::jsonb`),
    /** Только duel: внешний id дуэли из content/corpus/duels (иначе — из пула юнита). */
    duelRef: text("duel_ref"),
    contentVersion: integer("content_version").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("exercises_lesson_position_uq").on(t.lessonId, t.position),
    index("exercises_lesson_idx").on(t.lessonId),
    check("exercises_sources_array", sql`jsonb_typeof(${t.sources}) = 'array'`),
    check("exercises_duel_ref", sql`${t.duelRef} IS NULL OR ${t.type} = 'duel'`),
  ],
);

/**
 * Словарь курса: слова из new_words уроков с переводом, записью произношения и источником. id — ключ слова
 * (wordKey в content-import.ts: слова answerTokens через пробел), на него ссылаются карточки повторения (learning.srs_cards)
 * — текстом, без внешнего ключа: новая версия контента заменяет строки, а ключ того же слова не меняется.
 */
export const words = pgTable(
  "words",
  {
    courseId: text("course_id").notNull(),
    id: text("id").notNull(),
    /** Порядок первого появления по курсу. */
    position: integer("position").notNull(),
    /** Как в уроке (каноническая форма normalize). */
    text: text("text").notNull(),
    review: reviewStatus("review").notNull(),
    translationRu: text("translation_ru").notNull(),
    /** Запись произношения: { url, source } — файл Wikimedia Commons (Lingua Libre). */
    audio: jsonb("audio"),
    sources: jsonb("sources").notNull().default(sql`'[]'::jsonb`),
    /** Урок, где слово встретилось впервые. */
    lessonId: text("lesson_id").notNull(),
    contentVersion: integer("content_version").notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ name: "words_pk", columns: [t.courseId, t.id] }),
    index("words_course_position_idx").on(t.courseId, t.position),
    check("words_sources_array", sql`jsonb_typeof(${t.sources}) = 'array'`),
  ],
);
