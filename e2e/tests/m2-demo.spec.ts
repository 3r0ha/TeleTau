// Главный путь показа (docs/demo/M2.md, шаги 1–6) против настоящего стека и демо-мира сида (src/demo/seed.ts).
// Ученик (телефон): вход по фото карточки → тропа → урок «Моя школа»: карточки «Новое слово» перед упражнениями
// (веб просит accepts: [word_intro], слова урока ученик ещё не встречал), плитки, ошибка в выборе, «Почти!» в вводе,
// дуэль → «Голос учтён» → повтор ошибки → итог с мёдом → серия → «Новая лига» → узел запечатан → вкладки. Учитель
// (ноутбук): вход по демо-коду → класс → «Прогресс» (ученик №07 сегодня) → «Помогите языку» — та же дуэль → голос →
// «Пару приняли» и голоса по группам. Ученик: в «Моём вкладе» вариант «созрел», мёд за голос начислен.
// Повторы (`--repeat-each`): у каждого повтора свой мир сида — свои учитель, класс, ученик и пара дуэли (голоса
// неизменяемы, принятая пара второй раз «Пару приняли» не станет).
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import QRCode from "qrcode";
import { stack } from "../support/env.js";
import { expectAccessible, heading, newWordHeading, passNewWord } from "../support/stack.js";

interface AnswerRow {
  type: "tiles_ru_ba" | "choice_ba_ru" | "free_ru_ba" | "match_pairs";
  prompt: string;
  answer: string[];
  almost?: string;
  wrong?: string;
}
interface World {
  index: number;
  teacher: { email: string; fullName: string; code: string };
  class: { id: string; title: string; school: string; seats: number };
  student: { seat: number; nickname: string; card: string };
  lesson: { id: string; titleRu: string; answers: AnswerRow[] };
  duel: { itemId: string; sourceRu: string; variants: [string, string] };
  expect: { streakBefore: number; freezes: number; lessonsBefore: number; leagueUp: string | null; activeAfter: number; seatsTotal: number };
  /** Задание учителя классу (ADR 0021) — урок показа; только в основном мире. */
  assignment?: { titleRu: string; dueOn: string; done: number; total: number };
}

const TIER = { clover: "Клевер", buckwheat: "Гречиха", sweetclover: "Донник", fireweed: "Кипрей", linden: "Липа" } as Record<string, string>;
const plural = (n: number, [one, few, many]: [string, string, string]) => {
  const d = n % 10;
  const h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};
const days = (n: number) => plural(n, ["день", "дня", "дней"]);
const seatLabel = (n: number) => `№${String(n).padStart(2, "0")}`;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function world(index: number): World {
  const worlds = (JSON.parse(readFileSync(stack().worldFile, "utf8")) as { worlds: World[] }).worlds;
  const w = worlds[index];
  if (!w) throw new Error(`e2e: в демо-мире ${worlds.length} миров — повторов m2-demo не больше (pnpm e2e --repeat-each=${worlds.length})`);
  return w;
}

async function newPage(browser: Browser, kind: "phone" | "laptop"): Promise<Page> {
  const s = stack();
  const context = await browser.newContext({
    baseURL: s.webUrl,
    locale: "ru-RU",
    timezoneId: "Asia/Yekaterinburg",
    ...(kind === "phone" ? { viewport: { width: 390, height: 844 }, hasTouch: true } : { viewport: { width: 1280, height: 800 } }),
  });
  return context.newPage();
}

