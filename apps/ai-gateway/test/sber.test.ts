// Провайдер GigaChat (API Сбера) на подменённом fetch: срок токена, общий in-flight токен, повтор на 401 и общий
// дедлайн вызова. Сеть не используется.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { SberProvider, type FetchFn } from "../src/providers/sber.js";

const AUTH_URL = "https://auth.test/oauth";
const BASE_URL = "https://chat.test/v1";
const request = { promptId: "explain_error@v1", system: "s", user: "u" };

interface Script {
  /** Ответ OAuth: срок токена (мс) и задержка. */
  token?: (n: number) => { value: string; expiresAt: number; delayMs?: number; status?: number };
  /** Ответ модели по номеру вызова и токену. */
  chat?: (n: number, token: string) => { status: number; delayMs?: number };
}

function fakeFetch(script: Script) {
  const calls = { auth: 0, chat: 0, tokens: [] as string[] };
  const wait = (ms: number, signal?: AbortSignal | null) =>
    new Promise<void>((resolve, reject) => {
      if (!ms) return resolve();
      const t = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(signal.reason as Error);
      });
    });
  const fetch = (async (url: string, init: { signal?: AbortSignal | null; headers: Record<string, string> }) => {
    if (url === AUTH_URL) {
      const n = calls.auth++;
      const t = script.token?.(n) ?? { value: `tok${n}`, expiresAt: Date.now() + 30 * 60_000 };
      await wait(t.delayMs ?? 0, init.signal);
      if (t.status && t.status !== 200) return new Response("{}", { status: t.status });
      return new Response(JSON.stringify({ access_token: t.value, expires_at: t.expiresAt }), { status: 200 });
    }
    const n = calls.chat++;
    const token = init.headers.Authorization!.replace("Bearer ", "");
    calls.tokens.push(token);
    const c = script.chat?.(n, token) ?? { status: 200 };
    await wait(c.delayMs ?? 0, init.signal);
    if (c.status !== 200) return new Response('{"message":"echo of prompt"}', { status: c.status });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"explanation":"ok"}' } }], usage: { prompt_tokens: 3, completion_tokens: 4 } }), { status: 200 });
  }) as unknown as FetchFn;
  return { fetch, calls };
}

const config = (timeoutMs = 10_000) =>
  loadConfig({ GIGACHAT_AUTH_KEY: "key", GIGACHAT_AUTH_URL: AUTH_URL, GIGACHAT_BASE_URL: BASE_URL, GIGACHAT_TIMEOUT_MS: String(timeoutMs) });

describe("GigaChat (API Сбера): токен и повторы", () => {
  it("expires_at — миллисекунды: токен живёт до срока минус запас, потом перевыпрашивается", async () => {
    let now = Date.parse("2026-11-15T10:00:00Z");
    const { fetch, calls } = fakeFetch({ token: (n) => ({ value: `tok${n}`, expiresAt: now + 30 * 60_000 }) });
    const provider = new SberProvider(config(), { fetch, now: () => now });
    await provider.complete(request);
    await provider.complete(request);
    expect(calls.auth).toBe(1);
    now += 26 * 60_000; // до срока меньше 5 минут
    await provider.complete(request);
    expect(calls.auth).toBe(2);
    expect(calls.tokens).toEqual(["tok0", "tok0", "tok1"]);
  });

  it("параллельные запросы ждут одно получение токена", async () => {
    const { fetch, calls } = fakeFetch({ token: (n) => ({ value: `tok${n}`, expiresAt: Date.now() + 30 * 60_000, delayMs: 50 }) });
    const provider = new SberProvider(config(), { fetch });
    await Promise.all([provider.complete(request), provider.complete(request), provider.complete(request)]);
    expect(calls.auth).toBe(1);
    expect(calls.chat).toBe(3);
  });

  it("401 модели — один повтор со свежим токеном", async () => {
    const { fetch, calls } = fakeFetch({ chat: (_, token) => ({ status: token === "tok0" ? 401 : 200 }) });
    const provider = new SberProvider(config(), { fetch });
    const res = await provider.complete(request);
    expect(res.text).toBe('{"explanation":"ok"}');
    expect(res.usage).toEqual({ inputTokens: 3, outputTokens: 4 });
    expect(calls.auth).toBe(2);
    expect(calls.tokens).toEqual(["tok0", "tok1"]);
  });

  it("повторный 401 — ошибка без бесконечных повторов; в сообщении нет тела ответа", async () => {
    const { fetch, calls } = fakeFetch({ chat: () => ({ status: 401 }) });
    const provider = new SberProvider(config(), { fetch });
    await expect(provider.complete(request)).rejects.toThrow(/^GigaChat: HTTP 401$/);
    expect(calls.chat).toBe(2);
  });

  it("отказ OAuth — ошибка провайдера со статусом", async () => {
    const { fetch } = fakeFetch({ token: () => ({ value: "", expiresAt: 0, status: 400 }) });
    const provider = new SberProvider(config(), { fetch });
    await expect(provider.complete(request)).rejects.toThrow(/OAuth: HTTP 400/);
  });

  it("один дедлайн на весь вызов: токен и запрос вместе дольше GIGACHAT_TIMEOUT_MS — отказ вовремя", async () => {
    const { fetch } = fakeFetch({
      token: (n) => ({ value: `tok${n}`, expiresAt: Date.now() + 30 * 60_000, delayMs: 700 }),
      chat: () => ({ status: 200, delayMs: 700 }),
    });
    const provider = new SberProvider(config(1000), { fetch });
    const started = Date.now();
    await expect(provider.complete(request)).rejects.toThrow();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(1300);
  });
});
