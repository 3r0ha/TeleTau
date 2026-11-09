import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildPersonalCardPayload,
  buildQrLink,
  buildQrPayload,
  classCodeFromRandomBytes,
  parseClassCode,
  parseLoginCard,
  parseQrPayload,
  personalCardFromRandomBytes,
  qrCardFromRandomBytes,
} from "../src/index.js";

interface VectorSuite {
  suite: string;
  version: number;
  function: string;
  cases: { id: string; input: unknown; expected: unknown; note: string }[];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../contracts/test-vectors");
const hex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16));

/** Функции наборов: вход из вектора → значение, которое сравнивается с `expected` целиком. */
const functions: Record<string, (input: never) => unknown> = {
  parseQrPayload: (input: string) => parseQrPayload(input),
  buildQrCard: (input: { seat: string; secret: string; baseUrl: string }) => {
    const payload = buildQrPayload(input.seat, input.secret);
    return { payload, link: buildQrLink(input.baseUrl, payload) };
  },
  qrCardFromRandomBytes: (input: string) => qrCardFromRandomBytes(hex(input)),
  parseClassCode: (input: string) => parseClassCode(input),
  classCodeFromRandomBytes: (input: string) => classCodeFromRandomBytes(hex(input)),
  parseLoginCard: (input: string) => parseLoginCard(input),
  buildPersonalCard: (input: { handle: string; secret: string }) => ({ payload: buildPersonalCardPayload(input.handle, input.secret) }),
  personalCardFromRandomBytes: (input: string) => personalCardFromRandomBytes(hex(input)),
};

/**
 * Версии наборов, которые реализует эталон (по каталогам). Новый набор или новая версия —
 * сознательное решение, которое повторяют порты Swift и Kotlin.
 */
const SUPPORTED_VERSIONS: Record<string, Record<string, number>> = {
  "qr-card": { "parse.json": 2, "build.json": 2, "generate.json": 2 },
  "class-code": { "parse.json": 1, "generate.json": 1 },
  // Личная карточка самостоятельного ученика и общий разбор сканера (ADR 0022).
  "login-card": { "parse.json": 2, "build.json": 2, "generate.json": 2 },
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
          expect(fn!(c.input as never)).toEqual(c.expected);
        });
      }
    });
  }
}
