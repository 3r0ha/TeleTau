// Доступ к Postgres для модулей. Таблицы здесь не объявляются (ADR 0014): каждый модуль строит запросы
// по своей схеме, а общий тип Db позволяет передать транзакцию в публичный сервис другого модуля —
// например, запись в аудит в той же транзакции, что и само изменение (ADR 0017 §5).
import { drizzle, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type pg from "pg";

/** База или открытая транзакция: публичные сервисы модулей принимают и то и другое. */
export type Db = PgDatabase<NodePgQueryResultHKT, Record<string, never>>;

export function createDb(pool: pg.Pool): Db {
  return drizzle({ client: pool });
}

/** Код ошибки Postgres (23505 — нарушение уникальности и т. п.), в том числе обёрнутой Drizzle. */
export function pgErrorCode(e: unknown): string | undefined {
  for (let cur: unknown = e, i = 0; cur && i < 4; cur = (cur as { cause?: unknown }).cause, i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

/** Имя нарушенного ограничения Postgres (для различения уникальных индексов). */
export function pgConstraint(e: unknown): string | undefined {
  for (let cur: unknown = e, i = 0; cur && i < 4; cur = (cur as { cause?: unknown }).cause, i++) {
    const c = (cur as { constraint?: unknown }).constraint;
    if (typeof c === "string") return c;
  }
  return undefined;
}
