/**
 * Telegram Web (web.telegram.org/k и /a): единственный сайт, которому разрешено встраивать Mini App во фрейм
 * (frame-ancestors, security.ts), и единственный собеседник моста Mini App по postMessage.
 */
export const TELEGRAM_WEB_ORIGIN = "https://web.telegram.org";
