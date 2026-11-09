// Заголовки безопасности веба: CSP с nonce на каждый запрос, запрет встраивания, камера — только этому сайту
// (сканер QR-карточки), HSTS в production. Telegram Mini App (/miniapp/*) встраивает только Telegram Web.
// Логика — @teletau/session/security (общая с консолью).
import type { NextRequest } from "next/server";
import { API_BASE_URL } from "@teletau/session/config";
import { createSecurityProxy } from "@teletau/session/security";

const secure = createSecurityProxy({ camera: true, apiOrigin: API_BASE_URL, miniApp: { prefix: "/miniapp" } });

export function proxy(request: NextRequest) {
  return secure(request);
}

export const config = {
  // Всё, кроме статики сборки: у неё CSP не нужна, а nonce меняется на каждый запрос.
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
