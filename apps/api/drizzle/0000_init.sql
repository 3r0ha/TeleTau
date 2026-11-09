-- 0000_init — фундамент базы. Таблицы модулей — в следующих миграциях.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS pii;--> statement-breakpoint
COMMENT ON SCHEMA pii IS 'Персональные данные взрослых (учителя, родители). Отдельные права доступа. Данные детей сюда не попадают — privacy by design (docs/08 §7).';--> statement-breakpoint
-- Башкирский алфавит: в CLDR нет башкирской сортировки, корневая ставит Ә после А,
-- а по алфавиту Ә идёт после Э. Остальные буквы корневая сортировка ставит верно (research/02 §F5).
CREATE COLLATION IF NOT EXISTS ba_tailored (provider = icu, locale = 'ru', rules = '&Э < ә <<< Ә');
