// «Награды» на моках API (mock-api.ts, mock-learn.ts): сетка в профиле, лист подробностей, экран «Новая награда»
// после урока — между серией и новой лигой. Снимки — по TELETAU_SCREENS=1 (390 и 1280 px, светлая и тёмная тема).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { childMe, mockBackend, type World } from "./mock-api";
import { CURRENT_NODE, award, learnWorld } from "./mock-learn";
import { settleAnimations } from "./settle";
import { chooseTheme } from "./theme";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectAccessible(page: Page, label: string) {
  await settleAnimations(page);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

/** Урок «Моя школа» до итога: карточки «Новое слово» — «Дальше», задания — любой ответ. */
async function finishLesson(page: Page) {
  await page.goto("/learn");
  await page.getByRole("button", { name: CURRENT_NODE }).click();
  const done = page.getByRole("heading", { name: "Урок пройден!" });
  const newWord = page.getByRole("heading", { name: "Новое слово" });
  const check = page.getByRole("button", { name: /^(Проверить|Отдать голос)$/ });
  for (let steps = 0; steps < 20; steps++) {
    await expect(check.or(done).or(newWord)).toBeVisible();
    if (await done.isVisible()) return;
    if (await newWord.isVisible()) {
      await page.getByRole("button", { name: "Дальше" }).click();
      continue;
    }
    const title = (await page.locator("main h1").first().textContent()) ?? "";
    if (title.startsWith("Какой перевод")) await page.keyboard.press("1");
    else if (title.startsWith("Что значит")) await page.getByRole("radio", { name: "Спасибо" }).click();
    else if (await page.getByRole("textbox").isVisible()) await page.getByRole("textbox").fill("ыыы");
    else await page.getByRole("group", { name: "Слова" }).getByRole("button", { name: "Һин", exact: true }).click();
    await check.click();
    await page.locator(".tt-sheet").getByRole("button", { name: "Дальше" }).click();
  }
  await expect(done).toBeVisible();
}

const awards = (page: Page) => page.getByRole("region", { name: "Награды" });

test.describe("Награды", () => {
  test("профиль: сетка значков — полученные с днём, остальные с прогрессом; лист подробностей; axe", async ({ page }) => {
    await mockBackend(page, { account: childMe() });
    await page.goto("/me");
    const section = awards(page);
    await expect(section.getByRole("heading", { name: "Награды" })).toBeVisible();
    await expect(section.getByText("5 из 12")).toBeVisible();
    await expect(section.getByRole("button")).toHaveCount(12);
    await expect(section.getByRole("button", { name: /Первый урок\s*Получена 3 ноября/ })).toBeVisible();
    await expect(section.getByRole("button", { name: /^7 дней подряд\s*5 из 7/ })).toBeVisible();
    await expect(section.getByRole("button", { name: /Место пройдено\s*Ещё не получена/ })).toBeVisible();
    // Полученные — цветные соты, остальные — воск.
    await expect(section.locator(".award-badge--streak")).toHaveCount(1);
    await expect(section.locator(".award-badge--locked")).toHaveCount(7);
    await expectAccessible(page, "профиль с наградами");

    await section.getByRole("button", { name: /^7 дней подряд\s*5 из 7/ }).click();
    const sheet = page.getByRole("dialog", { name: "7 дней подряд" });
    await expect(sheet.getByText("Занимайся 7 дней подряд")).toBeVisible();
    await expect(sheet.getByRole("progressbar", { name: "7 дней подряд" })).toHaveAttribute("aria-valuetext", "5 из 7");
    await expectAccessible(page, "лист награды");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await section.getByRole("button", { name: /10 голосов\s*Получена 7 ноября/ }).click();
    await expect(page.getByRole("dialog", { name: "10 голосов" }).getByText("Получена 7 ноября")).toBeVisible();
  });

  test("награды не загрузились — профиль без них, остальное на месте", async ({ page }) => {
    await mockBackend(page, { account: childMe() });
    await page.route("**/api/v1/me/achievements", (route) => route.fulfill({ status: 503, contentType: "application/problem+json", body: JSON.stringify({ type: "about:blank", title: "Сервис недоступен", status: 503 }) }));
    await page.goto("/me");
    await expect(page.getByRole("heading", { name: "Мой вклад в словарь" })).toBeVisible();
    await expect(awards(page)).toHaveCount(0);
  });

  test("после урока: итог → серия → «Новая награда» → новая лига; в профиле награда уже получена", async ({ page }) => {
    const learn = learnWorld();
    learn.summary.newAchievements = [award("words-10", { earnedOn: "2026-11-14" })];
    const w = await mockBackend(page, { account: childMe(), learn });
    await finishLesson(page);
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page.getByRole("heading", { name: "6 дней подряд" })).toBeVisible();
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page.getByRole("heading", { name: "Новая награда!" })).toBeVisible();
    await expect(page.getByText("10 слов", { exact: true })).toBeVisible();
    await expect(page.locator(".after .award-badge--water")).toHaveCount(1);
    // Контраст — по итогу подъёма соты, а не на середине анимации.
    await expect.poll(() => page.locator(".award-badge--rise").evaluate((el) => el.getAnimations({ subtree: true }).every((x) => x.playState === "finished"))).toBe(true);
    await expectAccessible(page, "новая награда");
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page.getByRole("heading", { name: "Новая лига — Кипрей!" })).toBeVisible();
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
    expect(w.learn.completes).toHaveLength(1);

    await page.getByRole("link", { name: "Профиль" }).first().click();
    await expect(awards(page).getByRole("button", { name: /^10 слов\s*Получена 14 ноября/ })).toBeVisible();
    await expect(awards(page).getByText("6 из 12")).toBeVisible();
  });

  test("несколько наград за урок — на одном экране «Новые награды!»; без новых — экрана нет", async ({ page }) => {
    const learn = learnWorld();
    learn.summary = { ...learn.summary, leagueResult: undefined, newAchievements: [award("words-10", { earnedOn: "2026-11-14" }), award("first-place", { earnedOn: "2026-11-14" })] };
    await mockBackend(page, { account: childMe(), learn });
    await finishLesson(page);
    await page.getByRole("button", { name: "Дальше" }).click();
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page.getByRole("heading", { name: "Новые награды!" })).toBeVisible();
    await expect(page.locator(".award-new__list li")).toHaveText([/10 слов/, /Место пройдено/]);
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
  });
});

