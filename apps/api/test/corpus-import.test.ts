// Разбор дуэлей для corpus:import (duels-import.ts): синтетические файлы (без башкирских слов — правило 6) и
// настоящий content/corpus/duels/*.yaml, если он уже собран. Загрузка в базу и идемпотентность — интеграционный
// тест test/integration/m2-duel.test.ts.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DUELS_DIR,
  DEFAULT_SOURCES_FILE,
  parseDuelFiles,
  parseSources,
  readDuelFiles,
  stableJson,
} from "../src/modules/corpus/duels-import.js";
import { readFileSync } from "node:fs";

const SOURCES = parseSources(`
sources:
  - id: synthetic-a
    title: "Синтетический источник А"
    url: https://example.org/a
    license: CC0
    accessed: "2026-11-04"
  - id: synthetic-b
    title: "Синтетический источник Б"
    edition: "Тестовое издание, 2026"
    license: не указана
    accessed: "2026-11-04"
`);

const variant = (text: string, ref = "synthetic-a", extra = "") => `
      - ba: ${text}${extra}
        source:
          ref: ${ref}
          ${ref === "synthetic-b" ? "page: 12" : "url: https://example.org/a/1"}
          locator: строка 1
        review: needs_native_review`;

const file = (body: string, unit = "01-test") => ({ name: "01-test.yaml", text: `unit: ${unit}\nduels:\n${body}` });

describe("corpus:import — parsing duels", () => {
  it("turns a duel into a source item and two import variants with source title and license", () => {
    const [d, ...rest] = parseDuelFiles(
      [
        file(`  - id: t01-d01
    ru: "Синтетическая фраза"
    kind: phrase
    domain: greeting
    variants:${variant("Синтетика один")}${variant("Синтетика два", "synthetic-b", "\n        raw: Синтетика  два")}`),
      ],
      SOURCES,
    );
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ externalId: "t01-d01", unitId: "01-test", ru: "Синтетическая фраза", kind: "phrase", domain: "greeting", sourceRef: null });
    expect(d!.variants[0]).toMatchObject({
      text: "Синтетика один",
      raw: null,
      review: "needs_native_review",
      sourceRef: { ref: "synthetic-a", url: "https://example.org/a/1", locator: "строка 1", title: "Синтетический источник А", license: "CC0" },
    });
    expect(d!.variants[1]).toMatchObject({ raw: "Синтетика  два", sourceRef: { ref: "synthetic-b", page: 12, title: "Синтетический источник Б" } });
    expect(d!.variants[0].textNorm).not.toBe(d!.variants[1].textNorm);
  });

  it("collects every error at once: unknown source, non-canonical text, equal variants, duplicate id, wrong shape", () => {
    const bad = [
      file(`  - id: t01-d01
    ru: "Фраза"
    kind: phrase
    variants:${variant("Один", "nowhere")}${variant("Два")}
  - id: t01-d02
    ru: "Фраза"
    kind: phrase
    variants:${variant("Синтетика три")}${variant("Синтетика четыре")}
  - id: t01-d03
    ru: "Фраза"
    kind: phrase
    variants:${variant("Повтор")}${variant("ПОВТОР")}
  - id: t01-d03
    ru: "Фраза"
    kind: idiom
    variants:${variant("Пять")}`),
    ];
    let message = "";
    try {
      parseDuelFiles(bad, SOURCES);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("источника «nowhere» нет");
    expect(message).toContain("t01-d02, variants[0]: ba не в канонической форме");
    expect(message).toContain("t01-d03: варианты совпадают");
    expect(message).toContain("t01-d03: id уже есть");
    expect(message).toContain("kind — word, phrase или sentence");
    expect(message).toContain("нужно ровно два варианта");
  });

  it("refuses a sources registry without titles or licenses", () => {
    expect(() => parseSources("sources:\n  - id: x\n    title: X\n")).toThrow(/license/);
  });

  it("compares stored jsonb with the computed value regardless of key order", () => {
    expect(stableJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(stableJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));
    expect(stableJson({ a: 1, u: undefined })).toBe(stableJson({ a: 1 }));
  });

  // Настоящий контент: файл разбирается без ошибок, у каждой дуэли два разных варианта с источником из реестра.
  const real = readDuelFiles(DEFAULT_DUELS_DIR);
  it.runIf(real.length > 0)("the real content/corpus/duels parses: two distinct sourced variants per duel", () => {
    const duels = parseDuelFiles(real, parseSources(readFileSync(DEFAULT_SOURCES_FILE, "utf8")));
    expect(duels.length).toBeGreaterThanOrEqual(6);
    for (const d of duels) {
      expect(d.variants[0].textNorm, d.externalId).not.toBe(d.variants[1].textNorm);
      for (const v of d.variants) {
        expect(v.sourceRef.title, d.externalId).toBeTruthy();
        expect(v.sourceRef.license, d.externalId).toBeTruthy();
      }
    }
  });
});
