import "reflect-metadata";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { Health } from "@teletau/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { configureApp, createFastifyAdapter } from "../src/bootstrap.js";
import { loadConfig } from "../src/config/config.js";
import { PG_POOL, VALKEY, type KvPinger, type SqlPinger } from "../src/infra/tokens.js";
import { failingSql, okKv, okSql } from "./fakes.js";

let app: NestFastifyApplication | undefined;

async function boot(sql: SqlPinger, kv: KvPinger): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(loadConfig({ HEALTH_TIMEOUT_MS: "50" }))],
  })
    .overrideProvider(PG_POOL)
    .useValue({ ...sql, end: async () => undefined })
    .overrideProvider(VALKEY)
    .useValue({ ...kv, quit: async () => "OK" })
    .compile();
  const created = configureApp(moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter()));
  await created.init();
  await created.getHttpAdapter().getInstance().ready();
  return created;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /api/v1/health (contract: getHealth)", () => {
  it("returns 200 and a Health body when dependencies are up", async () => {
    app = await boot(okSql, okKv);
    const res = await app.getHttpAdapter().getInstance().inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const body = res.json() as Health;
    expect(body).toEqual({ status: "ok", service: "api", version: "0.1.0", checks: { postgres: "ok", valkey: "ok" } });
  });

  it("returns 503 with the same schema when Postgres is down", async () => {
    app = await boot(failingSql, okKv);
    const res = await app.getHttpAdapter().getInstance().inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(503);
    expect((res.json() as Health).checks.postgres).toBe("down");
  });

  it("returns RFC 9457 problem+json for unknown routes, with a Russian title and no Nest text (M1-41)", async () => {
    app = await boot(okSql, okKv);
    const res = await app.getHttpAdapter().getInstance().inject({ method: "GET", url: "/api/v1/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toEqual({ type: "about:blank", title: "Не найдено", status: 404, code: "not_found", instance: "/api/v1/nope" });
  });

  it("returns RFC 9457 problem+json for framework-level errors (malformed URL, M0-08) without Fastify's text (M1-41)", async () => {
    app = await boot(okSql, okKv);
    const res = await app.getHttpAdapter().getInstance().inject({ method: "GET", url: "/api/v1/%E0%A4%A" });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toEqual({ type: "about:blank", title: "Запрос не разобран", status: 400, code: "bad_request", detail: "Адрес запроса не разобран", instance: "/api/v1/%E0%A4%A" });
  });

  it("an oversized body is 413 payload_too_large with a Russian title (M1-41)", async () => {
    app = await boot(okSql, okKv);
    const res = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "POST", url: "/api/v1/auth/otp/request", headers: { "content-type": "application/json" }, payload: JSON.stringify({ email: "x".repeat(70_000) }) });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ status: 413, code: "payload_too_large", title: "Слишком большой запрос" });
  });
});
