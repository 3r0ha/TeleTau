// Снимки веба для презентации — со стенда (реальные данные: словарь с kz-парами, доска почёта, демо-мир учителя
// и консоли). Запуск: node presentation/shots-web.mjs — пишет presentation/shots/*.png.
// Серверы не нужны: Playwright ходит на https://teletau.study и https://console.teletau.study.
// Единый формат: viewport 1600×900, deviceScaleFactor 2 → 3200×1800 (16:9) — на полноэкранном слайде
// вписывается почти без полей. Исключение — доска почёта: снимок элемента целиком (он широкий и низкий).
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const require = createRequire(join(root, "apps/web/package.json"));
const { chromium } = require("@playwright/test");

const WEB = "https://teletau.study";
const CONSOLE = "https://console.teletau.study";
const DEMO_CODE = "0000";
const OUT = (name) => join(here, "shots", `${name}.png`);

const browser = await chromium.launch();
const newPage = () => browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 }).then((c) => c.newPage());
const fail = (name, e) => {
  console.error(`${name}: ${e.message}`);
  process.exitCode = 1;
};
const snap = (name, page) => page.screenshot({ path: OUT(name) }).then(() => console.log(`${name}.png`));

/** Вход учителя на стенде: «Кабинет учителя» → почта → код из письма (демо 0000). */
async function loginTeacher(page, email) {
  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.getByRole("region", { name: "Для школ" }).getByRole("link", { name: "Кабинет учителя" }).click();
  await page.getByLabel("Электронная почта").fill(email);
  await page.getByRole("button", { name: "Получить код" }).click();
  await page.getByLabel("Код из письма: символ 1 из 4").fill(DEMO_CODE);
  await page.waitForURL(`${WEB}/teacher**`);
}

/** Вход сотрудника консоли на стенде (без TOTP — демо-режим стенда): почта → код из письма. */
async function loginStaff(page, email, section) {
  await page.goto(`${CONSOLE}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Рабочая почта").fill(email);
  await page.getByRole("button", { name: "Получить код" }).click();
  await page.getByLabel("Код из письма: символ 1 из 4").fill(DEMO_CODE);
  await page.waitForURL(`${CONSOLE}${section}**`);
}

// Лендинг на башкирском: переключатель языков в шапке, герой переведён.
{
  const page = await newPage();
  try {
    await page.context().addCookies([{ name: "tt_locale", value: "ba", url: WEB }]);
    await page.goto(WEB, { waitUntil: "networkidle" });
    await page.locator(".lp-hero__title").waitFor();
    await snap("landing-ba", page);
  } catch (e) {
    fail("landing-ba", e);
  }
  await page.context().close();
}

// Доска почёта внизу лендинга: периоды, топ школ и классов — элемент целиком.
{
  const page = await newPage();
  try {
    await page.goto(WEB, { waitUntil: "networkidle" });
    const board = page.locator(".lp-board");
    await board.waitFor();
    await board.scrollIntoViewIfNeeded();
    await board.screenshot({ path: OUT("landing-board") });
    console.log("landing-board.png");
  } catch (e) {
    fail("landing-board", e);
  }
  await page.context().close();
}

// Публичный словарь: обе языковые пары, счётчики, поиск.
{
  const page = await newPage();
  try {
    await page.goto(`${WEB}/dictionary`, { waitUntil: "networkidle" });
    await page.locator("tbody tr").first().waitFor();
    await snap("dictionary", page);
  } catch (e) {
    fail("dictionary", e);
  }
  await page.context().close();
}

// Кабинет учителя: сводка класса (кто занимался, задание, кто отстаёт).
{
  const page = await newPage();
  try {
    await loginTeacher(page, "teacher@demo.teletau.local");
    await page.locator("main").waitFor();
    await snap("teacher-home", page);
  } catch (e) {
    fail("teacher-home", e);
  }
  await page.context().close();
}

// Прогресс класса: таблица по урокам (экран, не вся страница).
{
  const page = await newPage();
  try {
    await loginTeacher(page, "teacher@demo.teletau.local");
    const first = page.getByRole("link", { name: /Класс|Прогресс/ }).first();
    await first.click();
    await page.locator("main").waitFor();
    await page.waitForLoadState("networkidle");
    await snap("teacher-progress", page);
  } catch (e) {
    fail("teacher-progress", e);
  }
  await page.context().close();
}

// Консоль: министерство — «Республика» (охват, районы, школы).
{
  const page = await newPage();
  try {
    await loginStaff(page, "ministry@demo.teletau.local", "/republic");
    await page.locator("main").waitFor();
    await snap("ministry", page);
  } catch (e) {
    fail("ministry", e);
  }
  await page.context().close();
}

// Консоль: словарь для Фонда — принятые пары с голосами.
{
  const page = await newPage();
  try {
    await loginStaff(page, "fund@demo.teletau.local", "/fund");
    await page.locator("main").waitFor();
    await page.waitForLoadState("networkidle");
    await snap("fund", page);
  } catch (e) {
    fail("fund", e);
  }
  await page.context().close();
}

await browser.close();
