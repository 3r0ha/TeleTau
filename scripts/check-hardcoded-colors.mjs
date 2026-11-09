// Запрет цветов вне дизайн-токенов (CLAUDE.md, правило 8).
// Файл сканируется целиком (многострочные конструкции).
// CSS/SCSS: значения объявлений (включая --переменные и $переменные SCSS) — hex, цветовые функции, именованные цвета.
// TS/TSX/JS/JSX/MJS/CJS: hex, цветовые функции, именованные цвета в style-ключах и цветовых атрибутах JSX.
// HTML: <style>, style="…", цветовые атрибуты. Android XML: #RRGGBB и @android:color/… (кроме transparent).
// Swift: Color/UIColor/NSColor с компонентами или пространством цветов, системные именованные цвета, 0xRRGGBB.
// Kotlin: Color(0x…), Color(r, g, b), Color(red = …), Color.Red и т. п., Color.hsv/hsl, parseColor, "#…" строки, ARGB-литералы 0xAARRGGBB.
// Также: аргумент color: .black в модификаторах Swift, CGColor, комментарии перед объявлением CSS, device-cmyk().
// Известное ограничение: цвет, переданный через переменную (val c = …; Color(c) без литерала) — нужен анализ типов.
// Разрешены: Transparent/clear/currentColor, токены; строка с маркером allow-hardcoded-color.
// Исключения: сгенерированные файлы токенов, тесты, сборочные каталоги.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isInvokedDirectly } from "./lib/invoked.mjs";

const CSS_NAMED = "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  .split(" ")
  .join("|");
