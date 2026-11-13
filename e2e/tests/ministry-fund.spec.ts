// Кабинет министерства и словарь для Фонда (ADR 0023) против настоящего стека и демо-мира (apps/api/src/demo/region.ts):
// министерство входит в консоль → «Республика» крупными числами → район → школы, малые группы «< 5» → чужие разделы
// закрыты; Фонд → принятые пары демо-мира с голосами по группам → «Скачать таблицу (CSV)». Ни ников, ни номеров мест.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { stack } from "../support/env.js";
import { expectAccessible, FUND, heading, loginStaff, MINISTRY } from "../support/stack.js";

test("министерство: «Республика» → район → школы; малые группы скрыты, чужих разделов нет", async ({ page }) => {
  const { consoleUrl } = stack();
  await loginStaff(page, MINISTRY, "Республика Башкортостан");
  await page.waitForURL(`${consoleUrl}/republic`);
  // Демо-мир: 7 районов республики и демо-район, классы и ученики — числа крупно.
  const reach = page.getByRole("region", { name: "Охват" });
  await expect(reach.getByText("Районов и округов подключено")).toBeVisible();
  const districts = /(\d+)\s*из (\d+)/.exec((await reach.getByRole("definition").first().textContent()) ?? "");
  expect(Number(districts?.[1])).toBeGreaterThanOrEqual(8);
  expect(Number(districts?.[2])).toBeGreaterThanOrEqual(63);
  await expect(page.getByRole("region", { name: "Ученики" })).toContainText("Учеников в школах");
  await expect(page.getByRole("region", { name: "По неделям" })).toBeVisible();
  await expectAccessible(page, "консоль: республика");

  const table = page.getByRole("table", { name: /Районы и городские округа/ });
  // Бурзянский район — 3 ученика: «< 5», чисел нет.
  await expect(table.getByRole("row", { name: /Бурзянский район/ })).toContainText("< 5");
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/№\s?\d{2}\s·|пчела|шмель|барсук/i);

  await table.getByRole("link", { name: "городской округ город Уфа" }).click();
  await expect(heading(page, "городской округ город Уфа")).toBeVisible();
  const schools = page.getByRole("table", { name: /Школы района/ });
  await expect(schools.locator("tbody tr").first()).toBeVisible();
  expect(await schools.locator("tbody tr").count()).toBeGreaterThanOrEqual(3);
  await expectAccessible(page, "консоль: школы района");
  await page.getByRole("link", { name: "Республика" }).click();
  await table.getByRole("link", { name: "Баймакский район" }).click();
  // Школа на 4 ученика — «< 5», и ещё одна скрыта дополнительно.
  await expect(page.getByRole("table", { name: /Школы района/ })).toContainText("< 5");
  await expect(page.getByRole("table", { name: /Школы района/ })).toContainText("скрыто");

  for (const path of ["/verifications", "/audit", "/fund"]) {
    await page.goto(`${consoleUrl}${path}`);
    await expect(heading(page, "Раздел недоступен")).toBeVisible();
  }
});

test("Фонд: принятые пары демо-мира, «Предварительно», скачать CSV", async ({ page }) => {
  const { consoleUrl } = stack();
  await loginStaff(page, FUND, "Словарь для Фонда");
  await page.waitForURL(`${consoleUrl}/fund`);
  await expect(page.getByText("Предварительно.")).toBeVisible();
  const rows = page.locator("table tbody tr");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThanOrEqual(5);
  await expect(rows.first()).toContainText(/Дети \d+ из \d+/);
  await expect(rows.first()).toContainText("ждёт проверки носителем");
  await expectAccessible(page, "консоль: словарь для Фонда");

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Скачать таблицу (CSV)" }).click()]);
  const csv = readFileSync((await download.path())!, "utf8");
  // BOM — для Excel; trim() его срезал бы, поэтому проверка — по исходному тексту.
  expect(csv.startsWith("\uFEFFРусский исходник;Башкирский вариант;")).toBe(true);
  const lines = csv.trim().split("\r\n");
  expect(lines).toHaveLength((await rows.count()) + 1);
  expect(csv).toContain(";предварительно;");

  await page.goto(`${consoleUrl}/republic`);
  await expect(heading(page, "Раздел недоступен")).toBeVisible();
});
