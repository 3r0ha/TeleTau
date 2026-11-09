#!/usr/bin/env node
// Processes owner-generated illustrations: design/assets/incoming/*.jpg → design/assets/approved/*.webp
//
// - "cutout" assets (characters, objects, badges, scenes on white) get the white background removed by a
//   flood fill from the image border (inner whites like eye highlights stay), a soft 1px edge, trim and padding;
// - "full" assets (place heroes, signs, app icons) are only resized;
// - app icons additionally get a 1024×1024 PNG master without alpha (store requirement).
//
// Requires ImageMagick 7 (`magick`). Usage:
//   node design/scripts/process-assets.mjs            # all files
//   node design/scripts/process-assets.mjs bee-idle   # only names containing "bee-idle"
//   FUZZ=4 node design/scripts/process-assets.mjs     # flood-fill tolerance in percent (default below)
//   TELETAU_ASSETS_DIR=/tmp/a node design/scripts/process-assets.mjs   # other assets root (incoming/, approved/)
//
// Animation frames (design/prompts/batch-3-animation.md): <base>-blink, <base>-wings, <base>-wave2, <base>-breath are
// edits of the base picture «in place». They are NOT trimmed each by its own -trim (a raised wing or a bigger breath
// would shift and rescale the frame): the base and all its frames get one common crop box — the union of their trim
// boxes — and then the same padding and scale, so the frames stack without jumping. Without frames the base is
// processed exactly as before (its own trim).
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.TELETAU_ASSETS_DIR ? resolve(process.env.TELETAU_ASSETS_DIR) : resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets");
const incoming = join(root, "incoming");
const approved = join(root, "approved");
mkdirSync(approved, { recursive: true });

// Per-asset overrides: some illustrations have cream/white parts touching the background,
// so the tolerance must stay below the cream (#FFF8EC ≈ 4.6% from white).
const DEFAULT_FUZZ = Number(process.env.FUZZ ?? 3.5);
const FUZZ = { "scene-league-up": 2.5, "deco-ufa-monument": 2.5, "badge-linden": 12 };
// Assets with white "holes" enclosed by the figure (between the horse's legs, inside the tram pantograph):
// pure white is removed everywhere, not only where it touches the border. Never for characters (eye highlights).
const HOLES = new Set(["deco-ufa-monument", "deco-ufa-tram", "avatar-rowan", "deco-sabantuy-swing", "deco-village-well"]);

const RULES = [
  { test: /^place-.*-hero$/, kind: "full", width: 1376 },
  { test: /^place-.*-sign$/, kind: "full", width: 1584 },
  { test: /^app-icon/, kind: "icon" },
  { test: /^(bee|deco|scene|empty|badge|item)-/, kind: "cutout", max: 1024 },
  { test: /^hero-landing$/, kind: "full", width: 1584 },
  { test: /^tg-bot-cover$/, kind: "tgcover" },
  { test: /^avatars-sheet-\d$/, kind: "sheet" },
  { test: /^avatar-[a-z-]+$/, kind: "cutout", max: 512 },
];

// Листы аватаров: сетка 4 × 3, порядок — как в design/prompts/batch-2.md («Аватары ников»).
// Отдельный файл avatar-<имя> в incoming заменяет клетку листа (переделки).
const AVATAR_SHEETS = {
  "avatars-sheet-1": ["bee", "bumblebee", "owl", "hedgehog", "fox", "badger", "squirrel", "bear", "lynx", "falcon", "swallow", "crane"],
  "avatars-sheet-2": ["tit", "beaver", "dragonfly", "hare", "marten", "eagle-owl", "heron", "dolphin", "comet", "cedar", "star", "maple"],
  "avatars-sheet-3": ["chamomile", "wind", "birch", "lighthouse", "rowan", "compass", "wave", "spring", "sun", "cloud", "lake", "feather"],
};

// Кадры анимации: имя основного кадра + суффикс кадра.
const FRAME = /^(.+)-(blink|wings|wave2|breath)$/;

