// BFF сессии (/api/session/*): какой IP уходит в API и таймаут вызова API.
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PEER_HEADER, PEER_TOKEN_HEADER, peerSecret } from "../src/client-ip";
import { installPeerAddressStamp } from "../src/peer";
import { createSessionRoute } from "../src/server";

// Секрет процесса появляется при установке отметки (instrumentation.ts → register): так же, как в Next.js.
installPeerAddressStamp();

/** Отметка, которую ставит HTTP-сервер процесса (peer.ts): адрес сокета и секрет процесса. */
const stamped = (address: string) => ({ [PEER_HEADER]: address, [PEER_TOKEN_HEADER]: peerSecret()! });

const ORIGIN = "http://localhost:3000";
const PAYLOAD = "TT1.0123456789.ABCDEFGHJKMNPQRSTVWXYZ0123.6V";

function qrRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest(`${ORIGIN}/api/session/qr`, {
    method: "POST",
    headers: { origin: ORIGIN, host: "localhost:3000", "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    body: JSON.stringify({ payload: PAYLOAD }),
  });
}

/** Подменённый API: запоминает запросы BFF и отвечает «карточка не найдена». */
function fakeApi(respond: (req: Request) => Promise<Response> | Response = () => problem(401, "card_invalid")) {
  const seen: Request[] = [];
  vi.stubGlobal("fetch", async (input: Request, init?: RequestInit) => {
    const req = new Request(input, init);
    seen.push(req);
    return respond(req);
  });
  return seen;
}

const problem = (status: number, code: string) =>
  new Response(JSON.stringify({ type: "about:blank", title: "x", status, code }), { status, headers: { "content-type": "application/problem+json" } });

const call = (route: ReturnType<typeof createSessionRoute>, req: NextRequest, action = "qr") => route.POST(req, { params: Promise.resolve({ action }) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BFF: IP браузера для лимитов частоты API (M1-05)", () => {
  it("X-Forwarded-For, присланный клиентом, не пересылается — в API уходит адрес сокета", async () => {
    const seen = fakeApi();
    const route = createSessionRoute({ cookiePrefix: "t", appVersion: "test", trustProxy: "" });
    const res = await call(route, qrRequest({ ...stamped("203.0.113.7"), "x-forwarded-for": "198.18.0.99" }));
    expect(res.status).toBe(401);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers.get("x-forwarded-for")).toBe("203.0.113.7");
  });

  it("за доверенным балансировщиком — адрес, который добавил он, а не подставленный клиентом левый", async () => {
    const seen = fakeApi();
    const route = createSessionRoute({ cookiePrefix: "t", appVersion: "test", trustProxy: "10.0.0.0/8" });
    await call(route, qrRequest({ ...stamped("10.0.0.5"), "x-forwarded-for": "6.6.6.6, 198.18.0.1" }));
    expect(seen[0]!.headers.get("x-forwarded-for")).toBe("198.18.0.1");
  });

  it("нет адреса сокета (служебный заголовок не проставлен) — IP не передаётся вовсе, а не берётся у клиента", async () => {
    const seen = fakeApi();
    const route = createSessionRoute({ cookiePrefix: "t", appVersion: "test", trustProxy: "loopback" });
    await call(route, qrRequest({ "x-forwarded-for": "198.18.0.99" }));
    expect(seen[0]!.headers.get("x-forwarded-for")).toBeNull();
  });

  // В окне запуска Next.js (между listening и концом prepare()) запросы не проходят через отметку, и служебный
  // заголовок клиента доходит до BFF как есть. Без секрета процесса BFF адресу не верит и IP не передаёт (строгий вариант).
  it("подставленный клиентом адрес сокета без секрета процесса — IP не передаётся", async () => {
    const seen = fakeApi();
    const route = createSessionRoute({ cookiePrefix: "t", appVersion: "test", trustProxy: "" });
    await call(route, qrRequest({ [PEER_HEADER]: "198.18.0.42", "x-forwarded-for": "198.18.0.99" }));
    expect(seen[0]!.headers.get("x-forwarded-for")).toBeNull();
  });

  it("подставленный адрес с неверным секретом (другой длины и той же длины) — IP не передаётся", async () => {
    const seen = fakeApi();
    const route = createSessionRoute({ cookiePrefix: "t", appVersion: "test", trustProxy: "loopback" });
    const secret = peerSecret()!;
    const sameLength = secret.slice(0, -1) + (secret.endsWith("A") ? "B" : "A");
    for (const token of ["guess", sameLength, `${secret}x`, ""]) {
      await call(route, qrRequest({ [PEER_HEADER]: "198.18.0.42", [PEER_TOKEN_HEADER]: token }));
    }
    expect(seen.map((r) => r.headers.get("x-forwarded-for"))).toEqual([null, null, null, null]);
  });

  it("неверный BFF_TRUST_PROXY — 503 без обращения к API", async () => {
    const seen = fakeApi();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const route = createSessionRoute({ cookiePrefix: "t", appVersion: "test", trustProxy: "loopbak" });
    const res = await call(route, qrRequest(stamped("127.0.0.1")));
    expect(res.status).toBe(503);
    expect(seen).toHaveLength(0);
  });
});

