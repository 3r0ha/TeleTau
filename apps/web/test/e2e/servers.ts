// Серверы веба для тестов на моках (playwright.config.ts): основной — с ANDROID_APK_URL (кнопка «Скачать для Android»
// на стартовой странице), второй — та же сборка без неё. Переменная читается сервером при запросе, поэтому нужен
// отдельный процесс.
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3055);
export const NO_APK_PORT = Number(process.env.E2E_WEB_NO_APK_PORT ?? WEB_PORT + 1);
export const TEST_APK_URL = "https://apk.example/teletau.apk";
