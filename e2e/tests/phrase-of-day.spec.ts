// Фраза дня (ТЗ §3.6) — публичная витрина лендинга без регистрации: принятая пара корпуса показывается всем,
// башкирский текст — с lang="ba" (правило 6). Демо-мир сеет принятые пары (demo:seed, «принятые пары демо-мира»
// из ministry-fund), поэтому блок виден на главной сразу после старта стенда.
import { expect, test } from "@playwright/test";

test("фраза дня на лендинге: принятая пара, башкирский текст с lang=ba, без входа", async ({ page }) => {
  await page.goto("/");
  const band = page.getByRole("region", { name: "Фраза дня" });
  await expect(band).toBeVisible();
  const ba = band.locator(".lp-phrase__ba");
  await expect(ba).toHaveAttribute("lang", "ba");
  await expect(ba).not.toBeEmpty();
  await expect(band.locator(".lp-phrase__ru")).not.toBeEmpty();
  await expect(band).toContainText("словаря ТелеТау");
  // Блок не ломает остальную страницу: герой и места тропы на месте, h1 один.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Учи башкирский — легко и каждый день");
  await expect(page.getByRole("region", { name: "Места тропы" })).toBeVisible();
});
