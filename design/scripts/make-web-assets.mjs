#!/usr/bin/env node
// Web app assets derived from approved illustrations (design/assets/approved):
//
// - install icons for the web manifest: 192, 512 and a maskable 512 (content scaled into the 80% safe circle, the
//   margin filled with the icon's own background colour sampled from its corner);
// - apple-touch-icon 180×180 (iOS rounds the corners itself, no transparency);
// - favicon.ico (16/32/48) for the web and the console;
// - link preview image 1200×630 (Open Graph / Twitter card): the landing landscape with the bee, the app icon, the
//   brand wordmark and the tagline. Rendered by headless Chromium (Playwright of apps/web) from HTML that uses only
//   design tokens (packages/design-tokens/build/css/tokens.css) and the platform fonts (fonts.css).
//
// Requires ImageMagick 7 (`magick`) and the Playwright Chromium already downloaded for apps/web tests.
// Usage: node design/scripts/make-web-assets.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const approved = join(root, "design", "assets", "approved");
const webPublic = join(root, "apps", "web", "public");
const consolePublic = join(root, "apps", "console", "public");
const icons = join(webPublic, "icons");
mkdirSync(icons, { recursive: true });
mkdirSync(consolePublic, { recursive: true });

const magick = (args) => execFileSync("magick", args, { stdio: ["ignore", "pipe", "inherit"] }).toString();
const report = (p) => console.log(`${p.slice(root.length + 1)}  ${magick([`${p}[0]`, "-format", "%wx%h", "info:"])}  ${Math.round(statSync(p).size / 1024)} KB`);

// The 1024 master (lossless PNG) of the approved app-icon.webp: sharper downscales than the 512 webp.
const master = join(approved, "app-icon-1024.png");
const png = ["-alpha", "off", "-strip", "-define", "png:compression-level=9"];

for (const size of [192, 512]) {
  const out = join(icons, `icon-${size}.png`);
  magick([master, "-filter", "Lanczos", "-resize", `${size}x${size}`, ...png, out]);
  report(out);
}

// Maskable: launchers crop to a circle or squircle of at least 80% of the side; the hexagon reaches ~0.43 of the side
// from the centre, so the picture is scaled to 78% and centred on its own background colour.
const background = magick([master, "-format", "%[pixel:p{4,4}]", "info:"]).trim();
const maskable = join(icons, "icon-maskable-512.png");
magick([master, "-filter", "Lanczos", "-resize", "400x400", "-background", background, "-gravity", "center", "-extent", "512x512", ...png, maskable]);
report(maskable);

const apple = join(icons, "apple-touch-icon.png");
magick([master, "-filter", "Lanczos", "-resize", "180x180", ...png, apple]);
report(apple);

for (const dir of [webPublic, consolePublic]) {
  const ico = join(dir, "favicon.ico");
  magick([master, "-alpha", "off", "-define", "icon:auto-resize=48,32,16", ico]);
  report(ico);
}

// Link preview.
const tokensCss = pathToFileURL(join(root, "packages", "design-tokens", "build", "css", "tokens.css")).href;
const fontsCss = pathToFileURL(join(root, "packages", "design-tokens", "fonts", "fonts.css")).href;
const hero = pathToFileURL(join(approved, "hero-landing.webp")).href;
const icon = pathToFileURL(master).href;
const html = `<!doctype html>
<html lang="ru" data-theme="light">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="${tokensCss}">
<link rel="stylesheet" href="${fontsCss}">
<style>
  html, body { margin: 0; }
  .card { position: relative; width: 1200px; height: 630px; overflow: hidden; background: var(--tt-color-bg); }
  .hero { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 30%; }
  .brand { position: absolute; left: var(--tt-space-s1600); top: var(--tt-space-s1200); display: grid; gap: var(--tt-space-s300); }
  .row { display: flex; align-items: center; gap: var(--tt-space-s600); }
  .icon { width: calc(var(--tt-size-button) * 2); height: calc(var(--tt-size-button) * 2); border-radius: var(--tt-radius-card); }
  .name {
    margin: 0;
    font-family: var(--tt-font-family-display);
    font-weight: var(--tt-font-weight-black);
    font-size: calc(var(--tt-font-size-display) * 2.4);
    line-height: 1;
    letter-spacing: 0.01em;
    color: var(--tt-color-text-primary);
  }
  .tagline {
    margin: 0;
    font-family: var(--tt-font-family-display);
    font-weight: var(--tt-font-weight-extrabold);
    font-size: calc(var(--tt-font-size-title1) * 1.25);
    line-height: var(--tt-line-height-snug);
    color: var(--tt-color-text-primary);
  }
</style>
</head>
<body>
<div class="card">
  <img class="hero" src="${hero}" alt="">
  <div class="brand">
    <div class="row">
      <img class="icon" src="${icon}" alt="">
      <!-- brand name, needs_native_review -->
      <p class="name">ТелеТау</p>
    </div>
    <p class="tagline">Башкирский язык<br>каждый день</p>
  </div>
</div>
</body>
</html>`;

const work = mkdtempSync(join(tmpdir(), "teletau-og-"));
try {
  const page = join(work, "og.html");
  writeFileSync(page, html);
  const require = createRequire(join(root, "apps", "web", "package.json"));
  const playwright = await import(pathToFileURL(require.resolve("@playwright/test")).href);
  const { chromium } = playwright.default ?? playwright;
  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await tab.goto(pathToFileURL(page).href);
    await tab.evaluate(() => globalThis.document.fonts.ready);
    const shot = join(work, "og.png");
    await tab.locator(".card").screenshot({ path: shot });
    const out = join(webPublic, "og-image.jpg");
    magick([shot, "-strip", "-sampling-factor", "4:2:0", "-interlace", "JPEG", "-quality", "86", out]);
    report(out);
  } finally {
    await browser.close();
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
