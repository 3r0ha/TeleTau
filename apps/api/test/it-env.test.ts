// Адреса герметичных интеграционных тестов: своя база Postgres и своя база Valkey, dev-база не трогается.
import { describe, expect, it } from "vitest";
import { integrationDatabaseUrl, integrationEnv, integrationValkeyUrl } from "./integration/it-env.js";

describe("integration test environment (M1-50)", () => {
  it("uses the database <name>_it on the same server and user", () => {
    expect(integrationDatabaseUrl("postgres://teletau:teletau@localhost:15432/teletau")).toBe("postgres://teletau:teletau@localhost:15432/teletau_it");
    expect(integrationDatabaseUrl("postgres://u:p@db.internal:5432/app?sslmode=require")).toBe("postgres://u:p@db.internal:5432/app_it?sslmode=require");
  });

  it("refuses a URL without a database name or already pointing at the test database", () => {
    expect(() => integrationDatabaseUrl("postgres://teletau:teletau@localhost:15432")).toThrow(/без имени базы/);
    expect(() => integrationDatabaseUrl("postgres://teletau:teletau@localhost:15432/teletau_it")).toThrow(/уже указывает/);
  });

  it("uses the next Valkey database number", () => {
    expect(integrationValkeyUrl("redis://localhost:16379")).toBe("redis://localhost:16379/1");
    expect(integrationValkeyUrl("redis://localhost:16379/3")).toBe("redis://localhost:16379/4");
    expect(integrationValkeyUrl("rediss://user:pw@kv:6380?db=2")).toBe("rediss://user:pw@kv:6380/3");
  });

  it("falls back to the defaults of the Docker stack (as in .env.example)", () => {
    expect(integrationEnv({})).toEqual({ DATABASE_URL: "postgres://teletau:teletau@localhost:15432/teletau_it", VALKEY_URL: "redis://localhost:16379/1" });
  });
});
