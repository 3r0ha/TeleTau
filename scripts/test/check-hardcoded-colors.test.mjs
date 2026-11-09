import assert from "node:assert/strict";
import { test } from "node:test";
import { findHardcodedColors } from "../check-hardcoded-colors.mjs";

const hits = (source, file) => findHardcodedColors(source, file).length;

test("catches the bypasses found by QA in round 1 (M0-09)", () => {
  const cases = [
    [`<div style={{ color: "red" }} />`, "a.tsx"],
    [`const s = { backgroundColor: 'rebeccapurple' };`, "a.ts"],
    [`<path fill="orange" />`, "a.tsx"],
    [`.x { background: red; }`, "a.css"],
    [`.x { border-color: SteelBlue; }`, "a.css"],
    [`.x { color: oklch(70% 0.1 60); }`, "a.css"],
    [`const c = "oklch(70% 0.1 60)";`, "a.ts"],
    [`.x { background: color-mix(in srgb, white 30%, black); }`, "a.css"],
    [`.x { color: #ff0000; }`, "a.css"],
    [`Text("x").foregroundStyle(Color.red)`, "a.swift"],
    [`Text("x").foregroundStyle(.red)`, "a.swift"],
    [`let c = Color(.sRGB, red: 1, green: 0, blue: 0)`, "a.swift"],
    [`let c = UIColor.systemRed`, "a.swift"],
    [`val c = Color.Red`, "a.kt"],
    [`val c = Color(255, 0, 0)`, "a.kt"],
    [`val c = Color(1f, 0f, 0f)`, "a.kt"],
    [`val c = Color.hsv(10f, 1f, 1f)`, "a.kt"],
    [`val c = android.graphics.Color.parseColor("#FF0000")`, "a.kt"],
  ];
  for (const [src, file] of cases) assert.ok(hits(src, file) > 0, `не пойман: ${file}: ${src}`);
});

test("does not flag token usage, transparent and unrelated code", () => {
  const cases = [
    [`.x { color: var(--tt-color-text-primary); background: transparent; border-color: currentColor; }`, "a.css"],
    [`<div style={{ color: "var(--tt-color-bg)" }} />`, "a.tsx"],
    [`const red = loadConfig(); // слово red в коде — не цвет`, "a.ts"],
    [`.foregroundStyle(TeleTauColor.textPrimary).background(Color.clear)`, "a.swift"],
    [`val c = TeleTauTheme.colors.textPrimary; val t = Color.Transparent; val u = Color.Unspecified`, "a.kt"],
    [`val radius = 12.dp`, "a.kt"],
  ];
  for (const [src, file] of cases) assert.equal(hits(src, file), 0, `ложное срабатывание: ${file}: ${src}`);
});

test("respects the explicit allow marker", () => {
  assert.equal(hits(`.x { color: red; } /* allow-hardcoded-color: демо */`, "a.css"), 0);
});

test("catches the bypasses found by QA in round 2 (M0-R2-09)", () => {
  const cases = [
    // CSS / SCSS
    [`.x { background: linear-gradient(red, blue); }`, "a.css"],
    [`.x {\n  color:\n    tomato;\n}`, "a.css"],
    [`:root { --brand: tomato; }`, "a.css"],
    [`.x { background-image: radial-gradient(gold, transparent); }`, "a.css"],
    [`.x { box-shadow: 0 0 1px\n  black; }`, "a.css"],
    [`$brand: tomato;\n.x { color: $brand; }`, "a.scss"],
    [`.x { color: #f00; }`, "a.scss"],
    // TS / TSX / JS / JSX / MJS
    [`const s = { borderTop: '1px solid red' };`, "a.ts"],
    [`const s = { boxShadow: '0 0 1px black' };`, "a.tsx"],
    [`<path fill={'red'} />`, "a.tsx"],
    [`<div style={{ color: 'red' }} />`, "a.jsx"],
    [`export const c = "#ff0000";`, "a.mjs"],
    [`module.exports = { outline: "2px solid navy" };`, "a.cjs"],
    // Swift
    [`Text("x").foregroundStyle(Color(.systemRed))`, "a.swift"],
    [`let c = Color(uiColor: .red)`, "a.swift"],
    [`let c = Color(nsColor: .systemBlue)`, "a.swift"],
    [`let hex = "#FF0000"`, "a.swift"],
    [`let c = Color(\n  red: 1, green: 0, blue: 0)`, "a.swift"],
    // Kotlin
    [`val c = Color(\n    0xFFFF0000\n)`, "a.kt"],
    [`val c = android.graphics.Color.RED`, "a.kt"],
    [`val c = Color.rgb(255, 0, 0)`, "a.kt"],
    [`val c = Color(\n  red = 1f, green = 0f, blue = 0f)`, "a.kt"],
    // Android XML, HTML
    [`<resources><color name="brand">#FF0000</color></resources>`, "colors.xml"],
    [`<TextView android:textColor="#FF0000" />`, "layout.xml"],
    [`<item name="android:background">@android:color/black</item>`, "themes.xml"],
    [`<div style="color: red">x</div>`, "a.html"],
    [`<style>.x { background: #f00 }</style>`, "a.html"],
    [`<svg><path fill="orange"/></svg>`, "a.html"],
  ];
  for (const [src, file] of cases) assert.ok(hits(src, file) > 0, `не пойман: ${file}: ${JSON.stringify(src)}`);
});

