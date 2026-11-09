-- 0011_staff_roles — сгенерировано drizzle-kit из src/modules/*/*.schema.ts (ADR 0023): роли сотрудников ministry
-- (кабинет министерства, только агрегаты) и fund (словарь для Фонда). Новых таблиц нет: оба раздела читают публичные сервисы модулей.
ALTER TYPE "public"."identity_account_role" ADD VALUE 'ministry';--> statement-breakpoint
ALTER TYPE "public"."identity_account_role" ADD VALUE 'fund';