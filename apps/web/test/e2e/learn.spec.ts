// Экраны ученика на моках API по контракту (mock-api.ts, mock-learn.ts): тропа, урок с вердиктами «верно / почти /
// неверно», дуэль, поток после урока, вкладки. Основные состояния — по одному-два теста на экран.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { generateQrCard } from "@teletau/auth-codes";
import { createRequire } from "node:module";
import { childMe, adultMe, mockBackend, qrPhoto } from "./mock-api";
import { CURRENT_NODE, LESSON_ID, learnWorld } from "./mock-learn";
import { settleAnimations } from "./settle";

const tokens = createRequire(import.meta.url)("@teletau/design-tokens/tokens.json") as { dark: Record<string, string>; light: Record<string, string> };
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectAccessible(page: Page, label: string, disable: string[] = []) {
  await settleAnimations(page);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).disableRules(disable).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

async function openTrail(page: Page) {
  await page.goto("/learn");
  await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
}

/** Урок начинается с карточек «Новое слово» (мәктәп, барам) — пролистать их «Дальше». */
async function pastNewWords(page: Page, n = 2) {
  for (let i = 0; i < n; i++) {
    await expect(page.getByRole("heading", { name: "Новое слово" })).toBeVisible();
    await page.getByRole("button", { name: "Дальше" }).click();
  }
}

