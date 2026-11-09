import { describe, expect, it } from "vitest";
import { parseValkeyUrl } from "../src/valkey.js";

describe("parseValkeyUrl", () => {
  it("keeps username, password, db and enables TLS for rediss://", () => {
    expect(parseValkeyUrl("rediss://default:s3cret@valkey.prod.internal:6380/2")).toEqual({
      host: "valkey.prod.internal",
      port: 6380,
      username: "default",
      password: "s3cret",
      db: 2,
      tls: {},
    });
  });

  it("parses a plain local URL without credentials", () => {
    expect(parseValkeyUrl("redis://localhost:16379")).toEqual({ host: "localhost", port: 16379, db: 0 });
  });

  it("uses the default port and decodes percent-encoded credentials", () => {
    expect(parseValkeyUrl("redis://:p%40ss%2Fw0rd@cache.local/5")).toEqual({
      host: "cache.local",
      port: 6379,
      password: "p@ss/w0rd",
      db: 5,
    });
  });

  it("rejects unsupported schemes and invalid db numbers", () => {
    expect(() => parseValkeyUrl("http://localhost:6379")).toThrow(/redis:\/\/, rediss:\/\//);
    expect(() => parseValkeyUrl("redis://localhost:6379/abc")).toThrow(/номер базы/);
  });
});

describe("parseValkeyUrl — один разборщик для всех приложений (M0-R2-05)", () => {
  it("strips brackets from IPv6 literals", () => {
    expect(parseValkeyUrl("redis://[::1]:16379")).toEqual({ host: "::1", port: 16379, db: 0, family: 6 });
    expect(parseValkeyUrl("rediss://u:p@[2001:db8::7]/3")).toMatchObject({ host: "2001:db8::7", port: 6379, db: 3, tls: {} });
  });

  it("reads db from the ?db= query parameter", () => {
    expect(parseValkeyUrl("redis://h:6379?db=3")).toMatchObject({ db: 3 });
    expect(parseValkeyUrl("redis://h:6379/3?db=3")).toMatchObject({ db: 3 });
  });

  it("rejects a conflicting db in path and query", () => {
    expect(() => parseValkeyUrl("redis://h:6379/2?db=3")).toThrow(/номер базы/);
  });

  it("accepts valkey:// and valkeys:// (TLS) schemes", () => {
    expect(parseValkeyUrl("valkey://h:7000")).toEqual({ host: "h", port: 7000, db: 0 });
    expect(parseValkeyUrl("valkeys://h")).toEqual({ host: "h", port: 6379, db: 0, tls: {} });
  });

  it("honours ?family=4|6 and rejects other values", () => {
    expect(parseValkeyUrl("redis://h?family=6")).toMatchObject({ family: 6 });
    expect(() => parseValkeyUrl("redis://h?family=5")).toThrow(/family/);
  });

  it("rejects unknown query parameters instead of silently ignoring them", () => {
    expect(() => parseValkeyUrl("redis://h?tls=true")).toThrow(/неизвестный параметр/);
  });
});
