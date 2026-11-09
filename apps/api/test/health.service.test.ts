import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/config.js";
import { HealthService } from "../src/modules/health/health.service.js";
import { failingKv, failingSql, hangingSql, okKv, okSql } from "./fakes.js";

const config = loadConfig({ HEALTH_TIMEOUT_MS: "50" });
const noReport = () => undefined;

describe("HealthService", () => {
  it("reports ok when all dependencies respond", async () => {
    const h = await new HealthService(okSql, okKv, config, noReport).check();
    expect(h).toEqual({ status: "ok", service: "api", version: "0.1.0", checks: { postgres: "ok", valkey: "ok" } });
  });

  it("reports down and names the failed dependency", async () => {
    const h = await new HealthService(failingSql, okKv, config, noReport).check();
    expect(h.status).toBe("down");
    expect(h.checks).toEqual({ postgres: "down", valkey: "ok" });
  });

  it("treats a hanging dependency as down after the timeout", async () => {
    const started = Date.now();
    const h = await new HealthService(hangingSql, failingKv, config, noReport).check();
    expect(h.checks).toEqual({ postgres: "down", valkey: "down" });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("reports the reason of a failed probe to the infra logger (M0-R3-03)", async () => {
    const reported: Array<[string, string]> = [];
    const report = (source: string, err: unknown) => reported.push([source, err instanceof Error ? err.message : String(err)]);
    await new HealthService(failingSql, okKv, config, report).check();
    await new HealthService(okSql, failingKv, config, report).check();
    await new HealthService(hangingSql, okKv, config, report).check();
    expect(reported).toEqual([
      ["health/postgres", "connection refused"],
      ["health/valkey", "connection refused"],
      ["health/postgres", "timeout after 50 ms"],
    ]);
  });

  it("does not report anything when all dependencies respond", async () => {
    const reported: string[] = [];
    await new HealthService(okSql, okKv, config, (s) => reported.push(s)).check();
    expect(reported).toEqual([]);
  });
});
