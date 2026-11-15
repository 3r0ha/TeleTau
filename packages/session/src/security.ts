// Заголовки безопасности веба и консоли (docs/08 §5): CSP с nonce на каждый запрос, запрет встраивания,
// Permissions-Policy, Referrer-Policy, nosniff и HSTS в production. Подключается из proxy.ts приложения (Next 16).
// Nonce Next.js сам проставляет своим скриптам и стилям, прочитав CSP из заголовка запроса, — поэтому все страницы
// рендерятся динамически (корневой layout вызывает connection()). Inline-скриптов и стилей без nonce в приложениях нет,
// атрибутов style — тоже: `unsafe-inline` не нужен ни для скриптов, ни для стилей.
// Встраивание во фрейм запрещено всем страницам (frame-ancestors 'none' + X-Frame-Options: DENY), кроме Telegram Mini App
// веба: страницы под префиксом miniApp.prefix (/miniapp и /miniapp/*) может встраивать только Telegram Web
// (https://web.telegram.org) — так он открывает Mini App на компьютере. В мобильных клиентах
// Telegram Mini App открывается во встроенном браузере верхним окном, фрейма там нет.
import { NextResponse, type NextRequest } from "next/server";
import { TELEGRAM_WEB_ORIGIN } from "./telegram";

export { TELEGRAM_WEB_ORIGIN };

export interface SecurityOptions {
  /** Доступ к камере (сканер QR-карточки в вебе). В консоли камера запрещена. */
  camera: boolean;
  /** Origin API (connect-src): браузер вызывает API напрямую. */
  apiOrigin: string;
  /** Telegram Mini App: страницы под этим префиксом («/miniapp») можно встраивать в Telegram Web. В консоли нет. */
  miniApp?: { prefix: string };
}

export interface CspInput {
  nonce: string;
  apiOrigin: string;
  /** next dev: React использует eval для отладки, стили вставляются без nonce, HMR — через WebSocket. */
  dev: boolean;
  /** Страница открыта по https: просим браузер поднимать http-ссылки до https. */
  https: boolean;
  /** Кому можно встраивать страницу во фрейм; пусто или нет — никому ('none'). */
  frameAncestors?: readonly string[];
}

/**
 * Кому можно встраивать страницу `pathname`: Telegram Web — только страницам Mini App (сам префикс и всё под ним, но не
 * «/miniapp-что-то»), остальным — никому. pathname — уже разобранный путь URL (точки-сегменты, в том числе %2e%2e,
 * нормализует парсер URL до этой проверки).
 */
export function frameAncestorsFor(pathname: string, miniApp?: { prefix: string }): string[] {
  const prefix = miniApp?.prefix.replace(/\/+$/, "");
  if (!prefix) return [];
  return pathname === prefix || pathname.startsWith(`${prefix}/`) ? [TELEGRAM_WEB_ORIGIN] : [];
}

export function contentSecurityPolicy({ nonce, apiOrigin, dev, https, frameAncestors = [] }: CspInput): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' ${dev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self' ${apiOrigin}${dev ? " ws: wss:" : ""}`,
    // Записи произношения (кнопка «Послушать») веб отдаёт сам — копии в public/audio (scripts/prepare-audio.mjs).
    "media-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors.length ? frameAncestors.join(" ") : "'none'"}`,
  ];
  if (https) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export function securityHeaders({
  csp,
  camera,
  production,
  embeddable = false,
}: {
  csp: string;
  camera: boolean;
  production: boolean;
  /** Страница Mini App: X-Frame-Options не ставится — он не умеет «только Telegram Web», это делает frame-ancestors. */
  embeddable?: boolean;
}): Record<string, string> {
  return {
    "content-security-policy": csp,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    // Старые браузеры без frame-ancestors.
    ...(embeddable ? {} : { "x-frame-options": "DENY" }),
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": `camera=${camera ? "(self)" : "()"}, microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()`,
    // По http браузеры HSTS игнорируют (RFC 6797 §8.1), поэтому `next start` на localhost он не мешает.
    ...(production ? { "strict-transport-security": "max-age=63072000; includeSubDomains" } : {}),
  };
}

/** Случайный nonce: 128 бит, base64. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** Функция proxy (Next 16) для приложения: новый nonce на каждый запрос, CSP в запросе (для Next) и в ответе. */
export function createSecurityProxy({ camera, apiOrigin, miniApp }: SecurityOptions) {
  const origin = new URL(apiOrigin).origin;
  return function proxy(request: NextRequest): NextResponse {
    const nonce = createNonce();
    const dev = process.env.NODE_ENV === "development";
    const https = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
    const frameAncestors = frameAncestorsFor(request.nextUrl.pathname, miniApp);
    const csp = contentSecurityPolicy({ nonce, apiOrigin: origin, dev, https, frameAncestors });
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("content-security-policy", csp);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    for (const [name, value] of Object.entries(securityHeaders({ csp, camera, production: process.env.NODE_ENV === "production", embeddable: frameAncestors.length > 0 }))) {
      response.headers.set(name, value);
    }
    return response;
  };
}
