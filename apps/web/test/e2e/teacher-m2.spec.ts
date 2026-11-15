// Кабинет учителя на моках API по контракту (mock-api.ts, mock-teacher.ts): «Прогресс» класса и «Помогите языку».
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { Schema } from "@teletau/contracts";
import { CLASS_ID, FOREIGN_CLASS_ID, SCHOOL, SECOND_CLASS_ID, adultMe, classDetail, mockBackend, type World } from "./mock-api";
import { demoClassProgress, demoSeats } from "./mock-teacher";
import { settleAnimations } from "./settle";
import { chooseTheme } from "./theme";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectAccessible(page: Page, label: string) {
  await settleAnimations(page);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

const teacher = (init: Partial<World> = {}) => ({ account: adultMe(), classDetail: classDetail({ seats: demoSeats() }), ...init });

test.describe("учитель — «Мои классы»", () => {
  test("у класса — сегодня N из M, задание с выполнением, кто не занимался, заявки; новый класс — шаги к первому уроку", async ({ page }) => {
    await mockBackend(page, teacher());
    await page.goto("/teacher");
    const klass = page.getByRole("article", { name: "5 «Б»" });
    const today = klass.getByRole("region", { name: "Занимались сегодня" });
    await expect(today).toContainText("9 из 22");
    await expect(today.getByRole("link", { name: "№07 · Смелая пчела" })).toHaveAttribute("href", `/teacher/classes/${CLASS_ID}/seats/7`);
    await expect(klass.getByRole("progressbar", { name: "Сделали: «Моя школа»" })).toHaveAttribute("aria-valuetext", "9 из 22");
    const idle = klass.getByRole("region", { name: "Не занимались на неделе" });
    await expect(idle.getByRole("link", { name: "№04 Ясный ручей" })).toBeVisible();
    await expect(klass.getByRole("status")).toContainText("2 ученика ждут подтверждения");
    await expect(klass.getByRole("status")).toContainText("Тёплый ветер, Зоркий сокол");

    const fresh = page.getByRole("article", { name: "6 «А»" });
    await expect(fresh.getByText("Выпустите карточки")).toBeVisible();
    await expect(fresh.getByRole("link", { name: "Выпустить карточки" })).toHaveAttribute("href", `/teacher/classes/${SECOND_CLASS_ID}?open=cards`);
    await expect(page.getByRole("link", { name: "Оценить пары" })).toHaveAttribute("href", "/teacher/duels");
    await expectAccessible(page, "мои классы со сводкой");

    // «Посмотреть» у заявок — сразу лист заявок класса.
    await klass.getByRole("link", { name: "Посмотреть" }).click();
    await page.waitForURL(`**/teacher/classes/${CLASS_ID}`);
    await expect(page.getByRole("dialog", { name: "Заявки на вход" })).toBeVisible();
  });

  test("один класс — карточка на всю ширину, блоки сводки в ряд", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await mockBackend(page, teacher({ classes: [{ id: CLASS_ID, title: "5 «Б»", grade: 5, letter: "Б", program: "native", academicYear: 2026, school: SCHOOL, myRole: "teacher", studentCount: 22, seatCount: 24 }] }));
    await page.goto("/teacher");
    const klass = page.getByRole("article", { name: "5 «Б»" });
    await expect(klass.getByRole("region", { name: "Задание" })).toContainText("«Моя школа»");
    const boxes = await Promise.all(["Занимались сегодня", "Задание", "Не занимались на неделе"].map((name) => klass.getByRole("region", { name }).boundingBox()));
    expect(new Set(boxes.map((b) => Math.round(b!.y))).size).toBe(1);
    expect((await klass.boundingBox())!.width).toBeGreaterThan(1000);
  });
});

