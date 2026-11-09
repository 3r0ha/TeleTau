import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fold, normalize, toComparable } from "../src/index.js";
// @ts-expect-error — скрипт на JS без деклараций типов
import { FUZZ_SUITES, fuzzInputs } from "../scripts/vectors-fuzz.mjs";

interface VectorCase {
  id: string;
  input: string;
  expected: string;
  note: string;
}
interface VectorSuite {
  suite: string;
  version: number;
  function: string;
  cases: VectorCase[];
}

const vectorsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../contracts/test-vectors/bashkir-text");
const functions: Record<string, (s: string) => string> = { normalize, fold, toComparable };

/**
 * Версии наборов, которые реализует эталон. Новая версия набора = новое поведение = обновить все порты.
 * Набор, которого нет в этом списке, — ошибка: его нужно явно принять во всех трёх портах.
 */
const SUPPORTED_VERSIONS: Record<string, number> = {
  "normalize.json": 3,
  "fold.json": 4,
  "comparable.json": 4,
  "normalize-table.json": 2,
  "fuzz-normalize.json": 2,
  "fuzz-comparable.json": 2,
  "fuzz-fold.json": 2,
};

const files = readdirSync(vectorsDir).filter((f) => f.endsWith(".json")).sort();
const load = (file: string) => JSON.parse(readFileSync(resolve(vectorsDir, file), "utf8")) as VectorSuite;

describe("vector suites", () => {
  it("every suite in the directory is known to this implementation, and none is missing", () => {
    expect(files).toEqual(Object.keys(SUPPORTED_VERSIONS).sort());
  });
});

