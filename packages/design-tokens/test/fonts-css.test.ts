// fonts/fonts.css — то, что подключают веб и консоль. Каждый @font-face ссылается на проверенный файл из fonts.json,
// семейство совпадает с токеном, диапазон весов — с осью wght файла.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openSync, type Font } from "fontkit";
import { describe, expect, it } from "vitest";
// @ts-expect-error — модуль сборки на JS без объявлений типов
import { woff2MatchesTtf } from "../scripts/woff2.mjs";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(resolve(pkg, "fonts/fonts.css"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(pkg, "fonts/fonts.json"), "utf8")) as {
  fonts: { file: string; family: string }[];
};
const tokens = JSON.parse(readFileSync(resolve(pkg, "build/json/tokens.json"), "utf8")) as { base: Record<string, string> };

const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => {
  const body = m[1]!;
  return {
    family: /font-family:\s*"([^"]+)"/.exec(body)?.[1],
    url: /url\("\.\/([^"]+\.ttf)"\)/.exec(body)?.[1],
    woff2: /url\("\.\/([^"]+\.woff2)"\)\s*format\("woff2"\)/.exec(body)?.[1],
    firstFormat: /src:\s*url\("[^"]+"\)\s*format\("([^"]+)"\)/.exec(body)?.[1],
    weight: /font-weight:\s*(\d+)\s+(\d+)/.exec(body),
  };
});

describe("fonts/fonts.css", () => {
  it("declares both token families", () => {
    expect(faces.map((f) => f.family).sort()).toEqual([tokens.base["fontFamily.text"], tokens.base["fontFamily.display"]].sort());
  });

  for (const face of faces) {
    it(`${face.family}: file is reviewed in fonts.json, weight range matches the wght axis`, () => {
      const entry = manifest.fonts.find((f) => f.file === face.url);
      expect(entry, `${face.url} нет в fonts.json`).toBeDefined();
      expect(entry!.family).toBe(face.family);
      const font = openSync(resolve(pkg, "fonts", face.url!)) as Font;
      const axis = (font.variationAxes as Record<string, { min: number; max: number }>).wght;
      expect(axis, "нужен вариативный файл").toBeDefined();
      expect([Number(face.weight?.[1]), Number(face.weight?.[2])]).toEqual([axis!.min, axis!.max]);
    });

    it(`${face.family}: браузер берёт WOFF2 — те же таблицы, что у проверенного TTF`, () => {
      expect(face.firstFormat).toBe("woff2");
      expect(face.woff2).toBe(face.url!.replace(/\.ttf$/, ".woff2"));
      const woff2 = readFileSync(resolve(pkg, "fonts", face.woff2!));
      const ttf = readFileSync(resolve(pkg, "fonts", face.url!));
      expect(woff2MatchesTtf(woff2, ttf)).toBe(true);
      expect(woff2.length).toBeLessThan(ttf.length * 0.6);
      // fontkit читает WOFF2 сам: все башкирские буквы на месте.
      const font = openSync(resolve(pkg, "fonts", face.woff2!)) as Font;
      for (const ch of "ӘәӨөҮүҒғҠҡҢңҘҙҪҫҺһ") expect(font.hasGlyphForCodePoint(ch.codePointAt(0)!), ch).toBe(true);
    });
  }
});
