import type { Metadata } from "next";
import { connection } from "next/server";
import { StaffLogin } from "./StaffLogin";

export const metadata: Metadata = { title: "Вход сотрудника" };

/** Вход сотрудника: e-mail → одноразовый код → TOTP (ADR 0015 §4). Демо-подсказка — только в демо-режиме сервера. */
export default async function LoginPage() {
  await connection();
  return <StaffLogin demoCode={process.env.AUTH_DEMO_OTP?.trim() || null} />;
}
