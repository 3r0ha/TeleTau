// Задания учителя, карточка ученика и отчёт по классу (ADR 0021) на моках API по контракту (mock-api.ts,
// mock-teacher.ts, mock-learn.ts). Ученик: карточка «Задание учителя» на тропе.
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { Schema } from "@teletau/contracts";
import { CLASS_ID, adultMe, childMe, classDetail, mockBackend, type World } from "./mock-api";
import { learnWorld } from "./mock-learn";
import { demoSeats, teacherWorld } from "./mock-teacher";
import { chooseTheme } from "./theme";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectAccessible(page: Page, label: string) {
  // Контраст — на итоговом кадре, как expectAccessible в e2e/support/stack.ts: дожидаемся конечных анимаций
  // (проявление диалога «Задание классу», тост). Бесконечные (скелетоны) не ждём — они не меняют цвета текста.
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

const teacher = (init: Partial<World> = {}) => ({ account: adultMe(), classDetail: classDetail({ seats: demoSeats() }), ...init });
const ufaDay = (shift = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yekaterinburg" }).format(new Date(Date.now() + shift * 86_400_000));

test.describe("Задания классу (учитель)", () => {
  test("вкладка «Задания»: выполнение по номерам мест, «Дать задание» → новое задание → лимит двух, «Снять задание»", async ({ page }) => {
    const w = await mockBackend(page, teacher());
    const sent: Schema<"CreateAssignmentRequest">[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith(`/classes/${CLASS_ID}/assignments`)) sent.push(r.postDataJSON() as Schema<"CreateAssignmentRequest">);
    });
    await page.goto(`/teacher/classes/${CLASS_ID}`);
    await page.getByRole("navigation", { name: "Разделы класса" }).getByRole("link", { name: "Задания" }).click();
    await page.waitForURL(`**/teacher/classes/${CLASS_ID}/assignments`);
    await expect(page).toHaveTitle("Задания · 5 «Б» · ТелеТау");

    const active = page.getByRole("region", { name: "«Моя школа»" });
    await expect(active.getByRole("progressbar", { name: "Сделали" })).toHaveAttribute("aria-valuetext", "9 из 22");
    await expect(active.getByRole("list", { name: /^Сделали: 9/ }).getByRole("link")).toHaveCount(9);
    await expect(active.getByRole("list", { name: /^Ещё нет: 13/ })).toContainText("№07 Смелая пчела");
    const past = page.getByRole("region", { name: "«Привет!»" });
    await expect(past).toContainText("срок был");
    await expect(past.getByRole("list", { name: /^Просрочили/ })).toContainText("№07 Смелая пчела");
    await expect(past.getByRole("list", { name: /^Сделали после срока/ })).toContainText("№05");
    await expectAccessible(page, "задания класса");

    // «Дать задание»: повторение слов, срок «Завтра».
    await page.getByRole("button", { name: "Дать задание" }).click();
    const dialog = page.getByRole("dialog", { name: "Задание классу" });
    await expect(dialog.getByRole("radio", { name: "Моя школа" })).toBeVisible();
    await expectAccessible(page, "диалог «Задание классу»");
    await dialog.getByRole("radio", { name: "Повторить слова" }).check();
    await expect(dialog.getByRole("group", { name: "Урок" })).toHaveCount(0);
    await dialog.getByRole("radio", { name: /^Завтра/ }).check();
    await dialog.getByRole("button", { name: "Дать задание" }).click();
    await expect(dialog).toBeHidden();
    expect(sent).toEqual([{ kind: "review", dueOn: ufaDay(1) }]);
    await expect(page.getByRole("region", { name: "Повторить слова" })).toContainText("до завтра");
    expect(w.teacher.assignments.active).toHaveLength(2);
    // Два активных — больше нельзя, и учитель видит почему.
    await expect(page.getByRole("button", { name: "Дать задание" })).toBeDisabled();
    await expect(page.getByText(/Не больше 2 заданий/)).toBeVisible();

    // Снять задание — подтверждение, и оно пропадает; кнопка снова доступна.
    await page.getByRole("region", { name: "Повторить слова" }).getByRole("button", { name: "Снять задание" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Снять задание" }).click();
    await expect(page.getByRole("region", { name: "Повторить слова" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Дать задание" })).toBeEnabled();
  });

  test("урок по месту: выбор места и урока; номер места ведёт на карточку ученика", async ({ page }) => {
    await mockBackend(page, teacher({ teacher: { ...teacherWorld(), assignments: { active: [], past: [] } } }));
    const sent: Schema<"CreateAssignmentRequest">[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith(`/classes/${CLASS_ID}/assignments`)) sent.push(r.postDataJSON() as Schema<"CreateAssignmentRequest">);
    });
    await page.goto(`/teacher/classes/${CLASS_ID}/assignments`);
    await expect(page.getByRole("heading", { name: "Заданий пока нет" })).toBeVisible();
    await expectAccessible(page, "заданий нет");
    await page.getByRole("button", { name: "Дать задание" }).click();
    const dialog = page.getByRole("dialog", { name: "Задание классу" });
    await dialog.getByRole("radio", { name: "Шульган-Таш" }).check();
    await dialog.getByRole("radio", { name: "Братья и сёстры" }).check();
    await dialog.getByRole("button", { name: "Дать задание" }).click();
    await expect(dialog).toBeHidden();
    expect(sent[0]).toMatchObject({ kind: "lesson", lessonId: "u02-bratya-i-sestry" });
    const card = page.getByRole("region", { name: "«Братья и сёстры»" });
    await expect(card).toContainText("Урок · Шульган-Таш");
    await card.getByRole("link", { name: "№07 Смелая пчела" }).click();
    await page.waitForURL(`**/teacher/classes/${CLASS_ID}/seats/7`);
    await expect(page.getByRole("heading", { level: 1, name: "№07 · Смелая пчела" })).toBeVisible();
  });
});

test.describe("Карточка ученика и отчёт по классу (учитель)", () => {
  test("«Прогресс» → строка ученика → карточка: уроки, точность, слова, серия, голоса, задания, последние занятия", async ({ page }) => {
    await mockBackend(page, teacher());
    await page.goto(`/teacher/classes/${CLASS_ID}/progress`);
    await page.getByRole("link", { name: "№07 · Смелая пчела" }).click();
    await page.waitForURL(`**/teacher/classes/${CLASS_ID}/seats/7`);
    await expect(page).toHaveTitle("№07 · Смелая пчела · 5 «Б» · ТелеТау");
    const stats = page.getByRole("definition");
    await expect(page.getByLabel("Итоги ученика")).toContainText("86%");
    await expect(stats.filter({ hasText: "214" })).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Пройденные уроки" }).getByRole("listitem")).toHaveCount(3);
    await expect(page.getByRole("region", { name: "Задания" })).toContainText("«Моя школа»");
    await expect(page.getByRole("region", { name: "Задания" })).toContainText("ещё нет");
    await expect(page.getByRole("region", { name: "Последние занятия" })).toContainText("сегодня");
    // Только ник и номер места — без ПДн и без технических объяснений.
    await expect(page.locator("main")).not.toContainText(/accountId|@|e-mail/i);
    await expectAccessible(page, "карточка ученика");

    await page.getByRole("link", { name: "Прогресс класса" }).click();
    await page.waitForURL(`**/teacher/classes/${CLASS_ID}/progress`);
  });

  test("пустое место — «На этом месте нет ученика»", async ({ page }) => {
    await mockBackend(page, teacher());
    await page.goto(`/teacher/classes/${CLASS_ID}/seats/24`);
    await expect(page.getByRole("heading", { name: "На этом месте нет ученика" })).toBeVisible();
  });

  test("«Скачать отчёт»: CSV по местам с заданиями (BOM, «;»), ники и номера мест, без ПДн", async ({ page }) => {
    await mockBackend(page, teacher());
    await page.goto(`/teacher/classes/${CLASS_ID}/progress`);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Скачать отчёт" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^teletau-otchet-5Б-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = readFileSync((await download.path())!, "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const [head, ...rows] = text.slice(1).trim().split("\r\n");
    expect(head!.split(";").slice(0, 9)).toEqual(["Место", "Ник", "Уроков пройдено", "Точность, %", "Слов выучено", "Серия, дней", "Уроков за неделю", "Мёд за неделю", "Последнее занятие"]);
    expect(head).toMatch(/Задание: «Моя школа» до \d\d\.\d\d;Задание: «Привет!» до \d\d\.\d\d;Заданий сделано$/);
    expect(rows).toHaveLength(22);
    const hero = rows.find((r) => r.startsWith("7;"))!.split(";");
    expect(hero.slice(0, 6)).toEqual(["7", "Смелая пчела", "3", "86", String(3 * 6 + 3), "6"]);
    expect(hero.slice(-3)).toEqual(["ещё нет", "просрочено", "0 из 2"]);
  });

  test("печатная версия «Прогресса»: без шапки, разделов и кнопок; подпись отчёта; светлая тема", async ({ page }) => {
    await chooseTheme(page, "dark");
    await mockBackend(page, teacher());
    await page.goto(`/teacher/classes/${CLASS_ID}/progress`);
    await expect(page.getByText("№07 · Смелая пчела")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByText(/^Отчёт по классу/)).toBeHidden();
    await page.emulateMedia({ media: "print" });
    await expect(page.getByText(/^Отчёт по классу 5 «Б» · неделя/)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Разделы класса" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Скачать отчёт" })).toBeHidden();
    await expect(page.locator(".tt-topbar")).toBeHidden();
    await expect(page.getByRole("table", { name: "Прогресс учеников" })).toBeVisible();
    // beforeprint → светлая тема на время печати.
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});

test.describe("Задание учителя на тропе (ученик)", () => {
  test("карточка «Задание учителя · до …» → «Начать задание» открывает заданный урок; после урока — «выполнено»", async ({ page }) => {
    const learn = learnWorld();
    learn.course = { ...learn.course, assignments: [{ id: "0193f7a4-0000-7000-8000-0000000a5001", kind: "lesson", lessonId: "u01-moya-shkola", titleRu: "Моя школа", placeRu: "Уфа", dueOn: ufaDay(2), done: false }] };
    const w = await mockBackend(page, { account: childMe(), learn });
    await page.goto("/learn");
    const card = page.getByRole("region", { name: "«Моя школа»" });
    await expect(card).toContainText("Задание учителя");
    await expect(card).toContainText(/до (пн|вт|ср|чт|пт|сб|вс)/);
    await expectAccessible(page, "тропа с заданием учителя");
    await card.getByRole("button", { name: "Начать задание" }).click();
    await expect(page.getByRole("button", { name: "Выйти из урока" })).toBeVisible();
    expect(w.calls).toContain("POST /lessons/u01-moya-shkola/runs");
  });

  test("выполненное задание — спокойная строка «Задание учителя выполнено» без кнопки", async ({ page }) => {
    const learn = learnWorld();
    learn.course = { ...learn.course, assignments: [{ id: "0193f7a4-0000-7000-8000-0000000a5002", kind: "review", titleRu: "Повторить слова", dueOn: ufaDay(), done: true }] };
    await mockBackend(page, { account: childMe(), learn });
    await page.goto("/learn");
    const card = page.getByRole("region", { name: "Повторить слова" });
    await expect(card).toContainText("Задание учителя выполнено");
    await expect(card.getByRole("button")).toHaveCount(0);
  });
});
