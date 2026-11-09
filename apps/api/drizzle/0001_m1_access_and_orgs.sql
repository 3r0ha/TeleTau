-- 0001_m1_access_and_orgs — таблицы доступа и организаций (сгенерировано drizzle-kit из src/modules/*/*.schema.ts).
-- Правка вручную одна: схема pii уже создана в 0000_init, поэтому CREATE SCHEMA — с IF NOT EXISTS.
CREATE SCHEMA IF NOT EXISTS "pii";
--> statement-breakpoint
CREATE TYPE "public"."consent_method" AS ENUM('electronic', 'paper');--> statement-breakpoint
CREATE TYPE "public"."consent_document_kind" AS ENUM('privacy', 'terms', 'consent_child', 'consent_adult');--> statement-breakpoint
CREATE TYPE "public"."identity_account_kind" AS ENUM('child', 'adult', 'staff');--> statement-breakpoint
CREATE TYPE "public"."identity_locale" AS ENUM('ru', 'ba');--> statement-breakpoint
CREATE TYPE "public"."identity_account_role" AS ENUM('student', 'teacher', 'moderator', 'admin');--> statement-breakpoint
CREATE TYPE "public"."identity_account_status" AS ENUM('active', 'blocked', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."identity_credential_type" AS ENUM('email', 'totp');--> statement-breakpoint
CREATE TYPE "public"."identity_device_platform" AS ENUM('web', 'ios', 'android', 'bot');--> statement-breakpoint
CREATE TYPE "public"."identity_session_revoke_reason" AS ENUM('logout', 'logout_all', 'refresh_reuse', 'account_blocked', 'admin');--> statement-breakpoint
CREATE TYPE "public"."identity_ui_mode" AS ENUM('bee', 'bortnik', 'keeper');--> statement-breakpoint
CREATE TYPE "public"."moderation_teacher_verification_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."org_card_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."org_class_program" AS ENUM('native', 'state', 'elective');--> statement-breakpoint
CREATE TYPE "public"."org_class_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."org_district_kind" AS ENUM('municipal_district', 'urban_okrug');--> statement-breakpoint
CREATE TYPE "public"."org_join_request_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'consumed');--> statement-breakpoint
CREATE TYPE "public"."org_membership_role" AS ENUM('student', 'teacher', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."org_school_category" AS ENUM('city_large', 'city_small', 'rural', 'small_rural');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_account_id" uuid,
	"actor_kind" text,
	"actor_roles" text[],
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_hash" text,
	"request_id" text,
	CONSTRAINT "audit_log_action_format" CHECK ("audit_log"."action" ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
	CONSTRAINT "audit_log_metadata_object" CHECK (jsonb_typeof("audit_log"."metadata") = 'object'),
	CONSTRAINT "audit_log_actor_pair" CHECK (("audit_log"."actor_account_id" IS NULL) = ("audit_log"."actor_kind" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"method" "consent_method" NOT NULL,
	"subject_account_id" uuid,
	"subject_seat_id" uuid,
	"subject_class_id" uuid,
	"given_by_account_id" uuid NOT NULL,
	"scope" text[] DEFAULT '{}'::text[] NOT NULL,
	"signed_on" date,
	"given_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_one_subject" CHECK (num_nonnulls("consents"."subject_account_id", "consents"."subject_seat_id") = 1),
	CONSTRAINT "consents_seat_has_class" CHECK ("consents"."subject_seat_id" IS NULL OR "consents"."subject_class_id" IS NOT NULL),
	CONSTRAINT "consents_paper_for_seats" CHECK (("consents"."method" = 'paper') = ("consents"."subject_seat_id" IS NOT NULL)),
	CONSTRAINT "consents_revoked_pair" CHECK (("consents"."revoked_at" IS NULL) = ("consents"."revoked_by_account_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "consent_document_kind" NOT NULL,
	"version" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"body_sha256" text,
	"effective_from" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "identity_account_kind" NOT NULL,
	"roles" "identity_account_role"[] DEFAULT '{}'::identity_account_role[] NOT NULL,
	"status" "identity_account_status" DEFAULT 'active' NOT NULL,
	"nickname_key" text,
	"nickname" text,
	"ui_mode" "identity_ui_mode",
	"locale" "identity_locale" DEFAULT 'ru' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_nickname_child_only" CHECK ("accounts"."kind" = 'child' OR ("accounts"."nickname" IS NULL AND "accounts"."nickname_key" IS NULL)),
	CONSTRAINT "accounts_nickname_pair" CHECK (("accounts"."nickname" IS NULL) = ("accounts"."nickname_key" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "pii"."adult_profiles" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adult_profiles_email_lower" CHECK ("pii"."adult_profiles"."email" = lower("pii"."adult_profiles"."email"))
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"type" "identity_credential_type" NOT NULL,
	"subject" text,
	"secret_enc" text,
	"verified_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_subject_hex" CHECK ("credentials"."subject" IS NULL OR "credentials"."subject" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "credentials_email_has_subject" CHECK ("credentials"."type" <> 'email' OR "credentials"."subject" IS NOT NULL),
	CONSTRAINT "credentials_totp_has_secret" CHECK ("credentials"."type" <> 'totp' OR "credentials"."secret_enc" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"install_id" uuid NOT NULL,
	"platform" "identity_device_platform" NOT NULL,
	"app_version" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"refresh_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"family_expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_reason" "identity_session_revoke_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_refresh_hash_hex" CHECK ("sessions"."refresh_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sessions_revoke_reason_pair" CHECK (("sessions"."revoked_at" IS NULL) = ("sessions"."revoke_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "teacher_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"position" text NOT NULL,
	"status" "moderation_teacher_verification_status" DEFAULT 'pending' NOT NULL,
	"decided_by_account_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_verifications_decision_pair" CHECK (("teacher_verifications"."status" = 'pending') = ("teacher_verifications"."decided_at" IS NULL) AND ("teacher_verifications"."decided_at" IS NULL) = ("teacher_verifications"."decided_by_account_id" IS NULL)),
	CONSTRAINT "teacher_verifications_reject_reason" CHECK ("teacher_verifications"."status" <> 'rejected' OR "teacher_verifications"."decision_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "class_seats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"class_id" uuid NOT NULL,
	"seat_number" smallint NOT NULL,
	"account_id" uuid,
	"bound_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_seats_number_range" CHECK ("class_seats"."seat_number" BETWEEN 1 AND 99),
	CONSTRAINT "class_seats_bound_pair" CHECK (("class_seats"."account_id" IS NULL) = ("class_seats"."bound_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"teacher_account_id" uuid NOT NULL,
	"grade" smallint NOT NULL,
	"letter" text NOT NULL,
	"program" "org_class_program" NOT NULL,
	"academic_year" smallint NOT NULL,
	"status" "org_class_status" DEFAULT 'active' NOT NULL,
	"join_code_hash" text,
	"join_code_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classes_grade_range" CHECK ("classes"."grade" BETWEEN 1 AND 11),
	CONSTRAINT "classes_letter_length" CHECK (char_length("classes"."letter") BETWEEN 1 AND 3),
	CONSTRAINT "classes_join_code_pair" CHECK (("classes"."join_code_hash" IS NULL) = ("classes"."join_code_expires_at" IS NULL)),
	CONSTRAINT "classes_join_code_hex" CHECK ("classes"."join_code_hash" IS NULL OR "classes"."join_code_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"oktmo" text NOT NULL,
	"name_ru" text NOT NULL,
	"name_ba" text,
	"kind" "org_district_kind" NOT NULL,
	"source" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "districts_oktmo_digits" CHECK ("districts"."oktmo" ~ '^[0-9]{8}([0-9]{3})?$' OR "districts"."is_demo")
);
--> statement-breakpoint
CREATE TABLE "join_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"class_id" uuid NOT NULL,
	"nickname_key" text NOT NULL,
	"nickname" text NOT NULL,
	"status" "org_join_request_status" DEFAULT 'pending' NOT NULL,
	"poll_token_hash" text NOT NULL,
	"device_install_id" uuid NOT NULL,
	"device_platform" text NOT NULL,
	"app_version" text,
	"account_id" uuid,
	"seat_id" uuid,
	"decided_by_account_id" uuid,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "join_requests_poll_token_hex" CHECK ("join_requests"."poll_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "join_requests_platform" CHECK ("join_requests"."device_platform" IN ('web', 'ios', 'android', 'bot'))
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"class_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"role" "org_membership_role" NOT NULL,
	"seat_id" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schools" (
	"id" uuid PRIMARY KEY NOT NULL,
	"district_id" uuid NOT NULL,
	"name_ru" text NOT NULL,
	"short_name_ru" text NOT NULL,
	"name_ba" text,
	"inn" text,
	"address" text,
	"category" "org_school_category",
	"bashkir_medium" boolean,
	"source" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schools_inn_digits" CHECK ("schools"."inn" IS NULL OR "schools"."inn" ~ '^[0-9]{10}$')
);
--> statement-breakpoint
CREATE TABLE "seat_cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seat_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"handle" text NOT NULL,
	"secret_hash" text NOT NULL,
	"status" "org_card_status" DEFAULT 'active' NOT NULL,
	"issued_by_account_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seat_cards_version_positive" CHECK ("seat_cards"."version" >= 1),
	CONSTRAINT "seat_cards_handle_format" CHECK ("seat_cards"."handle" ~ '^[0-9A-HJKMNP-TV-Z]{10}$'),
	CONSTRAINT "seat_cards_secret_hex" CHECK ("seat_cards"."secret_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "seat_cards_revoked_pair" CHECK (("seat_cards"."status" = 'revoked') = ("seat_cards"."revoked_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_document_id_legal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."legal_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pii"."adult_profiles" ADD CONSTRAINT "adult_profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_seats" ADD CONSTRAINT "class_seats_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_seat_id_class_seats_id_fk" FOREIGN KEY ("seat_id") REFERENCES "public"."class_seats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_seat_id_class_seats_id_fk" FOREIGN KEY ("seat_id") REFERENCES "public"."class_seats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_cards" ADD CONSTRAINT "seat_cards_seat_id_class_seats_id_fk" FOREIGN KEY ("seat_id") REFERENCES "public"."class_seats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_account_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "consents_account_active_uq" ON "consents" USING btree ("subject_account_id","document_id") WHERE "consents"."revoked_at" IS NULL AND "consents"."subject_account_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "consents_seat_active_uq" ON "consents" USING btree ("subject_seat_id","document_id") WHERE "consents"."revoked_at" IS NULL AND "consents"."subject_seat_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "consents_subject_account_idx" ON "consents" USING btree ("subject_account_id");--> statement-breakpoint
CREATE INDEX "consents_subject_seat_idx" ON "consents" USING btree ("subject_seat_id");--> statement-breakpoint
CREATE INDEX "consents_subject_class_idx" ON "consents" USING btree ("subject_class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_documents_kind_version_uq" ON "legal_documents" USING btree ("kind","version");--> statement-breakpoint
CREATE INDEX "legal_documents_kind_effective_idx" ON "legal_documents" USING btree ("kind","effective_from");--> statement-breakpoint
CREATE INDEX "accounts_kind_idx" ON "accounts" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "adult_profiles_email_uq" ON "pii"."adult_profiles" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_type_subject_uq" ON "credentials" USING btree ("type","subject") WHERE "credentials"."subject" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "credentials_account_idx" ON "credentials" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_account_install_uq" ON "devices" USING btree ("account_id","install_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_refresh_hash_uq" ON "sessions" USING btree ("refresh_hash");--> statement-breakpoint
CREATE INDEX "sessions_family_idx" ON "sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "sessions_account_idx" ON "sessions" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_verifications_one_pending_uq" ON "teacher_verifications" USING btree ("account_id") WHERE "teacher_verifications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "teacher_verifications_queue_idx" ON "teacher_verifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "teacher_verifications_account_idx" ON "teacher_verifications" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "class_seats_class_number_uq" ON "class_seats" USING btree ("class_id","seat_number");--> statement-breakpoint
CREATE UNIQUE INDEX "class_seats_class_account_uq" ON "class_seats" USING btree ("class_id","account_id") WHERE "class_seats"."account_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "class_seats_account_idx" ON "class_seats" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "classes_join_code_hash_uq" ON "classes" USING btree ("join_code_hash") WHERE "classes"."join_code_hash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "classes_teacher_identity_uq" ON "classes" USING btree ("teacher_account_id","school_id","grade","letter","program","academic_year");--> statement-breakpoint
CREATE INDEX "classes_school_idx" ON "classes" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "classes_teacher_idx" ON "classes" USING btree ("teacher_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "districts_oktmo_uq" ON "districts" USING btree ("oktmo");--> statement-breakpoint
CREATE UNIQUE INDEX "join_requests_poll_token_uq" ON "join_requests" USING btree ("poll_token_hash");--> statement-breakpoint
CREATE INDEX "join_requests_class_status_idx" ON "join_requests" USING btree ("class_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_active_uq" ON "memberships" USING btree ("class_id","account_id") WHERE "memberships"."left_at" IS NULL;--> statement-breakpoint
CREATE INDEX "memberships_account_idx" ON "memberships" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schools_inn_uq" ON "schools" USING btree ("inn") WHERE "schools"."inn" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "schools_district_idx" ON "schools" USING btree ("district_id");--> statement-breakpoint
CREATE INDEX "schools_name_ru_trgm_idx" ON "schools" USING gin ("name_ru" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "schools_short_name_ru_trgm_idx" ON "schools" USING gin ("short_name_ru" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "seat_cards_handle_uq" ON "seat_cards" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "seat_cards_seat_version_uq" ON "seat_cards" USING btree ("seat_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "seat_cards_one_active_uq" ON "seat_cards" USING btree ("seat_id") WHERE "seat_cards"."status" = 'active';