/** Ответ на текущее упражнение урока по шпаргалке мира: `mode` — верно, ошибка или «почти». */
async function answer(page: Page, w: World, mode: "right" | "wrong" | "almost"): Promise<AnswerRow["type"] | "duel"> {
  const main = page.locator("main");
  const title = (await main.getByRole("heading").first().textContent()) ?? "";
  if (/Переведи на башкирский/.test(title)) {
    const prompt = (await main.locator(".prompt__bubble").textContent())!.trim();
    const row = w.lesson.answers.find((a) => a.type === "tiles_ru_ba" && a.prompt === prompt)!;
    const words = mode === "wrong" ? [...row.answer].reverse() : row.answer;
    for (const word of words) await main.getByRole("group", { name: "Слова" }).getByRole("button", { name: word, exact: true }).click();
    return "tiles_ru_ba";
  }
  if (/Что значит это слово/.test(title)) {
    const prompt = (await main.locator(".word-card").textContent())!.trim();
    const row = w.lesson.answers.find((a) => a.type === "choice_ba_ru" && a.prompt === prompt)!;
    await main.getByRole("radio", { name: new RegExp(escapeRe(mode === "wrong" ? row.wrong! : row.answer[0]!)) }).click();
    return "choice_ba_ru";
  }
  if (/Напиши по-башкирски/.test(title)) {
    const box = main.getByRole("textbox");
    const prompt = (await box.getAttribute("aria-label"))!.replace(/^Перевод на башкирский: /, "");
    const row = w.lesson.answers.find((a) => a.type === "free_ru_ba" && a.prompt === prompt)!;
    await box.fill(mode === "almost" && row.almost ? row.almost : mode === "wrong" ? prompt : row.answer[0]!);
    return "free_ru_ba";
  }
  if (/Соедини пары/.test(title)) {
    // Шпаргалка «Пар» — строки «башкирское — перевод» (apps/api/src/demo/answers.ts); «не так» — два перевода перепутаны.
    const pairs = w.lesson.answers.find((a) => a.type === "match_pairs")!.answer.map((line) => line.split(" — ") as [string, string]);
    if (mode === "wrong" && pairs.length > 1) [pairs[0]![1], pairs[1]![1]] = [pairs[1]![1], pairs[0]![1]];
    for (const [ba, ru] of pairs) {
      await main.getByRole("list", { name: "Слова" }).getByRole("button", { name: ba, exact: true }).click();
      await main.getByRole("list", { name: "Переводы" }).getByRole("button", { name: ru, exact: true }).click();
    }
    return "match_pairs";
  }
  await expect(main.getByRole("heading", { name: "Какой перевод лучше?" })).toBeVisible();
  await expect(main.getByText(w.duel.sourceRu, { exact: true })).toBeVisible();
  await main.getByRole("radio", { name: new RegExp(escapeRe(w.duel.variants[0])) }).click();
  return "duel";
}

/** «Мой вклад в словарь»: сколько вариантов созрело и сколько ждут. */
async function myCells(page: Page): Promise<{ matured: number; pending: number }> {
  await page.goto("/me");
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Мой вклад в словарь" }) });
  await expect(card.getByText(/в словаре/)).toBeVisible({ timeout: 15_000 });
  const text = (await card.textContent()) ?? "";
  const matured = Number(/(\d+) в словаре/.exec(text)?.[1] ?? NaN);
  const pending = Number(/(\d+) жд(ёт|ут) итога/.exec(text)?.[1] ?? 0);
  return { matured, pending };
}