for (const file of files) {
  const suite = load(file);
  const fn = functions[suite.function];

  describe(suite.suite, () => {
    it(`implements suite version ${suite.version} with a known function`, () => {
      expect(fn, `${file}: неизвестная функция ${suite.function}`).toBeDefined();
      expect(suite.version, `${file}: эталон реализует версию ${SUPPORTED_VERSIONS[file]}`).toBe(SUPPORTED_VERSIONS[file]);
    });

    it("has unique case ids", () => {
      const ids = suite.cases.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    for (const c of suite.cases) {
      it(`${c.id}: ${c.note}`, () => {
        expect(fn?.(c.input)).toBe(c.expected);
      });
    }
  });
}

describe("fuzz suites match the generator", () => {
  const inputs = fuzzInputs() as string[];
  for (const { file } of FUZZ_SUITES as { file: string }[]) {
    it(`${file}: inputs are exactly the generator output (seed, alphabet, count)`, () => {
      expect(load(file).cases.map((c) => c.input)).toEqual(inputs);
    });
  }
});

// Цель теста — стек, а не скорость: щедрый таймаут, чтобы загруженная машина не давала ложного падения.
describe("long input (200 000 code points)", () => {
  const long = "ә".repeat(100_000) + "Ҡ".repeat(100_000);
  it("normalize, toComparable and fold do not overflow the stack", { timeout: 30_000 }, () => {
    expect([...normalize(long)].length).toBe(200_000);
    expect([...toComparable(long)].length).toBe(200_000);
    expect(fold(long)).toBe("а".repeat(100_000) + "к".repeat(100_000));
  });
});

// Квадратичное удаление ZWJ/ZWNJ на 40 000 соединителей заняло бы секунды.
// Линейность проверяется отношением времени t(4n)/t(n), а не абсолютными миллисекундами —
// равномерное замедление машины (загруженный CI) отношение не меняет. Линейный алгоритм даёт ≈4,
// квадратичный ≈16; порог 8 — посередине в логарифмической шкале.
// Время вызова — минимум по многим одиночным замерам, малый и большой вход чередуются: вытеснение потока
// и сборка мусора время только увеличивают, поэтому минимум устойчив к нагрузке на машину.
const growthRatio = (make: (n: number) => string, run: (s: string) => unknown, n: number, samples = 25, budgetMs = 3_000): number => {
  const small = make(n);
  const big = make(4 * n);
  run(small); // прогрев JIT на обоих размерах
  run(big);
  let bestSmall = Infinity;
  let bestBig = Infinity;
  const start = performance.now();
  for (let i = 0; i < samples && performance.now() - start < budgetMs; i++) {
    let t = performance.now();
    run(small);
    bestSmall = Math.min(bestSmall, performance.now() - t);
    t = performance.now();
    run(big);
    bestBig = Math.min(bestBig, performance.now() - t);
  }
  return bestBig / bestSmall;
};

describe("joiner chains are processed in linear time", () => {
  const ZWJ = "\u200D";
  const ZWNJ = "\u200C";
  const N = 5_000;
  const chains: [string, (n: number) => string, (s: string) => unknown][] = [
    ["ZWJ without letter neighbours (normalize)", (n) => ZWJ.repeat(n), normalize],
    ["ZWJ/ZWNJ chain between letters (normalize)", (n) => "ҡ" + (ZWJ + ZWNJ).repeat(n / 2) + "ы", normalize],
    ["ZWJ chain between emoji (normalize, toComparable, fold)", (n) => "🐝" + ZWJ.repeat(n) + "🍯", (s) => [normalize(s), toComparable(s), fold(s)]],
  ];
  for (const [name, make, run] of chains) {
    it(`${name}: t(4n)/t(n) < 8`, { timeout: 30_000 }, () => {
      expect(growthRatio(make, run, N)).toBeLessThan(8);
    });
  }

  it("200 000 ZWJ without letter neighbours are kept", { timeout: 30_000 }, () => {
    expect([...normalize(ZWJ.repeat(200_000))].length).toBe(200_000);
  });

  it("a 200 000-long ZWJ/ZWNJ chain between letters is removed entirely", { timeout: 30_000 }, () => {
    expect(normalize("ҡ" + (ZWJ + ZWNJ).repeat(100_000) + "ы")).toBe("ҡы");
  });

  it("a long ZWJ chain between emoji is kept by normalize, toComparable and fold", { timeout: 30_000 }, () => {
    const input = "🐝" + ZWJ.repeat(100_000) + "🍯";
    for (const out of [normalize(input), toComparable(input), fold(input)]) expect([...out].length).toBe(100_002);
  });
});

// Алфавит для property-тестов: всё, что ломало или могло ломать нормализацию.
const ALPHABET = [
  ..."абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБЕЁКОРСТХ",
  ..."әөүғҡңҙҫһӘӨҮҒҠҢҘҪҺ",
  ..."aeopcxyhkqAEOPCXYHKQ",
  ..."äöüçğñðəɵÄÖÜÇĞÑÐƏƟ",
  ..."қҥұґӻӡӧӓӱҟӄӈ",
  "̀", "́", "̆", "̈", "̧",
  "​", "‌", "‍", "⁠", "﻿", "­",
  " ", "\t", "\n", " ", " ",
  "🐝", "👨", "👩", "-", ".", "1", "Σ", "İ", "ß",
];
const text = fc.array(fc.constantFrom(...ALPHABET), { maxLength: 40 }).map((a) => a.join(""));
const RUNS = { numRuns: 2000, seed: 20261102 };

describe("properties (fast-check)", () => {
  it("normalize is idempotent and returns NFC", () => {
    fc.assert(
      fc.property(text, (s) => {
        const once = normalize(s);
        return normalize(once) === once && once === once.normalize("NFC");
      }),
      RUNS,
    );
  });

  it("toComparable is idempotent and returns NFC", () => {
    fc.assert(
      fc.property(text, (s) => {
        const once = toComparable(s);
        return toComparable(once) === once && once === once.normalize("NFC");
      }),
      RUNS,
    );
  });

  it("fold is idempotent and returns NFC", () => {
    fc.assert(
      fc.property(text, (s) => {
        const once = fold(s);
        return fold(once) === once && once === once.normalize("NFC");
      }),
      RUNS,
    );
  });
});
