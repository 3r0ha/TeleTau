import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/config.js";
import { VALKEY_MAX_RECONNECT_DELAY_MS, pgPoolConfig, valkeyOptions } from "../src/infra/clients.js";

describe("infra clients — timeouts policy (M0-R2-02)", () => {
  const config = loadConfig({});

  it("Postgres pool has client and server query timeouts and TCP keep-alive", () => {
    const c = pgPoolConfig(config);
    expect(c.query_timeout).toBe(config.DB_QUERY_TIMEOUT_MS);
    expect(c.statement_timeout).toBe(config.DB_STATEMENT_TIMEOUT_MS);
    expect(c.keepAlive).toBe(true);
    expect(c.connectionTimeoutMillis).toBeGreaterThan(0);
  });

  it("Valkey client has command and socket timeouts", () => {
    const o = valkeyOptions(config);
    expect(o.commandTimeout).toBe(config.VALKEY_COMMAND_TIMEOUT_MS);
    expect(o.socketTimeout).toBe(config.VALKEY_SOCKET_TIMEOUT_MS);
    expect(o.connectTimeout).toBeGreaterThan(0);
  });

  it("Valkey client uses the shared VALKEY_URL parser (IPv6, db) — M0-R2-05", () => {
    const o = valkeyOptions(loadConfig({ VALKEY_URL: "redis://[::1]:16379?db=4" }));
    expect(o).toMatchObject({ host: "::1", port: 16379, db: 4, family: 6 });
  });

  it("Valkey reconnect delay is capped at 1 s, so recovery after a long partition fits 5 s (M0-R3-05)", () => {
    const retry = valkeyOptions(config).retryStrategy;
    expect(retry).toBeTypeOf("function");
    const delays = [1, 2, 5, 10, 50, 1000].map((n) => retry!(n));
    expect(delays).toEqual([100, 200, 500, 1000, 1000, 1000]);
    // худший случай после лечения сети: socketTimeout + потолок задержки + рукопожатие — с запасом меньше 5 с
    expect(config.VALKEY_SOCKET_TIMEOUT_MS + VALKEY_MAX_RECONNECT_DELAY_MS).toBeLessThanOrEqual(4000);
  });
});
