// Обрыв соединений Postgres (рестарт, failover, pg_terminate_backend) не должен ронять процесс API.
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { once } from "node:events";
import type { Redis } from "ioredis";
import { createApp } from "../../src/bootstrap.js";
import { PG_POOL, VALKEY } from "../../src/infra/tokens.js";
import { loadConfig } from "../../src/config/config.js";
import { startBlackholeProxy } from "./blackhole-proxy.js";

const base = loadConfig(process.env);
let app: NestFastifyApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function boot(applicationName: string): Promise<NestFastifyApplication> {
  const url = new URL(base.DATABASE_URL);
  url.searchParams.set("application_name", applicationName);
  const created = await createApp({ ...base, DATABASE_URL: url.toString() });
  await created.init();
  await created.getHttpAdapter().getInstance().ready();
  // Клиент Valkey подключается асинхронно; до готовности health честно отвечает 503 (это не предмет теста).
  const valkey = created.get<Redis>(VALKEY);
  if (valkey.status !== "ready") await once(valkey, "ready");
  return created;
}

const health = (a: NestFastifyApplication) =>
  a.getHttpAdapter().getInstance().inject({ method: "GET", url: "/api/v1/health" });

describe("resilience: Postgres terminates connections", () => {
  it("keeps the process alive and recovers health after pg_terminate_backend", async () => {
    const name = `teletau_it_${process.pid}_${Date.now()}`;
    app = await boot(name);
    const before = await health(app);
    expect(before.statusCode, before.body).toBe(200);

    const admin = new pg.Client({ connectionString: base.DATABASE_URL });
    await admin.connect();
    try {
      const { rows } = await admin.query<{ n: number }>(
        "SELECT count(pg_terminate_backend(pid))::int AS n FROM pg_stat_activity WHERE application_name = $1",
        [name],
      );
      expect(rows[0]?.n, "в пуле приложения должно быть простаивающее соединение").toBeGreaterThan(0);
    } finally {
      await admin.end();
    }

    // даём простаивающему клиенту получить FATAL 57P01 и сгенерировать событие error
    await new Promise((r) => setTimeout(r, 300));

    const after = await health(app);
    expect(after.statusCode, after.body).toBe(200);
    expect(after.json()).toMatchObject({ checks: { postgres: "ok", valkey: "ok" } });
  });
});

