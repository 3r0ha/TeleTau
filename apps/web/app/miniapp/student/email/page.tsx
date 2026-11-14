import { connection } from "next/server";
import { EmailLogin } from "../../../_components/telegram/EmailLogin";

/**
 * Вход по почте в Mini App: тот же путь, что на сайте (e-mail → одноразовый код), но сессия остаётся в рамке
 * Telegram — и чат с ботом связывается сам (initData → POST /telegram/link, ADR 0020). Подсказка про демо-код —
 * только если сервер в демо-режиме (AUTH_DEMO_OTP), значение читается при запросе, а не при сборке.
 */
export default async function MiniAppEmailLoginPage() {
  await connection();
  return <EmailLogin demoCode={process.env.AUTH_DEMO_OTP?.trim() || null} />;
}