test("демо M2: урок с дуэлью → итог, серия, лига → учитель: прогресс и голос «Пару приняли» → у ученика созрел мёд", async ({ browser }, info) => {
  const w = world(info.repeatEachIndex);
  const s = stack();
  const student = await newPage(browser, "phone");
  const teacher = await newPage(browser, "laptop");
  const problems: string[] = [];
  for (const p of [student, teacher]) p.on("response", (r) => r.url().startsWith(`${s.apiUrl}/api/v1/`) && r.status() >= 500 && problems.push(`${r.status()} ${r.url()}`));

  // ── шаг 1: вход по карточке → тропа ──
  await test.step(`ученик ${seatLabel(w.student.seat)} · ${w.student.nickname}: фото карточки → тропа`, async () => {
    await student.goto("/student");
    await expect(heading(student, "Покажи карточку камере")).toBeVisible();
    const png = await QRCode.toBuffer(w.student.card, { errorCorrectionLevel: "M", margin: 4, width: 640 });
    await student.getByLabel("Фото карточки").setInputFiles({ name: "card.png", mimeType: "image/png", buffer: png });
    // Ник выбран в сиде — повторный вход ведёт сразу на тропу (экран «Ты в классе» — только при первом входе).
    await student.waitForURL("**/learn");
    await expect(student.getByRole("button", { name: `Урок «${w.lesson.titleRu}» — начать` })).toBeVisible({ timeout: 20_000 });
    await expect(student.getByRole("heading", { name: /Өфө/ }).first()).toBeVisible();
    await expect(student.getByRole("button", { name: /^Помоги языку/ }).first()).toBeVisible();
    // target-size: узлы тропы под липкой нижней навигацией axe считает «частично закрытыми» — это прокрутка, а не размер
    // (как в apps/web/test/e2e/learn.spec.ts).
    await expectAccessible(student, "тропа", ["target-size"]);
  });

  // ── шаг 2: урок ──
  const seen = { tiles_ru_ba: 0, choice_ba_ru: 0, free_ru_ba: 0, match_pairs: 0, duel: 0 };
  let retried = 0;
  let newWords = 0;
  await test.step(`урок «${w.lesson.titleRu}»: новые слова → плитки → ошибка в выборе → «Почти!» → дуэль «Голос учтён» → повтор ошибки`, async () => {
    await student.getByRole("button", { name: `Урок «${w.lesson.titleRu}» — начать` }).click();
    await expect(student.getByRole("button", { name: "Выйти из урока" })).toBeVisible();
    const check = student.getByRole("button", { name: /^(Проверить|Отдать голос)$/ });
    const done = heading(student, /Урок пройден!/);
    for (let step = 0; step < 40 && !(await done.isVisible()); step++) {
      await expect(check.or(done).or(newWordHeading(student))).toBeVisible({ timeout: 15_000 });
      if (await done.isVisible()) break;
      // «Новое слово» — без ответа: посмотрели и дальше (первую карточку проверяет axe).
      if (await newWordHeading(student).isVisible()) {
        if (newWords === 0) await expectAccessible(student, "новое слово");
        if (await passNewWord(student)) newWords++;
        continue;
      }
      const again = await student.locator("main").getByText("Ещё раз").isVisible();
      const title = (await student.locator("main").getByRole("heading").first().textContent()) ?? "";
      const mode = again ? "right" : /Что значит/.test(title) && seen.choice_ba_ru === 0 ? "wrong" : /Напиши/.test(title) && seen.free_ru_ba === 0 ? "almost" : "right";
      const kind = await answer(student, w, mode);
      if (again) retried++;
      else seen[kind]++;
      if (kind === "duel" && seen.duel === 1) await expectAccessible(student, "дуэль в уроке");
      await check.click();
      const sheet = student.getByRole("button", { name: /^(Дальше|Понятно)$/ });
      await expect(sheet).toBeVisible();
      if (kind === "duel") await expect(student.getByText("Голос учтён")).toBeVisible();
      else if (mode === "wrong") await expect(student.getByText("Пока не так")).toBeVisible();
      else if (mode === "almost") await expect(student.getByText("Почти!")).toBeVisible();
      await sheet.click();
    }
    await expect(done).toBeVisible({ timeout: 20_000 });
    expect(seen.duel, "в уроке была дуэль").toBe(1);
    expect(newWords, "урок сначала показал новые слова").toBeGreaterThan(0);
    expect(retried, "ошибочное упражнение вернулось в конце").toBeGreaterThanOrEqual(1);
  });

  // ── шаг 3: итог → серия → новая лига → тропа ──
  await test.step(`итог: мёд, серия ${w.expect.streakBefore + 1}${w.expect.leagueUp ? `, «Новая лига — ${TIER[w.expect.leagueUp]}!»` : ""}, узел запечатан`, async () => {
    // Плитки итога — список определений: «Мёд» → «+N».
    const honey = student.locator('dl[aria-label="Итог урока"] div', { has: student.getByText("Мёд", { exact: true }) }).locator("dd");
    await expect(honey).toHaveText(/^\+\d+$/);
    await expectAccessible(student, "итог урока");
    await student.getByRole("button", { name: "Дальше", exact: true }).click();
    const streak = w.expect.streakBefore + 1;
    await expect(heading(student, `${days(streak)} подряд`)).toBeVisible();
    await expect(student.getByText(String(streak), { exact: true }).first()).toBeVisible();
    await expect(student.getByText(`${w.expect.freezes} ${plural(w.expect.freezes, ["заморозка", "заморозки", "заморозок"])} в запасе`)).toBeVisible();
    await student.getByRole("button", { name: "Дальше", exact: true }).click();
    if (w.expect.leagueUp) {
      await expect(heading(student, `Новая лига — ${TIER[w.expect.leagueUp]}!`)).toBeVisible();
      await expectAccessible(student, "новая лига");
      await student.getByRole("button", { name: "Дальше", exact: true }).click();
    }
    await expect(student.getByRole("button", { name: `Урок «${w.lesson.titleRu}», пройден` })).toBeVisible({ timeout: 15_000 });
    // Урок показа был заданием учителя — оно засчитано.
    if (w.assignment) await expect(student.getByRole("region", { name: `«${w.assignment.titleRu}»` })).toContainText("Задание учителя выполнено");
  });

  // ── шаг 4: вкладки ──
  const before = await test.step("вкладки «Лига», «Класс», «Профиль»", async () => {
    await student.getByRole("link", { name: "Лига", exact: true }).click();
    await student.waitForURL("**/league");
    await expect(student.getByText(w.student.nickname).first()).toBeVisible({ timeout: 15_000 });
    if (w.expect.leagueUp) await expect(heading(student, `Лига ${TIER[w.expect.leagueUp] === "Кипрей" ? "Кипрея" : TIER[w.expect.leagueUp]}`)).toBeVisible();
    await expectAccessible(student, "лига");
    await student.getByRole("link", { name: "Класс", exact: true }).click();
    await student.waitForURL("**/hive");
    await expect(student.getByText(`Занимались ${w.expect.activeAfter} из ${w.expect.seatsTotal}`)).toBeVisible({ timeout: 15_000 });
    await expect(heading(student, "Квест недели")).toBeVisible();
    await expectAccessible(student, "класс");
    const cells = await myCells(student);
    expect(cells.pending, "голос урока ждёт решения").toBeGreaterThanOrEqual(1);
    await expectAccessible(student, "профиль");
    return cells;
  });

  // ── шаг 5: учитель ──
  await test.step(`учитель: вход по ${w.teacher.code} → ${w.class.title} → «Прогресс»`, async () => {
    await teacher.goto("/teacher/login");
    await teacher.getByLabel("Электронная почта").fill(w.teacher.email);
    await teacher.getByRole("button", { name: "Получить код" }).click();
    await teacher.getByLabel("Код из письма: символ 1 из 4").fill(w.teacher.code);
    await teacher.waitForURL("**/teacher");
    await teacher.getByRole("link", { name: new RegExp(escapeRe(w.class.title)) }).first().click();
    await teacher.waitForURL(`**/teacher/classes/${w.class.id}`);
    await teacher.getByRole("navigation", { name: "Разделы класса" }).getByRole("link", { name: "Прогресс" }).click();
    await teacher.waitForURL(`**/teacher/classes/${w.class.id}/progress`);
    await expect(heading(teacher, /^Неделя /)).toBeVisible({ timeout: 15_000 });
    const pupils = teacher.getByRole("table", { name: "Прогресс учеников" });
    const row = pupils.getByRole("row").filter({ hasText: `${seatLabel(w.student.seat)} · ${w.student.nickname}` });
    await expect(row).toContainText(`${w.expect.lessonsBefore + 1} ${plural(w.expect.lessonsBefore + 1, ["урок", "урока", "уроков"])} · сегодня`);
    await expect(row).toContainText(`Серия: ${w.expect.streakBefore + 1} ${days(w.expect.streakBefore + 1)}`);
    await expect(teacher.getByText(`Занимались ${w.expect.activeAfter} из ${w.expect.seatsTotal}`).first()).toBeVisible();
    await expect(heading(teacher, "Прохождение уроков")).toBeVisible();
    await expectAccessible(teacher, "учитель: прогресс класса");
  });

  if (w.assignment) {
    const task = w.assignment;
    await test.step(`учитель: карточка ученика и «Задания» — «${task.titleRu}»: №${String(w.student.seat).padStart(2, "0")} сделал`, async () => {
      await teacher.getByRole("link", { name: `${seatLabel(w.student.seat)} · ${w.student.nickname}` }).click();
      await teacher.waitForURL(`**/teacher/classes/${w.class.id}/seats/${w.student.seat}`);
      await expect(heading(teacher, "Пройденные уроки")).toBeVisible({ timeout: 15_000 });
      await expect(teacher.getByRole("region", { name: "Пройденные уроки" })).toContainText(w.lesson.titleRu);
      await expect(teacher.getByRole("region", { name: "Задания" })).toContainText("сделано");
      await expectAccessible(teacher, "учитель: карточка ученика");
      await teacher.goto(`/teacher/classes/${w.class.id}/assignments`);
      const card = teacher.getByRole("region", { name: `«${task.titleRu}»` });
      await expect(card.getByRole("progressbar", { name: "Сделали" })).toHaveAttribute("aria-valuetext", `${task.done + 1} из ${task.total}`, { timeout: 15_000 });
      await expect(card.getByRole("list", { name: /^Сделали:/ })).toContainText(`${seatLabel(w.student.seat)} ${w.student.nickname}`);
      await expectAccessible(teacher, "учитель: задания класса");
    });
  }

  await test.step(`учитель: «Помогите языку» — та же дуэль «${w.duel.sourceRu}» → голос → «Пару приняли», голоса по группам`, async () => {
    await teacher.getByRole("link", { name: "Помогите языку" }).first().click();
    await teacher.waitForURL("**/teacher/duels");
    await expect(heading(teacher, "Какой перевод лучше?")).toBeVisible({ timeout: 15_000 });
    await expect(teacher.locator("main").getByText(w.duel.sourceRu, { exact: true })).toBeVisible();
    const give = teacher.getByRole("button", { name: "Отдать голос" });
    await expect(give).toBeDisabled();
    await teacher.getByRole("radio", { name: new RegExp(escapeRe(w.duel.variants[0])) }).click();
    const voted = teacher.waitForResponse((r) => r.url().endsWith("/api/v1/corpus/judgments") && r.request().method() === "POST");
    await give.click();
    expect((await voted).status()).toBe(201);
    const results = teacher.getByRole("region", { name: "Голоса по группам" });
    await expect(results.getByRole("status")).toContainText("Пару приняли");
    for (const group of ["Дети", "Взрослые", "Учителя"]) await expect(results.getByText(group, { exact: true })).toBeVisible();
    await expect(results.getByText("Ваш голос")).toBeVisible();
    await expectAccessible(teacher, "учитель: голоса по группам");
  });

  // ── шаг 6: у ученика созрел вариант ──
  await test.step("ученик: в «Моём вкладе» вариант созрел, мёд за голос начислен", async () => {
    const after = await myCells(student);
    expect(after.matured).toBe(before.matured + 1);
    expect(after.pending).toBe(before.pending - 1);
  });

  expect(problems, "ошибки сервера").toEqual([]);
  for (const p of [student, teacher]) await p.context().close();
});
