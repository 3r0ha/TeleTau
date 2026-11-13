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
