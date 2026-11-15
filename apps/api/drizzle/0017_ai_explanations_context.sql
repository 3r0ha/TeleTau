-- Кеш объяснений без версии промпта и хеша контекста недействителен: строки удаляются, кеш наполняется заново по запросам.
DELETE FROM "ai_explanations";--> statement-breakpoint
ALTER TABLE "ai_explanations" ADD COLUMN "prompt_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_explanations" ADD COLUMN "context_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_explanations" DROP CONSTRAINT "ai_explanations_pk";
--> statement-breakpoint
ALTER TABLE "ai_explanations" ADD CONSTRAINT "ai_explanations_pk" PRIMARY KEY("exercise_id","error_class","prompt_id","context_hash");
