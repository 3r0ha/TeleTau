ALTER TYPE "public"."learning_run_kind" ADD VALUE 'jump';--> statement-breakpoint
CREATE TABLE "lesson_skips" (
	"account_id" uuid NOT NULL,
	"lesson_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_skips_pk" PRIMARY KEY("account_id","lesson_id")
);
