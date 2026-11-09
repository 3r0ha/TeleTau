// BFF сессии (ADR 0015 §3): единственное место, где веб видит refresh-токен. Обработчик Next.js (route handler)
// вызывает API входа, кладёт refresh-токен в cookie `HttpOnly; Secure; SameSite=Strict` с путём /api/session
// и отдаёт браузеру только access-токен и аккаунт. Идентификатор установки (DeviceInfo.installId) — тоже здесь,
// в httpOnly cookie: сессия привязана к нему, и при обновлении он должен совпасть.
import createClient from "openapi-fetch";
import { NextResponse, type NextRequest } from "next/server";
import type { Problem, Schema, paths } from "@teletau/contracts";
import { clientIp, parseTrustList, stampedPeer, type TrustList } from "./client-ip";
import { API_BASE_URL, SESSION_PATH } from "./config";
import type { BrowserSession } from "./types";

type AuthSession = Schema<"AuthSession">;

export interface SessionRouteOptions {
  /** Префикс cookie: у веба и консоли на одном хосте (localhost) свои cookie. */
  cookiePrefix: string;
  /** DeviceInfo.appVersion, например "web-0.1.0". */
  appVersion: string;
  /** Для тестов: доверенные балансировщики и таймаут вместо BFF_TRUST_PROXY и BFF_API_TIMEOUT_MS. */
  trustProxy?: string;
  apiTimeoutMs?: number;
}

const INSTALL_ID_MAX_AGE = 400 * 24 * 3600; // предел браузеров для срока cookie

/** BFF → API: ждём меньше, чем браузер ждёт BFF (BROWSER_REQUEST_TIMEOUT_MS), — браузер успеет получить 503. */
const DEFAULT_API_TIMEOUT_MS = 10_000;

function apiTimeoutMs(value: number | undefined): number {
  const fromEnv = Number(process.env.BFF_API_TIMEOUT_MS);
  const ms = value ?? (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_API_TIMEOUT_MS);
  return Math.max(500, ms);
}

function problem(status: number, code: string, title: string, detail?: string): NextResponse {
  const body: Problem = { type: "about:blank", title, status, code, ...(detail ? { detail } : {}) };
  return NextResponse.json(body, { status, headers: { "content-type": "application/problem+json", "cache-control": "no-store" } });
}

/** Запрос пришёл со страницы этого же сайта (дополнительно к SameSite=Strict): защита от CSRF. */
function sameOrigin(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = req.headers.get("origin");
  if (!origin) return site === "same-origin";
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 && v.length <= 600 ? v : undefined);

