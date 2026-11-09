// Сбитые часы устройства и зависший API.
import { expect, test } from "@playwright/test";
import { API, CLASS_ID, adultMe, classDetail, mockBackend } from "./mock-api";

test.describe("M1-18: сроки — по часам сервера, а не устройства", () => {
  test("часы школьного ПК спешат на 20 минут: свежий код класса (15 мин) не «истёк»", async ({ page }) => {
    // Время устройства +20 мин; сервер (моки BFF) отвечает с Date по настоящим часам.
    await page.clock.install({ time: Date.now() + 20 * 60_000 });
    await mockBackend(page, { account: adultMe() });
    await page.goto(`/teacher/classes/${CLASS_ID}`);
    await expect(page.getByRole("heading", { name: "Места" })).toBeVisible();
    await page.getByRole("button", { name: "Показать код класса" }).click();
    const board = page.getByRole("dialog", { name: "Код класса 5 «Б»" });
    await expect(board.getByText("K7Q-4MZ")).toBeVisible();
    await expect(board.getByText(/^Действует ещё 1[45]:\d\d$/)).toBeVisible();
    await expect(board.getByText("Код истёк — покажите новый")).toHaveCount(0);
  });

  test("часы спешат на 40 минут: задание печати (30 мин) живо — PDF можно скачать", async ({ page }) => {
    await page.clock.install({ time: Date.now() + 40 * 60_000 });
    await mockBackend(page, { account: adultMe(), classDetail: classDetail({ seats: [], pendingJoinRequestCount: 0 }) });
    await page.goto(`/teacher/classes/${CLASS_ID}`);
    await expect(page.getByRole("heading", { name: "Первый урок" })).toBeVisible();
    await page.getByRole("button", { name: "Выпустить карточки" }).first().click();
    await page.getByRole("button", { name: /Выпустить 24 карточки/ }).click();
    await expect(page.getByText("Карточки готовы")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Закрыть" }).click();
    await expect(page.getByRole("button", { name: "Скачать PDF" })).toBeEnabled();
    await expect(page.getByText(/№01–№24\. PDF доступен до/)).toBeVisible();
  });

  test("таймер не показывает больше срока жизни кода (15:00), даже если часы устройства отстают", async ({ page }) => {
    await page.clock.install({ time: Date.now() - 3_000 });
    await mockBackend(page, { account: adultMe() });
    await page.goto(`/teacher/classes/${CLASS_ID}`);
    await page.getByRole("button", { name: "Показать код класса" }).click();
    const timer = page.getByRole("dialog").getByText(/^Действует ещё \d+:\d\d$/);
    await expect(timer).toBeVisible();
    const [, m, s] = /(\d+):(\d\d)/.exec((await timer.textContent())!)!;
    expect(Number(m) * 60 + Number(s)).toBeLessThanOrEqual(15 * 60);
  });
});

test.describe("M1-24: таймауты запросов", () => {
  test("API завис — через таймаут страница показывает «Нет связи», а не вечную загрузку", async ({ page }) => {
    test.setTimeout(45_000);
    await mockBackend(page, { account: adultMe() });
    // Ответа нет вовсе (зависшее соединение в мобильной сети).
    await page.route(`${API}/api/v1/classes/${CLASS_ID}`, () => new Promise(() => undefined));
    await page.goto(`/teacher/classes/${CLASS_ID}`);
    await expect(page.getByRole("heading", { name: "Нет связи" })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("button", { name: "Попробовать снова" })).toBeVisible();
  });
});
