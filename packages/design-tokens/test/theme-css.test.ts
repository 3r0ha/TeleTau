import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Веб и консоль: без выбора тема светлая и в тёмной системе; тёмную включает только data-theme="dark" (выбор пользователя).
const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(resolve(pkg, "build/css/tokens.css"), "utf8");
const tokens = JSON.parse(readFileSync(resolve(pkg, "build/json/tokens.json"), "utf8")) as { light: Record<string, string>; dark: Record<string, string> };

describe("tokens.css: light by default, dark only by choice", () => {
  it("does not follow the system theme", () => {
    expect(css).not.toMatch(/prefers-color-scheme/);
  });

  it(":root is light: light colors and color-scheme light", () => {
    const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
    expect(root).toMatch(/color-scheme: light;/);
    expect(root).toContain(`--tt-color-bg: ${tokens.light["color.bg"]};`);
  });

  it("dark colors only under :root[data-theme=\"dark\"] with color-scheme dark", () => {
    const selectors = [...css.matchAll(/^([^\s{}/*][^{}]*)\{/gm)].map((m) => m[1]!.trim());
    expect(selectors).toEqual([":root", ':root[data-theme="dark"]']);
    const dark = css.slice(css.indexOf(':root[data-theme="dark"]'));
    expect(dark).toMatch(/color-scheme: dark;/);
    expect(dark).toContain(`--tt-color-bg: ${tokens.dark["color.bg"]};`);
  });
});
