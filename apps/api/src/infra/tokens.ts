/** Токены DI инфраструктурных клиентов. Модули зависят от узких интерфейсов, а не от драйверов. */
export const PG_POOL = Symbol("PG_POOL");
export const VALKEY = Symbol("VALKEY");
/** Drizzle поверх общего пула (тип Db из src/db/database.ts): таблицы у каждого модуля свои (ADR 0014). */
export const DB = Symbol("DB");
/** Репортёр ошибок инфраструктуры с троттлингом (`@teletau/runtime` createThrottledErrorLogger). */
export const INFRA_REPORTER = Symbol("INFRA_REPORTER");

/** То, что нужно health-проверке от Postgres. */
export interface SqlPinger {
  /** Совместимо с pg: строка или конфиг запроса с собственным query_timeout. */
  query(query: string | { text: string; query_timeout?: number }): Promise<unknown>;
}

/** То, что нужно health-проверке от Valkey. */
export interface KvPinger {
  ping(): Promise<string>;
}
