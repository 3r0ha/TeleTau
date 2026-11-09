// Пересоздание базы для демо-мира и сквозных тестов: DROP DATABASE → CREATE DATABASE (+ очистка базы Valkey).
// Удалить демо-голоса иначе нельзя: judgments — только вставка, триггер запрещает UPDATE/DELETE/TRUNCATE (правило 9).
// Вызывают `pnpm demo:reset` (scripts/demo-reset.mjs) и `pnpm e2e` (e2e/run.mjs); адреса — DATABASE_URL и VALKEY_URL
// из окружения процесса. Без --force база с подключениями не трогается: код выхода 3 и имена приложений.
//
//   node apps/api/scripts/db-reset.mjs [--force] [--flush-valkey]
import { Redis } from "ioredis";
import pg from "pg";
import { isInvokedDirectly } from "../../../scripts/lib/invoked.mjs";

export const BUSY_EXIT_CODE = 3;
const SYSTEM_DATABASES = new Set(["postgres", "template0", "template1"]);

/** Имя базы из адреса; системные базы пересоздавать нельзя. */
export function databaseName(url) {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!name) throw new Error(`в DATABASE_URL нет имени базы: ${new URL(url).origin}`);
  if (SYSTEM_DATABASES.has(name)) throw new Error(`базу «${name}» пересоздавать нельзя`);
  return name;
}

/** Адрес служебной базы `postgres` на том же сервере. */
export function maintenanceUrl(url) {
  const u = new URL(url);
  u.pathname = "/postgres";
  return u.toString();
}

/**
 * Пересоздаёт базу. Подключения к ней (pnpm dev, открытый psql) — `{ busy: [...] }` без изменений, если не `force`;
 * с `force` — подключения разрываются (DROP … WITH (FORCE)).
 */
export async function recreateDatabase(url, { force = false } = {}) {
  const name = databaseName(url);
  const admin = new pg.Client({ connectionString: maintenanceUrl(url) });
  await admin.connect();
  try {
    const { rows } = await admin.query(
      "SELECT coalesce(nullif(application_name, ''), 'без имени') AS app, count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid() GROUP BY 1",
      [name],
    );
    if (rows.length > 0 && !force) return { name, busy: rows.map((r) => `${r.app} × ${r.n}`) };
    const db = admin.escapeIdentifier(name);
    await admin.query(`DROP DATABASE IF EXISTS ${db}${force ? " WITH (FORCE)" : ""}`);
    await admin.query(`CREATE DATABASE ${db}`);
    return { name, busy: [] };
  } finally {
    await admin.end();
  }
}

/** Очищает базу Valkey из адреса (лимиты частоты, стоп-лист сессий, задания печати прошлого мира). */
export async function flushValkey(url) {
  const valkey = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await valkey.connect();
    await valkey.flushdb();
  } finally {
    valkey.disconnect();
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("db-reset: нет DATABASE_URL");
    process.exit(2);
  }
  const { name, busy } = await recreateDatabase(url, { force: args.has("--force") });
  if (busy.length) {
    console.error(`db-reset: к базе «${name}» подключены приложения (${busy.join(", ")}) — остановите pnpm dev (Ctrl+C) и повторите.`);
    process.exit(BUSY_EXIT_CODE);
  }
  console.log(`db-reset: база «${name}» пересоздана`);
  if (args.has("--flush-valkey") && process.env.VALKEY_URL) {
    await flushValkey(process.env.VALKEY_URL);
    const db = new URL(process.env.VALKEY_URL).pathname.replace(/^\//, "") || "0";
    console.log(`db-reset: база Valkey ${db} очищена`);
  }
}

if (isInvokedDirectly(import.meta.url)) await main();
