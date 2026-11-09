import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeAchievements, computeStreak, duelV0, fsrsReplay, lessonHoney, ratingFromVerdicts, srsStatus, voteHoney } from "../src/index.js";

interface VectorSuite {
  suite: string;
  version: number;
  function: string;
  /** Допуск для чисел с плавающей точкой (srs/fsrs6); нет — сравнение точное. */
  tolerance?: number;
  cases: { id: string; input: unknown; expected: unknown; note: string }[];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../contracts/test-vectors");

/** Функции наборов: вход из вектора → значение, которое сравнивается с `expected` целиком. */
const functions: Record<string, (input: never) => unknown> = {
  lessonHoney: (input: Parameters<typeof lessonHoney>[0]) => lessonHoney(input),
  voteHoney: (input: Parameters<typeof voteHoney>[0]) => voteHoney(input),
  computeStreak: (input: Parameters<typeof computeStreak>[0]) => computeStreak(input),
  computeAchievements: (input: Parameters<typeof computeAchievements>[0]) => computeAchievements(input),
  duelV0: (input: Parameters<typeof duelV0>[0]) => duelV0(input),
  fsrsReplay: (input: Parameters<typeof fsrsReplay>[0]) => fsrsReplay(input),
  ratingFromVerdicts: (input: Parameters<typeof ratingFromVerdicts>[0]) => ratingFromVerdicts(input),
  srsStatus: (input: Parameters<typeof srsStatus>[0]) => srsStatus(input),
};

/**
 * Сравнение целиком: те же ключи и значения; числа, у которых хоть одно не целое, — с допуском (порты Swift и Kotlin
 * считают в double, последние знаки exp и pow на платформах могут расходиться).
 */
function expectClose(actual: unknown, expected: unknown, tolerance: number, path = "$"): void {
  if (typeof expected === "number" && typeof actual === "number" && !(Number.isInteger(expected) && Number.isInteger(actual))) {
    expect(Math.abs(actual - expected), `${path}: ${actual} ≠ ${expected}`).toBeLessThanOrEqual(tolerance);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, `${path}.length`).toBe(expected.length);
    expected.forEach((e, i) => expectClose((actual as unknown[])[i], e, tolerance, `${path}[${i}]`));
    return;
  }
  if (expected && typeof expected === "object") {
    expect(actual && typeof actual === "object", path).toBeTruthy();
    expect(Object.keys(actual as object).sort(), `${path}: ключи`).toEqual(Object.keys(expected).sort());
    for (const [k, v] of Object.entries(expected)) expectClose((actual as Record<string, unknown>)[k], v, tolerance, `${path}.${k}`);
    return;
  }
  expect(actual, path).toEqual(expected);
}

/** Версии наборов, которые реализует эталон (по каталогам). Новый набор или версия — решение, которое повторяют порты. */
const SUPPORTED_VERSIONS: Record<string, Record<string, number>> = {
  xp: { "lesson.json": 1, "vote.json": 1 },
  streak: { "streak.json": 1 },
  consensus: { "duel-v0.json": 1 },
  srs: { "fsrs6.json": 1, "rating.json": 2, "status.json": 1 },
  achievements: { "achievements.json": 1 },
};

for (const [dir, versions] of Object.entries(SUPPORTED_VERSIONS)) {
  const files = readdirSync(resolve(root, dir)).filter((f) => f.endsWith(".json")).sort();

  describe(`${dir} vector suites`, () => {
    it("every suite in the directory is known to this implementation, and none is missing", () => {
      expect(files).toEqual(Object.keys(versions).sort());
    });
  });

  for (const file of files) {
    const suite = JSON.parse(readFileSync(resolve(root, dir, file), "utf8")) as VectorSuite;
    const fn = functions[suite.function];

    describe(suite.suite, () => {
      it(`implements suite version ${suite.version} with a known function`, () => {
        expect(fn, `${dir}/${file}: неизвестная функция ${suite.function}`).toBeDefined();
        expect(suite.version).toBe(versions[file]);
        expect(suite.suite).toBe(`${dir}/${file.replace(/\.json$/, "")}`);
      });

      it("has unique case ids and a note for every case", () => {
        const ids = suite.cases.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const c of suite.cases) expect(c.note, c.id).toBeTruthy();
      });

      for (const c of suite.cases) {
        it(`${c.id}: ${c.note}`, () => {
          if (suite.tolerance !== undefined) expectClose(fn!(c.input as never), c.expected, suite.tolerance);
          else expect(fn!(c.input as never)).toEqual(c.expected);
        });
      }
    });
  }
}
