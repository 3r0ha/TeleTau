// Язык интерфейса (i18n): cookie tt_locale читает сервер (html lang и все строки — без вспышки другого языка),
// переключатель в шапке лендинга пишет cookie и обновляет страницу, неизвестное значение — фолбэк на русский.
import { expect, test } from "@playwright/test";
import { mockBackend } from "./mock-api";
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
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Башҡортса өйрәнергә — еңел һәм көн һайын");
    await expect(page.getByRole("heading", { level: 2, name: "Һуҡмаҡ урындары" })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 2, name: "Мәктәптәр өсөн" })).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Һуҡмаҡ урындары" }).getByRole("listitem").first()).toContainText("Өфө");
  });

  test("cookie tt_locale=kk — казахские строки на сервере", async ({ page }) => {
    await setLocale(page, "kk");
    await mockBackend(page);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "kk");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Башқортша үйрену — жеңіл және күн сайын");
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

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Башҡортса өйрәнергә — еңел һәм көн һайын");
    await expect(page.locator("html")).toHaveAttribute("lang", "ba");
    await expect(group.getByRole("button", { name: "Башҡортса" })).toHaveAttribute("aria-pressed", "true");

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
});
