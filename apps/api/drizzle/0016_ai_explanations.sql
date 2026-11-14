CREATE TABLE "ai_explanation_uses" (
	"account_id" uuid NOT NULL,
	"day" date NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "ai_explanation_uses_pk" PRIMARY KEY("account_id","day"),
	CONSTRAINT "ai_explanation_uses_range" CHECK ("ai_explanation_uses"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_explanations" (
	"exercise_id" text NOT NULL,
	"error_class" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_explanations_pk" PRIMARY KEY("exercise_id","error_class"),
	CONSTRAINT "ai_explanations_error_class" CHECK ("ai_explanations"."error_class" IN ('almost', 'typo', 'wrong')),
	CONSTRAINT "ai_explanations_text_len" CHECK (char_length("ai_explanations"."text") BETWEEN 1 AND 400)
);
