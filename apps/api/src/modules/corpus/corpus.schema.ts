// Таблицы модуля corpus (ADR 0014): исходники и варианты перевода. Импорт дуэлей — `pnpm --filter @teletau/api corpus:import`
// из content/corpus/duels/*.yaml (идемпотентный). Пока варианты — только из человеческих источников (origin = import,
// source_ref обязателен): машинных и LLM-вариантов в дуэлях нет (CLAUDE.md, правило 6; ADR 0019).
import { sql } from "drizzle-orm";
import { check, index, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "../../db/columns.js";

export const sourceKind = pgEnum("corpus_source_kind", ["word", "phrase", "sentence", "term"]);
export const variantOrigin = pgEnum("corpus_variant_origin", ["human", "import", "mt", "llm"]);
export const variantReview = pgEnum("corpus_variant_review", ["needs_native_review", "native_approved", "native_rejected"]);

/** Исходник дуэли (русская фраза; для пары ba-kz — казахская). external_id — id дуэли из YAML («u01-d01»): по нему импорт идемпотентен. */
export const sourceItems = pgTable(
  "source_items",
  {
    id: primaryId(),
    externalId: text("external_id").notNull(),
    lang: text("lang").notNull().default("ru"),
    text: text("text").notNull(),
    /** toComparable(text) из @teletau/bashkir-text. */
    textNorm: text("text_norm").notNull(),
    kind: sourceKind("kind").notNull(),
    domain: text("domain"),
    /** Юнит, в пул дуэлей которого входит исходник (content.units.id). */
    unitId: text("unit_id"),
    /** Откуда русская сторона: { ref, url | page, locator }. */
    sourceRef: jsonb("source_ref"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("source_items_external_uq").on(t.externalId),
    index("source_items_unit_idx").on(t.unitId),
    check("source_items_lang", sql`${t.lang} IN ('ru', 'ba', 'kz')`),
  ],
);

/** Вариант перевода. Для origin = import источник обязателен (ссылка на content/sources.yaml и место в нём). */
export const variants = pgTable(
  "variants",
  {
    id: primaryId(),
    sourceItemId: uuid("source_item_id")
      .notNull()
      .references(() => sourceItems.id, { onDelete: "restrict" }),
    lang: text("lang").notNull().default("ba"),
    /** Каноническая форма normalize() — то, что видит голосующий. */
    text: text("text").notNull(),
    /** toComparable(text): два варианта одного исходника различаются. */
    textNorm: text("text_norm").notNull(),
    /** Запись как в источнике, если она отличалась от text (двойники). */
    raw: text("raw"),
    origin: variantOrigin("origin").notNull(),
    /** { ref, url | page, locator } — content/schema/common.schema.json#/$defs/SourceRef. */
    sourceRef: jsonb("source_ref"),
    review: variantReview("review").notNull().default("needs_native_review"),
    authorAccountId: uuid("author_account_id"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("variants_item_norm_uq").on(t.sourceItemId, t.textNorm),
    index("variants_item_idx").on(t.sourceItemId),
    check("variants_lang", sql`${t.lang} IN ('ru', 'ba')`),
    check("variants_import_has_source", sql`${t.origin} <> 'import' OR ${t.sourceRef} IS NOT NULL`),
  ],
);