test("no false positives on selectors, token variables and HTML anchors (M0-R2-09)", () => {
  const cases = [
    [`a:hover { color: var(--tt-color-info); }\nbutton:not(.red) { outline: none; }`, "a.css"],
    [`.x { color: var(--tt-color-red-500); background: transparent; }`, "a.css"],
    [`@media (prefers-color-scheme: dark) { .x { color: var(--tt-color-bg); } }`, "a.css"],
    [`.x { width: calc(100% - 2px); transform: rotate(tan(45deg)); }`, "a.css"],
    [`<a href="#face">Лицо</a><a href="#add">x</a>`, "a.html"],
    [`<item name="android:windowBackground">@android:color/transparent</item>`, "themes.xml"],
    [`const title = "Red Square"; const s = { color: "var(--tt-color-bg)" };`, "a.ts"],
  ];
  for (const [src, file] of cases) assert.equal(hits(src, file), 0, `ложное срабатывание: ${file}: ${JSON.stringify(src)}`);
});

test("catches the bypasses found by QA in round 3 (M0-R3-08)", () => {
  const cases = [
    [`Text("x").shadow(color: .black, radius: 2)`, "a.swift"],
    [`Text("x").shadow(color: .black.opacity(0.2), radius: 2)`, "a.swift"],
    [`let c = CGColor(red: 1, green: 0, blue: 0, alpha: 1)`, "a.swift"],
    [`let c = CGColor(gray: 0.5, alpha: 1)`, "a.swift"],
    [`val c = "#ff0000".toColorInt()`, "a.kt"],
    [`val c = Color(color = 0xFFFF0000)`, "a.kt"],
    [`val c = Color(value = 0xFFFF0000UL)`, "a.kt"],
    [`val c = 0xFFFF0000; val d = Color(c)`, "a.kt"],
    [`.x { /* x */color: red; }`, "a.css"],
    [`.x { color: device-cmyk(0 1 1 0); }`, "a.css"],
  ];
  for (const [src, file] of cases) assert.ok(hits(src, file) > 0, `не пойман: ${file}: ${JSON.stringify(src)}`);
});

test("no false positives for round 3 rules (M0-R3-08)", () => {
  const cases = [
    [`Text("x").shadow(color: TeleTauColor.shadow, radius: 2).background(Color.clear)`, "a.swift"],
    [`let mask: UInt64 = 0x9E3779B97F4A7C15`, "a.swift"],
    [`val seed = 0x9E3779B97F4A7C15uL; val cp = 0x04D9`, "a.kt"],
    [`/* color: red — пример в комментарии */ .x { color: var(--tt-color-bg); }`, "a.css"],
  ];
  for (const [src, file] of cases) assert.equal(hits(src, file), 0, `ложное срабатывание: ${file}: ${JSON.stringify(src)}`);
});

test("reports the line of a multi-line match", () => {
  const [first] = findHardcodedColors(`val a = 1\nval c = Color(\n    0xFFFF0000\n)`, "a.kt");
  assert.match(first, /^2: /);
});