const SWIFT_NAMED = "red|green|blue|orange|yellow|pink|purple|white|black|gray|brown|cyan|mint|teal|indigo";
const NAMED_RE = new RegExp(`\\b(?:${CSS_NAMED})\\b(?!\\s*\\()`, "i");
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
const CSS_FN_RE = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|device-cmyk)\(/i;
const STYLE_KEY = "color|\\w*Color|background\\w*|border\\w*|outline\\w*|boxShadow|textShadow|fill|stroke|stopColor|floodColor|lightingColor";
const COLOR_ATTR = "fill|stroke|color|stopColor|stop-color|floodColor|lightingColor|bgcolor";

/** Значение без токенов и строк: var(--tt-color-red) и font-family: "Red Hat" — не хардкод. */
const scrubValue = (v) => v.replace(/var\([^)]*\)/gi, "").replace(/(["'])(?:(?!\1).)*\1/g, "");
const valueHasColor = (v) => {
  const clean = scrubValue(v);
  return HEX_RE.test(clean) || CSS_FN_RE.test(clean) || NAMED_RE.test(clean);
};

/** Комментарии /* … *\/ заменяются пробелами той же длины (с сохранением переводов строк): индексы и номера строк не сдвигаются. */
const blankComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));

/** CSS/SCSS: только значения объявлений (селекторы вроде a:hover или :not(.red) не проверяются). */
function cssHits(raw, offset = 0) {
  const text = blankComments(raw);
  const out = [];
  const decl = /(?:^|[;{\s])((?:--|\$)?[A-Za-z][\w-]*)\s*:\s*([^;{}]*?)\s*(?=;|}|$)/g;
  for (const m of text.matchAll(decl)) {
    if (valueHasColor(m[2])) {
      out.push({ index: offset + (m.index ?? 0) + m[0].indexOf(m[1]), text: `${m[1]}: ${m[2].replace(/\s+/g, " ")}` });
    }
  }
  return out;
}

function regexHits(src, res) {
  const out = [];
  for (const re of res) for (const m of src.matchAll(re)) out.push({ index: m.index ?? 0, text: m[0] });
  return out;
}

function scriptHits(src) {
  const out = regexHits(src, [/#[0-9a-fA-F]{3,8}\b/g, /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/gi]);
  const styleKv = new RegExp(`\\b(?:${STYLE_KEY})\\s*:\\s*(["'\`])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1`, "g");
  for (const m of src.matchAll(styleKv)) if (NAMED_RE.test(scrubValue(m[2]))) out.push({ index: m.index ?? 0, text: m[0] });
  const attr = new RegExp(`\\b(?:${COLOR_ATTR})\\s*=\\s*\\{?\\s*(["'\`])([^"'\`]*)\\1`, "g");
  for (const m of src.matchAll(attr)) if (valueHasColor(m[2])) out.push({ index: m.index ?? 0, text: m[0] });
  return out;
}

function htmlHits(src) {
  const out = [];
  for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) out.push(...cssHits(m[1], (m.index ?? 0) + m[0].indexOf(m[1])));
  for (const m of src.matchAll(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi)) out.push(...cssHits(m[2], (m.index ?? 0) + m[0].indexOf(m[2])));
  const attr = new RegExp(`\\s(?:${COLOR_ATTR})\\s*=\\s*(["'])([^"']*)\\1`, "gi");
  for (const m of src.matchAll(attr)) if (valueHasColor(m[2])) out.push({ index: m.index ?? 0, text: m[0].trim() });
  return out;
}

const CHECKERS = [
  { ext: [".css", ".scss"], hits: (src) => cssHits(src) },
  { ext: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"], hits: scriptHits },
  { ext: [".html"], hits: htmlHits },
  { ext: [".xml"], hits: (src) => regexHits(src, [/(?:=\s*"|>)\s*#[0-9A-Fa-f]{3,8}\b/g, /@android:color\/(?!transparent\b)\w+/g]) },
  {
    ext: [".swift"],
    hits: (src) =>
      regexHits(src, [
        /\b(?:Color|UIColor|NSColor|CGColor)\(\s*(?:red|white|gray|hue|displayP3Red|srgbRed|genericCMYKCyan)\s*:/g,
        /\bCGColor\.(?:black|white)\b/g,
        new RegExp(`\\bcolor\\s*:\\s*(?:Color|UIColor|NSColor)?\\.(?:${SWIFT_NAMED}|system[A-Z]\\w*)\\b`, "g"),
        /\bColor\(\s*\.(?:sRGB|sRGBLinear|displayP3)\b/g,
        /#colorLiteral/g,
        /\b0x[0-9A-Fa-f]{6}\b/g,
        /"#[0-9A-Fa-f]{3,8}"/g,
        new RegExp(`\\b(?:Color|UIColor|NSColor)\\.(?:${SWIFT_NAMED}|system[A-Z]\\w*)\\b`, "g"),
        new RegExp(`\\bColor\\(\\s*\\.(?:${SWIFT_NAMED}|system[A-Z]\\w*)\\b`, "g"),
        new RegExp(`\\bColor\\(\\s*(?:uiColor|nsColor|cgColor)\\s*:\\s*\\.?(?:${SWIFT_NAMED}|system[A-Z]\\w*)\\b`, "g"),
        new RegExp(`\\.(?:foregroundColor|foregroundStyle|background|tint|fill|stroke|accentColor|shadow|border)\\(\\s*\\.(?:${SWIFT_NAMED})\\b`, "g"),
      ]),
  },
  {
    ext: [".kt", ".kts"],
    hits: (src) =>
      regexHits(src, [
        /\bColor\(\s*(?:\w+\s*=\s*)?0x[0-9A-Fa-f]{6,8}/g,
        /\b0x[0-9A-Fa-f]{8}(?:UL|L|U|u)?\b/g,
        /"#[0-9A-Fa-f]{3,8}"/g,
        /\bColor\(\s*(?:red|alpha)\s*=/g,
        /\bColor\(\s*\d+(?:\.\d+)?f?\s*,/g,
        /\bColor\.(?:Red|Green|Blue|Black|White|Gray|DarkGray|LightGray|Yellow|Cyan|Magenta)\b/g,
        /\bColor\.(?:hsv|hsl|argb|rgb|valueOf)\(/g,
        /\bandroid\.graphics\.Color\.[A-Z][A-Z_]*\b/g,
        /\bparseColor\(/g,
      ]),
  },
];

/** Находки в одном файле: «строка: фрагмент». Файл сканируется целиком (многострочные конструкции). */
export function findHardcodedColors(source, file) {
  const lower = file.toLowerCase();
  const checker = CHECKERS.find((c) => c.ext.some((e) => lower.endsWith(e)));
  if (!checker) return [];
  // Строки с маркером allow-hardcoded-color вычищаются (нумерация строк сохраняется).
  const src = source
    .split("\n")
    .map((l) => (l.includes("allow-hardcoded-color") ? "" : l))
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

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", ".turbo", ".gradle", ".build", "DerivedData", ".kotlin", "test", "tests", "Tests", "__Snapshots__"]);
const SCAN = ["apps", "ios", "android", "packages/ui", "packages/session"];

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
      const rel = relative(root, file);
      if (/(^|\/)src\/(test|androidTest)\//.test(rel)) continue;
      for (const f of findHardcodedColors(readFileSync(file, "utf8"), file)) findings.push(`${rel}:${f}`);
    }
  }
  if (findings.length) {
    console.error(`Цвета вне дизайн-токенов (${findings.length}). Используйте TeleTauColor / var(--tt-…) / TeleTauColors:\n  ${findings.join("\n  ")}`);
    process.exit(1);
  }
  console.log("Цвета: хардкода вне дизайн-токенов нет");
}
