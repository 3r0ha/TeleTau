import { describe, expect, it } from "vitest";
import { createThrottledErrorLogger } from "../src/throttle.js";

describe("createThrottledErrorLogger", () => {
  it("logs each (source, error code) at most once per interval", () => {
    const lines: string[] = [];
    let now = 0;
    const log = createThrottledErrorLogger({ write: (m) => lines.push(m), intervalMs: 10_000, now: () => now });
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:16379"), { code: "ECONNREFUSED" });

    for (let i = 0; i < 100; i++) log("valkey", refused);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("valkey");
    expect(lines[0]).toContain("ECONNREFUSED");

    log("postgres", Object.assign(new Error("terminating connection"), { code: "57P01" }));
    expect(lines).toHaveLength(2);

    now = 10_001;
    log("valkey", refused);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toMatch(/подавлено повторов: 99/);
  });

  it("never prints connection strings that may contain credentials", () => {
    const lines: string[] = [];
    const log = createThrottledErrorLogger({ write: (m) => lines.push(m), intervalMs: 1000, now: () => 0 });
    log("postgres", new Error("failed for postgres://teletau:secret@db:5432/teletau"));
    expect(lines[0]).not.toContain("secret");
    expect(lines[0]).toContain("postgres://***@db:5432/teletau");
  });
});
