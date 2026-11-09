// Герметичные интеграционные тесты: тесты не пишут в dev-базу из корневого .env.
// Им достаются отдельная база `<имя>_it` на том же Postgres и следующий номер базы Valkey (по умолчанию /1).
// Адреса считает vitest.config.ts из окружения процесса (корневой .env) и передаёт тестам через `test.env` проекта
// integration. global-setup.ts перед прогоном пересоздаёт базу, применяет миграции, загружает справочник и очищает
// базу Valkey. Dev-база и ключи dev в Valkey не меняются.
import { DEFAULT_DATABASE_URL, DEFAULT_VALKEY_URL } from "../../src/config/config.js";

/** Суффикс имени базы интеграционных тестов. global-setup.ts удаляет и создаёт только базу с таким суффиксом. */
export const IT_DATABASE_SUFFIX = "_it";

export interface IntegrationEnv {
  DATABASE_URL: string;
  VALKEY_URL: string;
}

/** `postgres://…/teletau` → `postgres://…/teletau_it`: тот же сервер и пользователь, другая база. */
export function integrationDatabaseUrl(devUrl: string): string {
  const url = new URL(devUrl);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!name) throw new Error("DATABASE_URL без имени базы: не из чего построить имя базы интеграционных тестов");
  if (name.endsWith(IT_DATABASE_SUFFIX)) {
    throw new Error(`DATABASE_URL уже указывает на базу интеграционных тестов (${name}): укажите dev-базу`);
  }
  url.pathname = `/${encodeURIComponent(`${name}${IT_DATABASE_SUFFIX}`)}`;
  return url.toString();
}

/** `redis://…:16379` (база 0) → `redis://…:16379/1`: следующий номер базы на том же сервере. */
export function integrationValkeyUrl(devUrl: string): string {
  const url = new URL(devUrl);
  const raw = url.searchParams.get("db") ?? (url.pathname.replace(/^\//, "") || "0");
  const db = Number(raw);
  if (!Number.isInteger(db) || db < 0) throw new Error(`VALKEY_URL: некорректный номер базы «${raw}»`);
  url.searchParams.delete("db");
  url.pathname = `/${db + 1}`;
  return url.toString();
}

export function integrationEnv(env: NodeJS.ProcessEnv): IntegrationEnv {
  return {
    DATABASE_URL: integrationDatabaseUrl(env["DATABASE_URL"] || DEFAULT_DATABASE_URL),
    VALKEY_URL: integrationValkeyUrl(env["VALKEY_URL"] || DEFAULT_VALKEY_URL),
  };
}
