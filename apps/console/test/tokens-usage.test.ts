import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(resolve(here, "../app/globals.css"), "utf8");
const layout = readFileSync(resolve(here, "../app/layout.tsx"), "utf8");
const tokensCss = readFileSync(resolve(here, "../../../packages/design-tokens/build/css/tokens.css"), "utf8");

describe("design tokens usage in console", () => {
  it("every var(--tt-…) used in console CSS is defined by the design tokens", () => {
    const defined = new Set([...tokensCss.matchAll(/(--tt-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = [...new Set([...appCss.matchAll(/var\((--tt-[a-z0-9-]+)/g)].map((m) => m[1]))];
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((v) => !defined.has(v))).toEqual([]);
  });

  it("uses the shared v2 components and stylesheet from @teletau/ui (packages/ui)", () => {
    expect(layout).toContain('import "@teletau/ui/ui.css"');
    expect(layout).toContain('from "@teletau/ui"');
  });
});
