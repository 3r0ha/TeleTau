import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../src");
// Компоненты (ui.css) и оболочка на компьютере и планшете (shell.css) — по одним правилам.
const uiCss = ["ui.css", "shell.css"].map((name) => readFileSync(resolve(src, name), "utf8")).join("\n");
const tokensCss = readFileSync(resolve(here, "../../design-tokens/build/css/tokens.css"), "utf8");

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

describe("@teletau/ui: стили на дизайн-токенах", () => {
  it("every var(--tt-…) used in ui.css is defined by the design tokens", () => {
    const defined = new Set([...tokensCss.matchAll(/(--tt-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = [...new Set([...uiCss.matchAll(/var\((--tt-[a-z0-9-]+)/g)].map((m) => m[1]))];
    expect(used.length).toBeGreaterThan(30);
    expect(used.filter((v) => !defined.has(v))).toEqual([]);
  });

  it("variable Nunito defaults to weight 200 — every Nunito rule sets an explicit font-weight", () => {
    const css = uiCss.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/([^{}]+)\{([^}]*font-family:\s*var\(--tt-font-family-display\)[^}]*)\}/g)) {
      expect(m[2], m[1]!.trim()).toMatch(/font-weight:/);
    }
  });

  it("font sizes come from the tokens in rem — they follow the browser font-size setting", () => {
    const fontSize = [...uiCss.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(fontSize.length).toBeGreaterThan(20);
    for (const v of fontSize) expect(v, v).not.toMatch(/\d(px|pt)\b/);
    expect(tokensCss).toMatch(/--tt-font-size-body:\s*1rem;/);
    expect(tokensCss).not.toMatch(/--tt-font-size-[a-z0-9-]+:\s*[\d.]+px;/);
  });

  it("режим «Пчёлка» (data-mode=bee) поднимает цели нажатия до size.touchChild и увеличивает текст", () => {
    const bee = /:root\[data-mode="bee"\]\s*\{([^}]*)\}/.exec(uiCss)?.[1] ?? "";
    expect(bee).toMatch(/--tt-size-touch-min:\s*var\(--tt-size-touch-child\)/);
    expect(bee).toMatch(/--tt-size-button:\s*var\(--tt-size-touch-child\)/);
    expect(bee).toMatch(/font-size:\s*calc\(100% \* var\(--tt-font-scale-bee\)\)/);
    expect(tokensCss).toMatch(/--tt-size-touch-child:\s*56px;/);
  });

  it("выбранное состояние и фокус на мёде — контрастными токенами", () => {
    expect(uiCss).toMatch(/input:checked \+ \.tt-choice__box \{[^}]*border-color: var\(--tt-color-accent-text\)/);
    expect(uiCss).toMatch(/\.tt-tab\[aria-current="page"\] \{[^}]*border-color: var\(--tt-color-accent-text\)/);
    expect(uiCss).toMatch(/\.tt-topnav a\[aria-current="page"\] \{[^}]*border-color: var\(--tt-color-accent-text\)/);
    expect(uiCss).toMatch(/\.tt-dialog--board :focus-visible \{[^}]*outline-color: var\(--tt-color-text-on-fill\)/);
  });
});

describe("@teletau/ui самодостаточен", () => {
  it("imports only react, react-dom (createPortal), next, @phosphor-icons/react, design assets and its own files", () => {
    const allowed = /^(react|react\/.*|react-dom|next\/(link|image)|@phosphor-icons\/react\/ssr|\.\/.+|\.\.\/\.\.\/\.\.\/design\/assets\/approved\/.+\.webp)$/;
    for (const file of walk(src)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/from\s+"([^"]+)"/g)) expect(m[1], file).toMatch(allowed);
    }
  });

  it("компоненты не рисуют атрибут style: строгая CSP без 'unsafe-inline' его не применит", () => {
    for (const file of walk(src)) {
      if (!/\.tsx$/.test(file)) continue;
      expect(readFileSync(file, "utf8"), file).not.toMatch(/\sstyle=\{/);
    }
  });
});
