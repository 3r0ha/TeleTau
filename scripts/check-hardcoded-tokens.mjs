// Запрет длительностей анимаций и радиусов вне дизайн-токенов (CLAUDE.md, правило 8) и атрибутов style
// в разметке веба и консоли (строгая CSP без 'unsafe-inline' не применяет атрибуты style, отрисованные на сервере).
// Дополняет check-hardcoded-colors.mjs (цвета). Подключён в `pnpm lint`.
// CSS/SCSS: длительности (`1.4s`, `200ms`) в animation*/transition* и радиусы (`9px`, `50%`) в border-radius и его
// полных формах — только var(--tt-duration-…) / var(--tt-radius-…). Разрешены 0 и сброс движения 0.01ms
// (prefers-reduced-motion: «мгновенно» — не дизайн-значение). TS/TSX/JSX: атрибут style={…}.
// Строка с маркером allow-hardcoded-token не проверяется.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isInvokedDirectly } from "./lib/invoked.mjs";

const blankComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
/** Значение без токенов и строк: var(--tt-duration-fast) и имена анимаций в кавычках — не хардкод. */
const scrub = (v) => v.replace(/var\([^)]*\)/gi, " ").replace(/(["'])(?:(?!\1).)*\1/g, " ");

const TIME_RE = /(?<![\w.-])(\d*\.?\d+)(ms|s)\b/gi;
const LENGTH_RE = /(?<![\w.-])(\d*\.?\d+)(px|rem|em|%|vw|vh|vmin|vmax|pt|cm|mm|in|ch|ex)?(?![\w%-])/gi;
const DURATION_PROP = /^(?:-webkit-)?(?:animation|animation-duration|animation-delay|transition|transition-duration|transition-delay)$/i;
const RADIUS_PROP = /^(?:-webkit-)?border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$/i;

/** Длительность из литерала: разрешены только нули и сброс движения 0.01ms. */
const allowedTime = (num, unit) => Number(num) === 0 || (unit.toLowerCase() === "ms" && Number(num) === 0.01);

function cssHits(raw) {
  const text = blankComments(raw);
  const out = [];
  const decl = /(?:^|[;{\s])((?:--)?[A-Za-z][\w-]*)\s*:\s*([^;{}]*?)\s*(?=;|}|$)/g;
  for (const m of text.matchAll(decl)) {
    const prop = m[1];
    const value = scrub(m[2]);
    const index = (m.index ?? 0) + m[0].indexOf(prop);
    if (DURATION_PROP.test(prop)) {
      for (const t of value.matchAll(TIME_RE)) {
        if (!allowedTime(t[1], t[2])) out.push({ index, text: `${prop}: ${m[2].replace(/\s+/g, " ")} — длительность ${t[0]} вне токенов (var(--tt-duration-…))` });
      }
    } else if (RADIUS_PROP.test(prop)) {
      for (const l of value.matchAll(LENGTH_RE)) {
        if (Number(l[1]) !== 0) out.push({ index, text: `${prop}: ${m[2].replace(/\s+/g, " ")} — радиус ${l[0]} вне токенов (var(--tt-radius-…))` });
      }
    }
  }
  return out;
}

function scriptHits(src) {
  const out = [];
  for (const m of src.matchAll(/\sstyle\s*=\s*\{/g)) {
    out.push({ index: m.index ?? 0, text: "атрибут style={…} — строгая CSP его не применит; используйте класс CSS или атрибуты SVG" });
  }
  return out;
}

const CHECKERS = [
  { ext: [".css", ".scss"], hits: cssHits },
  { ext: [".tsx", ".jsx"], hits: scriptHits },
];

/** Находки в одном файле: «строка: описание». */
export function findHardcodedTokens(source, file) {
  const lower = file.toLowerCase();
  const checker = CHECKERS.find((c) => c.ext.some((e) => lower.endsWith(e)));
  if (!checker) return [];
  const src = source
    .split("\n")
    .map((l) => (l.includes("allow-hardcoded-token") ? "" : l))
    .join("\n");
  const lineOf = (idx) => src.slice(0, idx).split("\n").length;
  const seen = new Set();
  const out = [];
  for (const h of checker.hits(src).sort((a, b) => a.index - b.index)) {
    const key = `${lineOf(h.index)}: ${h.text.trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", ".turbo", "test", "tests", "test-results"]);
/** Веб-клиенты: приложения Next.js и общие пакеты компонентов. */
const SCAN = ["apps/web", "apps/console", "packages/ui", "packages/session"];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (!name.includes(".generated.")) yield full;
  }
}

if (isInvokedDirectly(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const findings = [];
  for (const top of SCAN) {
    for (const file of walk(resolve(root, top))) {
      for (const f of findHardcodedTokens(readFileSync(file, "utf8"), file)) findings.push(`${relative(root, file)}:${f}`);
    }
  }
  if (findings.length) {
    console.error(`Длительности, радиусы и атрибуты style вне дизайн-токенов (${findings.length}):\n  ${findings.join("\n  ")}`);
    process.exit(1);
  }
  console.log("Длительности и радиусы: хардкода вне дизайн-токенов нет; атрибутов style в разметке нет");
}
