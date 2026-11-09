// «Учусь сам» (ADR 0022) против настоящего стека: старт → «Начать» → возраст 11–14 → ник из словаря → цель дня
// 1 урок → тропа → первый урок курса целиком (дуэль — голос) → итог с мёдом → серия «1 день подряд» → новые награды →
// цель дня выполнена → узел пройден. Ни одного поля ПДн. Ответы — из контента курса тем же импортом, что у API
// (content-import.ts), и по тем же правилам, что шпаргалка сида (apps/api/src/demo/answers.ts): новых башкирских слов
// тест не придумывает.
import { expect, test, type Page } from "@playwright/test";
import { buildCourse, readContent, type ExerciseRow } from "../../apps/api/src/modules/content/content-import.js";
import { stack } from "../support/env.js";
import { dismissIntro, expectAccessible, heading, newWordHeading, passNewWord } from "../support/stack.js";

const FIRST_LESSON = "u01-privet";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface AnswerSheetRow {
  type: "tiles_ru_ba" | "choice_ba_ru" | "free_ru_ba" | "match_pairs";
  prompt: string;
  answer: string[];
}

/** Слова плиток — как их режет импорт контента: по пробелам, без пунктуации по краям (answers.ts, tileWords). */
const tileWords = (text: string) =>
  text
    .split(/\s+/u)
    .map((w) => w.replace(/^\p{P}+|\p{P}+$/gu, ""))
    .filter((w) => w.length > 0);

function row(e: ExerciseRow): AnswerSheetRow[] {
  const key = e.answerKey;
  const accepted = key.kind === "accepted" ? key.accepted[0]!.text : "";
  if (e.type === "tiles_ru_ba") return [{ type: e.type, prompt: String(e.payload["promptRu"]), answer: tileWords(accepted) }];
  if (e.type === "free_ru_ba") return [{ type: e.type, prompt: String(e.payload["promptRu"]), answer: [accepted] }];
  if (e.type === "choice_ba_ru" && key.kind === "choice") {
    return [{ type: e.type, prompt: (e.payload["prompt"] as { text: string }).text, answer: [(e.payload["optionsRu"] as string[])[key.correct]!] }];
  }
  if (e.type === "match_pairs") {
    const pairs = (e.payload["pairs"] as { ba: { text: string }; ru: string }[] | undefined) ?? [];
    return [{ type: e.type, prompt: "Соедини пары", answer: pairs.map((p) => `${p.ba.text} — ${p.ru}`) }];
  }
  return [];
}

function sheet(): { titleRu: string; rows: AnswerSheetRow[] } {
  const bundle = buildCourse(readContent()[0]!);
  const lesson = bundle.lessons.find((l) => l.id === FIRST_LESSON)!;
  return { titleRu: lesson.titleRu, rows: bundle.exercises.filter((e) => e.lessonId === FIRST_LESSON).flatMap(row) };
}

/** Верный ответ на текущее упражнение (как answer() в m2-demo.spec.ts); дуэль — первый вариант. */
async function answerRight(page: Page, rows: AnswerSheetRow[]): Promise<void> {
  const main = page.locator("main");
  const title = (await main.getByRole("heading").first().textContent()) ?? "";
  if (/Переведи на башкирский/.test(title)) {
    const prompt = (await main.locator(".prompt__bubble").textContent())!.trim();
    const row = rows.find((a) => a.type === "tiles_ru_ba" && a.prompt === prompt)!;
    for (const word of row.answer) await main.getByRole("group", { name: "Слова" }).getByRole("button", { name: word, exact: true }).click();
    return;
  }
  if (/Что значит/.test(title)) {
    const prompt = (await main.locator(".word-card").textContent())!.trim();
    const row = rows.find((a) => a.type === "choice_ba_ru" && a.prompt === prompt)!;
    await main.getByRole("radio", { name: new RegExp(escapeRe(row.answer[0]!)) }).click();
    return;
  }
  if (/Напиши по-башкирски/.test(title)) {
    const box = main.getByRole("textbox");
    const prompt = (await box.getAttribute("aria-label"))!.replace(/^Перевод на башкирский: /, "");
    await box.fill(rows.find((a) => a.type === "free_ru_ba" && a.prompt === prompt)!.answer[0]!);
    return;
  }
  if (/Соедини пары/.test(title)) {
    for (const line of rows.find((a) => a.type === "match_pairs")!.answer) {
      const [ba, ru] = line.split(" — ") as [string, string];
      await main.getByRole("list", { name: "Слова" }).getByRole("button", { name: ba, exact: true }).click();
      await main.getByRole("list", { name: "Переводы" }).getByRole("button", { name: ru, exact: true }).click();
    }
    return;
  }
  await expect(main.getByRole("heading", { name: "Какой перевод звучит естественнее?" })).toBeVisible();
  await main.getByRole("radio").first().click();
}

