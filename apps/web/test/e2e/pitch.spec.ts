// Листалка слайдов (/pitch, app/pitch): клавиши меняют слайд и hash, номер переживает перезагрузку, Home и End,
// клик по краям, подписи для читалок, noindex, axe. Слайды — public/pitch, число — public/pitch/slides.json.
// На странице нет запросов к API; mockBackend — как в соседних тестах, чтобы BFF сессии не ушёл в сеть.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mockBackend } from "./mock-api";
import { chooseTheme } from "./theme";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const here = dirname(fileURLToPath(import.meta.url));
const COUNT = (JSON.parse(readFileSync(resolve(here, "../../public/pitch/slides.json"), "utf8")) as { count: number }).count;

const slide = (page: Page, n: number) => page.getByRole("img", { name: `Слайд ${n} из ${COUNT}` });

async function expectSlide(page: Page, n: number) {
  await expect(slide(page, n)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/pitch#${n}$`));
  await expect(page.locator(".pitch__count")).toContainText(`Слайд ${n} из ${COUNT}`);
}

test.describe("листалка слайдов", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await mockBackend(page);
  });

  test("стрелки и другие клавиши меняют слайд и hash; после перезагрузки — тот же слайд", async ({ page }) => {
    expect(COUNT).toBeGreaterThan(3);
    await page.goto("/pitch");
    await expect(slide(page, 1)).toBeVisible();
    // Видна одна картинка: соседние загружены, но скрыты.
    await expect(page.getByRole("img")).toHaveCount(1);

    await page.keyboard.press("ArrowRight");
    await expectSlide(page, 2);
    await page.keyboard.press("ArrowDown");
    await expectSlide(page, 3);
    await page.keyboard.press("PageDown");
    await expectSlide(page, 4);
    await page.keyboard.press("ArrowLeft");
    await expectSlide(page, 3);
    await page.keyboard.press("ArrowUp");
    await expectSlide(page, 2);
    await page.keyboard.press("Space");
    await expectSlide(page, 3);
    await page.keyboard.press("Backspace");
    await expectSlide(page, 2);

    await page.reload();
    await expect(slide(page, 2)).toBeVisible();
    await expect(page).toHaveURL(/\/pitch#2$/);
  });

  test("Home и End — первый и последний слайд; за края не листается", async ({ page }) => {
    await page.goto("/pitch#3");
    await expect(slide(page, 3)).toBeVisible();
    await page.keyboard.press("End");
    await expectSlide(page, COUNT);
    await page.keyboard.press("ArrowRight");
    await expectSlide(page, COUNT);
    await page.keyboard.press("Home");
    await expectSlide(page, 1);
    await page.keyboard.press("ArrowLeft");
    await expectSlide(page, 1);

    // Номер вне диапазона — последний слайд.
    await page.goto(`/pitch#${COUNT + 50}`);
    await expectSlide(page, COUNT);
  });

  test("клик по правым двум третям — вперёд, по левой трети — назад", async ({ page }) => {
    await page.goto("/pitch#2");
    await expect(slide(page, 2)).toBeVisible();
    await page.mouse.click(1000, 360);
    await expectSlide(page, 3);
    await page.mouse.click(100, 360);
    await expectSlide(page, 2);
  });

  test("подписи для читалок, noindex, на сайте нет ссылок на листалку", async ({ page }) => {
    await page.goto("/pitch");
    await expect(slide(page, 1)).toBeVisible();
    await expect(page.locator(".pitch__count")).toHaveAttribute("aria-live", "polite");
    await expect(page.getByRole("button", { name: "Во весь экран" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator("header, footer, nav")).toHaveCount(0);

    await page.goto("/");
    await page.getByRole("heading", { level: 1 }).waitFor();
    await expect(page.locator('a[href^="/pitch"]')).toHaveCount(0);
  });

  for (const dark of [false, true]) {
    test(`axe без серьёзных нарушений, ${dark ? "тёмная" : "светлая"} тема`, async ({ page }) => {
      if (dark) await chooseTheme(page, "dark");
      await page.goto("/pitch#2");
      await expect(slide(page, 2)).toBeVisible();
      const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      const report = serious.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`).join("\n");
      expect(serious, `листалка: нарушения axe\n${report}`).toEqual([]);
    });
  }
});