describe("BFF: опрос заявки по коду класса", () => {
  it("передаёт X-Device-Install-Id устройства заявки — после потерянного ответа сессия выдаётся снова", async () => {
    const seen = fakeApi(() => new Response(JSON.stringify({ requestId: "r", status: "pending", expiresAt: new Date().toISOString(), pollIntervalSeconds: 3 }), { status: 200, headers: { "content-type": "application/json" } }));
    const route = createSessionRoute({ cookiePrefix: "t", appVersion: "test", trustProxy: "" });
    const installId = "0193f7a4-0000-7000-8000-0000000d0001";
    const req = new NextRequest(`${ORIGIN}/api/session/class-code-status`, {
      method: "POST",
      headers: { origin: ORIGIN, host: "localhost:3000", "sec-fetch-site": "same-origin", "content-type": "application/json", cookie: `t_did=${installId}`, ...stamped("127.0.0.1") },
      body: JSON.stringify({ requestId: "0193f7a4-0000-7000-8000-0000000r0001", pollToken: "poll-token-for-tests-0001" }),
    });
    const res = await call(route, req, "class-code-status");
    expect(res.status).toBe(200);
    expect(seen[0]!.headers.get("x-poll-token")).toBe("poll-token-for-tests-0001");
    expect(seen[0]!.headers.get("x-device-install-id")).toBe(installId);
  });
});

describe("BFF: Retry-After от API доходит до браузера (M1-55)", () => {
  const limited = (code: string, retryAfter: string) => () =>
    new Response(JSON.stringify({ type: "about:blank", title: "Слишком много запросов", status: 429, code }), {
      status: 429,
      headers: { "content-type": "application/problem+json", "retry-after": retryAfter },
    });

  it("вход по QR: 429 Retry-After: 1 — тот же статус, код и заголовок", async () => {
    fakeApi(limited("rate_limited", "1"));
    const route = createSessionRoute({ cookiePrefix: "t", appVersion: "test", trustProxy: "" });
    const res = await call(route, qrRequest(stamped("203.0.113.7")));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("1");
    expect(((await res.json()) as { code: string }).code).toBe("rate_limited");
  });

  it("заявка по коду класса: 429 join_queue_full — с заголовком", async () => {
    fakeApi(limited("join_queue_full", "30"));
    const route = createSessionRoute({ cookiePrefix: "t", appVersion: "test", trustProxy: "" });
    const req = new NextRequest(`${ORIGIN}/api/session/class-code`, {
      method: "POST",
      headers: { origin: ORIGIN, host: "localhost:3000", "sec-fetch-site": "same-origin", "content-type": "application/json", ...stamped("127.0.0.1") },
      body: JSON.stringify({ code: "K7Q4MZ", nicknameId: "nick:1" }),
    });
    const res = await call(route, req, "class-code");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(((await res.json()) as { code: string }).code).toBe("join_queue_full");
  });
});

