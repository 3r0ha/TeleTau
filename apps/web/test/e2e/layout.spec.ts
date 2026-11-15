// Раскладка ученика на компьютере и телефоне (@teletau/ui/shell.css, StudentShell, StudentRail) и стартовая страница:
// на 1280 px — боковая навигация на 6 разделов («Доска» — как «Словарь», только в ней) и правая колонка карточек,
// на 390 px — как прототип: нижние вкладки на 4 раздела.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { childMe, mockBackend } from "./mock-api";
import { CURRENT_NODE, learnWorld } from "./mock-learn";
import { settleAnimations } from "./settle";
import { chooseTheme } from "./theme";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectAccessible(page: Page, label: string) {
  await settleAnimations(page);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).disableRules(["target-size"]).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

test.describe("компьютер, 1280 px", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("слева — 6 разделов с логотипом, нижних вкладок нет; справа — цель дня, серия, лига и квест улья", async ({ page }) => {
    const learn = learnWorld();
    learn.course.review = { due: 5 };
    await mockBackend(page, { account: childMe(), learn });
    await page.goto("/learn");
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Разделы" });
    await expect(nav).toHaveCount(1);
    await expect(nav.getByRole("link")).toHaveText(["ТелеТау", "Путь", "Лига", "Доска", "Класс", "Словарь", "Профиль"]);
    await expect(nav.getByRole("link", { name: "Путь" })).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".tt-tabbar")).toBeHidden();
    // Шапка тропы со счётчиками — в правой колонке.
    await expect(page.locator(".learn-top")).toBeHidden();

    const rail = page.getByRole("complementary", { name: "Мой день" });
    await expect(rail.getByRole("heading", { name: "Цель дня" })).toBeVisible();
    await expect(rail.getByText("5 дней подряд")).toBeVisible();
    await expect(rail.getByRole("heading", { name: "Лига Донника" })).toBeVisible();
    await expect(rail.getByText("Ты в зоне повышения")).toBeVisible();
    await expect(rail.getByRole("heading", { name: "Квест недели" })).toBeVisible();
    await expect(rail.getByRole("progressbar", { name: "Квест класса" })).toHaveAttribute("aria-valuetext", "214 из 300");
    // «Повторить 5 слов» — только в колонке (плашки над тропой нет), и кнопка начинает повторение здесь же.
    await expect(page.getByRole("heading", { name: "Повторить 5 слов" })).toHaveCount(1);
    await expect(page.locator(".today")).toBeHidden();
    await expectAccessible(page, "тропа на компьютере");
    await rail.getByRole("button", { name: "Начать", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Что значит это слово?" })).toBeVisible();
  });

  test("«Словарь» — отдельный раздел: текущий в боковой навигации, «‹ Профиль» не нужен; колонка без повторения", async ({ page }) => {
    const learn = learnWorld();
    learn.course.review = { due: 5 };
    await mockBackend(page, { account: childMe(), learn });
    await page.goto("/league");
    await expect(page.getByRole("heading", { name: "Лига Донника", level: 1 })).toBeVisible();
    // На «Лиге» карточки лиги в колонке нет — она уже в центре.
    await expect(page.getByRole("complementary", { name: "Мой день" }).getByRole("heading", { name: /Лига/ })).toHaveCount(0);

    await page.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: "Словарь" }).click();
    await expect(page).toHaveURL(/\/me\/words$/);
    await expect(page.getByRole("heading", { name: "Мой словарь", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Словарь" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Профиль", exact: true })).not.toHaveAttribute("aria-current", "page");
    await expect(page.locator(".words__back")).toBeHidden();
    await expect(page.getByRole("heading", { name: /^Повторить \d/ })).toHaveCount(1);
    await expectAccessible(page, "словарь на компьютере");
  });

  test("вкладки «Лига», «Класс», «Профиль» в тёмной теме: колонка без нарушений axe, текущий раздел отмечен", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await chooseTheme(page, "dark");
    await mockBackend(page, { account: childMe() });
    for (const [path, tab, heading] of [
      ["/league", "Лига", "Лига Донника"],
      ["/hive", "Класс", "Улей 5 «Б»"],
      ["/me", "Профиль", "Мой вклад в словарь"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: tab, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("complementary", { name: "Мой день" }).getByRole("heading", { name: "Цель дня" })).toBeVisible();
      await expectAccessible(page, `${path} в тёмной теме`);
    }
  });

  test("стартовая страница: картинка героя слева, заголовок и кнопки справа; разделы через один зеркально", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    const art = (await page.locator(".lp-hero__img").boundingBox())!;
    const title = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    expect(title.x).toBeGreaterThan(art.x + art.width);
    await expect(page.getByRole("link", { name: "Начать", exact: true }).first()).toBeInViewport();
    // Полоса мест — в одну строку.
    const cells = page.getByRole("region", { name: "Места тропы" }).getByRole("listitem");
    const tops = await cells.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    for (const [name, artLeft] of [
      ["Мёд и серия", true],
      ["Путь по родным местам", false],
      ["Помоги языку", true],
      ["Лига и класс", false],
    ] as const) {
      const row = page.getByRole("region", { name });
      const a = (await row.locator(".lp-row__art").boundingBox())!;
      const h = (await row.getByRole("heading", { level: 2 }).boundingBox())!;
      expect(a.x < h.x, name).toBe(artLeft);
    }
    await expectAccessible(page, "лендинг");
  });
});

