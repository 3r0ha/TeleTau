// Интеграционные тесты против docker-compose (pnpm dev или docker compose up -d --wait).
import pg from "pg";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/config.js";
import { HealthService } from "../../src/modules/health/health.service.js";

const config = loadConfig(process.env);
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
const valkey = new Redis(config.VALKEY_URL, { maxRetriesPerRequest: 1 });

afterAll(async () => {
  await pool.end();
  await valkey.quit();
});

describe("local infrastructure", () => {
  it("health is ok against real Postgres and Valkey", async () => {
    const reasons: string[] = [];
    const h = await new HealthService(pool, valkey, config, (source, err) => reasons.push(`${source}: ${String(err)}`)).check();
    expect(h.checks, reasons.join("; ")).toEqual({ postgres: "ok", valkey: "ok" });
  });

  it("runs against the dedicated integration database and Valkey db, not the dev ones from .env (M1-50)", async () => {
    const { rows } = await pool.query<{ db: string }>("SELECT current_database() AS db");
    expect(rows[0]!.db).toMatch(/_it$/);
    expect(valkey.options.db).toBeGreaterThan(0);
  });

  it("migration 0000_init installed vector and pg_trgm extensions", async () => {
    const { rows } = await pool.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname IN ('vector','pg_trgm') ORDER BY extname",
    );
    expect(rows.map((r) => r.extname)).toEqual(["pg_trgm", "vector"]);
  });

  it("pii schema exists", async () => {
    const { rowCount } = await pool.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = 'pii'");
    expect(rowCount).toBe(1);
  });

  it("ba_tailored collation sorts Ә after Э (Bashkir alphabet), unlike the root collation", async () => {
    const letters = ["ю", "ә", "а", "э", "б"];
    const sql = (collation: string) =>
      `SELECT x FROM unnest($1::text[]) AS x ORDER BY x COLLATE "${collation}"`;
    const tailored = await pool.query<{ x: string }>(sql("ba_tailored"), [letters]);
    expect(tailored.rows.map((r) => r.x)).toEqual(["а", "б", "э", "ә", "ю"]);
    const root = await pool.query<{ x: string }>(sql("und-x-icu"), [letters]);
    expect(root.rows.map((r) => r.x)).toEqual(["а", "ә", "б", "э", "ю"]);
  });
});
