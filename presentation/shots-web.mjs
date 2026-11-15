// Снимки со стенда для презентации: лендинг на башкирском и публичный словарь (живые данные teletau.study).
// Запуск: node presentation/shots-web.mjs — пишет presentation/shots/{landing-ba,dictionary}.png. Вход не нужен.
// Остальные экраны — из демо-мира на моках: TELETAU_SCREENS=1 TELETAU_SCREENS_DIR=<папка>
// pnpm --filter @teletau/web test:a11y (и то же для консоли), соответствие файлов — presentation/README.md.
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const require = createRequire(join(root, "apps/web/package.json"));
const { chromium } = require("@playwright/test");

const WEB = "https://teletau.study";
const OUT = (name) => join(here, "shots", `${name}.png`);

const browser = await chromium.launch();
const newPage = (viewport) =>
  browser.newContext({ viewport, deviceScaleFactor: 2, locale: "ru-RU", reducedMotion: "reduce" }).then((c) => c.newPage());

async function shoot(name, viewport, go, clip) {
  const page = await newPage(viewport);
  try {
    await go(page);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: OUT(name), ...(clip ? { clip } : {}) });
    console.log(`${name}.png`);
  } catch (e) {
    console.error(`${name}: ${e.message}`);
    process.exitCode = 1;
  }
  await page.context().close();
}

// Лендинг на башкирском: язык — cookie tt_locale, как у переключателя в шапке.
await shoot("landing-ba", { width: 1600, height: 900 }, async (page) => {
  await page.context().addCookies([{ name: "tt_locale", value: "ba", url: WEB }]);
  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.locator(".lp-hero__title").waitFor();
});

// Публичный словарь: колонка контента без пустых полей по бокам (480×760 → 960×1520).
await shoot(
  "dictionary",
  { width: 900, height: 760 },
  async (page) => {
    await page.goto(`${WEB}/dictionary`, { waitUntil: "networkidle" });
    await page.locator("tbody tr").first().waitFor();
  },
  { x: 210, y: 0, width: 480, height: 760 },
);

await browser.close();
