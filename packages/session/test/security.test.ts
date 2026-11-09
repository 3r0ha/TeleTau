// CSP с nonce и заголовки безопасности. Встраивать можно только Telegram Mini App (/miniapp/*) и только
// в Telegram Web; остальные страницы веба и вся консоль — frame-ancestors 'none' и X-Frame-Options: DENY.
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { TELEGRAM_WEB_ORIGIN, contentSecurityPolicy, createNonce, createSecurityProxy, frameAncestorsFor, securityHeaders } from "../src/security";

describe("CSP", () => {
  it("production: nonce и strict-dynamic для скриптов, без unsafe-inline и unsafe-eval; запрет встраивания", () => {
    const csp = contentSecurityPolicy({ nonce: "abc", apiOrigin: "https://api.teletau.example", dev: false, https: true });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).toContain("style-src 'self' 'nonce-abc'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self' https://api.teletau.example");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("звук — только свой и записи носителей с Wikimedia Commons («Послушать», M2b)", () => {
    const csp = contentSecurityPolicy({ nonce: "n", apiOrigin: "https://api.teletau.example", dev: false, https: true });
    // Озвучка — со своего сайта (public/audio): чужих источников звука нет.
    expect(csp).toContain("media-src 'self';");
    expect(csp).not.toContain("wikimedia");
    expect(csp).toContain("img-src 'self' blob: data:;");
  });

  it("по http не просит поднимать ссылки до https (локальный next start, e2e)", () => {
    expect(contentSecurityPolicy({ nonce: "n", apiOrigin: "http://localhost:4000", dev: false, https: false })).not.toContain("upgrade-insecure-requests");
  });

  it("nonce — новый на каждый запрос, 128 бит", () => {
    const a = createNonce();
    expect(atob(a)).toHaveLength(16);
    expect(createNonce()).not.toBe(a);
  });

  it("камера — только вебу; HSTS — только в production", () => {
    expect(securityHeaders({ csp: "x", camera: true, production: true })["permissions-policy"]).toMatch(/^camera=\(self\)/);
    expect(securityHeaders({ csp: "x", camera: false, production: true })["permissions-policy"]).toMatch(/^camera=\(\)/);
    expect(securityHeaders({ csp: "x", camera: false, production: true })["strict-transport-security"]).toMatch(/max-age=\d+/);
    expect(securityHeaders({ csp: "x", camera: false, production: false })["strict-transport-security"]).toBeUndefined();
  });

  it("proxy кладёт CSP в запрос (для Next.js) и в ответ, nonce совпадает", () => {
    const proxy = createSecurityProxy({ camera: true, apiOrigin: "http://localhost:4000/" });
    const res = proxy(new NextRequest("http://localhost:3000/student"));
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).toContain("connect-src 'self' http://localhost:4000");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    // Заголовки запроса, переданные дальше в приложение (NextResponse.next({ request })).
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(/'nonce-([^']+)'/.exec(csp)![1]);
  });
});

describe("Telegram Mini App: frame-ancestors только для /miniapp/*", () => {
  const web = createSecurityProxy({ camera: true, apiOrigin: "http://localhost:4000", miniApp: { prefix: "/miniapp" } });
  const console = createSecurityProxy({ camera: false, apiOrigin: "http://localhost:4000" });
  const headers = (proxy: typeof web, path: string) => {
    const res = proxy(new NextRequest(`http://localhost:3000${path}`));
    return { csp: res.headers.get("content-security-policy")!, xfo: res.headers.get("x-frame-options") };
  };

  it.each(["/miniapp", "/miniapp/", "/miniapp/learn", "/miniapp/student/code", "/miniapp/learn?x=1"])("%s — встраивает только Telegram Web, без X-Frame-Options", (path) => {
    const { csp, xfo } = headers(web, path);
    expect(csp.split("; ")).toContain(`frame-ancestors ${TELEGRAM_WEB_ORIGIN}`);
    expect(csp).not.toContain("frame-ancestors 'none'");
    expect(xfo).toBeNull();
  });

  it.each(["/", "/learn", "/student", "/teacher", "/teacher/duels", "/api/session/refresh", "/miniapp-evil", "/miniappx/learn", "/x/miniapp", "/miniapp/%2e%2e/teacher", "/miniapp/../teacher"])(
    "%s — встраивать нельзя никому",
    (path) => {
      const { csp, xfo } = headers(web, path);
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain("web.telegram.org");
      expect(xfo).toBe("DENY");
    },
  );

  it("консоль (без miniApp) — 'none' даже на /miniapp", () => {
    const { csp, xfo } = headers(console, "/miniapp/learn");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(xfo).toBe("DENY");
  });

  it("frameAncestorsFor: префикс со слешем в конце, пустой префикс", () => {
    expect(frameAncestorsFor("/miniapp/me", { prefix: "/miniapp/" })).toEqual([TELEGRAM_WEB_ORIGIN]);
    expect(frameAncestorsFor("/miniapp", { prefix: "" })).toEqual([]);
    expect(frameAncestorsFor("/miniapp", undefined)).toEqual([]);
  });

  it("остальные директивы на /miniapp — те же строгие: nonce, без unsafe-inline, connect-src на API", () => {
    const { csp } = headers(web, "/miniapp/learn");
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).toContain("connect-src 'self' http://localhost:4000");
    expect(securityHeaders({ csp, camera: true, production: true, embeddable: true })["x-frame-options"]).toBeUndefined();
  });
});
