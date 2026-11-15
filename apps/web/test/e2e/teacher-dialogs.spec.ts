// Листы учителя на моках API: выбор в открытом листе не сбрасывается опросом, итог выпуска не откатывается, фокус
// не теряется, когда нажатая кнопка исчезает; блок заданий без данных показывает повтор.
import { expect, test } from "@playwright/test";
import type { Schema } from "@teletau/contracts";
import { API, CLASS_ID, adultMe, classDetail, mockBackend, type World } from "./mock-api";
import { demoSeats, teacherWorld } from "./mock-teacher";

const teacher = (init: Partial<World> = {}) => ({ account: adultMe(), classDetail: classDetail({ seats: demoSeats() }), ...init });
const ASSIGNMENTS = `GET /classes/${CLASS_ID}/assignments`;

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("«Задание классу»: опрос заданий не сбрасывает выбор места и урока", async ({ page }) => {
  await page.clock.install();
  const w = await mockBackend(page, teacher({ teacher: { ...teacherWorld(), assignments: { active: [], past: [] } } }));
  const sent: Schema<"CreateAssignmentRequest">[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith(`/classes/${CLASS_ID}/assignments`)) sent.push(r.postDataJSON() as Schema<"CreateAssignmentRequest">);
  });
  await page.goto(`/teacher/classes/${CLASS_ID}/assignments`);
  await expect(page.getByRole("heading", { name: "Заданий пока нет" })).toBeVisible();
  await page.getByRole("button", { name: "Дать задание" }).click();
  const dialog = page.getByRole("dialog", { name: "Задание классу" });
  await dialog.getByRole("radio", { name: "Шульган-Таш" }).check();
  await dialog.getByRole("radio", { name: "Братья и сёстры" }).check();

  const polls = w.calls.filter((c) => c === ASSIGNMENTS).length;
  await page.clock.runFor(16_000);
  await expect.poll(() => w.calls.filter((c) => c === ASSIGNMENTS).length).toBeGreaterThan(polls);
  await page.clock.runFor(500);

  await expect(dialog.getByRole("radio", { name: "Шульган-Таш" })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "Братья и сёстры" })).toBeChecked();
  await dialog.getByRole("button", { name: "Дать задание" }).click();
  await expect(dialog).toBeHidden();
  expect(sent[0]).toMatchObject({ kind: "lesson", lessonId: "u02-bratya-i-sestry" });
});

test("выпуск карточек: после обновления класса лист остаётся на «Карточки готовы», фокус — на «Скачать PDF»", async ({ page }) => {
  const w = await mockBackend(page, { account: adultMe(), classDetail: classDetail({ seats: [], pendingJoinRequestCount: 0 }) });
  // Как у API: выпущенные места появляются в классе — свободных мест становится меньше.
  await page.route(`${API}/api/v1/classes/${CLASS_ID}/seats`, async (route) => {
    if (route.request().method() === "POST") {
      const { count } = route.request().postDataJSON() as { count: number };
      const first = (w.classDetail.seats?.length ?? 0) + 1;
      const added = Array.from({ length: count }, (_, i) => ({ number: first + i, cardStatus: "active" as const, cardVersion: 1 }));
      w.classDetail = { ...w.classDetail, seats: [...(w.classDetail.seats ?? []), ...added] };
      const printJob = { id: "0193f7a4-0000-7000-8000-0000000p0001", expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), seatNumbers: added.map((x) => x.number), pdfPath: `/api/v1/classes/${CLASS_ID}/cards.pdf?printJob=0193f7a4-0000-7000-8000-0000000p0001` };
      return route.fulfill({ status: 201, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ printJob, seats: added }) });
    }
    return route.fallback();
  });
  await page.goto(`/teacher/classes/${CLASS_ID}`);
  await expect(page.getByRole("heading", { name: "Первый урок" })).toBeVisible();
  await page.getByRole("button", { name: "Выпустить карточки" }).first().click();
  const dialog = page.getByRole("dialog");
  const reloaded = page.waitForRequest((r) => r.method() === "GET" && r.url().endsWith(`/api/v1/classes/${CLASS_ID}`));
  await dialog.getByRole("button", { name: /Выпустить 24 карточки/ }).click();
  await expect(dialog.getByText("Карточки готовы")).toBeVisible();
  await reloaded;
  await expect(page.getByRole("heading", { name: "Места" })).toBeVisible();
  await expect(dialog.getByText("Карточки готовы")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Выпустить \d+ карточ/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Скачать PDF" })).toBeFocused();
});

