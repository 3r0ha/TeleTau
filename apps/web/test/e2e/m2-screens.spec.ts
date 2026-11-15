// Снимки экранов ученика для сравнения с утверждённым прототипом (prototypes/trail-expedition/shots/*.webp —
// 390×844 при плотности 2). Запуск: TELETAU_SCREENS=1 pnpm --filter @teletau/web test:a11y -- screens
// Пишет PNG с теми же номерами, что у прототипа, в apps/web/test/screens/m2/ (или TELETAU_SCREENS_DIR/m2).
import { test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { childMe, mockBackend, type World } from "./mock-api";
import { CURRENT_NODE, learnWorld } from "./mock-learn";
import { chooseTheme } from "./theme";

const OUT = resolve(process.env.TELETAU_SCREENS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../screens"), "m2");

test.skip(!process.env.TELETAU_SCREENS, "снимки — только по TELETAU_SCREENS=1");
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

const student = childMe();

async function trail(page: Page) {
  await page.goto("/learn");
  await page.getByRole("button", { name: CURRENT_NODE }).waitFor();
}

/** Прокрутить к месту экспедиции: вывеска юнита — под липким баннером (offset — сколько оставить над ней). */
async function scrollToUnit(page: Page, index: number, offset: number) {
  await page.evaluate(
    ([i, off]) => {
      const el = document.querySelectorAll(".unit")[i]!;
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - off);
    },
    [index, offset] as const,
  );
}

/** Урок открыт: первая карточка «Новое слово» (мәктәп с записью). */
async function newWord(page: Page) {
  await trail(page);
  await page.getByRole("button", { name: CURRENT_NODE }).click();
  await page.getByRole("heading", { name: "Новое слово" }).waitFor();
}

/** Карточка «Новое слово» — «Дальше». */
async function pastNewWord(page: Page) {
  await page.getByRole("heading", { name: "Новое слово" }).waitFor();
  await page.getByRole("button", { name: "Дальше" }).click();
}

/** Урок до плиток: две карточки «Новое слово» пролистаны. */
async function lesson(page: Page) {
  await newWord(page);
  await pastNewWord(page);
  await pastNewWord(page);
  await page.getByRole("heading", { name: "Переведи на башкирский" }).waitFor();
}

/** Плитки: подсказка к слову «иду» открыта. */
async function hint(page: Page) {
  await lesson(page);
  await page.locator(".prompt__bubble").getByRole("button", { name: "иду", exact: true }).click();
  await page.getByRole("tooltip").waitFor();
}

async function tilesOk(page: Page) {
  for (const w of ["Мин", "мәктәпкә", "барам"]) await page.getByRole("group", { name: "Слова" }).getByRole("button", { name: w, exact: true }).click();
  await page.getByRole("button", { name: "Проверить" }).click();
  await page.getByRole("heading", { name: "Верно!" }).waitFor();
}

async function choiceBad(page: Page) {
  await page.getByRole("button", { name: "Дальше" }).click();
  await page.getByRole("radio", { name: "Спасибо" }).click();
  await page.getByRole("button", { name: "Проверить" }).click();
  await page.getByRole("heading", { name: "Пока не так" }).waitFor();
}

async function inputAlmost(page: Page, check = true) {
  await page.getByRole("button", { name: "Дальше" }).click();
  await pastNewWord(page);
  await page.getByRole("heading", { name: "Напиши по-башкирски" }).waitFor();
  if (!check) return;
  await page.getByRole("textbox").fill("Рахмат!");
  await page.getByRole("button", { name: "Проверить" }).click();
  await page.getByRole("heading", { name: "Почти!" }).waitFor();
}

async function duel(page: Page, vote = false) {
  await page.getByRole("button", { name: "Дальше" }).click();
  await page.getByRole("radio", { name: "Хәйерле көн" }).click();
  if (!vote) return;
  await page.getByRole("button", { name: "Отдать голос" }).click();
  await page.getByRole("heading", { name: "Голос учтён" }).waitFor();
}

/** Весь урок: ошибка в выборе возвращается в конце — отвечаем верно и получаем итог. */
async function finish(page: Page) {
  await lesson(page);
  await tilesOk(page);
  await choiceBad(page);
  await inputAlmost(page);
  await duel(page, true);
  await page.getByRole("button", { name: "Дальше" }).click();
  await page.getByRole("radio", { name: "Привет!" }).click();
  await page.getByRole("button", { name: "Проверить" }).click();
  await page.getByRole("button", { name: "Дальше" }).click();
  await page.getByRole("heading", { name: "Урок пройден!" }).waitFor();
}

/** Новый ученик: открыт только первый урок, уроков ещё не было. */
const freshLearn = () => {
  const learn = learnWorld();
  learn.course.units[0]!.nodes.forEach((n, i) => (n.state = i === 0 ? "current" : "locked"));
  learn.progress = { ...learn.progress, lessonsCompleted: 0, honey: { total: 0, pending: 0 } };
  return learn;
};

/** Три верных подряд (плитки, выбор, ввод) — огонёк «3 подряд» на листе «Верно». */
async function finishCombo(page: Page) {
  await lesson(page);
  await tilesOk(page);
  await page.getByRole("button", { name: "Дальше" }).click();
  await page.getByRole("radio", { name: "Привет!" }).click();
  await page.getByRole("button", { name: "Проверить" }).click();
  await page.getByRole("button", { name: "Дальше" }).click();
  await pastNewWord(page);
  await page.getByRole("textbox").fill("Рәхмәт!");
  await page.getByRole("button", { name: "Проверить" }).click();
  await page.getByText("3 подряд").waitFor();
}

/** У ученика 5 слов к повторению. */
const dueLearn = () => {
  const learn = learnWorld();
  learn.course.review = { due: 5 };
  return learn;
};

/** Задание учителя на тропе и 5 слов к повторению — правая колонка компьютера со всеми карточками. */
const taskLearn = () => {
  const learn = dueLearn();
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  learn.course.assignments = [{ id: "0193f7a4-0000-7000-8000-0000000a5001", kind: "lesson", lessonId: "u01-moya-shkola", titleRu: "Моя школа", placeRu: "Уфа", dueOn: due, done: false }];
  return learn;
};

async function reviewStart(page: Page) {
  await trail(page);
  await page.getByRole("button", { name: /^Повторить \d+ \S+ Начать$/ }).click();
  await page.getByRole("heading", { name: "Что значит это слово?" }).waitFor();
}

/** Повторение до «Пар»: выбор и ввод — верно. */
async function reviewToPairs(page: Page) {
  await reviewStart(page);
  await page.getByRole("radio", { name: "Привет!" }).click();
  await page.getByRole("button", { name: "Проверить" }).click();
  await page.getByRole("button", { name: "Дальше" }).click();
  await page.getByRole("textbox").fill("Рәхмәт!");
  await page.getByRole("button", { name: "Проверить" }).click();
  await page.getByRole("button", { name: "Дальше" }).click();
  await page.getByRole("heading", { name: "Соедини пары" }).waitFor();
}

async function pairLink(page: Page, ba: string, ru: string) {
  await page.getByRole("list", { name: "Слова" }).getByRole("button", { name: new RegExp(`^${ba}`) }).click();
  await page.getByRole("list", { name: "Переводы" }).getByRole("button", { name: new RegExp(`^${ru}`) }).click();
}

interface Shot {
  name: string;
  world?: Partial<World>;
  go: (page: Page) => Promise<void>;
  dark?: boolean;
  mode?: "bee" | "keeper";
  width?: number;
  /** Вся страница целиком (тропа со всеми местами). */
  fullPage?: boolean;
  /** Подготовка страницы до перехода (например, что ученик уже видел в профиле). */
  init?: (page: Page) => Promise<void>;
}

const SHOTS: Shot[] = [
  { name: "01-home", go: trail },
  // Липкий баннер юнита: текущий узел в центре — декорации места под баннером не обрезаны.
  {
    name: "02-home-unit-bar",
    go: async (p) => (await trail(p), await p.evaluate(() => document.querySelector('[data-node="u01-moya-shkola"]')?.scrollIntoView({ block: "center" }))),
  },
  { name: "03-home-next-places", go: async (p) => (await trail(p), await scrollToUnit(p, 1, 130)) },
  { name: "04-home-agidel", go: async (p) => (await trail(p), await scrollToUnit(p, 2, 10)) },
  // Места 4–6 (курс версии 2): вывески и декорации Ямантау, деревни и Сабантуя, в конце — «Впереди ещё N мест».
  { name: "04b-home-yamantau", go: async (p) => (await trail(p), await scrollToUnit(p, 3, 10)) },
  { name: "04c-home-village", go: async (p) => (await trail(p), await scrollToUnit(p, 4, 10)) },
  { name: "04d-home-sabantuy", go: async (p) => (await trail(p), await scrollToUnit(p, 5, 10)) },
  { name: "04e-home-path-end", go: async (p) => (await trail(p), await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight))) },
  { name: "34-home-all-places-full", fullPage: true, go: trail },
  { name: "05-lesson-tiles", go: lesson },
  { name: "06-lesson-tiles-ok", go: async (p) => (await lesson(p), await tilesOk(p)) },
  { name: "07-lesson-choice-bad", go: async (p) => (await lesson(p), await tilesOk(p), await choiceBad(p)) },
  { name: "08-lesson-input", go: async (p) => (await lesson(p), await tilesOk(p), await choiceBad(p), await inputAlmost(p, false)) },
  { name: "09-lesson-input-almost", go: async (p) => (await lesson(p), await tilesOk(p), await choiceBad(p), await inputAlmost(p)) },
  { name: "10-lesson-duel", go: async (p) => (await lesson(p), await tilesOk(p), await choiceBad(p), await inputAlmost(p), await duel(p)) },
  { name: "11-lesson-duel-voted", go: async (p) => (await lesson(p), await tilesOk(p), await choiceBad(p), await inputAlmost(p), await duel(p, true)) },
  {
    name: "12-lesson-quit",
    go: async (p) => {
      await lesson(p);
      await p.getByRole("button", { name: "Выйти из урока" }).click();
      await p.getByRole("dialog", { name: "Уже уходишь?" }).waitFor();
    },
  },
  { name: "13-result", go: finish },
  {
    name: "14-streak",
    go: async (p) => {
      await finish(p);
      await p.getByRole("button", { name: "Дальше" }).click();
      await p.getByRole("heading", { name: /подряд/ }).waitFor();
    },
  },
  {
    name: "15-league-up",
    go: async (p) => {
      await finish(p);
      await p.getByRole("button", { name: "Дальше" }).click();
      await p.getByRole("button", { name: "Дальше" }).click();
      await p.getByRole("heading", { name: "Новая лига — Кипрей!" }).waitFor();
    },
  },
  {
    name: "15b-home-sealed",
    go: async (p) => {
      await finish(p);
      await p.getByRole("button", { name: "Дальше" }).click();
      await p.getByRole("button", { name: "Дальше" }).click();
      await p.getByRole("button", { name: "Дальше" }).click();
      await p.getByRole("button", { name: /Вежливые слова/ }).waitFor();
      // Тропа сама показывает запечатанный узел (Trail, sealed) — снимаем то, что видит ученик после урока.
      await p.waitForTimeout(300);
    },
  },
  { name: "16-league", go: async (p) => (await p.goto("/league"), await p.getByRole("heading", { name: "Лига Донника" }).waitFor()) },
  // Доска почёта (ТЗ §4.5): публичный топ школ и классов — данные от мока, как у демо-API; заголовок и секции «Школы»/«Классы» стабильны.
  {
    name: "16b-board",
    go: async (p) => {
      await p.goto("/board");
      await p.getByRole("heading", { name: "Доска почёта", level: 1 }).waitFor();
      await p.getByRole("region", { name: "Школы" }).waitFor();
      await p.getByRole("region", { name: "Классы" }).waitFor();
    },
  },
  { name: "17-class", go: async (p) => (await p.goto("/hive"), await p.getByRole("heading", { name: /Улей 5/ }).waitFor()) },
  { name: "18-profile", go: async (p) => (await p.goto("/me"), await p.getByRole("heading", { name: "Мой вклад в словарь" }).waitFor()) },
  {
    // С прошлого захода созрел ещё один вариант (было 6 из 7, мёда за голоса 16 из 19) — «Мёд созрел!».
    name: "18b-profile-honey-matured",
    init: async (p) => {
      await p.addInitScript((key) => window.localStorage.setItem(key, JSON.stringify({ matured: 6, honey: 16 })), `teletau.cells-seen.${student.id}`);
    },
    go: async (p) => (await p.goto("/me"), await p.getByRole("heading", { name: "Мёд созрел!" }).waitFor()),
  },
  { name: "19-empty-offline", world: { failures: { "GET /course": "offline" } }, go: async (p) => (await p.goto("/learn"), await p.getByRole("heading", { name: "Нет связи" }).waitFor()) },
  {
    name: "20-empty-done",
    world: (() => {
      const learn = learnWorld();
      learn.course.units[0]!.nodes.forEach((n) => (n.state = "done"));
      return { learn };
    })(),
    go: async (p) => (await p.goto("/learn"), await p.getByRole("heading", { name: "На сегодня всё" }).waitFor()),
  },
  { name: "21-empty-error", world: { failures: { "GET /course": { status: 500, code: "internal" } } }, go: async (p) => (await p.goto("/learn"), await p.getByRole("heading", { name: "Что-то пошло не так" }).waitFor()) },
  {
    name: "23-help-empty",
    go: async (p) => {
      await trail(p);
      await p.getByRole("button", { name: "Помоги языку, пройден" }).click();
      await p.getByRole("heading", { name: "Все пары уже оценены" }).waitFor();
    },
  },
  { name: "22-splash", world: { delays: { "GET /course": 5000 } }, go: async (p) => (await p.goto("/learn"), await p.getByRole("status", { name: "Открываем тропу" }).waitFor()) },
  // Первый заход: знакомство с пчелой (ни одного урока), закрытый узел объясняет, что пройти сначала.
  { name: "24-intro", world: { learn: freshLearn() }, go: async (p) => (await p.goto("/learn"), await p.getByRole("dialog", { name: "Привет! Я пчела" }).waitFor()) },
  {
    name: "24b-intro-goal",
    world: { learn: freshLearn() },
    go: async (p) => {
      await p.goto("/learn");
      await p.getByRole("dialog").getByRole("button", { name: "Дальше" }).click();
      await p.getByRole("dialog", { name: "Урок — сота мёда" }).waitFor();
    },
  },
  {
    name: "25-home-locked-hint",
    go: async (p) => {
      await trail(p);
      // Как после урока: в центре — текущий узел, закрытый — сразу под ним (декорации места видны целиком).
      await p.evaluate(() => document.querySelector('[data-node="u01-moya-shkola"]')?.scrollIntoView({ block: "center" }));
      await p.getByRole("button", { name: "Урок «Вежливые слова», закрыт" }).click({ force: true });
      await p.locator(".track__hint").waitFor();
    },
  },
  { name: "26-lesson-combo", go: async (p) => (await finishCombo(p)) },
  { name: "30-home-dark", dark: true, go: trail },
  { name: "31-lesson-input-bee", mode: "bee", go: async (p) => (await lesson(p), await tilesOk(p), await choiceBad(p), await inputAlmost(p, false)) },
  { name: "32-lesson-tiles-keeper", mode: "keeper", go: lesson },
  { name: "33-home-1280", width: 1280, go: trail },
  // Раскладка для компьютера и планшета (@teletau/ui/shell.css): боковая навигация, в центре — вкладка, справа — карточки.
  { name: "33b-home-1280-dark", width: 1280, dark: true, go: trail },
  { name: "33c-home-task-1280", width: 1280, world: { learn: taskLearn() }, go: trail },
  { name: "33d-home-768", width: 768, go: trail },
  { name: "33e-home-1024", width: 1024, world: { learn: taskLearn() }, go: trail },
  { name: "35-league-1280", width: 1280, go: async (p) => (await p.goto("/league"), await p.getByRole("heading", { name: "Лига Донника" }).waitFor()) },
  { name: "36-class-1280", width: 1280, go: async (p) => (await p.goto("/hive"), await p.getByRole("heading", { name: /Улей 5/ }).waitFor()) },
  { name: "37-profile-1280", width: 1280, go: async (p) => (await p.goto("/me"), await p.getByRole("heading", { name: "Мой вклад в словарь" }).waitFor()) },
  { name: "38-words-1280", width: 1280, world: { learn: dueLearn() }, go: async (p) => (await p.goto("/me/words"), await p.getByRole("heading", { name: "Мой словарь", level: 1 }).waitFor()) },
  { name: "39-lesson-1280", width: 1280, go: lesson },
  // ── Повторение слов, «Пары», цель дня, «Мой словарь» ──
  { name: "50-home-review", world: { learn: dueLearn() }, go: trail },
  { name: "51-review-choice", world: { learn: dueLearn() }, go: reviewStart },
  {
    name: "52-review-pairs",
    world: { learn: dueLearn() },
    go: async (p) => {
      await reviewToPairs(p);
      await pairLink(p, "Сәләм!", "Привет!");
      await pairLink(p, "Рәхмәт!", "Спасибо!");
      await p.getByRole("list", { name: "Слова" }).getByRole("button", { name: /^Хәйерле көн/ }).click();
    },
  },
  {
    name: "53-review-pairs-wrong",
    world: { learn: dueLearn() },
    go: async (p) => {
      await reviewToPairs(p);
      await pairLink(p, "Сәләм!", "Привет!");
      await pairLink(p, "Хәйерле көн", "школа");
      await pairLink(p, "мәктәп", "Добрый день");
      await pairLink(p, "Рәхмәт!", "Спасибо!");
      await p.getByRole("button", { name: "Проверить" }).click();
      await p.getByRole("heading", { name: "Пока не так" }).waitFor();
    },
  },
  {
    name: "54-review-result-goal",
    world: { learn: dueLearn() },
    go: async (p) => {
      await reviewToPairs(p);
      await pairLink(p, "Хәйерле көн", "Добрый день");
      await pairLink(p, "Сәләм!", "Привет!");
      await pairLink(p, "мәктәп", "школа");
      await pairLink(p, "Рәхмәт!", "Спасибо!");
      await p.getByRole("button", { name: "Проверить" }).click();
      await p.getByRole("button", { name: "Дальше" }).click();
      await p.getByRole("heading", { name: "Повторение пройдено!" }).waitFor();
    },
  },
  {
    name: "55-words",
    world: { learn: dueLearn() },
    go: async (p) => (await p.goto("/me/words"), await p.getByRole("heading", { name: "Мой словарь", level: 1 }).waitFor()),
  },
  {
    name: "56-profile-dictionary",
    world: { learn: dueLearn() },
    go: async (p) => {
      await p.goto("/me");
      await p.getByRole("link", { name: /Мой словарь/ }).waitFor();
      await p.evaluate(() => window.scrollTo(0, 200));
    },
  },
  {
    name: "57-home-done-review",
    world: (() => {
      const learn = dueLearn();
      learn.course.units[0]!.nodes.forEach((n) => (n.state = "done"));
      return { learn };
    })(),
    go: async (p) => (await p.goto("/learn"), await p.getByRole("heading", { name: "На сегодня всё" }).waitFor()),
  },
  { name: "58-home-review-dark", dark: true, world: { learn: dueLearn() }, go: trail },
  // ── Тропа с первого экрана: шапка места, плашки задания и повторения; текущее место не первое ──
  { name: "62-home-today", world: { learn: taskLearn() }, go: trail },
  { name: "62b-home-today-dark", dark: true, world: { learn: taskLearn() }, go: trail },
  {
    name: "62c-home-task-done",
    world: (() => {
      const learn = taskLearn();
      learn.course.assignments = learn.course.assignments!.map((a) => ({ ...a, done: true }));
      return { learn };
    })(),
    go: trail,
  },
  {
    name: "63-home-second-place",
    world: (() => {
      const learn = dueLearn();
      learn.course.units[0]!.nodes.forEach((n) => (n.state = "done"));
      learn.course.units[1]!.state = "open";
      learn.course.units[1]!.nodes.forEach((n, i) => (n.state = i < 2 ? "done" : i === 2 ? "current" : "locked"));
      return { learn };
    })(),
    go: trail,
  },
  // ── Обучение перед проверкой: «Новое слово» и подсказки к условию ──
  { name: "60-lesson-new-word", go: newWord },
  { name: "60b-lesson-new-word-1280", width: 1280, go: newWord },
  { name: "60c-lesson-new-word-dark", dark: true, go: newWord },
  { name: "60d-lesson-new-word-no-audio-bee", mode: "bee", go: async (p) => (await newWord(p), await pastNewWord(p), await p.locator(".newword__word", { hasText: "барам" }).waitFor()) },
  { name: "61-lesson-hint", go: hint },
  { name: "61b-lesson-hint-1280", width: 1280, go: hint },
  { name: "61c-lesson-hint-bee", mode: "bee", go: hint },
];

for (const shot of SHOTS) {
  test(`снимок ${shot.name}`, async ({ page }) => {
    if (shot.width) await page.setViewportSize({ width: shot.width, height: 860 });
    // Без анимаций, чтобы кадр не попал на середину перехода (как ?static=1 у прототипа).
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (shot.dark) await chooseTheme(page, "dark");
    await mockBackend(page, { account: shot.mode ? childMe({ uiMode: shot.mode }) : student, ...shot.world });
    await shot.init?.(page);
    await shot.go(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${shot.name}.png`, fullPage: shot.fullPage });
  });
}
