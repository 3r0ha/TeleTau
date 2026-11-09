// Клиент API по контракту (openapi-fetch + сгенерированные типы @teletau/contracts; ручных DTO нет — CLAUDE.md, правило 1).
// К каждому запросу добавляется access-токен из памяти; на 401 — одно обновление токена и повтор.
// Каждый запрос ограничен по времени (docs/06 §6.8): зависший запрос завершается TimeoutError → «Нет связи».
import createClient from "openapi-fetch";
import type { paths } from "@teletau/contracts";
import { observeServerDate } from "./clock";
import { session } from "./client";
import { API_BASE_URL, BROWSER_REQUEST_TIMEOUT_MS, DOWNLOAD_TIMEOUT_MS } from "./config";
import { toApiProblem } from "./problem";

function withAuth(request: Request, token: string | null): Request {
  if (!token) return request;
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  return new Request(request, { headers });
}

async function send(request: Request, timeoutMs: number): Promise<Response> {
  const sentAt = Date.now();
  const response = await fetch(request, { signal: AbortSignal.timeout(timeoutMs) });
  // Date виден, только если API открывает его в Access-Control-Expose-Headers; иначе поправку даёт BFF.
  observeServerDate(response, sentAt);
  return response;
}

async function authFetch(request: Request, timeoutMs = BROWSER_REQUEST_TIMEOUT_MS): Promise<Response> {
  const token = await session.accessToken();
  const first = await send(withAuth(request.clone(), token), timeoutMs);
  if (first.status !== 401 || !token) return first;
  // Токен отозван или устарел раньше срока — одно обновление и повтор.
  if (!(await session.refresh())) return first;
  return send(withAuth(request, await session.accessToken()), timeoutMs);
}

export const api = createClient<paths>({ baseUrl: API_BASE_URL, fetch: (request) => authFetch(request) });

/** Данные ответа или исключение ApiProblem (Problem Details) — для useResource и обработчиков форм. */
export async function unwrap<T>(call: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await call;
  if (!response.ok || data === undefined) {
    if (response.ok && response.status === 204) return undefined as T;
    throw toApiProblem(error, response);
  }
  return data;
}

/** Скачать PDF карточек (бинарный ответ): fetch с токеном → файл. */
export async function downloadFile(path: string, fileName: string): Promise<void> {
  const url = new URL(path, `${API_BASE_URL}/`);
  const response = await authFetch(new Request(url, { headers: { accept: "application/pdf, application/problem+json" } }), DOWNLOAD_TIMEOUT_MS);
  if (!response.ok) throw toApiProblem(await response.json().catch(() => ({})), response);
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