const only = process.argv.slice(2);
const nameOf = (f) => basename(f).replace(/\.[^.]+$/, "");
const allIncoming = readdirSync(incoming)
  .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
  .sort();
const files = allIncoming.filter((f) => only.length === 0 || only.some((o) => f.includes(o)));
/** Файлы кадров основного кадра `base` (bee-idle → bee-idle-blink.jpg, bee-idle-wings.jpg…). */
const framesOf = (base) => allIncoming.filter((f) => FRAME.exec(nameOf(f))?.[1] === base);
const fileOf = (name) => allIncoming.find((f) => nameOf(f) === name);

const magick = (args) => execFileSync("magick", args, { stdio: ["ignore", "pipe", "inherit"] });
const kb = (p) => `${Math.round(statSync(p).size / 1024)} KB`;
const size = (p) => magick([p, "-format", "%wx%h", "info:"]).toString();

/** Белый фон → прозрачный (без обрезки): заливка от края (блики внутри остаются), край смягчается. */
const clearBackground = (src, fuzz, holes) => [
  src,
  "-bordercolor", "white", "-border", "4",
  "-alpha", "set",
  ...(holes ? ["-fuzz", "1.5%", "-transparent", "white"] : []),
  "-fuzz", `${fuzz}%`, "-fill", "none", "-draw", "color 0,0 floodfill",
  "-shave", "4x4", "+repage",
  "-channel", "A", "-morphology", "Erode", "Disk:1", "-blur", "0x0.7", "+channel",
];

/**
 * Вырезка: фон прозрачный, обрезка (своя `-trim` или общая рамка `box` — «WxH+X+Y» для кадров анимации), поля,
 * уменьшение.
 */
function cutout(src, out, fuzz, holes, max, box) {
  magick([
    ...clearBackground(src, fuzz, holes),
    ...(box ? ["-crop", box] : ["-trim"]), "+repage",
    "-bordercolor", "none", "-border", "12",
    "-resize", `${max}x${max}>`,
    "-strip",
    "-define", "webp:alpha-quality=95", "-define", "webp:method=6", "-quality", "88",
    out,
  ]);
}

/** Рамка, которую взяла бы `-trim` у вырезки, — «WxH+X+Y». */
const trimBox = (src, fuzz, holes) => magick([...clearBackground(src, fuzz, holes), "-format", "%@", "info:"]).toString().trim();

/** Объединение рамок «WxH+X+Y»: общая рамка основного кадра и его кадров. */
function unionBox(boxes) {
  const rects = boxes.map((b) => {
    const m = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(b);
    if (!m) throw new Error(`рамка обрезки не распознана: ${b}`);
    const [w, h, x, y] = m.slice(1).map(Number);
    return { x0: x, y0: y, x1: x + w, y1: y + h };
  });
  const x0 = Math.min(...rects.map((r) => r.x0));
  const y0 = Math.min(...rects.map((r) => r.y0));
  const x1 = Math.max(...rects.map((r) => r.x1));
  const y1 = Math.max(...rects.map((r) => r.y1));
  return `${x1 - x0}x${y1 - y0}+${x0}+${y0}`;
}

/** Доля пикселей, которыми кадр отличается от основного (подсказка: больше ~25% — кадр, скорее всего, сдвинут). */
function frameDiff(a, b) {
  let out;
  try {
    out = execFileSync("magick", ["compare", "-metric", "AE", "-fuzz", "12%", a, b, "null:"], { stdio: ["ignore", "pipe", "pipe"] }).stderr;
  } catch (e) {
    out = e.stderr; // compare завершается с кодом 1, когда картинки различаются, — это нормально
  }
  const changed = Number.parseFloat(String(out ?? "").trim().split(/\s+/)[0] ?? "");
  const [w, h] = size(a).split("x").map(Number);
  return Number.isFinite(changed) && w && h ? changed / (w * h) : NaN;
}

/**
 * Основной кадр и его кадры анимации — по одной общей рамке (объединение рамок обрезки всех кадров) с теми же полями
 * и масштабом: кадры одного размера и накладываются без сдвига. Кадр берёт допуск заливки и «дырки» основного.
 */
