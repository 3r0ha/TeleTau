import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

describe("ml-worker", () => {
  it("serves health", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", service: "ml-worker", capabilities: [] });
    await app.close();
  });
});