test("«Учусь сам»: возраст → ник → тропа → первый урок → итог, серия и цель дня", async ({ browser }) => {
  const s = stack();
  const { titleRu, rows } = sheet();
  const context = await browser.newContext({ baseURL: s.webUrl, locale: "ru-RU", timezoneId: "Asia/Yekaterinburg", viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on("response", (r) => r.url().startsWith(`${s.apiUrl}/api/v1/`) && r.status() >= 500 && problems.push(`${r.status()} ${r.url()}`));

  await test.step("старт → «Начать» («Учусь сам»): возраст и ник — без единого поля ПДн (цель дня — 2 соты по умолчанию)", async () => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "У меня есть карточка или код" })).toBeVisible();
    await expectAccessible(page, "стартовая страница");
    await page.getByRole("link", { name: "Начать", exact: true }).first().click();
    await expect(heading(page, "Сколько тебе лет?")).toBeVisible();
    await expectAccessible(page, "«Учусь сам»: возраст");
    await page.getByRole("radio", { name: "11–14 лет" }).check();
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(heading(page, "Выбери ник")).toBeVisible();
    await page.getByRole("radio").first().check();
    await expect(page.locator("input[type=email], input[type=tel], input[autocomplete=name]")).toHaveCount(0);
    const created = page.waitForResponse((r) => r.url().endsWith("/api/session/self"));
    await page.getByRole("button", { name: "Начать", exact: true }).click();
    expect((await created).status()).toBe(200);
    await page.waitForURL("**/learn");
    await dismissIntro(page);
  });

  await test.step(`тропа → урок «${titleRu}» целиком → итог с мёдом`, async () => {
    const start = page.getByRole("button", { name: `Урок «${titleRu}» — начать` });
    await expect(start).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("html")).toHaveAttribute("data-mode", "bortnik");
    await start.click();
    await expect(page.getByRole("button", { name: "Выйти из урока" })).toBeVisible();
    const check = page.getByRole("button", { name: /^(Проверить|Отдать голос)$/ });
    const done = heading(page, /Урок пройден!/);
    let newWords = 0;
    for (let step = 0; step < 40 && !(await done.isVisible()); step++) {
      await expect(check.or(done).or(newWordHeading(page))).toBeVisible({ timeout: 15_000 });
      if (await done.isVisible()) break;
      // Первый урок нового ученика: сначала карточки «Новое слово» (без ответа), потом упражнения с этими словами.
      if (await passNewWord(page)) {
        newWords++;
        continue;
      }
      await answerRight(page, rows);
      await check.click();
      const sheetButton = page.getByRole("button", { name: /^(Дальше|Понятно)$/ });
      await expect(sheetButton).toBeVisible();
      await sheetButton.click();
    }
    await expect(done).toBeVisible({ timeout: 20_000 });
    expect(newWords, "первый урок сначала показал новые слова").toBeGreaterThan(0);
    const honey = page.locator('dl[aria-label="Итог урока"] div', { has: page.getByText("Мёд", { exact: true }) }).locator("dd");
    await expect(honey).toHaveText(/^\+\d+$/);
    await expectAccessible(page, "итог урока");
  });

  await test.step("серия «1 день подряд» → тропа: узел пройден, цель дня — 1 из 2 сот", async () => {
    await page.getByRole("button", { name: "Дальше", exact: true }).click();
    await expect(heading(page, "день подряд")).toBeVisible();
    await page.getByRole("button", { name: "Дальше", exact: true }).click();
    // Первый урок приносит награду «Первый урок» — экран наград идёт после серии.
    await expect(heading(page, /^Нов(ая награда|ые награды)!$/)).toBeVisible();
    await expect(page.getByText("Первый урок", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Дальше", exact: true }).click();
    await expect(page.getByRole("button", { name: `Урок «${titleRu}», пройден` })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Цель дня: 1 из 2", { exact: true })).toBeAttached();
  });

  await test.step("«Класс» без класса — «Вступить в класс»; профиль — «Моя карточка входа»", async () => {
    await page.getByRole("link", { name: "Класс", exact: true }).click();
    await expect(heading(page, "Класса пока нет")).toBeVisible();
    await expect(page.getByRole("link", { name: "Вступить в класс" })).toBeVisible();
    await page.getByRole("link", { name: "Профиль", exact: true }).click();
    await page.getByRole("link", { name: /Моя карточка входа/ }).click();
    await page.getByRole("button", { name: "Сделать карточку" }).click();
    await expect(page.getByRole("img", { name: "QR-код карточки входа" })).toBeVisible();
    await expectAccessible(page, "карточка входа");
  });

  expect(problems, "ответы 5xx от API").toEqual([]);
  await context.close();
});
