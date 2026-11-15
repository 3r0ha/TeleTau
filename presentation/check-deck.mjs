// Проверка геометрии слайдов: переполнение слайда и габариты телефонов/полноэкранных снимков.
// Запуск: node presentation/check-deck.mjs — читает presentation/build/deck.html.
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const require = createRequire(join(root, "apps/web/package.json"));
const { chromium } = require("@playwright/test");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(pathToFileURL(join(here, "build", "deck.html")).href, { waitUntil: "load" });
const report = await page.evaluate(() => {
  return [...document.querySelectorAll(".slide")].map((slide, i) => {
    const sr = slide.getBoundingClientRect();
    const overflows = [...slide.children].filter((c) => {
      const r = c.getBoundingClientRect();
      return r.bottom > sr.bottom + 1 || r.right > sr.right + 1 || r.left < sr.left - 1 || r.top < sr.top - 1;
    }).map((c) => `${c.className?.toString().split(" ")[0] || c.tagName}: bottom=${Math.round(c.getBoundingClientRect().bottom)} right=${Math.round(c.getBoundingClientRect().right)}`);
    const phones = [...slide.querySelectorAll(".phone")].map((p) => Math.round(p.getBoundingClientRect().width));
    // Экраны, вылезающие за цветную сцену (кроме намеренно обрезанных окон — у них overflow внутри сцены).
    const stage = slide.querySelector(".stage")?.getBoundingClientRect();
    const outOfStage = stage
      ? [...slide.querySelectorAll(".stage .phone, .stage .win")].filter((d) => {
          const r = d.getBoundingClientRect();
          return r.left < stage.left - 1 || r.right > stage.right + 1 || r.top < stage.top - 1 || r.bottom > stage.bottom + 1;
        }).length
      : 0;
    const fulls = [...slide.querySelectorAll(".full__img")].map((img) => {
      const r = img.getBoundingClientRect();
      const box = { w: Math.round(r.width), h: Math.round(r.height) };
      const c = img.naturalWidth / img.naturalHeight;
      const rendered = { w: Math.round(r.height * c), h: Math.round(r.height) };
      return { box, rendered };
    });
    const title = slide.querySelector(".feat__title, .tech__title, .brand")?.textContent?.trim() ?? "(без заголовка)";
    return { n: i + 1, title, phones, fulls, overflows, outOfStage };
  });
});
for (const r of report) {
  const flags = [];
  if (r.overflows.length) flags.push(`ПЕРЕПОЛНЕНИЕ: ${r.overflows.join("; ")}`);
  if (r.outOfStage) flags.push(`ЗА СЦЕНОЙ: ${r.outOfStage}`);
  if (r.phones.length) flags.push(`телефоны ${r.phones.map((w) => `${w}px`).join(", ")}`);
  if (r.fulls.length) flags.push(r.fulls.map((f) => `скрин в ${f.rendered.w}×${f.rendered.h} (box ${f.box.w}×${f.box.h})`).join("; "));
  console.log(`${String(r.n).padStart(2)}. ${r.title} — ${flags.join(" | ") || "ок"}`);
}
await browser.close();