test("заявки на вход: решённая строка уходит — фокус на кнопке следующей заявки, затем на «Готово»", async ({ page }) => {
  await mockBackend(page, { account: adultMe() });
  await page.goto(`/teacher/classes/${CLASS_ID}`);
  await page.getByRole("button", { name: "Посмотреть" }).click();
  const requests = page.getByRole("dialog", { name: "Заявки на вход" });
  await requests.getByRole("button", { name: "Принять: Тёплый ветер" }).click();
  await expect(requests.getByText("В классе · №25")).toBeVisible();
  await expect(requests.getByRole("button", { name: "Принять: Зоркий сокол" })).toBeFocused();
  await requests.getByRole("button", { name: "Отклонить: Зоркий сокол" }).click();
  await expect(requests.getByText("Отклонена", { exact: true })).toBeVisible();
  await expect(requests.getByRole("button", { name: "Готово" })).toBeFocused();
});

test.describe("задания класса не загрузились — повтор, а не вечный скелетон", () => {
  test("обзор класса: блок «Задание»", async ({ page }) => {
    const w = await mockBackend(page, teacher({ failures: { [ASSIGNMENTS]: { status: 500, code: "internal" } } }));
    await page.goto(`/teacher/classes/${CLASS_ID}`);
    const card = page.getByRole("region", { name: "Задание", exact: true });
    await expect(card.getByText("Не получилось загрузить.")).toBeVisible();
    delete w.failures[ASSIGNMENTS];
    await card.getByRole("button", { name: "Попробовать ещё раз" }).click();
    await expect(card.getByText("Не получилось загрузить.")).toHaveCount(0);
    await expect(card).toContainText("сделали");
  });

  test("карточка ученика: блок «Задания»", async ({ page }) => {
    const w = await mockBackend(page, teacher({ failures: { [ASSIGNMENTS]: { status: 500, code: "internal" } } }));
    await page.goto(`/teacher/classes/${CLASS_ID}/seats/7`);
    const card = page.getByRole("region", { name: "Задания", exact: true });
    await expect(card.getByText("Не получилось загрузить.")).toBeVisible();
    delete w.failures[ASSIGNMENTS];
    await card.getByRole("button", { name: "Попробовать ещё раз" }).click();
    await expect(card.getByText("Не получилось загрузить.")).toHaveCount(0);
    await expect(card).toContainText("Моя школа");
  });
});

test("«Помогите языку»: «Ещё пары» — пока грузится новый заход, прежняя пара не показывается снова", async ({ page }) => {
  const w = await mockBackend(page, teacher({ delays: { "GET /corpus/duels": 800 } }));
  w.teacher.items.splice(1);
  await page.goto("/teacher/duels");
  await page.getByRole("radio", { name: "Һаумыһығыҙ!" }).click();
  await page.getByRole("button", { name: "Отдать голос" }).click();
  await expect(page.getByRole("region", { name: "Голоса по группам" })).toBeVisible();
  await page.getByRole("button", { name: "Ещё пары" }).click();
  await expect(page.getByLabel("Загружаем пары")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Һаумыһығыҙ!" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Все пары оценены" })).toBeVisible();
});

test("заявка учителя: другой район — пока грузятся его школы, школ прежнего района на экране нет", async ({ page }) => {
  const w = await mockBackend(page, { account: adultMe({ teacherStatus: "none", roles: [], classes: [] }) });
  await page.goto("/teacher/apply");
  await page.getByLabel("Фамилия, имя, отчество").fill("Учитель Демонстрационный");
  await page.getByLabel("Должность").fill("Учитель башкирского языка");
  await page.getByRole("button", { name: "Дальше" }).click();
  await page.getByRole("radio", { name: /Уфа/ }).check();
  await page.getByRole("button", { name: "Дальше" }).click();
  await expect(page.getByRole("radio")).toHaveCount(3);
  await page.goBack();
  await page.getByRole("radio", { name: /Бурзянский район/ }).check();
  w.delays = { "GET /schools": 800 };
  await page.getByRole("button", { name: "Дальше" }).click();
  await expect(page.getByLabel("Ищем школы")).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(3);
});
