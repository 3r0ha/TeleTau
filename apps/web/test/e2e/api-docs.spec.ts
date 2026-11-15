// Документация API (/api-docs, app/api-docs): страница из JSON-копии контракта (@teletau/contracts/openapi.json).
// Блок открытых данных с выгрузкой словаря, все операции контракта, раскрытие операций и схем, файлы контракта
// для скачивания, ссылка в подвале лендинга, axe в светлой и тёмной теме, 390 px без прокрутки вбок.
// API на странице не вызывается.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mockBackend } from "./mock-api";
import { chooseTheme } from "./theme";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const METHODS = ["get", "post", "put", "patch", "delete"];

type Contract = { paths: Record<string, Record<string, { operationId: string }>> };
const contract = JSON.parse(readFileSync(createRequire(import.meta.url).resolve("@teletau/contracts/openapi.json"), "utf8")) as Contract;
const operationIds = Object.values(contract.paths).flatMap((item) => METHODS.flatMap((m) => (item[m] ? [item[m].operationId] : [])));

/** Имя поля или параметра целиком: «status», а не «statusText». */
const exactName = (name: string) => new RegExp(`^${name}$`);

async function open(page: Page) {
  await mockBackend(page);
  await page.goto("/api-docs");
  await expect(page.getByRole("heading", { level: 1, name: "Документация API" })).toBeVisible();
}

test.describe("документация API", () => {
  test("вступление и блок открытых данных: выгрузка словаря с параметрами, полями и примером", async ({ page }) => {
    await open(page);
    await expect(page.getByText("https://api.teletau.study/api/v1")).toBeVisible();
    await expect(page.getByRole("link", { name: "Скачать openapi.yaml" })).toHaveAttribute("href", "/api-docs/openapi.yaml");
    await expect(page.getByRole("link", { name: "openapi.json", exact: true })).toHaveAttribute("href", "/api-docs/openapi.json");

    const openData = page.getByRole("region", { name: "Открытые данные" });
    const dictionary = openData.getByRole("article", { name: "Выгрузка словаря" });
    await expect(dictionary).toBeVisible();
    await expect(dictionary).toContainText("/api/v1/public/dictionary");
    await expect(dictionary.getByRole("link", { name: "Скачать CSV" })).toHaveAttribute("href", "https://api.teletau.study/api/v1/public/dictionary?format=csv");
    const params = dictionary.locator(".ad-fact", { hasText: "Параметры" });
    for (const param of ["format", "status"]) {
      await expect(params.locator(".ad-field__name", { hasText: exactName(param) })).toHaveCount(1);
    }
    const fields = dictionary.locator(".ad-key__part", { hasText: "Поля записи" });
    for (const field of ["fragmentId", "textBa", "langPair", "translation", "sources", "confirmed", "status"]) {
      await expect(fields.locator(".ad-field__name", { hasText: exactName(field) })).toHaveCount(1);
    }
    await expect(dictionary.locator("pre")).toContainText('"fragmentId"');
    await expect(openData.getByRole("article", { name: "Доска почёта" })).toContainText("/api/v1/public/leaderboard");
    await expect(openData.getByRole("article", { name: "Фраза дня" })).toContainText("/api/v1/public/phrase-of-day");
  });

  test("в полном списке — все операции контракта, каждая один раз", async ({ page }) => {
    await open(page);
    expect(operationIds.length).toBeGreaterThan(0);
    const shown = await page.locator("article[data-op]").evaluateAll((els) => els.map((el) => el.getAttribute("data-op")));
    expect(shown).toHaveLength(operationIds.length);
    expect([...shown].sort()).toEqual([...operationIds].sort());
  });

  test("операция раскрывается; ссылка на схему открывает её описание", async ({ page }) => {
    await open(page);
    const op = page.locator('article[data-op="getPublicDictionary"]');
    await expect(op.locator(".ad-op__body")).toBeHidden();
    await op.locator("summary").click();
    await expect(op.locator(".ad-op__body")).toBeVisible();

    const schema = page.locator("details", { has: page.locator("#s-PublicDictionary") });
    await expect(schema).not.toHaveAttribute("open");
    await op.getByRole("link", { name: "PublicDictionary", exact: true }).click();
    await expect(page).toHaveURL(/#s-PublicDictionary$/);
    await expect(schema).toHaveAttribute("open");
    await expect(schema.locator(".ad-field__name", { hasText: exactName("items") })).toBeVisible();
  });

  test("файлы контракта: openapi.yaml — YAML, openapi.json — JSON", async ({ request }) => {
    const yaml = await request.get("/api-docs/openapi.yaml");
    expect(yaml.status()).toBe(200);
    expect(yaml.headers()["content-type"]).toMatch(/^application\/yaml/);
    const text = await yaml.text();
    expect(text).toMatch(/^openapi: 3\.1/);
    expect(text).toContain("/api/v1/public/dictionary:");

    const json = await request.get("/api-docs/openapi.json");
    expect(json.status()).toBe(200);
    expect(json.headers()["content-type"]).toMatch(/^application\/json/);
    expect(((await json.json()) as { openapi: string }).openapi).toMatch(/^3\.1/);
  });

  test("ссылка «API» в подвале лендинга", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "API", exact: true })).toHaveAttribute("href", "/api-docs");
  });

  for (const dark of [false, true]) {
    test(`axe без серьёзных нарушений, ${dark ? "тёмная" : "светлая"} тема`, async ({ page }) => {
      // Страница длинная (все операции и схемы): axe проверяет её дольше обычного.
      test.setTimeout(90_000);
      if (dark) await chooseTheme(page, "dark");
      await open(page);
      const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      const report = serious.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`).join("\n");
      expect(serious, `документация API: нарушения axe\n${report}`).toEqual([]);
    });
  }

  test("390 px: без горизонтальной прокрутки, в том числе с раскрытыми операциями и схемами и крупным шрифтом", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.evaluate(() => {
      for (const details of document.querySelectorAll("details")) details.open = true;
    });
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "20px";
    });
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});
