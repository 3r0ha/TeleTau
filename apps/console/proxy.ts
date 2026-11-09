// Заголовки безопасности консоли: CSP с nonce на каждый запрос, запрет встраивания, камера запрещена,
// HSTS в production. Логика — @teletau/session/security (общая с вебом). Плюс запрет индексации всех ответов консоли.
import type { NextRequest } from "next/server";
import { API_BASE_URL } from "@teletau/session/config";
import { createSecurityProxy } from "@teletau/session/security";

const secure = createSecurityProxy({ camera: false, apiOrigin: API_BASE_URL });

export function proxy(request: NextRequest) {
  const response = secure(request);
  response.headers.set("x-robots-tag", "noindex, nofollow");
  return response;
}

export const config = {
  // Всё, кроме статики сборки: у неё CSP не нужна, а nonce меняется на каждый запрос.
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