describe("BFF: таймаут вызова API (M1-24)", () => {
  it("API не ответил вовремя — 503 api_unavailable, а не зависший запрос", async () => {
    fakeApi(
      (req) =>
        new Promise<Response>((_resolve, reject) => {
          req.signal.addEventListener("abort", () => reject(req.signal.reason));
        }),
    );
    const route = createSessionRoute({ cookiePrefix: "t", appVersion: "test", trustProxy: "", apiTimeoutMs: 600 });
    const started = Date.now();
    const res = await call(route, qrRequest(stamped("203.0.113.7")));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("api_unavailable");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("запрос с другого сайта отклоняется до обращения к API", async () => {
    const seen = fakeApi();
    const route = createSessionRoute({ cookiePrefix: "t", appVersion: "test", trustProxy: "" });
    const res = await call(route, qrRequest({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect(seen).toHaveLength(0);
  });
});

describe("BFF: «Учусь сам» и личная карточка (ADR 0022)", () => {
  const post = (action: string, body: unknown) =>
    new NextRequest(`${ORIGIN}/api/session/${action}`, {
      method: "POST",
      headers: { origin: ORIGIN, host: "localhost:3000", "sec-fetch-site": "same-origin", "content-type": "application/json", ...stamped("203.0.113.7") },
      body: JSON.stringify(body),
    });

  it("self: в API уходят только ник, диапазон, цель и устройство из cookie — лишние поля браузера отбрасываются", async () => {
    const seen = fakeApi(() => problem(429, "rate_limited"));
    const route = createSessionRoute({ cookiePrefix: "t", appVersion: "test", trustProxy: "" });
    const res = await call(route, post("self", { nicknameId: "a00.n00", ageBand: "age_7_10", dailyGoal: 2, email: "kid@example.org" }), "self");
    expect(res.status).toBe(429);
    expect(new URL(seen[0]!.url).pathname).toBe("/api/v1/auth/self");
    const sent = (await seen[0]!.json()) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["ageBand", "dailyGoal", "device", "nicknameId"]);
    expect(sent).toMatchObject({ nicknameId: "a00.n00", ageBand: "age_7_10", dailyGoal: 2, device: { platform: "web", appVersion: "test" } });
  });

  it("self без ника или диапазона — 422 без обращения к API", async () => {
    const seen = fakeApi();
    const route = createSessionRoute({ cookiePrefix: "t", appVersion: "test", trustProxy: "" });
    expect((await call(route, post("self", { ageBand: "adult" }), "self")).status).toBe(422);
    expect(seen).toHaveLength(0);
  });

  it("card: личная карточка уходит в /auth/login-card только в теле запроса", async () => {
    const seen = fakeApi();
    const route = createSessionRoute({ cookiePrefix: "t", appVersion: "test", trustProxy: "" });
    const payload = "TP1.0123456789.ABCDEFGHJKMNPQRSTVWXYZ0123.4S";
    expect((await call(route, post("card", { payload }), "card")).status).toBe(401);
    expect(new URL(seen[0]!.url).pathname).toBe("/api/v1/auth/login-card");
    expect(seen[0]!.url).not.toContain("TP1");
    expect(((await seen[0]!.json()) as { payload: string }).payload).toBe(payload);
  });
});

describe("BFF: вход в Mini App по initData привязки (ADR 0020)", () => {
  const post = (body: unknown) =>
    new NextRequest(`${ORIGIN}/api/session/telegram`, {
      method: "POST",
      headers: { origin: ORIGIN, host: "localhost:3000", "sec-fetch-site": "same-origin", "content-type": "application/json", ...stamped("203.0.113.7") },
      body: JSON.stringify(body),
    });
  const session = {
    accessToken: "a",
    accessTokenExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    refreshToken: "r",
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    account: { id: "x", kind: "child" },
  };
  const initData = "user=%7B%22id%22%3A279058397%7D&auth_date=1793800000&hash=abc";

  it("telegram: initData уходит только в теле запроса к /auth/telegram, ответ — сессия с cookie", async () => {
    const seen = fakeApi(() => new Response(JSON.stringify(session), { status: 200, headers: { "content-type": "application/json" } }));
    const route = createSessionRoute({ cookiePrefix: "t", appVersion: "test", trustProxy: "" });
    const res = await call(route, post({ initData }), "telegram");
    expect(res.status).toBe(200);
    expect(new URL(seen[0]!.url).pathname).toBe("/api/v1/auth/telegram");
    expect(seen[0]!.url).not.toContain("initData");
    expect(((await seen[0]!.json()) as { initData: string }).initData).toBe(initData);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("t_rt="))).toBe(true);
  });

  it("telegram: 404 chat_not_linked от API проходит как есть — миниапп покажет вход по карточке", async () => {
    fakeApi(() => problem(404, "chat_not_linked"));
    const route = createSessionRoute({ cookiePrefix: "t", appVersion: "test", trustProxy: "" });
    const res = await call(route, post({ initData }), "telegram");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("chat_not_linked");
  });

  it("telegram: пустая, не строка и длиннее 4096 знаков initData — 422 без обращения к API", async () => {
    const seen = fakeApi();
    const route = createSessionRoute({ cookiePrefix: "t", appVersion: "test", trustProxy: "" });
    for (const body of [{}, { initData: "" }, { initData: 42 }, { initData: "x".repeat(4097) }]) {
      expect((await call(route, post(body), "telegram")).status).toBe(422);
    }
    expect(seen).toHaveLength(0);
  });
});

describe("BFF: флаг Secure у cookie сессии в dev", () => {
  const session = {
    accessToken: "a",
    accessTokenExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    refreshToken: "r",
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    account: { id: "x", kind: "child" },
  };
  // url — как его видит Next dev (там всегда localhost), host и origin — адрес, который открыл браузер.
  const login = async (origin: string, host: string, url = ORIGIN) => {
    fakeApi(() => new Response(JSON.stringify(session), { status: 200, headers: { "content-type": "application/json" } }));
    const route = createSessionRoute({ cookiePrefix: "t", appVersion: "test", trustProxy: "" });
    const req = new NextRequest(`${url}/api/session/qr`, {
      method: "POST",
      headers: { origin, host, "sec-fetch-site": "same-origin", "content-type": "application/json", ...stamped("203.0.113.7") },
      body: JSON.stringify({ payload: PAYLOAD }),
    });
    const res = await call(route, req);
    expect(res.status).toBe(200);
    return res.headers.getSetCookie().find((c) => c.startsWith("t_rt="))!;
  };

  it("localhost — с Secure (браузер считает его защищённым)", async () => {
    expect(await login(ORIGIN, "localhost:3000")).toMatch(/;\s*Secure/i);
  });

  it("адрес в локальной сети по http — без Secure, иначе браузер отбросит cookie и перезагрузка разлогинит", async () => {
    expect(await login("http://192.168.1.232:3000", "192.168.1.232:3000")).not.toMatch(/;\s*Secure/i);
  });
});
