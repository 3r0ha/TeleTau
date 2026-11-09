// Шрифты в репозитории (ADR 0018): полный башкирский алфавит, правильная форма Ҫ/Ҙ, факт наличия locl BSH.
// Если у шрифта нет locl для языковой системы BSH, тест не падает, а фиксирует это в fonts.json (loclBSH: false)
// и печатает предупреждение; если факт изменится (например, после обновления шрифта), тест упадёт — обновите fonts.json.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openSync, type Font } from "fontkit";
import { describe, expect, it } from "vitest";

interface FontEntry {
  file: string;
  family: string;
  license: string;
  sha256: string;
  defaultWeight: number;
  loclBSH: boolean;
}

/** Часть таблицы GSUB, которую разбирает fontkit (в типах @types/fontkit её нет). */
interface Gsub {
  scriptList: { tag: string; script: { langSysRecords: { tag: string; langSys: { featureIndexes: number[] } }[] } }[];
  featureList: { tag: string }[];
}

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../fonts");
const manifest = JSON.parse(readFileSync(resolve(dir, "fonts.json"), "utf8")) as { bashkirLetters: string; fonts: FontEntry[] };
const RUSSIAN = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя";

function load(entry: FontEntry): Font {
  const font = openSync(resolve(dir, entry.file));
  if (!("hasGlyphForCodePoint" in font)) throw new Error(`${entry.file}: коллекция шрифтов вместо шрифта`);
  return font as Font;
}

/** Есть ли у языковой системы `lang` письменности `cyrl` функция locl. */
function hasLocl(font: Font, lang: string): boolean {
  const gsub = (font as unknown as { GSUB?: Gsub }).GSUB;
  const cyrl = gsub?.scriptList.find((s) => s.tag === "cyrl");
  const sys = cyrl?.script.langSysRecords.find((l) => l.tag.trim() === lang);
  return Boolean(sys?.langSys.featureIndexes.some((i) => gsub!.featureList[i]?.tag === "locl"));
}

/** Контуры глифов текста после шейпинга для языка `lang` (cyrl, locl); каждый — относительно своей первой точки. */
function shapedContours(font: Font, text: string, lang?: string): string[] {
  const out: string[] = [];
  for (const glyph of font.layout(text, ["locl"], "cyrl", lang).glyphs) {
    let origin: [number, number] = [0, 0];
    let current: string[] | undefined;
    for (const { command, args } of glyph.path.commands) {
      if (command === "moveTo") {
        origin = [args[0]!, args[1]!];
        current = [];
        out.push("");
      }
      const rel = args.map((v, i) => Math.round(v - origin[i % 2]!));
      current?.push(`${command}(${rel.join(",")})`);
      out[out.length - 1] = current?.join(" ") ?? "";
    }
  }
  return out;
}

/** Контуры седили этого шрифта: то, что есть в Ç (ç), но нет в C (c). */
function cedillaContours(font: Font, withCedilla: string, base: string): string[] {
  const plain = new Set(shapedContours(font, base));
  return shapedContours(font, withCedilla).filter((c) => !plain.has(c));
}

/** Рисуется ли буква с седилью (чувашская форма) — содержит ли она контур седили шрифта. */
function hasCedilla(font: Font, char: string, lang: string): boolean {
  const upper = char === char.toUpperCase();
  const cedilla = new Set(cedillaContours(font, upper ? "Ç" : "ç", upper ? "C" : "c"));
  return shapedContours(font, char, lang).some((c) => cedilla.has(c));
}

describe("fonts in packages/design-tokens/fonts", () => {
  for (const entry of manifest.fonts) {
    describe(entry.file, () => {
      const font = load(entry);

      it("is the reviewed file (sha256 from fonts.json) under the SIL OFL 1.1", () => {
        const sha = createHash("sha256").update(readFileSync(resolve(dir, entry.file))).digest("hex");
        expect(sha).toBe(entry.sha256);
        expect(readFileSync(resolve(dir, entry.license), "utf8")).toContain("SIL OPEN FONT LICENSE Version 1.1");
        expect(font.familyName).toContain(entry.family);
      });

      it("has every letter of the Bashkir and Russian alphabets", () => {
        const missing = [...manifest.bashkirLetters + RUSSIAN].filter((c) => !font.hasGlyphForCodePoint(c.codePointAt(0)!));
        expect(missing).toEqual([]);
      });

      it("draws Ҫ ҫ Ҙ ҙ in the Bashkir form for lang BSH — without the font's cedilla (Chuvash form)", () => {
        expect(cedillaContours(font, "Ç", "C").length, "контур седили в Ç не найден").toBeGreaterThan(0);
        for (const ch of ["Ҫ", "ҫ", "Ҙ", "ҙ"]) expect(hasCedilla(font, ch, "BSH"), ch).toBe(false);
      });

      it("the cedilla detector sees the Chuvash form where the font has one (positive control)", () => {
        if (!hasLocl(font, "CHU")) return;
        for (const ch of ["Ҫ", "ҫ", "Ҙ", "ҙ"]) expect(hasCedilla(font, ch, "CHU"), ch).toBe(true);
      });

      it(`records the fact: locl for BSH is ${entry.loclBSH ? "present" : "absent"}`, () => {
        const present = hasLocl(font, "BSH");
        if (!present) {
          console.warn(
            `⚠️  ${entry.file}: нет OpenType locl для языковой системы BSH. Ҫ/Ҙ рисуются формой по умолчанию — ` +
              "проверено выше, что это не седиль (чувашская форма). Подробности — docs/backlog.md, M0-P01.",
          );
        }
        expect(present).toBe(entry.loclBSH);
      });

      it("declares the default weight that renderers without variation support will use", () => {
        const axis = (font.variationAxes as Record<string, { default: number }>).wght;
        expect(axis?.default ?? entry.defaultWeight).toBe(entry.defaultWeight);
      });
    });
  }
});
