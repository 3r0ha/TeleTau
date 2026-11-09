ALTER TYPE "public"."content_exercise_type" ADD VALUE 'match_pairs';--> statement-breakpoint
ALTER TYPE "public"."learning_run_kind" ADD VALUE 'review';--> statement-breakpoint
CREATE TABLE "words" (
	"course_id" text NOT NULL,
	"id" text NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"review" "content_review_status" NOT NULL,
	"translation_ru" text NOT NULL,
	"audio" jsonb,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lesson_id" text NOT NULL,
	"content_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "words_pk" PRIMARY KEY("course_id","id"),
	CONSTRAINT "words_sources_array" CHECK (jsonb_typeof("words"."sources") = 'array')
);
--> statement-breakpoint
CREATE TABLE "srs_cards" (
	"account_id" uuid NOT NULL,
	"word_id" text NOT NULL,
	"stability" double precision NOT NULL,
	"difficulty" double precision NOT NULL,
	"reps" integer NOT NULL,
	"lapses" integer NOT NULL,
	"last_review_on" date NOT NULL,
	"due_on" date NOT NULL,
	"fsrs_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "srs_cards_pk" PRIMARY KEY("account_id","word_id"),
	CONSTRAINT "srs_cards_stability_range" CHECK ("srs_cards"."stability" > 0),
	CONSTRAINT "srs_cards_difficulty_range" CHECK ("srs_cards"."difficulty" BETWEEN 1 AND 10),
	CONSTRAINT "srs_cards_reps" CHECK ("srs_cards"."reps" >= 1 AND "srs_cards"."lapses" >= 0 AND "srs_cards"."lapses" < "srs_cards"."reps")
);
--> statement-breakpoint
CREATE TABLE "srs_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"word_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"attempt_id" uuid,
	"rating" smallint NOT NULL,
	"reviewed_on" date NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"elapsed_days" integer,
	"stability" double precision NOT NULL,
	"difficulty" double precision NOT NULL,
	"due_on" date NOT NULL,
	"fsrs_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "srs_reviews_rating_range" CHECK ("srs_reviews"."rating" BETWEEN 1 AND 4)
);
--> statement-breakpoint
ALTER TABLE "activity_days" ADD COLUMN "goal_lessons" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "words_course_position_idx" ON "words" USING btree ("course_id","position");--> statement-breakpoint
CREATE INDEX "srs_cards_account_due_idx" ON "srs_cards" USING btree ("account_id","due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "srs_reviews_run_word_uq" ON "srs_reviews" USING btree ("run_id","word_id");--> statement-breakpoint
CREATE INDEX "srs_reviews_account_word_idx" ON "srs_reviews" USING btree ("account_id","word_id","reviewed_at");--> statement-breakpoint
ALTER TABLE "activity_days" ADD CONSTRAINT "activity_days_goal_lessons" CHECK ("activity_days"."goal_lessons" BETWEEN 0 AND "activity_days"."lessons");--> statement-breakpoint

-- Написано вручную: соты цели дня за уже прошедшие дни — по числу завершений (до этой миграции «Помоги языку» от уроков
-- не отличались; разница видна только в истории и только у цели дня, серия считается по lessons, как раньше).
UPDATE "activity_days" SET "goal_lessons" = "lessons" WHERE "goal_lessons" = 0 AND "lessons" > 0;
--> statement-breakpoint
COMMENT ON TABLE "srs_reviews" IS 'Журнал повторений слов (модуль learning): знакомство в уроке и первые попытки в забегах повторения. Только вставка; карточка srs_cards пересчитываема из журнала (FSRS-6, contracts/test-vectors/srs).';