test.describe("телефон, 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("стартовая страница: картинка героя над заголовком, обе кнопки — на первом экране", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    const art = (await page.locator(".lp-hero__img").boundingBox())!;
    const title = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    expect(title.y).toBeGreaterThan(art.y + art.height);
    await expect(page.getByRole("link", { name: "Начать", exact: true }).first()).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("link", { name: "У меня есть карточка или код" })).toBeInViewport({ ratio: 1 });
  });

  test("нижние вкладки на 4 раздела, боковой навигации и правой колонки нет", async ({ page }) => {
    await mockBackend(page, { account: childMe() });
    await page.goto("/learn");
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Разделы" });
    await expect(nav).toHaveCount(1);
    await expect(nav.getByRole("link")).toHaveText(["Путь", "Лига", "Класс", "Профиль"]);
    await expect(page.locator(".tt-sidenav")).toBeHidden();
    await expect(page.getByRole("complementary")).toHaveCount(0);
    await expect(page.locator(".learn-top")).toBeVisible();
    // «Мой словарь» на телефоне — внутри «Профиля».
    await page.goto("/me/words");
    await expect(page.getByRole("heading", { name: "Мой словарь", level: 1 })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Профиль" })).toHaveAttribute("aria-current", "page");
  });

  test("тропа с первого экрана: шапка места, плашки задания и повторения, текущий узел над нижними вкладками", async ({ page }) => {
    const learn = learnWorld();
    learn.course.review = { due: 12 };
    const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    learn.course.assignments = [{ id: "0193f7a4-0000-7000-8000-0000000a5001", kind: "lesson", lessonId: "u01-moya-shkola", titleRu: "Моя школа", placeRu: "Уфа", dueOn: due, done: false }];
    const w = await mockBackend(page, { account: childMe(), learn });
    await page.goto("/learn");
    await expect(page.getByRole("heading", { level: 1, name: /Өфө/ })).toBeInViewport();
    await expect(page.getByRole("progressbar", { name: "Пройдено на этом месте" })).toHaveAttribute("aria-valuetext", "3 из 7");
    await expect(page.locator(".unit-head")).toContainText("Знакомство · 3 из 7");
    const task = page.getByRole("button", { name: /^Задание учителя · до \S+ «Моя школа» Начать$/ });
    await expect(task).toBeInViewport();
    await expect(page.getByRole("button", { name: "Повторить 12 слов Начать" })).toBeInViewport();
    const node = (await page.getByRole("button", { name: CURRENT_NODE }).boundingBox())!;
    const tabs = (await page.locator(".tt-tabbar").boundingBox())!;
    expect(node.y).toBeGreaterThan(0);
    expect(node.y + node.height).toBeLessThanOrEqual(tabs.y);
    await expectAccessible(page, "тропа на телефоне с плашками");
    await task.click();
    await expect(page.getByRole("button", { name: "Выйти из урока" })).toBeVisible();
    expect(w.calls).toContain("POST /lessons/u01-moya-shkola/runs");
  });

  test("текущее место не первое — тропа открывается на нём: шапка места и текущий узел на первом экране", async ({ page }) => {
    const learn = learnWorld();
    learn.course.units[0]!.nodes.forEach((n) => (n.state = "done"));
    learn.course.units[1]!.state = "open";
    learn.course.units[1]!.nodes.forEach((n, i) => (n.state = i === 0 ? "current" : "locked"));
    await mockBackend(page, { account: childMe(), learn });
    await page.goto("/learn");
    await expect(page.getByRole("heading", { level: 1, name: /Шүлгәнташ/ })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Урок «Мама и папа» — начать" })).toBeInViewport();
    // Пройденное место — выше, с вывеской.
    await expect(page.locator(".place-sign__name [lang=ba]").first()).toHaveText("Өфө");
  });
});

