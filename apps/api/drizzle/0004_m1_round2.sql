-- 0004_m1_round2 — сгенерировано drizzle-kit из src/modules/*/*.schema.ts и дополнено вручную. Миграция аддитивна:
-- новые значения enum, столбец, таблица, функция и индексы; данные причин отказа переносятся в схему pii, старая
-- колонка остаётся (всегда NULL) до контрактной миграции.
--
-- 1. Новые причины отзыва сессии: перевыпуск карточки места и замена преемника refresh-токена — льготное окно
--    потерянного ответа и повторная выдача сессии по коду класса.
ALTER TYPE "public"."identity_session_revoke_reason" ADD VALUE 'card_reissued';--> statement-breakpoint
ALTER TYPE "public"."identity_session_revoke_reason" ADD VALUE 'superseded';--> statement-breakpoint
-- 2. Режим интерфейса, выбранный самим пользователем: вход по классу его больше не меняет.
ALTER TABLE "accounts" ADD COLUMN "ui_mode_manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- 3. Причина отказа модератора — в схеме pii: в свободном тексте бывают ПДн заявителя.
CREATE TABLE "pii"."teacher_verification_reasons" (
	"verification_id" uuid PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pii"."teacher_verification_reasons" ADD CONSTRAINT "teacher_verification_reasons_verification_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."teacher_verifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
COMMENT ON TABLE "pii"."teacher_verification_reasons" IS 'Причины отказа в подтверждении учителя (модуль moderation). Свободный текст модератора может содержать ПДн — поэтому в схеме pii.';--> statement-breakpoint
INSERT INTO "pii"."teacher_verification_reasons" ("verification_id", "reason", "created_at", "updated_at")
  SELECT "id", "decision_reason", coalesce("decided_at", "created_at"), now() FROM "teacher_verifications" WHERE "decision_reason" IS NOT NULL
  ON CONFLICT ("verification_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "teacher_verifications" DROP CONSTRAINT "teacher_verifications_reject_reason";--> statement-breakpoint
UPDATE "teacher_verifications" SET "decision_reason" = NULL WHERE "decision_reason" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "teacher_verifications" ADD CONSTRAINT "teacher_verifications_reason_unused" CHECK ("teacher_verifications"."decision_reason" IS NULL);--> statement-breakpoint
-- 4. Поиск школ: триграммные индексы по тому же выражению, что в запросе. org_search_fold — порт свёртки
--    @teletau/bashkir-text (FOLD_MAP: ҡ ғ ҙ ҫ һ ә ө ү ң ё → к г з с х а о у н е, после lower) и «№ 1» = «№1».
--    Совпадение с FOLD_MAP проверяют test/directory-search.test.ts и test/integration/m1-round2.test.ts.
CREATE OR REPLACE FUNCTION org_search_fold(t text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$ SELECT regexp_replace(translate(lower(t), 'ҡғҙҫһәөүңё', 'кгзсхаоуне'), '№\s*', '№', 'g') $$;--> statement-breakpoint
COMMENT ON FUNCTION org_search_fold(text) IS 'Ключ поиска школ (модуль org): свёртка @teletau/bashkir-text (FOLD_MAP) и «№ 1» = «№1». Изменение FOLD_MAP — новая миграция функции и индексов.';--> statement-breakpoint
DROP INDEX "schools_name_ru_trgm_idx";--> statement-breakpoint
DROP INDEX "schools_short_name_ru_trgm_idx";--> statement-breakpoint
CREATE INDEX "schools_name_ru_fold_trgm_idx" ON "schools" USING gin (org_search_fold("name_ru") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "schools_short_name_ru_fold_trgm_idx" ON "schools" USING gin (org_search_fold("short_name_ru") gin_trgm_ops);
