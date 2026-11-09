-- 0002_m1_guards — защиты на уровне БД (написано вручную; ADR 0009, 0017).
-- Миграция аддитивна: функции, триггеры, комментарии, роль приложения и права. Таблиц и данных не меняет.

-- 1. audit_log — только вставка. Триггеры срабатывают и для владельца таблицы, поэтому UPDATE, DELETE и TRUNCATE
--    невозможны из кода приложения при любом подключении. Обойти их может только владелец через DDL
--    (ALTER TABLE … DISABLE TRIGGER), поэтому в проде приложение работает под ролью teletau_app без владения таблицами (п. 3).
CREATE OR REPLACE FUNCTION audit_log_forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP
    USING ERRCODE = '42501', HINT = 'ADR 0017: журнал аудита только для вставки';
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_forbid_mutation();
--> statement-breakpoint
COMMENT ON TABLE audit_log IS 'Журнал аудита (модуль admin). Только вставка: UPDATE/DELETE/TRUNCATE запрещены триггерами и правами роли teletau_app (ADR 0017). Без ПДн, секретов и токенов.';
--> statement-breakpoint

-- 2. В pii нет строк для детских аккаунтов (ADR 0009): профиль ребёнка не вставить,
--    а аккаунт с профилем не превратить в детский.
CREATE OR REPLACE FUNCTION pii.adult_profiles_reject_child() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = NEW.account_id AND a.kind = 'child') THEN
    RAISE EXCEPTION 'pii.adult_profiles: child accounts have no personal data'
      USING ERRCODE = '23514', HINT = 'ADR 0009: детские аккаунты псевдонимны';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER adult_profiles_adult_only
  BEFORE INSERT OR UPDATE OF account_id ON pii.adult_profiles
  FOR EACH ROW EXECUTE FUNCTION pii.adult_profiles_reject_child();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION accounts_child_without_pii() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'child' AND EXISTS (SELECT 1 FROM pii.adult_profiles p WHERE p.account_id = NEW.id) THEN
    RAISE EXCEPTION 'accounts: an account with a pii.adult_profiles row cannot become a child account'
      USING ERRCODE = '23514', HINT = 'ADR 0009: детские аккаунты псевдонимны';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER accounts_child_without_pii
  BEFORE UPDATE OF kind ON accounts
  FOR EACH ROW EXECUTE FUNCTION accounts_child_without_pii();
--> statement-breakpoint
COMMENT ON TABLE pii.adult_profiles IS 'ПДн взрослых (e-mail, ФИО). Строк для детских аккаунтов нет — запрещено триггером (ADR 0009).';
--> statement-breakpoint

-- 3. Роль приложения teletau_app (NOLOGIN; в проде под ней работает логин-роль API, в которую она входит).
--    Права на чтение и запись всех таблиц, но на audit_log — только SELECT и INSERT.
--    В управляемом Postgres права CREATE ROLE у мигратора может не быть — тогда роль создаёт администратор БД,
--    а миграция только выдаёт права, если роль уже есть.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'teletau_app') THEN
    CREATE ROLE teletau_app NOLOGIN;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'teletau_app: нет права CREATE ROLE — роль создаёт администратор БД (ADR 0017)';
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'teletau_app') THEN
    GRANT USAGE ON SCHEMA public, pii TO teletau_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO teletau_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pii TO teletau_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM teletau_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO teletau_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA pii GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO teletau_app;
  END IF;
END
$$;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC;
