import { defineConfig } from "@playwright/test";

// Проверка доступности (axe) и снимки экранов консоли. API подменяется сетевыми моками по контракту (test/e2e/console.spec.ts);
// сквозные тесты с настоящим API — e2e/ (`pnpm e2e`). Браузер — уже скачанный Chromium из ~/Library/Caches/ms-playwright.
// Нужна собранная версия: `pnpm --filter @teletau/console build`, затем `pnpm --filter @teletau/console test:a11y`.
const PORT = Number(process.env.E2E_WEB_PORT ?? 3155);
/** Вторая копия той же сборки — демо-вход без TOTP («почта → код»), как на стенде показа. */
const NO_TOTP_PORT = PORT + 1;
const ENV = { AUTH_DEMO_OTP: "0000", NEXT_TELEMETRY_DISABLED: "1" };

export default defineConfig({
  testDir: "test/e2e",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: "chromium",
    locale: "ru-RU",
    timezoneId: "Asia/Yekaterinburg",
    trace: "off",
  },
  webServer: [
    {
      command: `pnpm exec next start --port ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: ENV,
    },
    {
      command: `pnpm exec next start --port ${NO_TOTP_PORT}`,
      url: `http://localhost:${NO_TOTP_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...ENV, AUTH_DEMO_STAFF: "1", AUTH_DEMO_STAFF_WITHOUT_TOTP: "1" },
    },
  ],
});
