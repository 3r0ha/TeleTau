import { defineConfig } from "@playwright/test";
import { stack } from "./support/env.js";

// Сквозные тесты против настоящего стека. Запуск — `pnpm e2e` (e2e/run.mjs: Docker, сборка, своя база
// `<имя>_e2e` с миграциями, справочником, курсом, дуэлями и демо-миром). Playwright сам поднимает собранные api, web и
// console на портах из .env и останавливает их после прогона (группа процессов, без сирот). Браузер — уже скачанный
// Chromium из кеша Playwright.
const s = stack();

/**
 * Окружение приложений стека: .env + демо-режим входа + доверие X-Forwarded-For только от BFF Next.js на этом
 * компьютере (как в dev, .env.example). NODE_ENV не передаётся: API по умолчанию в development (демо-код разрешён),
 * `next start` сам работает в production. BFF_TRUST_PROXY=loopback: тест proxy-ip играет роль балансировщика перед
 * Next.js на этом же компьютере (добавляет X-Forwarded-For с адресом «ученика»); браузер ходит в Next напрямую.
 */
const appEnv: Record<string, string> = {
  ...Object.fromEntries(Object.entries(s.env).filter(([key]) => key !== "NODE_ENV")),
  AUTH_DEMO_OTP: s.demoCode,
  TRUST_PROXY: "loopback",
  BFF_TRUST_PROXY: "loopback",
  NEST_LOG_LEVEL: s.env["NEST_LOG_LEVEL"] ?? "warn",
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "tests",
  outputDir: "test-results",
  // Один исполнитель: сценарий демо идёт по шагам, а лимиты частоты и очередь модератора общие.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: s.webUrl,
    browserName: "chromium",
    locale: "ru-RU",
    timezoneId: "Asia/Yekaterinburg",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      name: "api",
      command: "node --enable-source-maps dist/main.js",
      cwd: "../apps/api",
      url: `${s.apiUrl}/api/v1/health`,
      env: appEnv,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      name: "web",
      command: `./node_modules/.bin/next start --port ${s.webPort}`,
      cwd: "../apps/web",
      url: s.webUrl,
      env: appEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      name: "console",
      command: `./node_modules/.bin/next start --port ${s.consolePort}`,
      cwd: "../apps/console",
      url: `${s.consoleUrl}/login`,
      env: appEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
