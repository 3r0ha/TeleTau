// Испытание для перехода (docs/02 §2) на моках API (mock-jump.ts): у закрытого места —
// «Уже знаешь? — Пройти испытание»; сдал — «Место открыто», уроки перед местом пройдены испытанием; не сдал (третья
// ошибка заканчивает испытание) — «Пока рано», тропа как была. Снимки — по TELETAU_SCREENS_DIR (390×844).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { childMe, mockBackend } from "./mock-api";
import { CURRENT_NODE, learnWorld } from "./mock-learn";
import { withJump } from "./mock-jump";
import { settleAnimations } from "./settle";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SHOTS = process.env.TELETAU_SCREENS_DIR;

async function expectAccessible(page: Page, label: string, disable: string[] = []) {
  await settleAnimations(page);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).disableRules(disable).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const offer = (page: Page, place: string) => page.getByRole("button", { name: `Пройти испытание и открыть место «${place}»` });

/** Ответ на задание испытания (задания — урок прототипа: плитки, выбор, ввод). */
async function answer(page: Page, right: boolean) {
  const heading = page.getByRole("heading", { level: 1 }).or(page.getByRole("heading", { level: 2 })).first();
  await expect(heading).toBeVisible();
  if (await page.getByRole("group", { name: "Слова" }).isVisible()) {
    const bank = page.getByRole("group", { name: "Слова" });
    for (const word of right ? ["Мин", "мәктәпкә", "барам"] : ["Һин", "өйгә"]) await bank.getByRole("button", { name: word, exact: true }).click();
  } else if (await page.getByRole("radio").first().isVisible()) {
    await page.getByRole("radio", { name: right ? "Привет!" : "Спасибо" }).click();
  } else {
    await page.getByRole("textbox").fill(right ? "Рәхмәт!" : "ыыы");
  }
  await page.getByRole("button", { name: "Проверить" }).click();
  await expect(page.getByRole("heading", { name: right ? "Верно!" : "Пока не так" })).toBeVisible();
  // В испытании ошибки не повторяются.
  await expect(page.getByText("Повторим в конце урока.")).toHaveCount(0);
}

test.describe("испытание для перехода", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("у закрытых мест — «Пройти испытание», у текущего — нет; сдал — «Место открыто», уроки пройдены испытанием", async ({ page }) => {
    const w = await mockBackend(page, { account: childMe(), learn: withJump(learnWorld()) });
    await page.goto("/learn");
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Пройти испытание/ })).toHaveCount(2);
    await expect(offer(page, "Шульган-Таш")).toBeVisible();
    await expect(page.getByText("Уже знаешь?").first()).toBeVisible();
    await offer(page, "Шульган-Таш").scrollIntoViewIfNeeded();
    await expectAccessible(page, "тропа с испытанием", ["target-size"]);
    await shot(page, "jump-offer-390");

    await offer(page, "Шульган-Таш").click();
    await answer(page, true);
    await page.getByRole("button", { name: "Дальше" }).click();
    await answer(page, false);
    await page.getByRole("button", { name: "Дальше" }).click();
    await answer(page, true);
    await page.getByRole("button", { name: "Дальше" }).click();

    await expect(page.getByRole("heading", { name: "Место открыто" })).toBeVisible();
    await expect(page.locator(".jump-result__place [lang=ba]")).toHaveText("Шүлгәнташ");
    await expect(page.getByText("+12")).toBeVisible();
    await expectAccessible(page, "место открыто");
    await shot(page, "jump-passed-390");
    // Забег — по месту (startJumpRun), без карточек «Новое слово».
    expect(w.learn.runs).toEqual([expect.objectContaining({ lessonId: "02-shulgantash", kind: "jump" })]);

    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page.getByRole("heading", { name: "6 дней подряд" })).toBeVisible();
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page.getByRole("button", { name: "Урок «Вежливые слова», пройден испытанием" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Испытание места, пройден испытанием" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Урок «Мама и папа» — начать" })).toBeVisible();
    await expect(offer(page, "Шульган-Таш")).toHaveCount(0);
    await expect(offer(page, "Агидель")).toBeVisible();
  });

  test("не сдал: третья ошибка — сразу «Пока рано»; тропа как была, испытание можно пройти снова", async ({ page }) => {
    const w = await mockBackend(page, { account: childMe(), learn: withJump(learnWorld()) });
    await page.goto("/learn");
    await offer(page, "Агидель").click();
    for (let i = 0; i < 3; i++) {
      await answer(page, false);
      await page.getByRole("button", { name: "Дальше" }).click();
    }
    await expect(page.getByRole("heading", { name: "Пока рано" })).toBeVisible();
    await expectAccessible(page, "пока рано");
    await shot(page, "jump-failed-390");
    expect(w.learn.attempts.map((a) => [a.result.verdict, a.result.retry, a.result.runEnded ?? false])).toEqual([
      ["wrong", false, false],
      ["wrong", false, false],
      ["wrong", false, true],
    ]);
    await page.getByRole("button", { name: "К урокам" }).click();
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
    await expect(page.getByRole("button", { name: "Урок «Вежливые слова», закрыт" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Пройти испытание/ })).toHaveCount(2);
  });

  test("без поля jump кнопки нет (место открыто или API старый)", async ({ page }) => {
    await mockBackend(page, { account: childMe() });
    await page.goto("/learn");
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Пройти испытание/ })).toHaveCount(0);
  });
});
