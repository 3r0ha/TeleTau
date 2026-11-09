import { defineConfig } from "@playwright/test";
import { NO_APK_PORT, TEST_APK_URL, WEB_PORT as PORT } from "./test/e2e/servers";

// Проверка доступности (axe) и снимки экранов веба. API подменяется сетевыми моками по контракту (test/e2e/mock-api.ts);
// сквозные тесты с настоящим API — e2e/ (`pnpm e2e`). Браузер — уже скачанный Chromium из ~/Library/Caches/ms-playwright.
// Нужна собранная версия: `pnpm --filter @teletau/web build`, затем `pnpm --filter @teletau/web test:a11y`.

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
    // Моки API — page.route: запросы через service worker (public/sw.js) он не перехватывает. Воркер — только в своих тестах.
    serviceWorkers: "block",
  },
  // Второй сервер — та же сборка без ANDROID_APK_URL: на стартовой странице нет кнопки Android (test/e2e/landing.spec.ts).
  webServer: [
    {
      command: `pnpm exec next start --port ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...ENV, ANDROID_APK_URL: TEST_APK_URL },
    },
    {
      command: `pnpm exec next start --port ${NO_APK_PORT}`,
      url: `http://localhost:${NO_APK_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...ENV, ANDROID_APK_URL: "" },
    },
  ],
});
