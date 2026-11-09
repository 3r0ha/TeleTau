import type { Metadata } from "next";
import { connection } from "next/server";
import { OtpLogin } from "./OtpLogin";

export const metadata: Metadata = { title: "Вход для учителя" };

/**
 * Вход взрослого: e-mail → одноразовый код. Подсказка про демо-код показывается, только если сервер
 * запущен в демо-режиме (AUTH_DEMO_OTP) — значение читается при запросе, а не при сборке.
 */
export default async function TeacherLoginPage({ searchParams }: { searchParams: Promise<{ as?: string | string[] }> }) {
  await connection();
  const demoCode = process.env.AUTH_DEMO_OTP?.trim() || null;
  const teacherIntent = (await searchParams).as === "teacher";
  return <OtpLogin demoCode={demoCode} teacherIntent={teacherIntent} />;
}
