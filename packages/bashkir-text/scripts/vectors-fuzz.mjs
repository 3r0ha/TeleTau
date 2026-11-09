// Дифференциальный фазз-набор: детерминированный генератор строк (seed) + ожидания от TS-эталона.
// Swift и Kotlin проходят те же строки как обычные векторы — любое расхождение платформ видно сразу.
// Запуск (нужна сборка эталона): pnpm --filter @teletau/bashkir-text vectors:fuzz   [--check]
// Как модуль: import { fuzzInputs } from "./vectors-fuzz.mjs" (тест проверяет, что набор соответствует генератору).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatSuite, vectorsDir } from "./format-vectors.mjs";
import { isInvokedDirectly } from "./invoked.mjs";

export const FUZZ_SEED = 20261102;
export const FUZZ_COUNT = 1000;

// Только символы из Unicode ≤ 15: у более новых общая категория на JDK 21 / старых ОС другая,
// и это дало бы ложные расхождения в разбиении на слова (не связанные с нашим алгоритмом).
const POOLS = [
  { weight: 30, chars: [..."абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ"] },
  { weight: 20, chars: [..."әөүғҡңҙҫһӘӨҮҒҠҢҘҪҺ"] },
  { weight: 12, chars: [..."aeopcxyhkqAEOPCXYHKQBMT"] },
  { weight: 8, chars: [..."äöüçğñðəɵÄÖÜÇĞÑÐƏƟ"] },
  { weight: 8, chars: [..."қҚҥҤұҰґҐӻӺӡӠӧӦӓӒӱӰҟҞӄӃӈӇ"] },
  { weight: 8, chars: ["̀", "́", "̆", "̈", "̧", "̄"] },
  { weight: 5, chars: ["​", "‌", "‍", "⁠", "﻿", "­"] },
  { weight: 3, chars: ["‎", "‏", "‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩"] },
  { weight: 8, chars: [" ", "\t", "\n", " ", " ", "　", " "] },
  { weight: 3, chars: ["🐝", "🍯", "👨", "👩", "👧", "😀"] },
  { weight: 6, chars: ["-", ",", ".", "!", "?", "1", "2", "Σ", "σ", "Ο", "Δ", "İ", "ı", "ß", "Ꙁ", "d", "f", "g", "Ж"] },
];
const TOTAL_WEIGHT = POOLS.reduce((s, p) => s + p.weight, 0);

/** mulberry32 — маленький детерминированный ГПСЧ. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fuzzInputs(seed = FUZZ_SEED, count = FUZZ_COUNT) {
  const next = rng(seed);
  const out = [];
  for (let n = 0; n < count; n++) {
    const length = Math.floor(next() * 21);
    let s = "";
    for (let i = 0; i < length; i++) {
      let r = next() * TOTAL_WEIGHT;
      const pool = POOLS.find((p) => (r -= p.weight) < 0) ?? POOLS[0];
      s += pool.chars[Math.floor(next() * pool.chars.length)];
    }
    out.push(s);
  }
  return out;
}

export const FUZZ_SUITES = [
  { file: "fuzz-normalize.json", fn: "normalize" },
  { file: "fuzz-comparable.json", fn: "toComparable" },
  { file: "fuzz-fold.json", fn: "fold" },
];

export function buildFuzzSuites(reference) {
  const inputs = fuzzInputs();
  return FUZZ_SUITES.map(({ file, fn }) => ({
    file,
    suite: {
      suite: `bashkir-text/${file.replace(".json", "")}`,
      version: 2,
      function: fn,
      description: `СГЕНЕРИРОВАНО: ${FUZZ_COUNT} случайных строк (seed ${FUZZ_SEED}) из packages/bashkir-text/scripts/vectors-fuzz.mjs, ожидания — от TS-эталона. Дифференциальная проверка Swift и Kotlin против эталона. Не редактировать вручную.`,
      cases: inputs.map((input, i) => ({
        id: `z${String(i + 1).padStart(4, "0")}`,
        input,
        expected: reference[fn](input),
        note: `фазз #${i + 1}`,
      })),
    },
  }));
}

if (isInvokedDirectly(import.meta.url)) {
  const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/index.js");
  if (!existsSync(dist)) {
    console.error("Нет сборки эталона: pnpm --filter @teletau/bashkir-text build");
    process.exit(1);
  }
  const reference = await import(pathToFileURL(dist).href);
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const { file, suite } of buildFuzzSuites(reference)) {
    const path = join(vectorsDir, file);
    const content = formatSuite(suite);
    if (check) {
      if (!existsSync(path) || readFileSync(path, "utf8") !== content) {
        console.error(`УСТАРЕЛО: contracts/test-vectors/bashkir-text/${file} — запустите pnpm --filter @teletau/bashkir-text vectors:fuzz`);
        stale++;
      }
    } else {
      writeFileSync(path, content);
      console.log(`записано: ${file} (${suite.cases.length})`);
    }
  }
  if (check) {
    if (stale) process.exit(1);
    console.log("bashkir-text: фазз-векторы актуальны");
  }
}
