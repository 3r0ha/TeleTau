import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/config.js";

describe("loadConfig", () => {
  it("applies defaults for local development", () => {
    const c = loadConfig({});
    expect(c.API_PORT).toBe(4000);
    expect(c.DATABASE_URL).toContain("15432");
  });

  it("coerces numeric ports from env strings", () => {
    expect(loadConfig({ API_PORT: "4555" }).API_PORT).toBe(4555);
  });

  it("fails fast with a readable message on invalid env", () => {
    expect(() => loadConfig({ API_PORT: "not-a-port" })).toThrow(/API_PORT/);
    expect(() => loadConfig({ DATABASE_URL: "nope" })).toThrow(/DATABASE_URL/);
  });
});

describe("timeouts policy (M0-R2-02)", () => {
  it("has finite defaults for every external call", () => {
    const c = loadConfig({});
    expect(c.DB_QUERY_TIMEOUT_MS).toBeGreaterThan(0);
    expect(c.DB_STATEMENT_TIMEOUT_MS).toBeLessThan(c.DB_QUERY_TIMEOUT_MS);
    expect(c.VALKEY_COMMAND_TIMEOUT_MS).toBeGreaterThan(0);
    expect(c.VALKEY_SOCKET_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("rejects a server statement timeout that is not below the client query timeout", () => {
    expect(() => loadConfig({ DB_QUERY_TIMEOUT_MS: "3000", DB_STATEMENT_TIMEOUT_MS: "3000" })).toThrow(/DB_STATEMENT_TIMEOUT_MS/);
  });
});
