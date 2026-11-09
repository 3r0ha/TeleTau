import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { MockProvider } from "../src/providers/mock.js";
import { selectProvider } from "../src/providers/select.js";
import { buildServer } from "../src/server.js";

describe("ai-gateway", () => {
  it("serves health with the active provider name", async () => {
    const app = buildServer(new MockProvider());
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", service: "ai-gateway", version: "0.1.0", provider: "mock" });
    await app.close();
  });

  it("uses the mock provider without a GigaChat key", () => {
    const sel = selectProvider(loadConfig({}));
    expect(sel.provider.name).toBe("mock");
    expect(sel.warning).toBeUndefined();
  });

  it("warns that GigaChat is not wired yet when a key is present (until M5)", () => {
    const sel = selectProvider(loadConfig({ GIGACHAT_AUTH_KEY: "test-key" }));
    expect(sel.provider.name).toBe("mock");
    expect(sel.warning).toMatch(/M5/);
  });

  it("mock provider is deterministic and reports usage", async () => {
    const p = new MockProvider();
    const req = { promptId: "explain_error@v1", system: "s", user: "ҡыҙыҡ" };
    const [a, b] = [await p.complete(req), await p.complete(req)];
    expect(a).toEqual(b);
    expect(a.usage.inputTokens).toBeGreaterThan(0);
  });
});
