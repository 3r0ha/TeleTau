import { connection } from "next/server";
import { SaveEmailScreen } from "../../_components/learn/SaveEmailScreen";

// Взрослый «Учусь сам» сохраняет прогресс по почте (ADR 0022). Подсказка про демо-код — только если сервер запущен
// в демо-режиме (AUTH_DEMO_OTP), как на входе взрослого: значение читается при запросе, а не при сборке.
export default async function Page() {
  await connection();
  return <SaveEmailScreen demoCode={process.env.AUTH_DEMO_OTP?.trim() || null} />;
}
