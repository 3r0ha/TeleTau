// Форматирует наборы векторов bashkir-text в едином стиле: один кейс — одна строка,
// неотличимые на глаз символы (двойники из letterMap, невидимые, особые пробелы, комбинирующие знаки)
// записываются как \uXXXX — требование contracts/test-vectors/README.md.
// Запуск: node packages/bashkir-text/scripts/format-vectors.mjs
// Как модуль: import { formatSuite } from "./format-vectors.mjs" (используют генераторы векторов).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isInvokedDirectly } from "./invoked.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const spec = JSON.parse(readFileSync(join(root, "contracts/shared/bashkir-homoglyphs.json"), "utf8"));
export const vectorsDir = join(root, "contracts/test-vectors/bashkir-text");

const escapeSet = new Set([
  ...spec.letterMap.map((e) => parseInt(e.from, 16)),
  ...spec.removeCodePoints.map((e) => parseInt(e.cp, 16)),
  ...spec.whitespaceCodePoints.map((cp) => parseInt(cp, 16)).filter((cp) => cp !== 0x20),
]);
const hasCyrillic = (s) => /[Ѐ-ԯ]/u.test(s);
const WORD = /^[\p{L}\p{M}]$/u;
const INVISIBLE = /^[\p{Cf}\p{Cc}\p{Zl}\p{Zp}]$/u;

/** Экранируем символ, если он неотличим на глаз в контексте своего слова (как в алгоритме нормализации). */
function literal(s) {
  const chars = [...s];
  let out = "";
  let i = 0;
  while (i < chars.length) {
    let j = i;
    while (j < chars.length && WORD.test(chars[j])) j++;
    const word = j > i ? chars.slice(i, j) : [chars[i]];
    const inCyrillicWord = j > i && hasCyrillic(word.join(""));
    for (const ch of word) {
      const cp = ch.codePointAt(0);
      const latinLetter = cp < 0x80 && /[A-Za-z]/.test(ch);
      const mustEscape =
        /\p{M}/u.test(ch) ||
        INVISIBLE.test(ch) ||
        (escapeSet.has(cp) && cp !== 0x20 && (!latinLetter || inCyrillicWord));
      out += mustEscape ? escapeCp(cp) : JSON.stringify(ch).slice(1, -1);
    }
    i = j > i ? j : i + 1;
  }
  return `"${out}"`;
}

function escapeCp(cp) {
  if (cp <= 0xffff) return `\\u${cp.toString(16).toUpperCase().padStart(4, "0")}`;
  const v = cp - 0x10000;
  const hi = 0xd800 + (v >> 10);
  const lo = 0xdc00 + (v & 0x3ff);
  return `\\u${hi.toString(16).toUpperCase()}\\u${lo.toString(16).toUpperCase()}`;
}

/** Набор векторов → текст файла в каноническом формате. */
export function formatSuite(suite) {
  const head = Object.entries(suite)
    .filter(([k]) => k !== "cases")
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join("\n");
  const cases = suite.cases
    .map(
      (c) =>
        `    { "id": ${JSON.stringify(c.id)}, "input": ${literal(c.input)}, "expected": ${literal(c.expected)}, "note": ${JSON.stringify(c.note)} }`,
    )
    .join(",\n");
  return `{\n${head}\n  "cases": [\n${cases}\n  ]\n}\n`;
}

if (isInvokedDirectly(import.meta.url)) {
  for (const file of readdirSync(vectorsDir).filter((f) => f.endsWith(".json"))) {
    const suite = JSON.parse(readFileSync(join(vectorsDir, file), "utf8"));
    writeFileSync(join(vectorsDir, file), formatSuite(suite));
    console.log(`отформатировано: ${file}`);
  }
}
