// Шрифты: браузер загружает WOFF2 (вдвое меньше TTF — сельский интернет), а не TTF; оба семейства загружены.
import { expect, test } from "@playwright/test";
import { mockBackend } from "./mock-api";

test("шрифты Golos Text и Nunito загружаются как WOFF2", async ({ page }) => {
  await mockBackend(page);
  const fonts: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "font") fonts.push(new URL(r.url()).pathname);
  });
  // Вход ученика: заголовок — Nunito, текст — Golos Text (на стартовой странице текста Golos нет).
  await page.goto("/student");
  await expect(page.getByRole("heading", { name: "Покажи карточку камере" })).toBeVisible();
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, ""));
  });
  expect([...new Set(loaded)].sort()).toEqual(["Golos Text", "Nunito"]);
  expect(fonts.length).toBeGreaterThanOrEqual(2);
  for (const f of fonts) expect(f, f).toMatch(/\.woff2$/);
});
