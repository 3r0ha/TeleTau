// Раннер набора contracts/test-vectors/answer-check (matchAnswer). Swift и Kotlin пока читают только bashkir-text/.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matchAnswer, type AnswerInput } from "../src/index.js";

interface VectorSuite {
  suite: string;
  version: number;
  function: string;
  cases: { id: string; input: AnswerInput; expected: unknown; note: string }[];
}

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../contracts/test-vectors/answer-check");
const SUPPORTED_VERSIONS: Record<string, number> = { "match.json": 1 };
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

describe("answer-check vector suites", () => {
  it("every suite in the directory is known to this implementation, and none is missing", () => {
    expect(files).toEqual(Object.keys(SUPPORTED_VERSIONS).sort());
  });
});

for (const file of files) {
  const suite = JSON.parse(readFileSync(resolve(dir, file), "utf8")) as VectorSuite;
  describe(suite.suite, () => {
    it(`implements suite version ${suite.version} of matchAnswer`, () => {
      expect(suite.function).toBe("matchAnswer");
      expect(suite.version).toBe(SUPPORTED_VERSIONS[file]);
    });

    it("has unique case ids and a note for every case", () => {
      const ids = suite.cases.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const c of suite.cases) expect(c.note, c.id).toBeTruthy();
    });

    for (const c of suite.cases) {
      it(`${c.id}: ${c.note}`, () => {
        expect(matchAnswer(c.input)).toEqual(c.expected);
      });
    }
  });
}