export function createSessionRoute({ cookiePrefix, appVersion, trustProxy, apiTimeoutMs: timeout }: SessionRouteOptions) {
  const RT = `${cookiePrefix}_rt`;
  const DID = `${cookiePrefix}_did`;
  // Разбирается при первом запросе: ошибка в BFF_TRUST_PROXY — 503 и сообщение в логе, а не падение сборки.
  let trust: TrustList | null = null;
  const trusted = () => (trust ??= parseTrustList(trustProxy ?? process.env.BFF_TRUST_PROXY));
  const timeoutMs = apiTimeoutMs(timeout);

  // Secure — всегда в production и по https. В dev по http — только для localhost: браузер считает его защищённым.
  // Хост берётся из заголовка Host, а не из nextUrl: Next dev подставляет туда «localhost» при любом адресе, и на стенде
  // в локальной сети (http://192.168.…) cookie приходила с Secure, браузер её отбрасывал, сессия терялась при перезагрузке.
  const secureFor = (req: NextRequest) => {
    if (process.env.NODE_ENV === "production" || req.nextUrl.protocol === "https:") return true;
    let hostname = req.nextUrl.hostname;
    try {
      hostname = new URL(`http://${req.headers.get("host") ?? req.nextUrl.host}`).hostname;
    } catch {
      // неразборчивый Host — остаётся адрес из nextUrl
    }
    return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  };

  const cookieBase = (req: NextRequest) => ({ httpOnly: true, secure: secureFor(req), sameSite: "strict" as const, path: SESSION_PATH });

  /**
   * Клиент API для вызова с сервера: IP браузера передаётся в X-Forwarded-For (ограничения частоты по IP).
   * X-Forwarded-For клиента не пересылается: IP — адрес сокета запроса, а за доверенным балансировщиком
   * (BFF_TRUST_PROXY) — адрес, который добавил он (client-ip.ts). API доверяет заголовку только от адресов из
   * TRUST_PROXY (в dev — loopback, `.env.example`). Ответ API дольше timeoutMs — 503 api_unavailable.
   */
  const apiFor = (req: NextRequest) => {
    const ip = clientIp({ peer: stampedPeer(req.headers), forwardedFor: req.headers.get("x-forwarded-for"), trust: trusted() });
    return createClient<paths>({
      baseUrl: API_BASE_URL,
      headers: ip ? { "x-forwarded-for": ip } : {},
      fetch: (r) => fetch(r, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) }),
    });
  };

  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

  /** Ответ API → ответ браузеру. Problem Details проходят как есть, сеть недоступна — 503. */
  const passProblem = (error: unknown, response: Response) => {
    const p = error && typeof error === "object" ? (error as Problem) : undefined;
    if (p?.status) {
      // 429: через сколько секунд можно повторить — как ответил API (иначе клиент не знает, сколько ждать).
      const retryAfter = response.headers.get("retry-after");
      return NextResponse.json(p, {
        status: response.status,
        headers: { "content-type": "application/problem+json", "cache-control": "no-store", ...(retryAfter ? { "retry-after": retryAfter } : {}) },
      });
    }
    return problem(response.status || 502, "upstream_error", "Сервис ответил ошибкой");
  };

  const browserSession = (auth: AuthSession): BrowserSession => ({
    accessToken: auth.accessToken,
    accessTokenExpiresAt: auth.accessTokenExpiresAt,
    account: auth.account,
  });

  /** Ответ с access-токеном; refresh-токен — только в cookie. body — что увидит браузер (по умолчанию — сессия). */
  const withSession = (req: NextRequest, auth: AuthSession, installId: string, body: unknown = browserSession(auth)) => {
    const res = json(body);
    const maxAge = Math.max(60, Math.floor((Date.parse(auth.refreshTokenExpiresAt) - Date.now()) / 1000));
    res.cookies.set(RT, auth.refreshToken, { ...cookieBase(req), maxAge });
    res.cookies.set(DID, installId, { ...cookieBase(req), maxAge: INSTALL_ID_MAX_AGE });
    return res;
  };

  const clearSession = (req: NextRequest, res: NextResponse) => {
    res.cookies.set(RT, "", { ...cookieBase(req), maxAge: 0 });
    return res;
  };

  async function handle(req: NextRequest, action: string): Promise<NextResponse> {
    if (!sameOrigin(req)) return problem(403, "forbidden", "Запрос с другого сайта отклонён");
    const installId = req.cookies.get(DID)?.value ?? crypto.randomUUID();
    const device = { installId, platform: "web" as const, appVersion };
    const api = apiFor(req);

    switch (action) {
      case "qr": {
        const payload = str((await readBody(req)).payload);
        if (!payload) return problem(422, "payload_invalid", "Карточка не распознана");
        const { data, error, response } = await api.POST("/api/v1/auth/qr", { body: { payload, device } });
        return data ? withSession(req, data, installId) : passProblem(error, response);
      }
      case "card": {
        // Личная карточка самостоятельного ученика (ADR 0022) — тот же путь, что QR места: нагрузка только в теле.
        const payload = str((await readBody(req)).payload);
        if (!payload) return problem(422, "payload_invalid", "Карточка не распознана");
        const { data, error, response } = await api.POST("/api/v1/auth/login-card", { body: { payload, device } });
        return data ? withSession(req, data, installId) : passProblem(error, response);
      }
      case "self": {
        // «Учусь сам» (ADR 0022): ник из словаря и возрастной диапазон; устройство сессии — cookie установки.
        const body = await readBody(req);
        const nicknameId = str(body.nicknameId);
        const ageBand = str(body.ageBand);
        const dailyGoal = typeof body.dailyGoal === "number" ? body.dailyGoal : undefined;
        if (!nicknameId || !ageBand) return problem(422, "validation_failed", "Нужны ник и возраст");
        const { data, error, response } = await api.POST("/api/v1/auth/self", {
          body: { nicknameId, ageBand: ageBand as Schema<"AgeBand">, device, ...(dailyGoal !== undefined ? { dailyGoal } : {}) },
        });
        return data ? withSession(req, data, installId) : passProblem(error, response);
      }
      case "otp": {
        const body = await readBody(req);
        const challengeId = str(body.challengeId);
        const code = str(body.code);
        const totp = str(body.totp);
        if (!challengeId || !code) return problem(422, "validation_failed", "Нужен код");
        const { data, error, response } = await api.POST("/api/v1/auth/otp/verify", {
          body: { challengeId, code, device, ...(totp ? { totp } : {}) },
        });
        return data ? withSession(req, data, installId) : passProblem(error, response);
      }
      case "class-code": {
        const body = await readBody(req);
        const code = str(body.code);
        const nicknameId = str(body.nicknameId);
        if (!code || !nicknameId) return problem(422, "validation_failed", "Нужны код класса и ник");
        const { data, error, response } = await api.POST("/api/v1/auth/class-code", { body: { code, nicknameId, device } });
        if (!data) return passProblem(error, response);
        const res = json(data, 202);
        res.cookies.set(DID, installId, { ...cookieBase(req), maxAge: INSTALL_ID_MAX_AGE });
        return res;
      }
      case "class-code-status": {
        const body = await readBody(req);
        const requestId = str(body.requestId);
        const pollToken = str(body.pollToken);
        if (!requestId || !pollToken) return problem(422, "validation_failed", "Нет заявки");
        // Устройство заявки (cookie установки): если ответ с сессией потерялся, повторный опрос снова её выдаст.
        const deviceInstallId = req.cookies.get(DID)?.value;
        const { data, error, response } = await api.GET("/api/v1/auth/class-code/{requestId}", {
          params: { path: { requestId }, header: { "X-Poll-Token": pollToken, ...(deviceInstallId ? { "X-Device-Install-Id": deviceInstallId } : {}) } },
        });
        if (!data) return passProblem(error, response);
        if (data.session) {
          const { session, ...status } = data;
          return withSession(req, session, installId, { ...status, session: browserSession(session) });
        }
        return json(data);
      }
      case "refresh": {
        const refreshToken = req.cookies.get(RT)?.value;
        const deviceInstallId = req.cookies.get(DID)?.value;
        if (!refreshToken || !deviceInstallId) return problem(401, "refresh_invalid", "Нет сессии");
        const { data, error, response } = await api.POST("/api/v1/auth/refresh", { body: { refreshToken, deviceInstallId } });
        if (data) return withSession(req, data, deviceInstallId);
        const res = passProblem(error, response);
        // Токен отвергнут (повтор, отзыв, чужое устройство) — cookie больше не нужна.
        return response.status === 401 ? clearSession(req, res) : res;
      }
      case "logout": {
        const authorization = req.headers.get("authorization");
        const allDevices = (await readBody(req)).allDevices === true;
        if (authorization?.startsWith("Bearer ")) {
          // Ошибка API при выходе не мешает выйти локально: cookie удаляется в любом случае.
          await api
            .POST("/api/v1/auth/logout", { headers: { authorization }, body: allDevices ? { allDevices } : {} })
            .catch(() => undefined);
        }
        return clearSession(req, new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } }));
      }
      default:
        return problem(404, "not_found", "Нет такого действия");
    }
  }

  async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }): Promise<NextResponse> {
    const { action } = await ctx.params;
    try {
      return await handle(req, action);
    } catch (e) {
      // API недоступен (сеть, таймаут) или неверный BFF_TRUST_PROXY. Подробности не отдаём и не пишем запрос в лог:
      // в нём могут быть секреты; пишем только вид ошибки.
      if (e instanceof Error && e.message.startsWith("BFF_TRUST_PROXY")) console.error(`session BFF: ${e.message}`);
      return problem(503, "api_unavailable", "Сервис временно недоступен");
    }
  }

  return { POST };
}
