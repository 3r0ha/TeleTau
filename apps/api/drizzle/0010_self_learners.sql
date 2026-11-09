-- 0010_self_learners — сгенерировано drizzle-kit из src/modules/*/*.schema.ts (самостоятельное обучение, ADR 0022).
-- «Учусь сам»: accounts.self_signup (аккаунт без школы и без почты) и daily_goal (цель дня 1–3); ник есть и у
-- взрослых-учеников (лига), но не у сотрудников. Личная карточка входа TP1 — login_cards (SHA-256 секрета для проверки,
-- шифртекст для показа владельцу). Заявка в класс уже вошедшего ученика — join_requests.requester_account_id.
-- Группы лиги детей — по возрастному диапазону (competition_age_group: child_7_10, child_11_14, child_15_17).
ALTER TYPE "public"."competition_age_group" ADD VALUE 'child_7_10';--> statement-breakpoint
ALTER TYPE "public"."competition_age_group" ADD VALUE 'child_11_14';--> statement-breakpoint
ALTER TYPE "public"."competition_age_group" ADD VALUE 'child_15_17';--> statement-breakpoint
CREATE TABLE "login_cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"secret_hash" text NOT NULL,
	"secret_enc" text NOT NULL,
	"version" integer NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_cards_handle_format" CHECK ("login_cards"."handle" ~ '^[0-9A-HJKMNP-TV-Z]{10}$'),
	CONSTRAINT "login_cards_secret_hash_hex" CHECK ("login_cards"."secret_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "login_cards_version_positive" CHECK ("login_cards"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_nickname_child_only";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "self_signup" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "daily_goal" smallint;--> statement-breakpoint
ALTER TABLE "join_requests" ADD COLUMN "requester_account_id" uuid;--> statement-breakpoint
ALTER TABLE "login_cards" ADD CONSTRAINT "login_cards_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "login_cards_handle_uq" ON "login_cards" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "login_cards_account_live_uq" ON "login_cards" USING btree ("account_id") WHERE "login_cards"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "login_cards_account_version_uq" ON "login_cards" USING btree ("account_id","version");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_nickname_not_staff" CHECK ("accounts"."kind" <> 'staff' OR ("accounts"."nickname" IS NULL AND "accounts"."nickname_key" IS NULL));--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_daily_goal_range" CHECK ("accounts"."daily_goal" IS NULL OR "accounts"."daily_goal" BETWEEN 1 AND 3);