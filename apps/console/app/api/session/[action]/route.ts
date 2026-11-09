// BFF сессии консоли (ADR 0015 §3): своя cookie (на localhost веб и консоль делят хост, но не cookie).
import { createSessionRoute } from "@teletau/session/server";

export const dynamic = "force-dynamic";

export const { POST } = createSessionRoute({ cookiePrefix: "tt_console", appVersion: "console-0.1.0" });
