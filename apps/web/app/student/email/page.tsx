import { connection } from "next/server";
import { EmailLogin } from "../../_components/telegram/EmailLogin";

/**
 * Вход по почте на сайте (тот же экран, что в Mini App): paths.loginEmail ведёт сюда с экрана welcome, когда сессия
 * взрослого истекла. Подсказка про демо-код — только если сервер в демо-режиме (AUTH_DEMO_OTP), как на входе учителя.
 */
export default async function StudentEmailLoginPage() {
  await connection();
  return <EmailLogin demoCode={process.env.AUTH_DEMO_OTP?.trim() || null} />;
}
