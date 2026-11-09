-- 0006_m2 — таблицы модулей content, learning, progress, competition, corpus, consensus
-- (сгенерировано drizzle-kit из src/modules/<m>/<m>.schema.ts; ADR 0014). Миграция аддитивна: прежние таблицы не меняются.
-- В конце — написанные вручную защиты judgments: только вставка (CLAUDE.md, правило 9; ADR 0005, 0019) — как audit_log в 0002.
CREATE TYPE "public"."competition_age_group" AS ENUM('child', 'adult');--> statement-breakpoint
CREATE TYPE "public"."competition_league_outcome" AS ENUM('promoted', 'stayed', 'demoted');--> statement-breakpoint
CREATE TYPE "public"."competition_league_tier" AS ENUM('clover', 'buckwheat', 'sweetclover', 'fireweed', 'linden');--> statement-breakpoint
CREATE TYPE "public"."consensus_decided_by" AS ENUM('rule', 'expert');--> statement-breakpoint
CREATE TYPE "public"."consensus_duel_choice" AS ENUM('a', 'b', 'both', 'skip');--> statement-breakpoint
CREATE TYPE "public"."consensus_item_status" AS ENUM('voting', 'accepted', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."consensus_judgment_context" AS ENUM('lesson', 'corpus');--> statement-breakpoint
CREATE TYPE "public"."consensus_judgment_type" AS ENUM('pairwise', 'expert_decision');--> statement-breakpoint
CREATE TYPE "public"."consensus_voter_group" AS ENUM('child', 'teacher', 'adult', 'expert');--> statement-breakpoint
CREATE TYPE "public"."content_exercise_type" AS ENUM('tiles_ru_ba', 'choice_ba_ru', 'free_ru_ba', 'duel');--> statement-breakpoint
CREATE TYPE "public"."content_node_kind" AS ENUM('lesson', 'help_language', 'place_test');--> statement-breakpoint
CREATE TYPE "public"."content_review_status" AS ENUM('needs_native_review', 'native_approved', 'native_rejected');--> statement-breakpoint
CREATE TYPE "public"."content_unit_status" AS ENUM('open', 'locked');--> statement-breakpoint
CREATE TYPE "public"."corpus_source_kind" AS ENUM('word', 'phrase', 'sentence', 'term');--> statement-breakpoint
CREATE TYPE "public"."corpus_variant_origin" AS ENUM('human', 'import', 'mt', 'llm');--> statement-breakpoint
CREATE TYPE "public"."corpus_variant_review" AS ENUM('needs_native_review', 'native_approved', 'native_rejected');--> statement-breakpoint
CREATE TYPE "public"."learning_attempt_verdict" AS ENUM('correct', 'almost', 'typo', 'wrong', 'recorded');--> statement-breakpoint
CREATE TYPE "public"."learning_run_kind" AS ENUM('lesson', 'help_language', 'place_test');--> statement-breakpoint
CREATE TYPE "public"."learning_run_status" AS ENUM('active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."progress_xp_reason" AS ENUM('lesson', 'vote');--> statement-breakpoint
CREATE TYPE "public"."progress_xp_status" AS ENUM('pending', 'final', 'revoked');--> statement-breakpoint
CREATE TABLE "class_week_activity" (
	"class_id" uuid NOT NULL,
	"day" date NOT NULL,
	"week_start" date NOT NULL,
	"account_id" uuid NOT NULL,
	"lessons" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_week_activity_pk" PRIMARY KEY("class_id","day","account_id"),
	CONSTRAINT "class_week_activity_lessons_nonnegative" CHECK ("class_week_activity"."lessons" >= 0)
);
--> statement-breakpoint
CREATE TABLE "league_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"week_start" date NOT NULL,
	"tier" "competition_league_tier" NOT NULL,
	"age_group" "competition_age_group" NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_members" (
	"group_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"scored_at" timestamp with time zone NOT NULL,
	"rank" smallint,
	"outcome" "competition_league_outcome",
	"tier_after" "competition_league_tier",
	"result_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_members_pk" PRIMARY KEY("group_id","account_id"),
	CONSTRAINT "league_members_points_nonnegative" CHECK ("league_members"."points" >= 0),
	CONSTRAINT "league_members_result_pair" CHECK (("league_members"."outcome" IS NULL) = ("league_members"."tier_after" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "item_state" (
	"source_item_id" uuid PRIMARY KEY NOT NULL,
	"status" "consensus_item_status" DEFAULT 'voting' NOT NULL,
	"accepted_variant_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"main_variant_id" uuid,
	"children_prefer_variant_id" uuid,
	"votes_by_group" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decided_by" "consensus_decided_by",
	"decided_at" timestamp with time zone,
	"rules_version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_state_decision" CHECK (("item_state"."status" = 'accepted') = ("item_state"."decided_by" IS NOT NULL AND "item_state"."decided_at" IS NOT NULL)),
	CONSTRAINT "item_state_votes_object" CHECK (jsonb_typeof("item_state"."votes_by_group") = 'object')
);
--> statement-breakpoint
CREATE TABLE "judgments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_item_id" uuid NOT NULL,
	"variant_a_id" uuid NOT NULL,
	"variant_b_id" uuid NOT NULL,
	"judge_account_id" uuid NOT NULL,
	"voter_group" "consensus_voter_group" NOT NULL,
	"type" "consensus_judgment_type" DEFAULT 'pairwise' NOT NULL,
	"choice" "consensus_duel_choice" NOT NULL,
	"context" "consensus_judgment_context" NOT NULL,
	"run_id" uuid,
	"latency_ms" integer,
	"weight_snapshot" real,
	"rules_version" text NOT NULL,
	CONSTRAINT "judgments_distinct_variants" CHECK ("judgments"."variant_a_id" <> "judgments"."variant_b_id"),
	CONSTRAINT "judgments_lesson_run" CHECK (("judgments"."context" = 'lesson') = ("judgments"."run_id" IS NOT NULL)),
	CONSTRAINT "judgments_latency_range" CHECK ("judgments"."latency_ms" IS NULL OR "judgments"."latency_ms" BETWEEN 0 AND 3600000)
);
--> statement-breakpoint
CREATE TABLE "content_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_versions_version_positive" CHECK ("content_versions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"lesson_id" text NOT NULL,
	"position" smallint NOT NULL,
	"type" "content_exercise_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"answer_key" jsonb,
	"review" "content_review_status" NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duel_ref" text,
	"content_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercises_sources_array" CHECK (jsonb_typeof("exercises"."sources") = 'array'),
	CONSTRAINT "exercises_duel_ref" CHECK ("exercises"."duel_ref" IS NULL OR "exercises"."type" = 'duel')
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"unit_id" text NOT NULL,
	"position" smallint NOT NULL,
	"kind" "content_node_kind" NOT NULL,
	"title_ru" text NOT NULL,
	"icon" text,
	"duel_count" smallint,
	"new_words" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lessons_duel_count" CHECK (("lessons"."kind" = 'help_language') = ("lessons"."duel_count" IS NOT NULL)),
	CONSTRAINT "lessons_new_words_array" CHECK (jsonb_typeof("lessons"."new_words") = 'array')
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"position" smallint NOT NULL,
	"status" "content_unit_status" NOT NULL,
	"place_slug" text NOT NULL,
	"title_ru" text NOT NULL,
	"title_ba" text,
	"title_ba_review" "content_review_status",
	"title_ba_source" jsonb,
	"topic_ru" text NOT NULL,
	"content_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_title_ba_pair" CHECK (("units"."title_ba" IS NULL) = ("units"."title_ba_review" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "source_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"lang" text DEFAULT 'ru' NOT NULL,
	"text" text NOT NULL,
	"text_norm" text NOT NULL,
	"kind" "corpus_source_kind" NOT NULL,
	"domain" text,
	"unit_id" text,
	"source_ref" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_items_lang" CHECK ("source_items"."lang" IN ('ru', 'ba'))
);
--> statement-breakpoint
CREATE TABLE "variants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_item_id" uuid NOT NULL,
	"lang" text DEFAULT 'ba' NOT NULL,
	"text" text NOT NULL,
	"text_norm" text NOT NULL,
	"raw" text,
	"origin" "corpus_variant_origin" NOT NULL,
	"source_ref" jsonb,
	"review" "corpus_variant_review" DEFAULT 'needs_native_review' NOT NULL,
	"author_account_id" uuid,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variants_lang" CHECK ("variants"."lang" IN ('ru', 'ba')),
	CONSTRAINT "variants_import_has_source" CHECK ("variants"."origin" <> 'import' OR "variants"."source_ref" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"run_exercise_id" text NOT NULL,
	"exercise_id" text,
	"answer" jsonb NOT NULL,
	"verdict" "learning_attempt_verdict" NOT NULL,
	"first_attempt" boolean NOT NULL,
	"latency_ms" integer,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attempts_latency_range" CHECK ("attempts"."latency_ms" IS NULL OR "attempts"."latency_ms" BETWEEN 0 AND 3600000)
);
--> statement-breakpoint
CREATE TABLE "lesson_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"lesson_id" text NOT NULL,
	"kind" "learning_run_kind" NOT NULL,
	"content_version" integer NOT NULL,
	"status" "learning_run_status" DEFAULT 'active' NOT NULL,
	"plan" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_on" date,
	"completion_index" smallint,
	"accuracy" real,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_runs_completion_fields" CHECK (("lesson_runs"."status" = 'completed') = ("lesson_runs"."completed_at" IS NOT NULL AND "lesson_runs"."completed_on" IS NOT NULL AND "lesson_runs"."completion_index" IS NOT NULL AND "lesson_runs"."summary" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "activity_days" (
	"account_id" uuid NOT NULL,
	"day" date NOT NULL,
	"lessons" smallint DEFAULT 0 NOT NULL,
	"honey" integer DEFAULT 0 NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_days_pk" PRIMARY KEY("account_id","day"),
	CONSTRAINT "activity_days_lessons_nonnegative" CHECK ("activity_days"."lessons" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lesson_progress" (
	"account_id" uuid NOT NULL,
	"lesson_id" text NOT NULL,
	"completions" integer DEFAULT 0 NOT NULL,
	"best_accuracy" real,
	"first_completed_at" timestamp with time zone NOT NULL,
	"last_completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_progress_pk" PRIMARY KEY("account_id","lesson_id")
);
--> statement-breakpoint
CREATE TABLE "progress_counters" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"lessons_completed" integer DEFAULT 0 NOT NULL,
	"words_learned" integer DEFAULT 0 NOT NULL,
	"votes_total" integer DEFAULT 0 NOT NULL,
	"votes_matured" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progress_counters_votes" CHECK ("progress_counters"."votes_matured" <= "progress_counters"."votes_total")
);
--> statement-breakpoint
CREATE TABLE "streaks" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"current" integer DEFAULT 0 NOT NULL,
	"longest" integer DEFAULT 0 NOT NULL,
	"freezes" smallint DEFAULT 2 NOT NULL,
	"last_day" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "streaks_freezes_range" CHECK ("streaks"."freezes" BETWEEN 0 AND 2),
	CONSTRAINT "streaks_longest" CHECK ("streaks"."longest" >= "streaks"."current")
);
--> statement-breakpoint
CREATE TABLE "xp_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"reason" "progress_xp_reason" NOT NULL,
	"ref_id" uuid NOT NULL,
	"status" "progress_xp_status" NOT NULL,
	"earned_on" date NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_ledger_amount_nonnegative" CHECK ("xp_ledger"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_group_id_league_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."league_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_week_activity_week_idx" ON "class_week_activity" USING btree ("class_id","week_start");--> statement-breakpoint
CREATE INDEX "league_groups_week_tier_idx" ON "league_groups" USING btree ("week_start","tier","age_group");--> statement-breakpoint
CREATE UNIQUE INDEX "league_members_account_week_uq" ON "league_members" USING btree ("account_id","week_start");--> statement-breakpoint
CREATE INDEX "league_members_unseen_idx" ON "league_members" USING btree ("account_id") WHERE "league_members"."outcome" IS NOT NULL AND "league_members"."result_seen_at" IS NULL;--> statement-breakpoint
CREATE INDEX "item_state_status_idx" ON "item_state" USING btree ("status");--> statement-breakpoint
CREATE INDEX "judgments_item_idx" ON "judgments" USING btree ("source_item_id","created_at");--> statement-breakpoint
CREATE INDEX "judgments_judge_idx" ON "judgments" USING btree ("judge_account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "judgments_one_pairwise_per_judge_uq" ON "judgments" USING btree ("source_item_id","judge_account_id") WHERE "judgments"."type" = 'pairwise';--> statement-breakpoint
CREATE UNIQUE INDEX "content_versions_course_version_uq" ON "content_versions" USING btree ("course_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_lesson_position_uq" ON "exercises" USING btree ("lesson_id","position");--> statement-breakpoint
CREATE INDEX "exercises_lesson_idx" ON "exercises" USING btree ("lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lessons_unit_position_uq" ON "lessons" USING btree ("unit_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "units_course_position_uq" ON "units" USING btree ("course_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "source_items_external_uq" ON "source_items" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "source_items_unit_idx" ON "source_items" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_item_norm_uq" ON "variants" USING btree ("source_item_id","text_norm");--> statement-breakpoint
CREATE INDEX "variants_item_idx" ON "variants" USING btree ("source_item_id");--> statement-breakpoint
CREATE INDEX "attempts_run_idx" ON "attempts" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "attempts_account_idx" ON "attempts" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_run_exercise_first_uq" ON "attempts" USING btree ("run_id","run_exercise_id") WHERE "attempts"."first_attempt";--> statement-breakpoint
CREATE INDEX "lesson_runs_account_idx" ON "lesson_runs" USING btree ("account_id","started_at");--> statement-breakpoint
CREATE INDEX "lesson_runs_account_lesson_day_idx" ON "lesson_runs" USING btree ("account_id","lesson_id","completed_on");--> statement-breakpoint
CREATE INDEX "lesson_progress_lesson_idx" ON "lesson_progress" USING btree ("lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_ledger_ref_uq" ON "xp_ledger" USING btree ("account_id","reason","ref_id");--> statement-breakpoint
CREATE INDEX "xp_ledger_account_idx" ON "xp_ledger" USING btree ("account_id","earned_on");--> statement-breakpoint
CREATE INDEX "xp_ledger_pending_idx" ON "xp_ledger" USING btree ("ref_id") WHERE "xp_ledger"."status" = 'pending';
--> statement-breakpoint

-- Защиты judgments (написано вручную). Голоса неизменяемы: состояние item_state пересчитывается из журнала (duel-v0,
-- затем Consensus Engine). Триггеры срабатывают и для владельца таблицы; обойти их можно только DDL владельца
-- (ALTER TABLE … DISABLE TRIGGER), поэтому в проде API работает под ролью teletau_app без владения таблицами (ADR 0017).
CREATE OR REPLACE FUNCTION judgments_forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'judgments is append-only: % is not allowed', TG_OP
    USING ERRCODE = '42501', HINT = 'CLAUDE.md, правило 9: голоса только вставляются, состояние пересчитывается из журнала';
END
$$;
--> statement-breakpoint
CREATE TRIGGER judgments_no_update_delete
  BEFORE UPDATE OR DELETE ON judgments
  FOR EACH ROW EXECUTE FUNCTION judgments_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER judgments_no_truncate
  BEFORE TRUNCATE ON judgments
  FOR EACH STATEMENT EXECUTE FUNCTION judgments_forbid_mutation();
--> statement-breakpoint
COMMENT ON TABLE judgments IS 'Журнал голосов в дуэлях (модуль consensus). Только вставка: UPDATE/DELETE/TRUNCATE запрещены триггерами и правами роли teletau_app (правило 9, ADR 0019). voter_group и rules_version — на момент голоса.';
--> statement-breakpoint
-- Права роли приложения: новые таблицы получили SELECT/INSERT/UPDATE/DELETE по ALTER DEFAULT PRIVILEGES из 0002;
-- у judgments изменение и удаление отзываются (роль создаёт 0002 или администратор БД — если её нет, пропускаем).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'teletau_app') THEN
    GRANT SELECT, INSERT ON judgments TO teletau_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON judgments FROM teletau_app;
  END IF;
END
$$;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON judgments FROM PUBLIC;
