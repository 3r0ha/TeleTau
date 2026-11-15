// Каталоги переводов интерфейса (i18n/areas): каждая строка из кода переведена на ba и kk, ключ живёт ровно в одном
// файле языка (иначе выигрывает последний файл и перевод зависит от порядка импорта), наборы ключей ba и kk совпадают,
// подстановки перевода есть в исходной строке, башкирские буквы — правильные кодовые точки (CLAUDE.md, правило 7).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RU_UI_STRINGS } from "@teletau/ui/strings";
import { PROBLEM_TEXTS } from "@teletau/session/problem";
import { CATALOG_PARTS, CATALOGS } from "../i18n/registry";

const APP = path.resolve(__dirname, "../app");
const LOCALES = ["ba", "kk"] as const;

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Ключи из кода: t("…") с литералом (переносы строк внутри вызова допустимы). */
function usedKeys(): Map<string, string> {
  const used = new Map<string, string>();
  const re = /\bt\(\s*"((?:[^"\\\n]|\\.)*)"/g;
  for (const file of sources(APP)) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(re)) {
      const key = JSON.parse(`"${m[1]}"`) as string;
      if (!used.has(key)) used.set(key, `${path.relative(APP, file)}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
  return used;
}

const placeholders = (s: string) => new Set(s.match(/\{\w+\}/g) ?? []);

describe("каталоги переводов", () => {
  it("каждая строка t(\"…\") из кода, строки packages/ui и тексты ошибок переведены на ba и kk", () => {
    const keys = new Map(usedKeys());
    for (const ru of Object.values(RU_UI_STRINGS)) keys.set(ru, "packages/ui/src/strings.ts");
    for (const ru of PROBLEM_TEXTS) keys.set(ru, "packages/session/src/problem.ts");
    for (const locale of LOCALES) {
      const missing = [...keys].filter(([key]) => !(key in CATALOGS[locale])).map(([key, where]) => `${key}  @ ${where}`);
      expect(missing, locale).toEqual([]);
    }
  });

  it("ключ — ровно в одном файле языка", () => {
    for (const locale of LOCALES) {
      const seen = new Map<string, string>();
      const twice: string[] = [];
      for (const [part, catalog] of Object.entries(CATALOG_PARTS[locale])) {
        for (const key of Object.keys(catalog)) {
          const first = seen.get(key);
          if (first) twice.push(`${key}: ${first}, ${part}`);
          else seen.set(key, part);
        }
      }
      expect(twice, locale).toEqual([]);
    }
  });

  it("наборы ключей ba и kk совпадают", () => {
    const ba = Object.keys(CATALOGS.ba);
    const kk = Object.keys(CATALOGS.kk);
    expect(ba.filter((k) => !(k in CATALOGS.kk)), "только в ba").toEqual([]);
    expect(kk.filter((k) => !(k in CATALOGS.ba)), "только в kk").toEqual([]);
  });

  it("подстановки перевода есть в исходной строке", () => {
    for (const locale of LOCALES) {
      const bad = Object.entries(CATALOGS[locale]).filter(([ru, text]) => [...placeholders(text)].some((p) => !placeholders(ru).has(p)));
      expect(bad, locale).toEqual([]);
    }
  });

  it("башкирские строки — без латиницы-двойников и казахских букв вместо башкирских", () => {
    // ə (U+0259), ç, ş, ğ — латинские двойники ә, ҫ, ш, ғ; ұ, қ, ғ-казахские — не башкирские буквы.
    const wrong = /[əƏçÇşŞğĞұҰқҚіІ]/;
    const bad = Object.entries(CATALOGS.ba).filter(([, text]) => wrong.test(text));
    expect(bad).toEqual([]);
  });
});