test.describe("M2: тропа", () => {
  test("после повторного входа по карточке ученик сразу на тропе: экспедиция, узлы по состояниям, места с lang=ba", async ({ page }) => {
    await mockBackend(page, { qr: { ok: true, account: childMe() } });
    await page.goto("/student");
    await page.getByLabel("Фото карточки").setInputFiles(await qrPhoto(generateQrCard().payload));
    await page.waitForURL("**/learn");
    await expect(page.getByRole("heading", { name: /Өфө/ })).toBeVisible();
    await expect(page.locator("#unit-head-title [lang=ba]")).toHaveText("Өфө");
    await expect(page.getByRole("button", { name: "Урок «Привет!», пройден" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Урок «Моя школа» — начать" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Урок «Вежливые слова», закрыт" })).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(".place-sign__name [lang=ba]").first()).toHaveText("Шүлгәнташ");
    await expect(page.getByText("Серия: 5 дней подряд")).toBeAttached();
    // target-size: узлы под липкой нижней навигацией axe считает «частично закрытыми» — это прокрутка, а не размер.
    // Размер проверяем сами: каждый узел — не меньше 44×44 (фактически 78×75).
    await expectAccessible(page, "тропа", ["target-size"]);
    const nodes = await page.locator(".tt-node").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
    expect(nodes.length).toBeGreaterThan(10);
    expect(nodes.every((r) => r.width >= 44 && r.height >= 44)).toBe(true);
  });

  test("курс из 6 мест: шапка текущего места, вывески и декорации мест 4–6, в конце — «Впереди ещё 5 мест»", async ({ page }) => {
    await mockBackend(page, { account: childMe() });
    await openTrail(page);
    await expect(page.getByRole("heading", { level: 1, name: /Өфө/ })).toBeVisible();
    for (const name of ["Гора Ямантау", "Башкирская деревня", "Сабантуй"]) await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    // Вывеска места — картинка из illustrations.ts по slug; декорации — в SVG под узлами.
    for (const slug of ["yamantau", "village", "sabantuy"]) {
      await expect(page.locator(`.place-sign__art[src*="place-${slug}-sign"]`)).toHaveCount(1);
      expect(await page.locator(`.track__deco[href*="deco-${slug}-"]`).count()).toBeGreaterThanOrEqual(6);
    }
    await expect(page.getByText("Впереди ещё 5 мест")).toBeVisible();
  });

  test("«Впереди ещё N мест» — по месту ученика, а не по открытости контента: открытый юнит 2 тоже впереди", async ({ page }) => {
    const learn = learnWorld();
    learn.course.units[1]!.state = "open";
    await mockBackend(page, { account: childMe(), learn });
    await openTrail(page);
    await expect(page.getByRole("heading", { level: 1, name: /Өфө/ })).toBeVisible();
    await expect(page.getByText("Впереди ещё 5 мест")).toBeVisible();
  });

  test("первый вход (выбор ника) — «Ты в классе» с кнопкой «На тропу»", async ({ page }) => {
    await mockBackend(page, { account: childMe({ nickname: undefined }) });
    await page.goto("/student/nickname");
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Выбрать" }).click();
    await expect(page.getByRole("heading", { name: "Ты в классе 5 «Б»" })).toBeVisible();
    await page.getByRole("link", { name: "На тропу" }).click();
    await page.waitForURL("**/learn");
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
  });

  test("закрытый узел объясняет, что пройти сначала; урок не начинается", async ({ page }) => {
    const w = await mockBackend(page, { account: childMe() });
    await openTrail(page);
    await page.getByRole("button", { name: "Урок «Вежливые слова», закрыт" }).click({ force: true });
    await expect(page.getByRole("status").filter({ hasText: "Сначала пройди «Моя школа»" })).toBeAttached();
    await expect(page.locator(".track__hint")).toHaveText("Сначала пройди «Моя школа»");
    expect(w.learn.runs).toHaveLength(0);
  });

  test("первый заход: знакомство с пчелой в два шага, «Начать урок» сразу открывает урок; второй раз — без него", async ({ page }) => {
    const learn = learnWorld();
    learn.course.units[0]!.nodes.forEach((n, i) => (n.state = i === 0 ? "current" : "locked"));
    learn.progress = { ...learn.progress, lessonsCompleted: 0 };
    await mockBackend(page, { account: childMe(), learn });
    await page.goto("/learn");
    const intro = page.getByRole("dialog", { name: "Привет! Я пчела" });
    await expect(intro).toBeVisible();
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeAttached();
    await expectAccessible(page, "знакомство");
    await intro.getByRole("button", { name: "Дальше" }).click();
    const goal = page.getByRole("dialog", { name: "Урок — сота мёда" });
    await expect(goal).toContainText("Цель дня — 2 соты");
    await goal.getByRole("button", { name: "Начать урок" }).click();
    await expect(page.getByRole("heading", { name: "Новое слово" })).toBeVisible();
    await page.getByRole("button", { name: "Выйти из урока" }).click();
    await page.getByRole("dialog", { name: "Уже уходишь?" }).getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("нет сети — «Нет связи», сеть вернулась — «Попробовать снова» открывает тропу", async ({ page }) => {
    const w = await mockBackend(page, { account: childMe(), failures: { "GET /course": "offline" } });
    await page.goto("/learn");
    await expect(page.getByRole("heading", { name: "Нет связи" })).toBeVisible();
    delete w.failures["GET /course"];
    await page.getByRole("button", { name: "Попробовать снова" }).click();
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
  });
});

test.describe("M2: урок", () => {
  test("новые слова → плитки с подсказкой (верно) → выбор (неверно, вернётся в конце) → новое слово → ввод («почти») → дуэль → повтор → итог → серия → лига → узел запечатан", async ({ page }) => {
    const w = await mockBackend(page, { account: childMe() });
    await openTrail(page);
    await page.getByRole("button", { name: CURRENT_NODE }).click();

    // «Новое слово»: сначала показываем — слово (lang=ba), «Послушать» (есть запись), перевод; проверки нет.
    await expect(page.getByRole("heading", { name: "Новое слово" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Новое слово" })).toBeFocused();
    const word = page.locator(".newword__word");
    await expect(word).toHaveText("мәктәп");
    await expect(word).toHaveAttribute("lang", "ba");
    await expect(page.locator(".newword__ru")).toHaveText("школа");
    await expect(page.getByRole("button", { name: "Послушать" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Проверить" })).toHaveCount(0);
    await expectAccessible(page, "новое слово");
    await page.getByRole("button", { name: "Дальше" }).click();
    // Второе слово — без записи: кнопки «Послушать» нет. Enter — «Дальше».
    await expect(word).toHaveText("барам");
    await expect(page.locator(".newword__ru")).toHaveText("иду");
    await expect(page.getByRole("button", { name: "Послушать" })).toHaveCount(0);
    await page.keyboard.press("Enter");

    // Плитки: «Проверить» недоступна, пока ответ пуст.
    await expect(page.getByRole("heading", { name: "Переведи на башкирский" })).toBeVisible();
    // Подсказка: слово условия с пунктиром — нажатие показывает перевод из словаря; Escape и нажатие мимо закрывают.
    const prompt = page.locator(".prompt__bubble");
    await expect(prompt).toHaveText("Я иду в школу.");
    await prompt.getByRole("button", { name: "иду", exact: true }).click();
    const tip = page.getByRole("tooltip");
    await expect(tip).toHaveText("барам");
    await expect(tip.locator("[lang=ba]")).toHaveText("барам");
    await expect(prompt.getByRole("button", { name: "иду", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expectAccessible(page, "подсказка к слову");
    await page.keyboard.press("Escape");
    await expect(tip).toHaveCount(0);
    // С клавиатуры: Tab (Shift+Tab) до слова и Enter; второе нажатие закрывает.
    await page.keyboard.press("Shift+Tab");
    await expect(prompt.getByRole("button", { name: "Я", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(tip).toHaveText("Мин");
    await page.keyboard.press("Enter");
    await expect(tip).toHaveCount(0);
    await prompt.getByRole("button", { name: "иду", exact: true }).click();
    await page.getByRole("heading", { name: "Переведи на башкирский" }).click();
    await expect(tip).toHaveCount(0);
    const check = page.getByRole("button", { name: "Проверить" });
    await expect(check).toBeDisabled();
    const bank = page.getByRole("group", { name: "Слова" });
    await expect(bank.getByRole("button", { name: "мәктәпкә" })).toHaveAttribute("lang", "ba");
    for (const word of ["Мин", "мәктәпкә", "барам"]) await bank.getByRole("button", { name: word, exact: true }).click();
    await check.click();
    await expect(page.getByRole("heading", { name: "Верно!" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Дальше" })).toBeFocused();
    await page.keyboard.press("Enter");

    // Выбор: клавиша 2 — «Спасибо», Enter — проверить.
    await expect(page.getByRole("heading", { name: "Что значит это слово?" })).toBeVisible();
    await expect(page.locator(".word-card__text")).toHaveAttribute("lang", "ba");
    await page.keyboard.press("2");
    await expect(page.getByRole("radio", { name: "Спасибо" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Пока не так" })).toBeVisible();
    await expect(page.getByText("Повторим в конце урока.")).toBeVisible();
    await page.getByRole("button", { name: "Дальше" }).click();

    // Новое слово перед вводом — «Рәхмәт!».
    await expect(page.getByRole("heading", { name: "Новое слово" })).toBeVisible();
    await expect(word).toHaveText("Рәхмәт!");
    await page.getByRole("button", { name: "Дальше" }).click();

    // У ввода «Спасибо!» подсказки нет — она выдала бы ответ целиком.
    await expect(page.locator(".prompt__bubble").getByRole("button")).toHaveCount(0);
    // Ввод: «Р» + буква с панели «ә» + «хмат!» — без особой буквы во втором слоге — «Почти».
    const field = page.getByRole("textbox");
    await field.fill("Р");
    await page.getByRole("group", { name: "Башкирские буквы" }).getByRole("button", { name: "ә" }).click();
    await expect(field).toBeFocused();
    await field.press("End");
    await field.pressSequentially("хмат!");
    await expect(field).toHaveValue("Рәхмат!");
    await field.press("Enter");
    await expect(page.getByRole("heading", { name: "Почти!" })).toBeVisible();
    await expect(page.locator(".tt-sheet mark").first()).toHaveText("ә");
    await page.getByRole("button", { name: "Дальше" }).click();

    // Дуэль: клавиша 1 — вариант A, «Отдать голос» → «Голос учтён».
    await expect(page.getByRole("heading", { name: "Какой перевод лучше?" })).toBeVisible();
    await page.keyboard.press("1");
    await page.getByRole("button", { name: "Отдать голос" }).click();
    await expect(page.getByRole("heading", { name: "Голос учтён" })).toBeVisible();
    await page.getByRole("button", { name: "Дальше" }).click();

    // Ошибка вернулась в конце — с меткой «Ещё раз».
    await expect(page.getByText("Ещё раз")).toBeVisible();
    await page.getByRole("radio", { name: "Привет!" }).click();
    await page.getByRole("button", { name: "Проверить" }).click();
    await page.getByRole("button", { name: "Дальше" }).click();

    await expect(page.getByRole("heading", { name: "Урок пройден!" })).toBeVisible();
    await expect(page.getByText("Знакомство · урок 3")).toBeVisible();
    await expect(page.locator(".new-words [lang=ba]")).toHaveText(["мәктәп", "барам", "рәхмәт"]);
    await expectAccessible(page, "итог урока");
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page.getByRole("heading", { name: "6 дней подряд" })).toBeVisible();
    await expect(page.getByText("2 заморозки в запасе")).toBeVisible();
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page.getByRole("heading", { name: "Новая лига — Кипрей!" })).toBeVisible();
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page.getByRole("button", { name: "Урок «Моя школа», пройден" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Урок «Вежливые слова» — начать" })).toBeVisible();

    // Ответы ушли по контракту: плитки — id, выбор — id варианта, ввод — текст, дуэль — сторона; на карточки «Новое
    // слово» ответов нет. Урок начат с accepts: [word_intro]; итог лиги отмечен.
    const answers = w.learn.attempts.map((a) => a.body.answer);
    expect(answers).toEqual([
      { type: "tiles", tileIds: ["t5", "t3", "t1"] },
      { type: "choice", optionId: "o2" },
      { type: "text", text: "Рәхмат!" },
      { type: "duel", choice: "a" },
      { type: "choice", optionId: "o1" },
    ]);
    expect(new Set(w.learn.attempts.map((a) => a.body.attemptId)).size).toBe(5);
    // К плиткам открывали две подсказки («иду» и «Я», «иду» — дважды): hintsUsed — число разных подсказок; у остальных
    // ответов поля нет (подсказок не открывали).
    expect(w.learn.attempts.map((a) => a.body.hintsUsed)).toEqual([2, undefined, undefined, undefined, undefined]);
    expect(w.learn.runs).toEqual([{ lessonId: LESSON_ID, runId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7/), accepts: ["word_intro"] }]);
    expect(w.learn.resultSeen).toEqual(["2026-11-02"]);
  });

  test("объяснение ошибки (GigaChat): у взрослого «Почему так?» даёт текст ИИ с меткой, у ребёнка — шаблон без метки", async ({ page }) => {
    // Взрослый самоучка: подсказку готовит GigaChat (source ai) — текст с честной меткой «Подсказку подготовил ИИ».
    await mockBackend(page, { account: adultMe({ roles: ["student"], teacherStatus: "none", classes: [] }) });
    await page.goto("/learn");
    // Взрослый после входа выбирает путь («Учиться» / «Я учитель») — нам на тропу ученика.
    await page.getByRole("button", { name: "Учиться" }).click();
    // У взрослого нет ника — сначала выбор: ник → тропа (как в miniapp.spec.ts).
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Начать" }).click();
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
    await page.getByRole("button", { name: CURRENT_NODE }).click();
    await pastNewWords(page);
    // Плитки в неверном порядке — «Пока не так».
    const bank = page.getByRole("group", { name: "Слова" });
    for (const word of ["мәктәпкә", "Мин", "барам"]) await bank.getByRole("button", { name: word, exact: true }).click();
    await page.getByRole("button", { name: "Проверить" }).click();
    await expect(page.getByRole("heading", { name: "Пока не так" })).toBeVisible();
    await page.getByRole("button", { name: "Почему так?" }).click();
    await expect(page.locator(".feedback-explain__text")).toContainText("Мин мәктәпкә барам.");
    await expect(page.locator(".feedback-explain__ai")).toContainText("Подсказку подготовил ИИ · GigaChat");
    await expectAccessible(page, "лист с объяснением ошибки");
    await page.getByRole("button", { name: "Дальше" }).click();
  });

  test("объяснение ошибки: ребёнку — шаблон без вызова GigaChat (без метки ИИ)", async ({ page }) => {
    await mockBackend(page, { account: childMe() });
    await openTrail(page);
    await page.getByRole("button", { name: CURRENT_NODE }).click();
    await pastNewWords(page);
    const bank = page.getByRole("group", { name: "Слова" });
    for (const word of ["мәктәпкә", "Мин", "барам"]) await bank.getByRole("button", { name: word, exact: true }).click();
    await page.getByRole("button", { name: "Проверить" }).click();
    await expect(page.getByRole("heading", { name: "Пока не так" })).toBeVisible();
    await page.getByRole("button", { name: "Почему так?" }).click();
    await expect(page.locator(".feedback-explain__text")).toContainText("вернётся в конце урока");
    await expect(page.locator(".feedback-explain__ai")).toHaveCount(0);
    await page.getByRole("button", { name: "Дальше" }).click();
  });

  test("всё неверно: упражнение возвращается один раз, после второй ошибки — верный ответ и дальше; урок завершается", async ({ page }) => {
    const w = await mockBackend(page, { account: childMe() });
    await openTrail(page);
    await page.getByRole("button", { name: CURRENT_NODE }).click();
    const done = page.getByRole("heading", { name: "Урок пройден!" });
    const newWord = page.getByRole("heading", { name: "Новое слово" });
    const check = page.getByRole("button", { name: /^(Проверить|Отдать голос)$/ });
    const notes: string[] = [];
    let steps = 0;
    for (; steps < 20; steps++) {
      await expect(check.or(done).or(newWord)).toBeVisible();
      if (await done.isVisible()) break;
      if (await newWord.isVisible()) {
        await page.getByRole("button", { name: "Дальше" }).click();
        continue;
      }
      const again = await page.locator("main").getByText("Ещё раз", { exact: true }).isVisible();
      const title = (await page.locator("main h1").first().textContent()) ?? "";
      if (title.startsWith("Какой перевод")) await page.keyboard.press("1");
      else if (title.startsWith("Что значит")) await page.getByRole("radio", { name: "Спасибо" }).click();
      else if (await page.getByRole("textbox").isVisible()) await page.getByRole("textbox").fill("ыыы");
      else await page.getByRole("group", { name: "Слова" }).getByRole("button", { name: "Һин", exact: true }).click();
      await check.click();
      const sheet = page.locator(".tt-sheet");
      await expect(sheet.getByRole("button", { name: "Дальше" })).toBeVisible();
      const extra = sheet.locator(".feedback-extra");
      const note = (await extra.count()) ? ((await extra.textContent()) ?? "") : "—";
      notes.push(`${again ? "ещё раз: " : ""}${note}`);
      await sheet.getByRole("button", { name: "Дальше" }).click();
    }
    await expect(done).toBeVisible();
    // Плитки, выбор, ввод — по два показа (сервер: retry только после первой ошибки), дуэль — один; 3 карточки + 7 ответов.
    expect(steps).toBe(10);
    const shows: Record<string, number> = {};
    for (const a of w.learn.attempts) shows[a.body.exerciseId] = (shows[a.body.exerciseId] ?? 0) + 1;
    expect(shows).toEqual({ "e-tiles": 2, "e-choice": 2, "e-free": 2, "e-duel": 1 });
    expect(w.learn.attempts.map((a) => a.result.retry)).toEqual([true, true, true, false, false, false, false]);
    expect(notes).toEqual([
      "Повторим в конце урока.",
      "Повторим в конце урока.",
      "Повторим в конце урока.",
      "—",
      "ещё раз: —",
      "ещё раз: —",
      "ещё раз: —",
    ]);
    expect(w.learn.completes).toHaveLength(1);
  });

  test("«Назад» в уроке спрашивает «Уже уходишь?»: «Остаться» — урок, «Выйти» — тропа", async ({ page }) => {
    await mockBackend(page, { account: childMe() });
    await openTrail(page);
    await page.getByRole("button", { name: CURRENT_NODE }).click();
    // Фокус (не просто видимость): заголовок в SSR-разметке есть и до гидратации, а фокус эффект ставит уже
    // после — запись истории листа («Назад» = «Уже уходишь?») к этому моменту точно запушена.
    await expect(page.getByRole("heading", { name: "Новое слово" })).toBeFocused();
    await page.goBack();
    const dialog = page.getByRole("dialog", { name: "Уже уходишь?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Остаться" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: "Новое слово" })).toBeVisible();
    await page.getByRole("button", { name: "Выйти из урока" }).click();
    await page.getByRole("dialog", { name: "Уже уходишь?" }).getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
    expect(page.url()).toMatch(/\/learn$/);
  });

  test("ответ не дошёл до сервера — сообщение, повтор с тем же attemptId", async ({ page }) => {
    const w = await mockBackend(page, { account: childMe() });
    await openTrail(page);
    await page.getByRole("button", { name: CURRENT_NODE }).click();
    await pastNewWords(page);
    const bank = page.getByRole("group", { name: "Слова" });
    for (const word of ["Мин", "мәктәпкә", "барам"]) await bank.getByRole("button", { name: word, exact: true }).click();
    const runId = () => w.learn.runs[0]!.runId;
    await expect.poll(() => w.learn.runs.length).toBe(1);
    w.failures[`POST /lesson-runs/${runId()}/attempts`] = "offline";
    await page.getByRole("button", { name: "Проверить" }).click();
    await expect(page.getByText("Нет связи. Нажми «Проверить» ещё раз.")).toBeVisible();
    delete w.failures[`POST /lesson-runs/${runId()}/attempts`];
    await page.getByRole("button", { name: "Проверить" }).click();
    await expect(page.getByRole("heading", { name: "Верно!" })).toBeVisible();
    expect(w.learn.attempts).toHaveLength(1);
  });

  test("«Помоги языку» без дуэлей — «Все пары уже оценены» и обратно на тропу", async ({ page }) => {
    await mockBackend(page, { account: childMe() });
    await openTrail(page);
    await page.getByRole("button", { name: "Помоги языку, пройден" }).click();
    await expect(page.getByRole("heading", { name: "Все пары уже оценены" })).toBeVisible();
    await page.getByRole("button", { name: "На тропу" }).click();
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
  });

  test("режим «Пчёлка»: пчела на карточке нового слова, подсказка крупная, плитки и буквы панели не меньше 56 px", async ({ page }) => {
    await mockBackend(page, { account: childMe({ uiMode: "bee" }) });
    await openTrail(page);
    await page.getByRole("button", { name: CURRENT_NODE }).click();
    await expect(page.locator(".newword__bee")).toBeVisible();
    await pastNewWords(page);
    await page.locator(".prompt__bubble").getByRole("button", { name: "иду", exact: true }).click();
    const hintSize = await page.getByRole("tooltip").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(hintSize).toBeGreaterThanOrEqual(26);
    await page.keyboard.press("Escape");
    const tile = await page.getByRole("group", { name: "Слова" }).getByRole("button").first().boundingBox();
    expect(tile!.height).toBeGreaterThanOrEqual(56);
    const bank = page.getByRole("group", { name: "Слова" });
    for (const word of ["Мин", "мәктәпкә", "барам"]) await bank.getByRole("button", { name: word, exact: true }).click();
    await page.getByRole("button", { name: "Проверить" }).click();
    await page.getByRole("button", { name: "Дальше" }).click();
    await page.getByRole("radio", { name: "Привет!" }).click();
    await page.getByRole("button", { name: "Проверить" }).click();
    await page.getByRole("button", { name: "Дальше" }).click();
    await pastNewWords(page, 1);
    const letters = await page.getByRole("group", { name: "Башкирские буквы" }).getByRole("button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
    expect(letters.every((r) => r.height >= 56 && r.width >= 56)).toBe(true);
  });
});

test.describe("M2: вкладки", () => {
  test("«Лига»: тир, зоны повышения и понижения, «ты» — по контракту; навигация по вкладкам", async ({ page }) => {
    await mockBackend(page, { account: childMe() });
    await page.goto("/league");
    await expect(page.getByRole("heading", { name: "Лига Донника" })).toBeVisible();
    await expect(page.getByText("Первые 5 перейдут в Лигу Кипрея.")).toBeVisible();
    const board = page.getByRole("list", { name: "Лига Донника: участники недели" });
    await expect(board.locator("[aria-current=true]")).toContainText("Смелая пчела");
    await expect(board.locator(".tt-lzone--up")).toHaveText("Зона повышения");
    await expect(board.locator(".tt-lzone--down")).toHaveText("Зона понижения");
    await expect(page.getByRole("link", { name: "Лига" })).toHaveAttribute("aria-current", "page");
    await expectAccessible(page, "лига");
    await page.getByRole("link", { name: "Класс" }).click();
    await expect(page.getByRole("heading", { name: "Улей 5 «Б»" })).toBeVisible();
    await expect(page.getByText("Занимались 18 из 24")).toBeVisible();
    await expectAccessible(page, "улей класса");
    await page.getByRole("link", { name: "Профиль" }).click();
    await expect(page.getByRole("heading", { name: "Смелая пчела" })).toBeVisible();
    await expect(page.getByText("7 в словаре", { exact: false })).toBeVisible();
    await expectAccessible(page, "профиль");
    await page.getByRole("link", { name: "Путь" }).click();
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
  });

  test("аватары ников по существительному; в зоне повышения — «Ты в зоне повышения»", async ({ page }) => {
    await mockBackend(page, { account: childMe() });
    await page.goto("/league");
    const board = page.getByRole("list", { name: "Лига Донника: участники недели" });
    await expect(board.locator("[aria-current=true] image")).toHaveAttribute("href", /avatar-bee\.[^/]*webp/);
    // «Сонный ёжик»: слова «ёжик» в словаре нет — цветная ячейка без картинки.
    await expect(board.getByRole("listitem").filter({ hasText: "Сонный ёжик" }).locator("image")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Ты в зоне повышения" })).toBeVisible();
    await expect(page.getByText("Удержи место до конца недели.")).toBeVisible();
  });

  test("«Мёд созрел!»: первый заход в профиль только запоминает, после созревания — плашка с мёдом", async ({ page }) => {
    const w = await mockBackend(page, { account: childMe() });
    await page.goto("/me");
    await expect(page.getByRole("heading", { name: "Мой вклад в словарь" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Мёд созрел!" })).toHaveCount(0);
    w.learn.cells.summary = { ...w.learn.cells.summary, matured: 8, pending: 4, honeyFinal: 22, honeyPending: 12 };
    await page.reload();
    await expect(page.getByRole("heading", { name: "Мёд созрел!" })).toBeVisible();
    await expect(page.getByText("1 перевод с твоим голосом вошёл в словарь · +3 мёда")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Мой вклад в словарь" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Мёд созрел!" })).toHaveCount(0);
  });

  test("«Звуки» в профиле: выключатель запоминается на устройстве", async ({ page }) => {
    await mockBackend(page, { account: childMe() });
    await page.goto("/me");
    const sounds = page.getByRole("switch", { name: "Звуки" });
    await expect(sounds).toHaveAttribute("aria-checked", "true");
    await sounds.click();
    await expect(sounds).toHaveAttribute("aria-checked", "false");
    await page.reload();
    await expect(page.getByRole("switch", { name: "Звуки" })).toHaveAttribute("aria-checked", "false");
  });

  test("«Тёмная тема» в профиле: включает тему сразу и после перезагрузки (тема ставится сервером, без вспышки)", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await mockBackend(page, { account: childMe() });
    await page.goto("/me");
    const html = page.locator("html");
    const dark = page.getByRole("switch", { name: "Тёмная тема" });
    await expect(dark).toHaveAttribute("aria-checked", "false");
    await expect(html).not.toHaveAttribute("data-theme", /./);
    await dark.click();
    await expect(dark).toHaveAttribute("aria-checked", "true");
    await expect(html).toHaveAttribute("data-theme", "dark");
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const darkBg = await bg();
    // HTML с сервера уже с data-theme="dark": тема из cookie, а не из скрипта после загрузки.
    const res = await page.request.get("/me");
    expect(await res.text()).toMatch(/<html[^>]*data-theme="dark"/);
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("switch", { name: "Тёмная тема" })).toHaveAttribute("aria-checked", "true");
    expect(await bg()).toBe(darkBg);
    await page.getByRole("switch", { name: "Тёмная тема" }).click();
    await expect(html).toHaveAttribute("data-theme", "light");
    expect(await bg()).not.toBe(darkBg);
  });

  test("«Тёмная тема» без выбора — светлая, даже в тёмной системе: выключатель выключен, фон и панель браузера светлые", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await mockBackend(page, { account: childMe() });
    await page.goto("/me");
    await expect(page.getByRole("switch", { name: "Тёмная тема" })).toHaveAttribute("aria-checked", "false");
    const html = page.locator("html");
    await expect(html).not.toHaveAttribute("data-theme", /./);
    const root = await html.evaluate((el) => {
      const style = getComputedStyle(el);
      return { bg: style.getPropertyValue("--tt-color-bg").trim().toUpperCase(), scheme: style.colorScheme };
    });
    expect(root).toEqual({ bg: tokens.light["color.bg"]!.toUpperCase(), scheme: "light" });
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", tokens.light["color.bg"]!);
  });

  test("лига пуста до первых очков недели — приглашение на тропу", async ({ page }) => {
    const learn = learnWorld();
    learn.league = { ...learn.league, members: [], me: undefined };
    await mockBackend(page, { account: childMe(), learn });
    await page.goto("/league");
    await expect(page.getByRole("heading", { name: "Лига ждёт тебя" })).toBeVisible();
    await expect(page.getByRole("link", { name: "На тропу" })).toHaveAttribute("href", "/learn");
  });
});
