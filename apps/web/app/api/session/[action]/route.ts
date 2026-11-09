// BFF сессии веба (ADR 0015 §3): refresh-токен — только в httpOnly cookie, браузеру — access-токен.
import { createSessionRoute } from "@teletau/session/server";

export const dynamic = "force-dynamic";

export const { POST } = createSessionRoute({ cookiePrefix: "tt_web", appVersion: "web-0.1.0" });
