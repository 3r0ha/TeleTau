import { connection } from "next/server";
import { SaveEmailScreen } from "../../_components/learn/SaveEmailScreen";

// «Сохранить прогресс по почте» (ADR 0022 §10) — детям и взрослым. Подсказка про демо-код — только если сервер
// запущен в демо-режиме (AUTH_DEMO_OTP), как на входе: значение читается при запросе, а не при сборке.
export default async function Page() {
  await connection();
  return <SaveEmailScreen demoCode={process.env.AUTH_DEMO_OTP?.trim() || null} />;
}