test.describe("учитель — «Прогресс» класса", () => {
  test("класс → «Прогресс»: «№07 · Смелая пчела — 3 урока, сегодня, серия 6», сводка недели, прохождение уроков", async ({ page }) => {
    await mockBackend(page, teacher());
    await page.goto(`/teacher/classes/${CLASS_ID}`);
    const tabs = page.getByRole("navigation", { name: "Разделы класса" });
    await expect(tabs.getByRole("link", { name: "Обзор" })).toHaveAttribute("aria-current", "page");
    await tabs.getByRole("link", { name: "Прогресс" }).click();
    await page.waitForURL(`**/teacher/classes/${CLASS_ID}/progress`);
    await expect(tabs.getByRole("link", { name: "Прогресс" })).toHaveAttribute("aria-current", "page");

    const hero = page.getByRole("row").filter({ hasText: "№07 · Смелая пчела" });
    await expect(hero).toContainText("3 урока · сегодня");
    await expect(hero).toContainText("Серия: 6 дней");
    await expect(hero).toContainText("На неделе: 3 урока · 36 мёда · точность 86%");
    // Ещё не занимался — честно, без нулей.
    await expect(page.getByRole("row").filter({ hasText: "№22 · Северный олень" })).toContainText("пока без уроков");

    const week = page.getByRole("region", { name: /^Неделя / });
    // Знаменатель — ученики с аккаунтом (22), а не все 24 места: так же, как во вкладке «Класс» у ученика.
    await expect(week).toContainText("Занимались 18 из 22");
    await expect(week.getByRole("img", { name: "Занимались 18 из 22" })).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Урок «Привет!»" })).toHaveAttribute("aria-valuetext", "19 из 22");
    // Уроки — по местам: где класс сейчас (Өфө), развёрнуто, остальные свёрнуты и открываются по нажатию.
    const lessons = page.getByRole("region", { name: "Прохождение уроков" });
    await expect(lessons.getByRole("button", { name: /Өфө/ })).toHaveAttribute("aria-expanded", "true");
    await expect(lessons.getByRole("button", { name: /Өфө/ })).toContainText("42%");
    const family = lessons.getByRole("button", { name: /Шүлгәнташ/ });
    await expect(family).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("progressbar", { name: "Урок «Мама и папа»" })).toBeHidden();
    await family.click();
    await expect(page.getByRole("progressbar", { name: "Урок «Мама и папа»" })).toHaveAttribute("aria-valuetext", "3 из 22");
    await expect(page).toHaveTitle("Прогресс · 5 «Б» · ТелеТау");
    await expectAccessible(page, "прогресс класса");
  });

  test("чужой класс — «Нет доступа» (403), прогресс не показывается", async ({ page }) => {
    await mockBackend(page, teacher());
    await page.goto(`/teacher/classes/${FOREIGN_CLASS_ID}/progress`);
    await expect(page.getByRole("heading", { name: "Нет доступа" })).toBeVisible();
    await expect(page.getByText("№07")).toHaveCount(0);
  });
});

