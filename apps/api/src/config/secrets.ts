import { createHash } from "node:crypto";
import type { AppConfig } from "./config.js";

/**
 * Ключ AES-256-GCM (ADR 0015, 0016). В production — только из AUTH_ENCRYPTION_KEY (проверяет loadConfig).
 * В dev и тестах при пустой переменной ключ выводится из перца: он одинаков между перезапусками,
 * поэтому TOTP-секреты демо-сотрудников и задания печати переживают перезапуск `node --watch`.
 */
export function encryptionKey(config: AppConfig): Buffer {
  if (config.AUTH_ENCRYPTION_KEY) return Buffer.from(config.AUTH_ENCRYPTION_KEY, "base64");
  if (config.NODE_ENV === "production") throw new Error("AUTH_ENCRYPTION_KEY обязателен в production");
  return createHash("sha256").update(`teletau-dev-encryption-key\0${config.AUTH_SECRET_PEPPER}`).digest();
}

/** Демо-режим входа: фиксированный код вместо письма. */
export function demoOtp(config: AppConfig): string | undefined {
  return config.NODE_ENV === "production" ? undefined : config.AUTH_DEMO_OTP;
}

/** Демо-сотрудники с TOTP-секретами из репозитория: только при AUTH_DEMO_STAFF и не в production. */
export function demoStaffEnabled(config: AppConfig): boolean {
  return config.NODE_ENV !== "production" && config.AUTH_DEMO_STAFF;
}

/**
 * Демо-сотрудники без второго фактора (AUTH_DEMO_STAFF_WITHOUT_TOTP): для показа жюри — аутентификатор на телефоне
 * проверяющего неудобен. Только вместе с демо-сотрудниками и не в production: вход сотрудника — «почта → код».
 */
export function demoStaffWithoutTotp(config: AppConfig): boolean {
  return config.NODE_ENV !== "production" && config.AUTH_DEMO_STAFF && config.AUTH_DEMO_STAFF_WITHOUT_TOTP;
}