/** Ширина прокрутки страницы больше видимой — экран уезжает вбок. */
const sideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("узкий телефон: доска почёта, профиль, лига, шапка лендинга", () => {
  for (const width of [320, 390]) {
    for (const locale of ["ru", "ba", "kk"]) {
      test(`доска почёта ${width} px, ${locale}: без прокрутки вбок, таблица в подложке, слова и ученики видны`, async ({ page, baseURL }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.context().addCookies([{ name: "tt_locale", value: locale, url: baseURL! }]);
        await mockBackend(page, { account: childMe() });
        await page.goto("/board");
        const schools = page.locator("#board-schools").locator("xpath=..");
        await expect(schools.locator(".board__row")).toHaveCount(10);
        expect(await sideScroll(page)).toBeLessThanOrEqual(0);
        for (const sheet of await page.locator(".board__sheet").all()) {
          const { table, box } = await sheet.evaluate((el) => ({ table: el.querySelector("table")!.getBoundingClientRect().width, box: el.clientWidth }));
          expect(table).toBeLessThanOrEqual(box + 0.5);
        }
        // На телефоне ученики и слова — подписью под названием, целиком внутри строки.
        const meta = schools.locator(".board__meta").first();
        await expect(meta).toBeVisible();
        await expect(meta).toContainText("4 120");
        const row = (await schools.locator(".board__row").first().boundingBox())!;
        const m = (await meta.boundingBox())!;
        expect(m.x + m.width).toBeLessThanOrEqual(row.x + row.width + 0.5);
        // Название не рвётся посреди короткого слова: «Школа» и «Гимназия» — целиком в одной строке.
        const who = schools.locator(".board__who").nth(1);
        const lines = await who.evaluate((el) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
        });
        expect(lines).toBeLessThanOrEqual(2);
      });
    }
  }

  test("профиль 320 px: строка «Язык» без прокрутки вбок, кнопки языка не ниже 44 px и внутри карточки", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await mockBackend(page, { account: childMe() });
    await page.goto("/me");
    const group = page.getByRole("group", { name: "Язык" });
    await group.scrollIntoViewIfNeeded();
    await expect(group.getByRole("button")).toHaveCount(3);
    expect(await sideScroll(page)).toBeLessThanOrEqual(0);
    const card = (await page.locator(".settings__row--stack").boundingBox())!;
    for (const b of await group.getByRole("button").all()) {
      const box = (await b.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(card.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
    }
    await expect(group.getByRole("button", { name: "Башҡортса" })).toHaveAttribute("lang", "ba");
  });

  test("лига 320 px: значки лиг сжимаются, без прокрутки вбок", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await mockBackend(page, { account: childMe() });
    await page.goto("/league");
    await expect(page.getByRole("heading", { name: "Лига Донника", level: 1 })).toBeVisible();
    expect(await sideScroll(page)).toBeLessThanOrEqual(0);
  });

  for (const width of [320, 390]) {
    test(`шапка лендинга ${width} px: один ряд «логотип, настройки, Войти»; язык и тема — в меню настроек`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 800 });
      await mockBackend(page);
      await page.goto("/");
      const head = page.getByRole("banner");
      const box = (await head.boundingBox())!;
      expect(box.height).toBeLessThanOrEqual(80);
      const brand = (await head.getByRole("link", { name: /ТелеТау/ }).boundingBox())!;
      expect(brand.y).toBeGreaterThanOrEqual(4);
      expect(await sideScroll(page)).toBeLessThanOrEqual(0);
      await expect(head.getByRole("group", { name: "Язык интерфейса" })).toHaveCount(0);
      const toggle = head.getByRole("button", { name: "Настройки" });
      await toggle.click();
      const group = head.getByRole("group", { name: "Язык интерфейса" });
      await expect(group.getByRole("button")).toHaveCount(3);
      for (const b of await group.getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(head.getByRole("switch", { name: "Тёмная тема" })).toBeVisible();
      await group.getByRole("button", { name: "Башҡортса" }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "ba");
      const cookie = (await page.context().cookies(baseURL!)).find((c) => c.name === "tt_locale");
      expect(cookie?.value).toBe("ba");
      await page.keyboard.press("Escape");
    });
  }
});
