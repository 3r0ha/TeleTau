// Тема в тестах на моках: тёмную включает только выбор пользователя — cookie выключателя «Тёмная тема»
// (packages/ui/src/theme.ts), её читает корневой layout. Системная тема браузера (emulateMedia colorScheme) сайт не меняет.
import { test, type Page } from "@playwright/test";
import { THEME_COOKIE, type Theme } from "@teletau/ui/theme-cookie";

/** Выбрать тему до перехода на страницу: сервер сразу отдаст HTML с `data-theme`. */
export async function chooseTheme(page: Page, theme: Theme): Promise<void> {
  const url = test.info().project.use.baseURL;
  if (!url) throw new Error("chooseTheme: в конфигурации Playwright нет baseURL");
  // Cookie не привязаны к порту: выбор действует и на втором сервере теста (servers.ts).
  await page.context().addCookies([{ name: THEME_COOKIE, value: theme, url }]);
}
