CREATE TYPE "public"."assignments_kind" AS ENUM('lesson', 'place_test', 'review');--> statement-breakpoint
CREATE TABLE "assignment_completions" (
	"assignment_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_completions_pk" PRIMARY KEY("assignment_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"class_id" uuid NOT NULL,
	"teacher_account_id" uuid NOT NULL,
	"kind" "assignments_kind" NOT NULL,
	"lesson_id" text,
	"title_ru" text NOT NULL,
	"place_ru" text,
	"due_on" date NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_lesson_by_kind" CHECK (("assignments"."kind" = 'review') = ("assignments"."lesson_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "assignment_completions" ADD CONSTRAINT "assignment_completions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_completions_account_idx" ON "assignment_completions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "assignments_class_due_idx" ON "assignments" USING btree ("class_id","due_on") WHERE "assignments"."cancelled_at" IS NULL;