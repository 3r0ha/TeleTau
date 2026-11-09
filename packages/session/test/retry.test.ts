// Клиент не теряет Retry-After. Короткий 429 (попытки «в работе») повторяется молча, а если не помог —
// текст «секунду», а не «подожди минуту». Длинный 429 и другие ошибки не повторяются.
import { afterEach, describe, expect, it, vi } from "vitest";
import { session } from "../src/client";
import { ApiProblem, describeProblem, isShortRateLimit, parseRetryAfter, toApiProblem } from "../src/problem";
import { withShortRetry } from "../src/retry";

const problemResponse = (status: number, code: string, retryAfter?: string) =>
  new Response(JSON.stringify({ type: "about:blank", title: "Ошибка", status, code }), {
    status,
    headers: { "content-type": "application/problem+json", ...(retryAfter ? { "retry-after": retryAfter } : {}) },
  });

const sessionResponse = () =>
  new Response(
    JSON.stringify({
      accessToken: "e30.e30.sig",
      accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      account: { id: "0193f7a4-0000-7000-8000-0000000c0007", kind: "child", roles: ["student"], locale: "ru", teacherStatus: "none", classes: [], pendingConsents: [] },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Retry-After → ApiProblem.retryAfter", () => {
  it("секунды и дата HTTP; пусто и мусор — undefined", () => {
    expect(parseRetryAfter("1")).toBe(1);
    expect(parseRetryAfter(" 60 ")).toBe(60);
    expect(parseRetryAfter("0")).toBe(0);
    const now = Date.parse("2026-11-03T09:00:00Z");
    expect(parseRetryAfter("Tue, 03 Nov 2026 09:00:30 GMT", now)).toBe(30);
    expect(parseRetryAfter("Tue, 03 Nov 2026 08:59:00 GMT", now)).toBe(0);
    for (const bad of [null, undefined, "", "1.5", "-1", "скоро", "1e3"]) expect(parseRetryAfter(bad), String(bad)).toBeUndefined();
  });

  it("toApiProblem берёт заголовок из ответа (API открывает его в CORS, BFF передаёт)", () => {
    const e = toApiProblem({ status: 429, code: "rate_limited" }, problemResponse(429, "rate_limited", "1"));
    expect(e).toBeInstanceOf(ApiProblem);
    expect(e.retryAfter).toBe(1);
    expect(toApiProblem({}, problemResponse(500, "internal")).retryAfter).toBeUndefined();
  });

  it("короткий 429 — только rate_limited (или без кода) с Retry-After ≤ 5", () => {
    expect(isShortRateLimit(new ApiProblem(429, { code: "rate_limited" }, { retryAfter: 1 }))).toBe(true);
    expect(isShortRateLimit(new ApiProblem(429, {}, { retryAfter: 5 }))).toBe(true);
    expect(isShortRateLimit(new ApiProblem(429, { code: "rate_limited" }, { retryAfter: 6 }))).toBe(false);
    expect(isShortRateLimit(new ApiProblem(429, { code: "rate_limited" }))).toBe(false);
    expect(isShortRateLimit(new ApiProblem(429, { code: "join_queue_full" }, { retryAfter: 1 }))).toBe(false);
    expect(isShortRateLimit(new ApiProblem(429, { code: "staff_locked" }, { retryAfter: 1 }))).toBe(false);
    expect(isShortRateLimit(new ApiProblem(503, { code: "rate_limited" }, { retryAfter: 1 }))).toBe(false);
  });
});

describe("текст 429 зависит от Retry-After", () => {
  it("коротко — «секунду», детям на «ты», взрослым на «вы»; долго или без заголовка — «подожди минуту»", () => {
    const short = new ApiProblem(429, { code: "rate_limited" }, { retryAfter: 1 });
    expect(describeProblem(short, "child")).toBe("Подожди секунду и попробуй ещё раз.");
    expect(describeProblem(short, "adult")).toBe("Подождите секунду и попробуйте ещё раз.");
    const long = new ApiProblem(429, { code: "rate_limited" }, { retryAfter: 60 });
    expect(describeProblem(long, "child")).toBe("Много попыток. Подожди минуту.");
    expect(describeProblem(long, "adult")).toBe("Слишком много попыток. Подождите минуту.");
    expect(describeProblem(new ApiProblem(429, { code: "rate_limited" }), "child")).toMatch(/Подожди минуту/);
  });

  it("join_queue_full (M1-49) — свой текст для ребёнка, даже с коротким Retry-After", () => {
    const full = new ApiProblem(429, { code: "join_queue_full" }, { retryAfter: 1 });
    expect(describeProblem(full, "child")).toBe("У учителя много заявок. Попробуй чуть позже.");
  });
});

describe("withShortRetry", () => {
  const short = () => new ApiProblem(429, { code: "rate_limited" }, { retryAfter: 1 });

  it("короткий 429 → пауза Retry-After → повтор → успех", async () => {
    const sleeps: number[] = [];
    const run = vi.fn().mockRejectedValueOnce(short()).mockResolvedValueOnce("ok");
    await expect(withShortRetry(run, { sleep: async (ms) => void sleeps.push(ms), jitterMs: 0 })).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([1000]);
  });

  it("не больше двух повторов; дальше — та же ошибка", async () => {
    const run = vi.fn().mockRejectedValue(short());
    await expect(withShortRetry(run, { sleep: async () => undefined })).rejects.toMatchObject({ status: 429, retryAfter: 1 });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("длинный 429, join_queue_full и другие ошибки — без повтора", async () => {
    for (const e of [
      new ApiProblem(429, { code: "rate_limited" }, { retryAfter: 60 }),
      new ApiProblem(429, { code: "join_queue_full" }, { retryAfter: 1 }),
      new ApiProblem(401, { code: "card_invalid" }),
      new TypeError("Failed to fetch"),
    ]) {
      const run = vi.fn().mockRejectedValue(e);
      await expect(withShortRetry(run, { sleep: async () => undefined })).rejects.toBe(e);
      expect(run).toHaveBeenCalledTimes(1);
    }
  });
});

describe("клиент сессии: вход по QR и заявка по коду класса повторяют короткий 429", () => {
  it("429 Retry-After: 1, затем 200 — вход без ошибки", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const calls: string[] = [];
    const replies = [problemResponse(429, "rate_limited", "1"), sessionResponse()];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return replies.shift()!;
    });
    const login = session.loginWithQr("TT1.payload");
    await vi.advanceTimersByTimeAsync(1_500);
    await expect(login).resolves.toMatchObject({ kind: "child" });
    expect(calls).toEqual(["/api/session/qr", "/api/session/qr"]);
  });

  it("429 Retry-After: 60 — сразу ошибка с retryAfter, без повтора", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => (calls++, problemResponse(429, "rate_limited", "60")));
    await expect(session.requestClassCode("K7Q4MZ", "nick:1")).rejects.toMatchObject({ status: 429, retryAfter: 60 });
    expect(calls).toBe(1);
  });
});