function cutoutFrames(base, max) {
  const members = [fileOf(base), ...framesOf(base)];
  const fuzz = FUZZ[base] ?? DEFAULT_FUZZ;
  const holes = HOLES.has(base);
  const box = unionBox(members.map((f) => trimBox(join(incoming, f), fuzz, holes)));
  for (const f of members) {
    const out = join(approved, `${nameOf(f)}.webp`);
    cutout(join(incoming, f), out, fuzz, holes, max, box);
    const diff = nameOf(f) === base ? null : frameDiff(join(approved, `${base}.webp`), out);
    const note = diff === null ? `рамка ${box}` : Number.isNaN(diff) ? "" : `отличается от основного на ${(diff * 100).toFixed(1)}%${diff > 0.25 ? " — проверьте, не сдвинут ли кадр" : ""}`;
    console.log(`${nameOf(f)}.webp  ${size(out)}  ${kb(out)}  ${note}`);
  }
}

const framed = new Set();

for (const file of files) {
  const name = nameOf(file);
  // Кадр анимации обрабатывается вместе со своим основным кадром (общая рамка).
  const frameBase = FRAME.exec(name)?.[1];
  if (frameBase) {
    const baseRule = RULES.find((r) => r.test.test(frameBase));
    if (!fileOf(frameBase) || baseRule?.kind !== "cutout") {
      console.warn(`skip ${file}: нет основного кадра ${frameBase} для вырезки`);
    } else if (!framed.has(frameBase)) {
      framed.add(frameBase);
      cutoutFrames(frameBase, baseRule.max);
    }
    continue;
  }
  const rule = RULES.find((r) => r.test.test(name));
  if (!rule) {
    console.warn(`skip ${file}: no rule`);
    continue;
  }
  const src = join(incoming, file);
  const out = join(approved, `${name}.webp`);

  if (rule.kind === "sheet") {
    const names = AVATAR_SHEETS[name] ?? [];
    const [w, h] = size(src).split("x").map(Number);
    names.forEach((avatar, i) => {
      const target = `avatar-${avatar}`;
      if (files.some((f) => f.startsWith(`${target}.`))) return; // переделка лежит отдельным файлом
      const cw = Math.floor(w / 4), ch = Math.floor(h / 3);
      const cell = join(approved, `.${target}.png`);
      magick([src, "-crop", `${cw}x${ch}+${(i % 4) * cw}+${Math.floor(i / 4) * ch}`, "+repage", cell]);
      cutout(cell, join(approved, `${target}.webp`), FUZZ[target] ?? DEFAULT_FUZZ, HOLES.has(target), 512);
      rmSync(cell);
      console.log(`${target}.webp  ${size(join(approved, `${target}.webp`))}`);
    });
    continue;
  }
  if (rule.kind === "tgcover") {
    magick([src, "-resize", "1280x>", "-strip", "-quality", "86", out]);
    const png = join(approved, `${name}-640x360.png`);
    magick([src, "-resize", "640x360^", "-gravity", "center", "-extent", "640x360", "-strip", png]);
    console.log(`${name}-640x360.png  ${size(png)}  ${kb(png)}`);
  } else if (rule.kind === "full") {
    magick([src, "-resize", `${rule.width}x>`, "-strip", "-quality", "86", out]);
  } else if (rule.kind === "icon") {
    const png = join(approved, `${name}-1024.png`);
    magick([src, "-resize", "1024x1024", "-alpha", "off", "-strip", png]);
    magick([src, "-resize", "512x512", "-strip", "-quality", "88", out]);
    console.log(`${name}-1024.png  ${size(png)}  ${kb(png)}`);
  } else if (framesOf(name).length) {
    if (!framed.has(name)) {
      framed.add(name);
      cutoutFrames(name, rule.max);
    }
    continue;
  } else {
    cutout(src, out, FUZZ[name] ?? DEFAULT_FUZZ, HOLES.has(name), rule.max);
  }
  console.log(`${name}.webp  ${size(out)}  ${kb(out)}`);
}
