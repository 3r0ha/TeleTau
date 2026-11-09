// Каждая операция контракта обслуживается маршрутом API, и в API нет маршрутов вне контракта (contract-first).
import "reflect-metadata";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { configureApp, createFastifyAdapter } from "../src/bootstrap.js";
import { contractOperations } from "../src/common/contract.js";
import { loadConfig } from "../src/config/config.js";
import { PG_POOL, VALKEY } from "../src/infra/tokens.js";
import { okKv, okSql } from "./fakes.js";

let app: NestFastifyApplication;
const routes: Array<{ method: string; url: string }> = [];

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(loadConfig({}))] })
    .overrideProvider(PG_POOL)
    .useValue({ ...okSql, end: async () => undefined })
    .overrideProvider(VALKEY)
    .useValue({ ...okKv, quit: async () => "OK" })
    .compile();
  app = configureApp(moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter()));
  app.getHttpAdapter().getInstance().addHook("onRoute", (r) => {
    for (const m of [r.method].flat()) if (m !== "HEAD" && m !== "OPTIONS") routes.push({ method: m, url: r.url });
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
});

describe("routes ⇔ contract operations", () => {
  const ops = contractOperations();
  const toFastify = (p: string) => p.replace(/\{(\w+)\}/g, ":$1");

  it("every operation in openapi.yaml has a handler", () => {
    const have = new Set(routes.map((r) => `${r.method} ${r.url}`));
    const missing = ops.filter((o) => !have.has(`${o.method} ${toFastify(o.path)}`)).map((o) => `${o.id}: ${o.method} ${o.path}`);
    expect(missing).toEqual([]);
  });

  it("there are no routes outside the contract", () => {
    const declared = new Set(ops.map((o) => `${o.method} ${toFastify(o.path)}`));
    expect(routes.filter((r) => !declared.has(`${r.method} ${r.url}`))).toEqual([]);
  });

  it("anonymous calls to closed operations get 401 before any body validation", async () => {
    const res = await app.getHttpAdapter().getInstance().inject({ method: "POST", url: "/api/v1/classes", payload: { nonsense: true } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ status: 401, code: "unauthenticated" });
  });

  it("schema violations on open operations are 422 problem+json with field pointers", async () => {
    const res = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/api/v1/auth/qr",
      payload: { payload: "", extra: 1 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json();
    expect(body.code).toBe("validation_failed");
    expect(body.errors.map((e: { pointer: string }) => e.pointer).sort()).toEqual(["/device", "/extra", "/payload"]);
  });

  it("CORS preflight allows every HTTP method used by the contract (DELETE join-code was blocked in the browser)", async () => {
    const methods = [...new Set(ops.map((o) => o.method.toUpperCase()))];
    expect(methods).toContain("DELETE");
    for (const method of methods) {
      const res = await app.getHttpAdapter().getInstance().inject({
        method: "OPTIONS",
        url: "/api/v1/me",
        headers: { origin: "http://localhost:3000", "access-control-request-method": method },
      });
      expect(String(res.headers["access-control-allow-methods"]).split(",").map((m) => m.trim()), method).toContain(method);
    }
  });

  it("CORS allows only the web and console origins", async () => {
    const inject = (origin: string) =>
      app.getHttpAdapter().getInstance().inject({ method: "OPTIONS", url: "/api/v1/me", headers: { origin, "access-control-request-method": "GET" } });
    expect((await inject("http://localhost:3000")).headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect((await inject("http://localhost:3100")).headers["access-control-allow-origin"]).toBe("http://localhost:3100");
    // Loopback-синонимы (corsOrigins): стенд открыт и как 127.0.0.1 — port сохраняется.
    expect((await inject("http://127.0.0.1:3000")).headers["access-control-allow-origin"]).toBe("http://127.0.0.1:3000");
    expect((await inject("http://127.0.0.1:3100")).headers["access-control-allow-origin"]).toBe("http://127.0.0.1:3100");
    // Чужой origin и другой порт не пускаются.
    expect((await inject("https://evil.example")).headers["access-control-allow-origin"]).toBeUndefined();
    expect((await inject("http://localhost:3055")).headers["access-control-allow-origin"]).toBeUndefined();
  });
});