// ───── снимки (TELETAU_SCREENS=1; каталог — TELETAU_SCREENS_DIR или apps/web/test/screens) ─────
const OUT = process.env.TELETAU_SCREENS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../screens");

test.describe("Награды — снимки", () => {
  test.skip(!process.env.TELETAU_SCREENS, "снимки — только по TELETAU_SCREENS=1");

  const shots: { name: string; go: (page: Page, w: World) => Promise<void>; fullPage?: boolean }[] = [
    {
      name: "awards-profile",
      fullPage: true,
      go: async (page) => {
        await page.goto("/me");
        await expect(awards(page).getByText("5 из 12")).toBeVisible();
      },
    },
    {
      name: "awards-sheet",
      go: async (page) => {
        await page.goto("/me");
        await awards(page).getByRole("button", { name: /^7 дней подряд\s*5 из 7/ }).click();
        await expect(page.getByRole("dialog", { name: "7 дней подряд" })).toBeVisible();
      },
    },
    {
      name: "awards-new",
      go: async (page) => {
        await finishLesson(page);
        await page.getByRole("button", { name: "Дальше" }).click();
        await page.getByRole("button", { name: "Дальше" }).click();
        await expect(page.getByRole("heading", { name: "Новая награда!" })).toBeVisible();
      },
    },
  ];

  for (const width of [390, 1280] as const) {
    for (const dark of [false, true]) {
      for (const shot of shots) {
        test(`${shot.name} @${width}${dark ? " dark" : ""}`, async ({ page }) => {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 860 });
          await page.emulateMedia({ reducedMotion: "reduce" });
          if (dark) await chooseTheme(page, "dark");
          const learn = learnWorld();
          learn.summary.newAchievements = [award("streak-7", { earnedOn: "2026-11-14" })];
          const w = await mockBackend(page, { account: childMe(), learn });
          await shot.go(page, w);
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(250);
          await page.screenshot({ path: `${OUT}/${shot.name}-${width}${dark ? "-dark" : ""}.png`, fullPage: Boolean(shot.fullPage) });
        });
      }
    }
  }
});
