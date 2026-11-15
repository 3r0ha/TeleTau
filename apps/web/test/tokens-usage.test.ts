import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(resolve(here, "../../../packages/design-tokens/build/css/tokens.css"), "utf8");
// Стили экранов: globals.css, экраны ученика (learn.css, self.css) и их место в сетке оболочки (shell.css).
const appCss = ["../app/globals.css", "../app/_components/learn/learn.css", "../app/_components/learn/self.css", "../app/_components/learn/shell.css"].map((p) => readFileSync(resolve(here, p), "utf8")).join("\n");
const layout = readFileSync(resolve(here, "../app/layout.tsx"), "utf8");

describe("design tokens usage in web", () => {
  it("every var(--tt-…) used in app CSS is defined by the design tokens", () => {
    const defined = new Set([...tokensCss.matchAll(/(--tt-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = [...new Set([...appCss.matchAll(/var\((--tt-[a-z0-9-]+)/g)].map((m) => m[1]))];
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((v) => !defined.has(v))).toEqual([]);
  });

  it("dark theme overrides every semantic color", () => {
    const darkBlock = tokensCss.split(':root[data-theme="dark"]')[1] ?? "";
    for (const name of ["--tt-color-bg", "--tt-color-text-primary", "--tt-color-accent-fill", "--tt-color-accent-lip", "--tt-color-violet-fill"]) {
      expect(darkBlock).toContain(name);
    }
  });

  it("variable Nunito defaults to weight 200 — every Nunito rule sets an explicit font-weight", () => {
    const css = appCss.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/([^{}]+)\{([^}]*font-family:\s*var\(--tt-font-family-display\)[^}]*)\}/g)) {
      expect(m[2], m[1]!.trim()).toMatch(/font-weight:/);
    }
  });

  it("uses the shared components and stylesheet from @teletau/ui (packages/ui)", () => {
    expect(layout).toContain('import "@teletau/ui/ui.css"');
    expect(layout).toContain('import "@teletau/ui/shell.css"');
    expect(layout).toContain('from "@teletau/ui"');
  });
});
