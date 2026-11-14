import type { Metadata } from "next";
import { connection } from "next/server";
import { getT } from "../../../i18n/server";
import { OtpLogin } from "./OtpLogin";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Вход по почте") };
}

/**
 * Вход и регистрация по почте: e-mail → одноразовый код (аккаунт создаётся сам, если адрес новый). Подсказка про
 * демо-код показывается, только если сервер запущен в демо-режиме (AUTH_DEMO_OTP) — значение читается при запросе, а
 * не при сборке. Ссылка на консоль — для сотрудника, который случайно начал вход на сайте (консоль — отдельный
 * адрес, PUBLIC_CONSOLE_URL). `?as=teacher` — вход с плитки «Я учитель»: подпись учительская и после кода сразу
 * условия, без выбора «Учиться / Я учитель».
 */
export default async function TeacherLoginPage({ searchParams }: { searchParams: Promise<{ as?: string | string[] }> }) {
  await connection();
  const demoCode = process.env.AUTH_DEMO_OTP?.trim() || null;
  const consoleUrl = process.env.PUBLIC_CONSOLE_URL?.trim() || null;
  const teacherIntent = (await searchParams).as === "teacher";
  return <OtpLogin demoCode={demoCode} teacherIntent={teacherIntent} consoleUrl={consoleUrl ?? undefined} />;
}
