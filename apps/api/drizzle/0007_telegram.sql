-- 0007_telegram — модуль telegram (ADR 0020): привязка личного чата с ботом к аккаунту и согласие на напоминания о серии.
-- Только chat_id (= user.id Telegram) и id аккаунта — ничего из профиля Telegram (CLAUDE.md, правило 13). Аддитивна.
CREATE TABLE "telegram_links" (
	"chat_id" bigint PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"reminders_enabled" boolean DEFAULT false NOT NULL,
	"reminder_hour" smallint DEFAULT 18 NOT NULL,
	"last_reminded_on" date,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_links_chat_positive" CHECK ("telegram_links"."chat_id" > 0),
	CONSTRAINT "telegram_links_hour_range" CHECK ("telegram_links"."reminder_hour" BETWEEN 8 AND 20)
);
--> statement-breakpoint
CREATE INDEX "telegram_links_account_idx" ON "telegram_links" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "telegram_links_reminders_idx" ON "telegram_links" USING btree ("reminder_hour") WHERE "telegram_links"."reminders_enabled";