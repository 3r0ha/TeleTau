// Подготовка герметичного окружения интеграционных тестов (адреса — it-env.ts). Перед каждым прогоном:
// 1. база `<имя>_it` пересоздаётся (DROP … WITH (FORCE) и CREATE) — прошлый прогон не оставляет ни заявок учителей,
//    ни классов, а e2e и `pnpm dev` на dev-базе не видят данных тестов;
// 2. миграции из apps/api/drizzle применяются программным мигратором drizzle (тот же журнал, что у drizzle-kit migrate);
// 3. справочник районов и школ с демо-школами загружается, как `pnpm --filter @teletau/api org:import`;
// 4. база Valkey тестов очищается: лимиты частоты и стоп-лист прошлого прогона не мешают.
// После прогона база остаётся (её можно посмотреть) и пересоздаётся следующим прогоном.
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Redis } from "ioredis";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { importDirectory } from "../../src/modules/org/directory-import.js";
import { IT_DATABASE_SUFFIX } from "./it-env.js";

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

export default async function setup(project: TestProject): Promise<void> {
  const databaseUrl = project.config.env["DATABASE_URL"];
  const valkeyUrl = project.config.env["VALKEY_URL"];
  if (!databaseUrl || !valkeyUrl) throw new Error("vitest.config.ts не передал проекту integration адреса DATABASE_URL и VALKEY_URL");
  const name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  // Удаляется только база тестов: имя с суффиксом _it, построенное it-env.ts из dev-адреса.
  if (!name.endsWith(IT_DATABASE_SUFFIX)) throw new Error(`Отказ пересоздавать базу «${name}»: у базы интеграционных тестов суффикс ${IT_DATABASE_SUFFIX}`);

  const maintenance = new URL(databaseUrl);
  maintenance.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: maintenance.toString() });
  await admin.connect();
  try {
    const db = admin.escapeIdentifier(name);
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${db}`);
  } finally {
    await admin.end();
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS });
    await importDirectory(pool, { demo: true });
  } finally {
    await pool.end();
  }

  const valkey = new Redis(valkeyUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await valkey.connect();
    await valkey.flushdb();
  } finally {
    valkey.disconnect();
  }
}
