CREATE TYPE "public"."telegram_dialog_status" AS ENUM('issued', 'answered', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."consensus_judgment_context" ADD VALUE 'telegram';--> statement-breakpoint
CREATE TABLE "telegram_dialogs" (
	"dialog_id" uuid PRIMARY KEY NOT NULL,
	"chat_id" bigint NOT NULL,
	"account_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"variant_a_id" uuid NOT NULL,
	"variant_b_id" uuid NOT NULL,
	"judgment_id" uuid NOT NULL,
	"day" date NOT NULL,
	"status" "telegram_dialog_status" DEFAULT 'issued' NOT NULL,
	"choice" text,
	"item_status" text,
	"answered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_dialogs_answered_fields" CHECK (("telegram_dialogs"."status" = 'answered') = ("telegram_dialogs"."choice" IS NOT NULL AND "telegram_dialogs"."item_status" IS NOT NULL AND "telegram_dialogs"."answered_at" IS NOT NULL)),
	CONSTRAINT "telegram_dialogs_cancelled_fields" CHECK (("telegram_dialogs"."status" = 'cancelled') = ("telegram_dialogs"."cancelled_at" IS NOT NULL)),
	CONSTRAINT "telegram_dialogs_choice_values" CHECK ("telegram_dialogs"."choice" IS NULL OR "telegram_dialogs"."choice" IN ('a', 'b', 'both', 'skip')),
	CONSTRAINT "telegram_dialogs_item_status_values" CHECK ("telegram_dialogs"."item_status" IS NULL OR "telegram_dialogs"."item_status" IN ('voting', 'accepted', 'escalated'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_dialogs_one_issued_per_account_uq" ON "telegram_dialogs" USING btree ("account_id") WHERE "telegram_dialogs"."status" = 'issued';--> statement-breakpoint
CREATE INDEX "telegram_dialogs_chat_idx" ON "telegram_dialogs" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "telegram_dialogs_account_status_idx" ON "telegram_dialogs" USING btree ("account_id","status");