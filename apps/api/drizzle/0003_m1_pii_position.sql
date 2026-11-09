-- 0003_m1_pii_position — сгенерировано drizzle-kit из src/modules/*/*.schema.ts.
-- Должность заявителя — ПДн взрослого: она переезжает в pii.adult_profiles.position, а teacher_verifications.position
-- становится необязательной и всегда NULL (CHECK). Колонка удаляется контрактной миграцией позже.
-- Новые причины отзыва сессии: чужое устройство при обновлении (ADR 0015 §2) и отзыв согласия родителем (ADR 0016 §5).
ALTER TYPE "public"."identity_session_revoke_reason" ADD VALUE 'device_mismatch';--> statement-breakpoint
ALTER TYPE "public"."identity_session_revoke_reason" ADD VALUE 'consent_revoked';--> statement-breakpoint
ALTER TABLE "teacher_verifications" ALTER COLUMN "position" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pii"."adult_profiles" ADD COLUMN "position" text;--> statement-breakpoint
ALTER TABLE "teacher_verifications" ADD CONSTRAINT "teacher_verifications_position_unused" CHECK ("teacher_verifications"."position" IS NULL);