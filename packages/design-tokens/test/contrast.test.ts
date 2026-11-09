import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(readFileSync(resolve(pkg, "build/json/tokens.json"), "utf8")) as {
  light: Record<string, string>;
  dark: Record<string, string>;
};
const { pairs } = JSON.parse(readFileSync(resolve(pkg, "tokens/contrast-pairs.json"), "utf8")) as {
  pairs: { fg: string; bg: string; min: number; use?: string }[];
};

/** Относительная яркость по WCAG 2.x. */
function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 0xff) + 0.7152 * channel((n >> 8) & 0xff) + 0.0722 * channel(n & 0xff);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("WCAG contrast of token pairs", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const { fg, bg, min, use } of pairs) {
      it(`${theme}: ${fg} on ${bg} ≥ ${min}${use ? ` (${use})` : ""}`, () => {
        const f = tokens[theme][fg];
        const b = tokens[theme][bg];
        expect(f, `нет токена ${fg}`).toBeDefined();
        expect(b, `нет токена ${bg}`).toBeDefined();
        const ratio = contrast(f as string, b as string);
        expect(ratio, `${f} на ${b} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
      });
    }
  }
});

describe("theme completeness", () => {
  it("dark theme defines every light semantic color", () => {
    expect(Object.keys(tokens.dark).sort()).toEqual(Object.keys(tokens.light).sort());
  });
});
