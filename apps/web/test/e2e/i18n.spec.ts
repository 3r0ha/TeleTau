// Язык интерфейса (i18n): cookie tt_locale читает сервер (html lang и все строки — без вспышки другого языка),
// переключатель в шапке лендинга пишет cookie и обновляет страницу, неизвестное значение — фолбэк на русский.
import { expect, test } from "@playwright/test";
import { childMe, mockBackend } from "./mock-api";
import { WEB_PORT as PORT } from "./servers";

const BASE = `http://localhost:${PORT}`;

async function setLocale(page: import("@playwright/test").Page, value: string) {
  await page.context().addCookies([{ name: "tt_locale", value, url: BASE }]);
}

test.describe("язык интерфейса", () => {
  test("без cookie — русский, html lang=ru", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Учи башкирский");
  });

  test("неизвестное значение cookie — фолбэк на русский", async ({ page }) => {
    await setLocale(page, "en");
    await mockBackend(page);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Учи башкирский");
  });

  test("cookie tt_locale=ba — башкирские строки на сервере", async ({ page }) => {
    await setLocale(page, "ba");
    await mockBackend(page);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "ba");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Башҡортса көн һайын өйрәнергә");
    await expect(page.getByRole("heading", { level: 2, name: "Һуҡмаҡ урындары" })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 2, name: "Мәктәптәр өсөн" })).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Һуҡмаҡ урындары" }).getByRole("listitem").first()).toContainText("Өфө");
  });

  test("cookie tt_locale=kk — казахские строки на сервере", async ({ page }) => {
    await setLocale(page, "kk");
    await mockBackend(page);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "kk");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Башқортшаны күн сайын үйрен");
    await expect(page.getByRole("heading", { level: 2, name: "Жол бойындағы орындар" })).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Жол бойындағы орындар" }).getByRole("listitem").first()).toContainText("Уфа");
  });

  test("переключатель в шапке: «Башҡортса» — cookie, перерисовка, html lang", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Учи башкирский");

    const group = page.getByRole("group", { name: "Язык интерфейса" });
    await expect(group).toHaveCount(1);
    await expect(group.getByRole("button", { name: "Русский" })).toHaveAttribute("aria-pressed", "true");
    await group.getByRole("button", { name: "Башҡортса" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Башҡортса көн һайын өйрәнергә");
    await expect(page.locator("html")).toHaveAttribute("lang", "ba");
    // Подпись группы теперь тоже по-башкирски — кнопку ищем в шапке по её названию (оно на самом языке).
    await expect(page.getByRole("banner").getByRole("button", { name: "Башҡортса" })).toHaveAttribute("aria-pressed", "true");

    const cookie = (await page.context().cookies(BASE)).find((c) => c.name === "tt_locale");
    expect(cookie?.value).toBe("ba");
    expect(cookie?.expires ?? 0).toBeGreaterThan(Date.now() / 1000 + 300 * 24 * 60 * 60); // примерно год
  });

  test("после перезагрузки язык сохраняется (cookie читается сервером заново)", async ({ page }) => {
    await setLocale(page, "ba");
    await mockBackend(page);
    await page.goto("/");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "ba");
    await expect(page.getByRole("heading", { level: 2, name: "Һуҡмаҡ урындары" })).toHaveCount(1);
  });

  test("ba: вкладки и подписи packages/ui, награды, цель дня, лига — по-башкирски", async ({ page }) => {
    await setLocale(page, "ba");
    await page.setViewportSize({ width: 390, height: 844 });
    await mockBackend(page, { account: childMe() });
    await page.goto("/me");
    const tabs = page.getByRole("navigation", { name: "Бүлектәр" });
    await expect(tabs.getByRole("link")).toHaveText(["Юл", "Лига", "Класс", "Профиль"]);
    const awards = page.getByRole("region", { name: "Бүләктәр" });
    await expect(awards.getByText("Урын үтелде")).toBeVisible();
    await expect(awards.getByText("Место пройдено")).toHaveCount(0);
    await expect(page.getByText("2 урока в день")).toHaveCount(0);
    await page.goto("/league");
    await expect(page.locator(".tt-lzone--up")).toHaveText("Күтәрелеү зонаһы");
  });

  test("ba: экран ошибки — заголовок и кнопка повтора, текст не повторяет заголовок", async ({ page }) => {
    await setLocale(page, "ba");
    await mockBackend(page, { account: childMe(), failures: { "GET /leagues/current": { status: 500, code: "internal" } } });
    await page.goto("/league");
    const alert = page.getByRole("alert").filter({ has: page.getByRole("heading", { name: "Нимәлер яңылыш сыҡты" }) });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("button", { name: "Тағы бер тапҡыр ҡарарға" })).toBeVisible();
    await expect(alert).not.toContainText("Нимәлер яңылыш сыҡты. Тағы");
    await expect(alert.locator(".tt-empty__text")).toHaveCount(0);
  });
});