test.describe("учитель — «Помогите языку»", () => {
  test("голос → голоса раздельно (дети / взрослые / учителя) и статус «Пару приняли»", async ({ page }) => {
    const w = await mockBackend(page, teacher());
    const sent: Schema<"JudgmentRequest">[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/api/v1/corpus/judgments")) sent.push(r.postDataJSON() as Schema<"JudgmentRequest">);
    });
    await page.goto("/teacher");
    await page.getByRole("navigation", { name: "Разделы кабинета" }).first().getByRole("link", { name: "Помогите языку" }).click();
    await page.waitForURL("**/teacher/duels");
    await expect(page.getByRole("heading", { level: 1, name: "Помогите языку" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Какой перевод лучше?" })).toBeVisible();
    await expect(page.getByText("Здравствуйте!", { exact: true })).toBeVisible();
    await expect(page.locator(".duel [lang=ba]").first()).toHaveText("Һаумыһығыҙ!");
    // До голоса — никаких чужих голосов.
    await expect(page.getByRole("heading", { name: "Голоса по группам" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Отдать голос" })).toBeDisabled();
    // Горячие клавиши работают, но подсказки о них на экране нет.
    await expect(page.locator("main")).not.toContainText("Клавиши");

    await page.getByRole("radio", { name: "Һаумыһығыҙ!" }).click();
    await page.getByRole("button", { name: "Отдать голос" }).click();
    const results = page.getByRole("region", { name: "Голоса по группам" });
    await expect(results).toBeVisible();
    await expect(results.getByRole("status")).toContainText("Пару приняли");
    await expect(results.getByRole("status")).toContainText("Вариант A вошёл в словарь.");
    await expect(results.getByRole("heading", { name: "Голоса по группам" })).toBeFocused();
    const groups = results.getByRole("list", { name: "Голоса по группам" }).getByRole("listitem");
    await expect(groups).toHaveText([/Дети.*10 голосов/, /Взрослые.*3 голоса/, /Учителя.*1 голос/]);
    await expect(groups.nth(2)).toContainText("вариант A: A 1");
    await expect(results.getByRole("listitem").filter({ hasText: "Һаумыһығыҙ!" })).toContainText("В словаре");
    await expect(results.getByRole("listitem").filter({ hasText: "Һаумыһығыҙ!" })).toContainText("Ваш голос");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ itemId: w.teacher.items[0]!.duel.itemId, shown: w.teacher.items[0]!.duel.variants.map((v) => v.variantId), choice: "a" });
    expect(sent[0]!.judgmentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await expectAccessible(page, "голоса по группам");

    await page.getByRole("button", { name: "Следующая пара" }).click();
    await expect(page.getByText("Как Вас зовут?", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Какой перевод лучше?" })).toBeFocused();
    await expect(page.getByRole("progressbar", { name: "Пары этого захода" })).toHaveAttribute("aria-valuetext", "Пара 2 из 3");
  });

  test("клавиатура: 2 — вариант B, Enter — голос; учителя и взрослые разошлись → «Мнения разошлись»", async ({ page }) => {
    await mockBackend(page, teacher());
    await page.goto("/teacher/duels");
    await expect(page.getByRole("radio", { name: "Иҫәнмеһегеҙ!" })).toBeVisible();
    await page.keyboard.press("2");
    await expect(page.getByRole("radio", { name: "Иҫәнмеһегеҙ!" })).toBeChecked();
    await page.keyboard.press("Enter");
    const results = page.getByRole("region", { name: "Голоса по группам" });
    await expect(results.getByRole("status")).toContainText("Мнения разошлись");
    await expect(results.getByRole("status")).toContainText("Голоса разделились — пару посмотрят ещё раз.");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Как Вас зовут?", { exact: true })).toBeVisible();
  });

  test("дети предпочли другой вариант — метка «Так говорят дети»", async ({ page }) => {
    const w = await mockBackend(page, teacher());
    w.teacher.items.splice(0, 1);
    await page.goto("/teacher/duels");
    await page.getByRole("radio", { name: "Исемегеҙ кем?" }).click();
    await page.getByRole("button", { name: "Отдать голос" }).click();
    const results = page.getByRole("region", { name: "Голоса по группам" });
    await expect(results.getByRole("status")).toContainText("Пару приняли");
    await expect(results.getByRole("listitem").filter({ hasText: "Исемегеҙ нисек?" })).toContainText("Так говорят дети");
  });

  test("без технических объяснений: нет «Как считаются голоса», «duel-v0», «Источники» — ни до голоса, ни после", async ({ page }) => {
    await mockBackend(page, teacher());
    await page.goto("/teacher/duels");
    await expect(page.getByRole("radio", { name: "Һаумыһығыҙ!" })).toBeVisible();
    const banned = ["Как считаются голоса", "duel-v0", "Источники", "эксперт", "по правилам", "носителем"];
    const main = page.locator("main");
    for (const text of banned) await expect(main.getByText(text)).toHaveCount(0);
    await page.getByRole("radio", { name: "Һаумыһығыҙ!" }).click();
    await page.getByRole("button", { name: "Отдать голос" }).click();
    await expect(page.getByRole("region", { name: "Голоса по группам" })).toBeVisible();
    for (const text of banned) await expect(main.getByText(text)).toHaveCount(0);
    await expect(main).not.toContainText("duel-v0");
  });

  test("дуэли закончились — «Все пары оценены»", async ({ page }) => {
    const w = await mockBackend(page, teacher());
    w.teacher.items = [];
    await page.goto("/teacher/duels");
    await expect(page.getByRole("heading", { name: "Все пары оценены" })).toBeVisible();
    await expect(page.getByRole("link", { name: "К моим классам" })).toHaveAttribute("href", "/teacher");
    await expectAccessible(page, "дуэли закончились");
  });
});

test("тёмная тема: «Прогресс» и голоса по группам — без серьёзных нарушений axe (контраст токенов)", async ({ page }) => {
  await chooseTheme(page, "dark");
  await mockBackend(page, teacher());
  await page.goto(`/teacher/classes/${CLASS_ID}/progress`);
  await expect(page.getByText("№07 · Смелая пчела")).toBeVisible();
  await expectAccessible(page, "прогресс, тёмная тема");
  await page.goto("/teacher/duels");
  await page.getByRole("radio", { name: "Иҫәнмеһегеҙ!" }).click();
  await page.getByRole("button", { name: "Отдать голос" }).click();
  await expect(page.getByRole("region", { name: "Голоса по группам" })).toBeVisible();
  await expectAccessible(page, "голоса по группам, тёмная тема");
});

test.describe("Кабинет: шлифовка листов и сводки", () => {
  for (const size of [
    { width: 1280, height: 720 },
    { width: 390, height: 667 },
  ]) {
    test(`${size.width}×${size.height}: в «Новый класс» и «Задание классу» главная кнопка видна без прокрутки`, async ({ page }) => {
      await page.setViewportSize(size);
      await mockBackend(page, teacher());
      await page.goto("/teacher");
      await page.getByRole("button", { name: "Создать класс" }).first().click();
      const create = page.getByRole("dialog", { name: "Новый класс" });
      await expect(create.getByRole("button", { name: "Создать класс" })).toBeInViewport({ ratio: 1 });
      await page.keyboard.press("Escape");
      await page.goto(`/teacher/classes/${CLASS_ID}/assignments`);
      await page.getByRole("button", { name: "Дать задание" }).first().click();
      const give = page.getByRole("dialog", { name: "Задание классу" });
      await expect(give.getByRole("button", { name: "Дать задание" })).toBeInViewport({ ratio: 1 });
    });
  }

  test("«Не занимались на неделе» — не больше четырёх ников, «Ещё N» ведёт в «Прогресс» в порядке «Кто отстаёт»", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    const w = await mockBackend(page, teacher({ classes: [{ id: CLASS_ID, title: "5 «Б»", grade: 5, letter: "Б", program: "native", academicYear: 2026, school: SCHOOL, myRole: "teacher", studentCount: 22, seatCount: 24 }] }));
    const old = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yekaterinburg" }).format(new Date(Date.now() - 12 * 86_400_000));
    // №01–№09 (кроме №07) неделю не занимались: вместе с №11, №16 и №22 — 11 учеников.
    w.teacher.progress = (id, seats) => {
      const p = demoClassProgress(id, seats);
      p.seats = p.seats.map((s) => (s.seatNumber <= 9 && s.seatNumber !== 7 ? { ...s, lessonsThisWeek: 0, lastActiveOn: old, streak: 0 } : s));
      return p;
    };
    await page.goto("/teacher");
    const idle = page.getByRole("region", { name: "Не занимались на неделе" });
    await expect(idle).toContainText("11");
    await expect(idle.getByRole("list").getByRole("link")).toHaveCount(4);
    const more = idle.getByRole("link", { name: "Ещё 7 учеников" });
    await expect(more).toHaveAttribute("href", `/teacher/classes/${CLASS_ID}/progress?order=attention`);
    // Блоки сводки — одной высоты.
    const heights = await Promise.all(["Занимались сегодня", "Задание", "Не занимались на неделе"].map(async (name) => Math.round((await page.getByRole("region", { name }).boundingBox())!.height)));
    expect(new Set(heights).size).toBe(1);
    await more.click();
    await page.waitForURL(/progress\?order=attention/);
    await expect(page.getByRole("button", { name: "Кто отстаёт" })).toHaveAttribute("aria-pressed", "true");
  });

  test("заявки: принятая остаётся в списке с итогом «В классе · №25», все решены — «Готово»", async ({ page }) => {
    await mockBackend(page, teacher());
    await page.goto(`/teacher/classes/${CLASS_ID}?open=requests`);
    const requests = page.getByRole("dialog", { name: "Заявки на вход" });
    await requests.getByRole("button", { name: "Принять: Тёплый ветер" }).click();
    await expect(requests.getByRole("listitem").filter({ hasText: "Тёплый ветер" })).toContainText("В классе · №25");
    // Тост при открытом листе — внутри листа (верхний слой), поверх него, а не под затемнением.
    const toast = requests.getByRole("region", { name: "Уведомления" }).getByText(/Тёплый ветер — в классе/);
    await expect(toast).toBeVisible();
    const onTop = await toast.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
    });
    expect(onTop).toBe(true);
    await expect(requests.getByRole("button", { name: "Готово" })).toHaveCount(0);
    await requests.getByRole("button", { name: "Отклонить: Зоркий сокол" }).click();
    await expect(requests.getByRole("listitem").filter({ hasText: "Зоркий сокол" })).toContainText("Отклонена");
    await requests.getByRole("button", { name: "Готово" }).click();
    await expect(requests).toBeHidden();
  });
});