describe("resilience: silent network partition (black hole, no RST) — M0-R2-02", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function bootThrough(databaseUrl: string, valkeyUrl: string): Promise<NestFastifyApplication> {
    const created = await createApp({ ...base, DATABASE_URL: databaseUrl, VALKEY_URL: valkeyUrl });
    await created.init();
    await created.getHttpAdapter().getInstance().ready();
    const valkey = created.get<Redis>(VALKEY);
    if (valkey.status !== "ready") await once(valkey, "ready");
    return created;
  }

  /** Опрашивает health, пока не получит 200; возвращает время восстановления в мс или -1. */
  async function recoveryMs(a: NestFastifyApplication, limitMs: number): Promise<number> {
    const started = Date.now();
    while (Date.now() - started < limitMs) {
      const results = await Promise.all([health(a), health(a), health(a)]);
      if (results.some((r) => r.statusCode === 200)) return Date.now() - started;
      await sleep(200);
    }
    return -1;
  }

  // Короткий разрыв — базовый сценарий; длинный (30 с) для Valkey: восстановление зависит от фазы цикла
  // «socketTimeout + задержка переподключения», и с задержкой ioredis по умолчанию (до 2 с) выходит до 6,3 с.
  const cases = [
    { target: "postgres", partitionMs: 1500 },
    { target: "valkey", partitionMs: 1500 },
    { target: "valkey", partitionMs: 30_000 },
  ] as const;
  for (const { target, partitionMs } of cases) {
    it(`recovers within 5 s after a ${partitionMs / 1000} s ${target} black hole heals`, async ({ annotate }) => {
      const pgUrl = new URL(base.DATABASE_URL);
      const kvUrl = new URL(base.VALKEY_URL);
      const proxy = await startBlackholeProxy(
        target === "postgres"
          ? { host: pgUrl.hostname, port: Number(pgUrl.port || 5432) }
          : { host: kvUrl.hostname, port: Number(kvUrl.port || 6379) },
      );
      try {
        app = await bootThrough(
          target === "postgres" ? proxy.url(base.DATABASE_URL) : base.DATABASE_URL,
          target === "valkey" ? proxy.url(base.VALKEY_URL) : base.VALKEY_URL,
        );
        // прогрев: несколько параллельных проб, чтобы в пуле были простаивающие соединения
        const warm = await Promise.all(Array.from({ length: 12 }, () => health(app!)));
        expect(warm.every((r) => r.statusCode === 200)).toBe(true);

        proxy.blackhole();
        const during = await Promise.all(Array.from({ length: 6 }, () => health(app!)));
        expect(during.every((r) => r.statusCode === 503)).toBe(true);
        // во время разрыва — лёгкая нагрузка: health отвечает 503 быстро и не зависает
        const partitionEnd = Date.now() + partitionMs;
        let slowest = 0;
        while (Date.now() < partitionEnd) {
          const t0 = Date.now();
          const batch = await Promise.all(Array.from({ length: 3 }, () => health(app!)));
          slowest = Math.max(slowest, Date.now() - t0);
          expect(batch.every((r) => r.statusCode === 503)).toBe(true);
          await sleep(Math.min(1000, Math.max(0, partitionEnd - Date.now())));
        }
        expect(slowest, "health во время разрыва отвечает не дольше HEALTH_TIMEOUT_MS + 0,5 с").toBeLessThanOrEqual(
          base.HEALTH_TIMEOUT_MS + 500,
        );

        proxy.heal();
        const ms = await recoveryMs(app, 5000);
        expect(ms, `health не вернулся к 200 за 5 с после лечения ${target}`).toBeGreaterThanOrEqual(0);
        await annotate(`восстановление: ${ms} мс; самый долгий ответ во время разрыва: ${slowest} мс`);
      } finally {
        await app?.close().catch(() => undefined);
        app = undefined;
        await proxy.close();
      }
    }, partitionMs + 30_000);
  }

  it("an ordinary pool query fails within DB_QUERY_TIMEOUT_MS + 1 s during a partition and works after heal (M0-R3-03)", async () => {
    // health использует собственный короткий query_timeout, поэтому тест выше не проверяет таймаут пула.
    // Здесь — обычные запросы через пул приложения: без query_timeout они висели бы до таймаута TCP в ОС.
    const pgUrl = new URL(base.DATABASE_URL);
    const proxy = await startBlackholeProxy({ host: pgUrl.hostname, port: Number(pgUrl.port || 5432) });
    try {
      app = await bootThrough(proxy.url(base.DATABASE_URL), base.VALKEY_URL);
      const pool = app.get<pg.Pool>(PG_POOL);
      // заполняем пул простаивающими соединениями (max = 10)
      await Promise.all(Array.from({ length: 10 }, () => pool.query("SELECT pg_sleep(0.05)")));
      expect(pool.idleCount).toBeGreaterThan(0);

      proxy.blackhole();
      // Предел — политика (§6.8): DB_QUERY_TIMEOUT_MS + 1 с; не больше 15 с, чтобы мутация «огромный таймаут» краснела явно.
      const limit = Math.min(base.DB_QUERY_TIMEOUT_MS + 1000, 15_000);
      const started = Date.now();
      const outcomes = await Promise.all(
        Array.from({ length: 10 }, () =>
          Promise.race([
            pool.query("SELECT 1").then(
              () => ({ kind: "resolved" as const, ms: Date.now() - started }),
              (err: unknown) => ({ kind: "rejected" as const, ms: Date.now() - started, err: String(err) }),
            ),
            sleep(limit + 500).then(() => ({ kind: "hung" as const, ms: Date.now() - started })),
          ]),
        ),
      );
      for (const o of outcomes) {
        expect(o.kind, `запрос во время разрыва должен завершиться ошибкой за ${limit} мс: ${JSON.stringify(o)}`).toBe("rejected");
        expect(o.ms).toBeLessThanOrEqual(limit);
      }

      proxy.heal();
      const t0 = Date.now();
      await expect(pool.query("SELECT 1 AS ok")).resolves.toMatchObject({ rows: [{ ok: 1 }] });
      expect(Date.now() - t0, "после лечения сети новый запрос проходит сразу").toBeLessThan(2000);
    } finally {
      // Сначала прокси: при регрессии (зависшие запросы) закрытие сокетов освобождает клиентов пула,
      // иначе app.close() ждал бы их бесконечно и тест падал бы по таймауту вместо понятного сообщения.
      await proxy.close();
      await app?.close().catch(() => undefined);
      app = undefined;
    }
  }, 45_000);
});
