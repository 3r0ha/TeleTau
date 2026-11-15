// Фраза дня (ТЗ §3.6) — публичная витрина лендинга без регистрации: принятая пара корпуса показывается всем,
// башкирский текст — с lang="ba" (правило 6). Пчела «произносит» фразу в облачке героя: башкирский вариант
// крупно, русский исходник — подписью; отдельной секции фразы нет. Демо-мир сеет принятые пары (demo:seed),
// поэтому фраза видна на главной сразу после старта стенда.
import { expect, test } from "@playwright/test";

test("фраза дня на лендинге: пчела произносит пару в облачке героя, башкирский текст с lang=ba, без входа", async ({ page }) => {
  await page.goto("/");
  const bubble = page.locator(".lp-hero__hello");
  await expect(bubble).toBeVisible();
  const ba = bubble.locator("[lang='ba']");
  await expect(ba).not.toBeEmpty();
  await expect(bubble.locator(".lp-hero__hello-ru")).not.toBeEmpty();
  // Отдельной секции фразы больше нет; остальная страница цела: герой и места тропы на месте, h1 один.
  await expect(page.getByRole("region", { name: "Фраза дня" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Учи башкирский каждый день");
  await expect(page.getByRole("region", { name: "Места тропы" })).toBeVisible();
});
