import type { Metadata } from "next";
import { connection } from "next/server";
import { StaffLogin } from "./StaffLogin";

export const metadata: Metadata = { title: "Вход сотрудника" };

/** Булев синтаксис env — как в API (config.ts): `1`/`true` — включено. */
const flag = (raw: string | undefined) => {
  const v = raw?.trim().toLowerCase();
  return v === "1" || v === "true";
};

/**
 * Вход сотрудника: e-mail → одноразовый код → TOTP (ADR 0015 §4). Демо-подсказка — только в демо-режиме сервера;
 * AUTH_DEMO_STAFF_WITHOUT_TOTP (вместе с AUTH_DEMO_STAFF) убирает шаг TOTP — «почта → код», удобно проверяющим.
 * NODE_ENV здесь не проверяем: `next start` всегда работает в production, а реальная защита от включения демо-флагов
 * в проде — в API (loadConfig запрещает их в production).
 */
export default async function LoginPage() {
  await connection();
  return <StaffLogin demoCode={process.env.AUTH_DEMO_OTP?.trim() || null} totpDisabled={flag(process.env.AUTH_DEMO_STAFF) && flag(process.env.AUTH_DEMO_STAFF_WITHOUT_TOTP)} />;
}
