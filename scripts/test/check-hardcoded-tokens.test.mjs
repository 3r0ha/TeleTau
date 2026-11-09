// Длительности анимаций и радиусы — только из дизайн-токенов; без атрибутов style (строгая CSP).
import assert from "node:assert/strict";
import { test } from "node:test";
import { findHardcodedTokens } from "../check-hardcoded-tokens.mjs";

const hits = (source, file) => findHardcodedTokens(source, file).length;

test("catches durations and radii outside the tokens (jury UX, M1 round 1)", () => {
  const cases = [
    [`.tt-spin { animation: tt-spin 0.9s linear infinite; }`, "a.css"],
    [`.tt-skeleton { animation: tt-shimmer 1.4s ease-in-out infinite; }`, "a.css"],
    [`.start__bee {\n  animation: start-drift 2.4s ease-in-out infinite;\n}`, "a.css"],
    [`.x { transition: transform 80ms ease-out, box-shadow var(--tt-duration-press) ease-out; }`, "a.css"],
    [`.x { transition-duration: 200ms; }`, "a.css"],
    [`.x { animation-delay: .5s; }`, "a.css"],
    [`.tt-choice__mark { border-radius: 9px; }`, "a.css"],
    [`.tt-brand img { border-radius: 10px; }`, "a.css"],
    [`.x { border-radius: 50%; }`, "a.css"],
    [`.x { border-top-left-radius: 4px; }`, "a.css"],
    [`.x { border-radius: var(--tt-radius-sheet) var(--tt-radius-sheet) 0 2rem; }`, "a.css"],
    [`.x { border-radius: calc(var(--tt-radius-card) - 2px); }`, "a.css"],
    [`<div style={{ flex: 1 }} />`, "a.tsx"],
    [`<span className="tt-hex" style={{ width: vw }}>`, "a.jsx"],
  ];
  for (const [src, file] of cases) assert.ok(hits(src, file) > 0, `не пойман: ${file}: ${src}`);
});

test("allows tokens, zero values, the reduced-motion reset and unrelated numbers", () => {
  const cases = [
    [`.tt-spin { animation: tt-spin var(--tt-duration-spin) linear infinite; }`, "a.css"],
    [`.x { transition: transform var(--tt-duration-press) cubic-bezier(0.2, 0.8, 0.2, 1); }`, "a.css"],
    [`@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }`, "a.css"],
    [`.x { transition: none; animation: none; transition-duration: 0s; }`, "a.css"],
    [`.x { border-radius: var(--tt-radius-sheet) var(--tt-radius-sheet) 0 0; }`, "a.css"],
    [`.x { border-radius: 0; width: 56px; height: 64px; }`, "a.css"],
    [`/* было border-radius: 9px */ .x { border-radius: var(--tt-radius-mark); }`, "a.css"],
    [`.x { animation: tt-sheet-up var(--tt-duration-base) var(--tt-easing-out); }`, "a.css"],
    [`.x { border-radius: 3px; } /* allow-hardcoded-token: печать */`, "a.css"],
    [`const s = { styleName: "x" }; <Foo className="a" />`, "a.tsx"],
    [`<svg width={vw} height={vh} />`, "a.tsx"],
  ];
  for (const [src, file] of cases) assert.equal(hits(src, file), 0, `ложное срабатывание: ${file}: ${src}`);
});

test("reports the line of the declaration", () => {
  const found = findHardcodedTokens(`.a {}\n.b {\n  border-radius: 9px;\n}\n`, "x.css");
  assert.equal(found.length, 1);
  assert.match(found[0], /^3: border-radius: 9px/);
});
