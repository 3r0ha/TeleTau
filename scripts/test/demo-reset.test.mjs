// pnpm demo:reset и база сквозных тестов: адреса баз и защита системных баз от пересоздания.
import assert from "node:assert/strict";
import { test } from "node:test";
import { databaseName, maintenanceUrl } from "../../apps/api/scripts/db-reset.mjs";
import { e2eDatabaseUrl, e2eEnv, e2eValkeyUrl } from "../demo-reset.mjs";

test("e2e uses its own Postgres database and Valkey db next to the dev ones", () => {
  assert.equal(e2eDatabaseUrl("postgres://teletau:teletau@localhost:15432/teletau"), "postgres://teletau:teletau@localhost:15432/teletau_e2e");
  assert.throws(() => e2eDatabaseUrl("postgres://teletau:teletau@localhost:15432/teletau_e2e"), /dev-базу/);
  assert.equal(e2eValkeyUrl("redis://localhost:16379"), "redis://localhost:16379/2");
  assert.equal(e2eValkeyUrl("redis://localhost:16379/3"), "redis://localhost:16379/5");
});

test("e2eEnv is idempotent: the Playwright process gets the converted env once more", () => {
  const once = e2eEnv({ DATABASE_URL: "postgres://u:p@h:1/teletau", VALKEY_URL: "redis://h:2", API_PORT: "4000", AUTH_DEMO_CLASS_CODE: "000000" });
  assert.equal(once.DATABASE_URL, "postgres://u:p@h:1/teletau_e2e");
  assert.equal("AUTH_DEMO_CLASS_CODE" in once, false, "постоянного кода класса в e2e нет");
  assert.equal(once.API_PORT, "4000");
  assert.deepEqual(e2eEnv(once), once);
  // Второй проход (процесс Playwright) снова получает ключ из .env.example — он снимается и тогда.
  assert.equal("AUTH_DEMO_CLASS_CODE" in e2eEnv({ ...once, AUTH_DEMO_CLASS_CODE: "000000" }), false);
});

test("db-reset refuses system databases and talks to the maintenance db", () => {
  assert.equal(databaseName("postgres://u:p@h:1/teletau_e2e"), "teletau_e2e");
  for (const name of ["postgres", "template0", "template1"]) assert.throws(() => databaseName(`postgres://u:p@h:1/${name}`), /нельзя/);
  assert.throws(() => databaseName("postgres://u:p@h:1/"), /нет имени базы/);
  assert.equal(maintenanceUrl("postgres://u:p@h:1/teletau?sslmode=disable"), "postgres://u:p@h:1/postgres?sslmode=disable");
});
