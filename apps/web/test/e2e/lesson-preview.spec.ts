// «Что в уроке» в кабинете учителя (getLessonPreview) на моках API по контракту (mock-api.ts, mock-teacher.ts):
// в листе «Задание классу» у выбранного урока и в «Прогрессе» у урока. Снимки — по TELETAU_SCREENS=1 (390 и 1280).
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { CLASS_ID, adultMe, classDetail, mockBackend, type World } from "./mock-api";
import { demoSeats, teacherWorld } from "./mock-teacher";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const OUT = resolve(process.env.TELETAU_SCREENS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../screens"), "lesson-preview");

async function expectAccessible(page: Page, label: string) {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((a) => {
      const end = a.effect?.getComputedTiming().endTime;
      return a.playState === "running" && typeof end === "number" && Number.isFinite(end);
    });
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

async function shot(page: Page, name: string) {
  if (!process.env.TELETAU_SCREENS) return;
  mkdirSync(OUT, { recursive: true });
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const width = page.viewportSize()?.width ?? 0;
  await page.screenshot({ path: resolve(OUT, `${name}-${width}.png`) });
}

const teacher = (init: Partial<World> = {}) => ({ account: adultMe(), classDetail: classDetail({ seats: demoSeats() }), ...init });
const noTasks = () => teacher({ teacher: { ...teacherWorld(), assignments: { active: [], past: [] } } });

async function openGive(page: Page): Promise<Locator> {
  await page.goto(`/teacher/classes/${CLASS_ID}/assignments`);
  await page.getByRole("button", { name: "Дать задание" }).click();
  return page.getByRole("dialog", { name: "Задание классу" });
}

const words = (scope: Locator) => scope.getByRole("region", { name: /^(Новые слова|Слова)/ });
const phrases = (scope: Locator) => scope.getByRole("region", { name: /^Фразы/ });
const tasks = (scope: Locator) => scope.getByRole("region", { name: /^Задания/ });

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test.describe(`«Что в уроке» — ${viewport.width} px`, () => {
    test.use({ viewport });

    test("«Задание классу»: у выбранного урока — счёт слов, по нажатию слова с переводом, фразы и задания", async ({ page }) => {
      await mockBackend(page, noTasks());
      const dialog = await openGive(page);
      const peek = dialog.getByRole("button", { name: /^Что в уроке/ });
      // Свёрнуто — одна строка со счётом; первый урок первого места — «Привет!».
      await expect(peek).toHaveAttribute("aria-expanded", "false");
      await expect(peek).toContainText("2 слова · 4 фразы");
      await dialog.getByRole("radio", { name: "Моя школа" }).check();
      await expect(peek).toContainText("5 слов · 2 фразы");
      await peek.click();
      await expect(peek).toHaveAttribute("aria-expanded", "true");
      // Раскрытое — в листе, под заголовком «Что в уроке».
      await expect(peek).toBeInViewport();
      await expect(words(dialog).getByRole("listitem").first()).toBeInViewport();

      const list = words(dialog);
      await expect(list.getByRole("heading")).toHaveText("Новые слова 5");
      await expect(list.getByRole("listitem")).toHaveCount(5);
      const first = list.getByRole("listitem").first();
      await expect(first.locator("[lang=ba]")).toHaveText("мәктәп");
      await expect(first).toContainText("школа");
      await expect(phrases(dialog).getByRole("listitem")).toHaveText(["Тоғро дуҫ.Верный друг.", "Урта мәктәпСредняя школа"]);
      await expect(tasks(dialog).getByRole("listitem")).toHaveText(["Собрать фразу 2", "Выбрать перевод 3", "Написать по-башкирски 2", "Помочь языку"]);
      // Без технических названий видов заданий.
      await expect(dialog).not.toContainText(/tiles|choice|free_ru|duel/);
      // Кнопка «Дать задание» остаётся на виду.
      await expect(dialog.getByRole("button", { name: "Дать задание" })).toBeInViewport();
      await shot(page, "give-task-open");
      await expectAccessible(page, "«Что в уроке» в листе «Задание классу»");

      // Другой урок — раскрытие остаётся, содержимое — нового урока.
      await dialog.getByRole("radio", { name: "Привет!" }).check();
      await expect(words(dialog).getByRole("listitem")).toHaveCount(2);
      await expect(phrases(dialog).getByRole("listitem").first()).toContainText("Доброе утро!");

      // «Испытание места» — «Что внутри»: слова и фразы его заданий.
      await dialog.getByRole("radio", { name: "Испытание места" }).check();
      const trial = dialog.getByRole("button", { name: /^Что внутри/ });
      await expect(trial).toContainText("3 слова · 5 фраз");
      await expect(words(dialog).getByRole("heading")).toHaveText("Слова 3");

      // Повторение слов — урока нет, и «Что в уроке» нет.
      await dialog.getByRole("radio", { name: "Повторить слова" }).check();
      await expect(dialog.getByRole("button", { name: /^Что (в уроке|внутри)/ })).toHaveCount(0);
    });

    test("«Прогресс»: «Что в уроке» у урока — лист с местом, сколько прошли, словами и «Послушать»", async ({ page }) => {
      await mockBackend(page, teacher());
      await page.goto(`/teacher/classes/${CLASS_ID}/progress`);
      const lessons = page.getByRole("region", { name: "Прохождение уроков" });
      await lessons.getByRole("button", { name: "Что в уроке «Моя школа»" }).scrollIntoViewIfNeeded();
      await shot(page, "progress-places");
      await lessons.getByRole("button", { name: "Что в уроке «Моя школа»" }).click();
      const sheet = page.getByRole("dialog", { name: "Моя школа" });
      await expect(sheet).toContainText("Уфа · Прошли 9 из 22");
      await expect(words(sheet).getByRole("listitem")).toHaveCount(5);
      await shot(page, "progress-sheet");
      await expectAccessible(page, "«Что в уроке» из «Прогресса»");
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await expect(lessons.getByRole("button", { name: "Что в уроке «Моя школа»" })).toBeFocused();

      // Закрытое место тоже можно посмотреть; у слова с записью носителя — «Послушать».
      await lessons.getByRole("button", { name: /^Гора Ямантау/ }).click();
      await lessons.getByRole("button", { name: "Что в уроке «Дни недели»" }).click();
      const days = page.getByRole("dialog", { name: "Дни недели" });
      await expect(words(days).getByRole("listitem")).toHaveCount(7);
      await expect(days.getByRole("button", { name: "Послушать: аҙна" })).toBeVisible();
      await expect(days.getByRole("button", { name: /^Послушать/ })).toHaveCount(1);
      await expect(phrases(days).getByRole("listitem")).toHaveText(["был аҙналаНа этой неделе"]);
      await expect(tasks(days).getByRole("listitem")).toContainText(["Найти пары"]);
      await shot(page, "progress-sheet-audio");

      // «Испытание места» — по месту.
      await page.keyboard.press("Escape");
      await lessons.getByRole("button", { name: "Что внутри: испытание места «Уфа»" }).click();
      await expect(page.getByRole("dialog", { name: "Испытание места «Уфа»" })).toContainText("Прошли 0 из 22");
    });
  });
}

test("ошибка загрузки — «Повторить», и содержимое приходит", async ({ page }) => {
  const w = await mockBackend(page, teacher());
  w.failures["GET /lessons/u01-moya-shkola/preview"] = "offline";
  await page.goto(`/teacher/classes/${CLASS_ID}/progress`);
  await page.getByRole("region", { name: "Прохождение уроков" }).getByRole("button", { name: "Что в уроке «Моя школа»" }).click();
  const sheet = page.getByRole("dialog", { name: "Моя школа" });
  await expect(sheet).toContainText("Нет связи");
  delete w.failures["GET /lessons/u01-moya-shkola/preview"];
  await sheet.getByRole("button", { name: "Повторить" }).click();
  await expect(words(sheet).getByRole("listitem")).toHaveCount(5);
});

test("на печати «Что в уроке» не видно", async ({ page }) => {
  await mockBackend(page, teacher());
  await page.goto(`/teacher/classes/${CLASS_ID}/progress`);
  const peek = page.getByRole("button", { name: "Что в уроке «Моя школа»" });
  await expect(peek).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(peek).toBeHidden();
});
