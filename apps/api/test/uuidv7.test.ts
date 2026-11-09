import { describe, expect, it } from "vitest";
import { uuidv7 } from "../src/common/uuidv7.js";

describe("uuidv7", () => {
  it("has version 7, RFC 9562 variant and the timestamp in the first 48 bits", () => {
    const now = Date.UTC(2026, 10, 3, 12, 0, 0, 123);
    const id = uuidv7(now);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(id.replace(/-/g, "").slice(0, 12), 16)).toBe(now);
  });

  it("sorts by creation time across milliseconds", () => {
    const ids = [0, 1, 2, 1000, 1_000_000].map((d) => uuidv7(1_790_000_000_000 + d));
    expect([...ids].sort()).toEqual(ids);
  });

  it("is unique within the same millisecond", () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => uuidv7(1_790_000_000_000)));
    expect(ids.size).toBe(10_000);
  });
});
