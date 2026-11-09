-- 0005_m1_final — сгенерировано drizzle-kit из src/modules/org/org.schema.ts. Миграция аддитивна: частичный индекс
-- для JoinGrants.close — заявки аккаунта с выданным местом.
-- Мигратор выполняет миграции в транзакции, поэтому здесь индекс создаётся обычным CREATE INDEX (таблица мала).
-- На проде с наполненной таблицей его создают заранее вручную: CREATE INDEX CONCURRENTLY IF NOT EXISTS … с тем же
-- именем и предикатом, тогда миграция найдёт индекс и ничего не сделает (IF NOT EXISTS ниже).
CREATE INDEX IF NOT EXISTS "join_requests_account_grant_idx" ON "join_requests" USING btree ("account_id") WHERE "join_requests"."status" IN ('approved', 'consumed');
