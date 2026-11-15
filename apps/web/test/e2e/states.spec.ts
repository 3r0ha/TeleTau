// Состояния второстепенных экранов (docs/05 §12 п. 3): ошибка загрузки — понятный текст и повтор рядом с ней,
// без бесконечного скелетона и без молчаливого «всё хорошо». API отвечает ошибкой через World.failures (mock-api.ts).
import { expect, test } from "@playwright/test";
import { adultMe, childMe, mockBackend } from "./mock-api";

const applicant = () => adultMe({ teacherStatus: "none", roles: [], classes: [], profile: { email: "teacher@school7.example" } });

test.describe("ошибка загрузки — текст и «Попробовать ещё раз»", () => {
  test("профиль: нет связи с API — «Нет связи» с повтором, после повтора — данные", async ({ page }) => {
    const w = await mockBackend(page, { account: adultMe(), failures: { "GET /me": "offline" } });
    await page.goto("/teacher/profile");
    await expect(page.getByRole("heading", { name: "Нет связи" })).toBeVisible();
    delete w.failures["GET /me"];
    await page.getByRole("button", { name: "Попробовать ещё раз" }).click();
    await expect(page.getByText("teacher@school7.example")).toBeVisible();
  });

  test("заявка, шаг 2: районы не загрузились — повтор рядом с ошибкой", async ({ page }) => {
    const w = await mockBackend(page, { account: applicant(), failures: { "GET /districts": "offline" } });
    await page.goto("/teacher/apply");
    await page.getByLabel("Фамилия, имя, отчество").fill("Учитель Демонстрационный");
    await page.getByLabel("Должность").fill("Учитель башкирского языка");
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page.getByText("Нет связи. Проверьте интернет.")).toBeVisible();
    delete w.failures["GET /districts"];
    await page.getByRole("button", { name: "Попробовать ещё раз" }).click();
    await expect(page.getByRole("radio", { name: /Уфа/ })).toBeVisible();
  });

  test("заявка, шаг 3: школы не загрузились — повтор рядом с ошибкой", async ({ page }) => {
    const w = await mockBackend(page, { account: applicant(), failures: { "GET /schools": { status: 500, code: "internal" } } });
    await page.goto("/teacher/apply");
    await page.getByLabel("Фамилия, имя, отчество").fill("Учитель Демонстрационный");
    await page.getByLabel("Должность").fill("Учитель башкирского языка");
    await page.getByRole("button", { name: "Дальше" }).click();
    await page.getByRole("radio", { name: /Уфа/ }).check();
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page.getByText("Что-то пошло не так")).toBeVisible();
    delete w.failures["GET /schools"];
    await page.getByRole("button", { name: "Попробовать ещё раз" }).click();
    await expect(page.getByRole("radio", { name: /Школа № 7/ })).toBeVisible();
  });

  test("выбор ника: варианты не загрузились — «Попробовать ещё раз» рядом с ошибкой", async ({ page }) => {
    const w = await mockBackend(page, { account: childMe({ nickname: undefined }), failures: { "GET /nicknames/suggest": "offline" } });
    await page.goto("/student/nickname");
    await expect(page.getByText("Нет связи. Проверь интернет.")).toBeVisible();
    delete w.failures["GET /nicknames/suggest"];
    await page.getByRole("button", { name: "Попробовать ещё раз" }).click();
    await expect(page.getByRole("radio")).toHaveCount(3);
  });

  test("ожидание проверки: 500 от GET /teacher/verification — ошибка с повтором, а не «Заявка на проверке»", async ({ page }) => {
    const w = await mockBackend(page, {
      account: adultMe({ teacherStatus: "pending", roles: [], classes: [] }),
      failures: { "GET /teacher/verification": { status: 500, code: "internal" } },
    });
    await page.goto("/teacher/pending");
    await expect(page.getByRole("heading", { name: "Что-то пошло не так" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Заявка на проверке" })).toHaveCount(0);
    delete w.failures["GET /teacher/verification"];
    await page.getByRole("button", { name: "Попробовать ещё раз" }).click();
    await expect(page.getByRole("heading", { name: "Заявка на проверке" })).toBeVisible();
    await expect(page.getByText("Школа № 7")).toBeVisible();
  });
});
