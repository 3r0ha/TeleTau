// Сборка презентации: deck.mjs → presentation/build/deck.html → teletau.pdf (Chromium из Playwright, без окон).
// Запуск: node presentation/build.mjs [--png <каталог>] — с --png ещё и снимок каждого слайда для проверки глазами.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deck } from "./deck.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
// Зависимости — из веба: React для SSR иконок Phosphor и Playwright. У Phosphor берём ESM-сборку `ssr`: CommonJS-файл
// пакета с "type": "module" Node загрузить не может.
const require = createRequire(join(root, "apps/web/package.json"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const phosphorDist = dirname(require.resolve("@phosphor-icons/react/ssr"));
const Icons = await import(pathToFileURL(join(phosphorDist, "ssr/index.es.js")).href);
const { chromium } = require("@playwright/test");

function icon(name, weight = "fill") {
  const C = Icons[name];
  if (!C) throw new Error(`нет иконки Phosphor «${name}»`);
  return renderToStaticMarkup(React.createElement(C, { weight, size: "100%", "aria-hidden": true }));
}

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>ТелеТау</title>
<link rel="stylesheet" href="../../packages/design-tokens/fonts/fonts.css">
<link rel="stylesheet" href="../../packages/design-tokens/build/css/tokens.css">
<link rel="stylesheet" href="../deck.css">
<base href="../">
</head>
<body>
${deck({ icon })}
</body>
</html>`;

// Ссылки на стили — от build/, картинки — от presentation/ (base). Стили подключены до base, поэтому идут от файла.
const outDir = join(here, "build");
mkdirSync(outDir, { recursive: true });
const htmlPath = join(outDir, "deck.html");
writeFileSync(htmlPath, html);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const broken = await page.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute("src")));
  if (broken.length) throw new Error(`не загрузились картинки: ${broken.join(", ")}`);

  const pngAt = process.argv.indexOf("--png");
  if (pngAt > 0) {
    const dir = resolve(process.argv[pngAt + 1]);
    mkdirSync(dir, { recursive: true });
    const slides = await page.$$(".slide");
    for (const [i, s] of slides.entries()) await s.screenshot({ path: join(dir, `slide-${String(i + 1).padStart(2, "0")}.png`) });
  }

  const pdf = join(here, "teletau.pdf");
  await page.pdf({ path: pdf, width: "1920px", height: "1080px", printBackground: true, preferCSSPageSize: true });
  console.log(`готово: ${pdf}`);
} finally {
  await browser.close();
}
