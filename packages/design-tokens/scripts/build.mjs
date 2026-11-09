// Сборка дизайн-токенов «Борть»: tokens/*.json (W3C DTCG) → CSS, JSON, Swift, Kotlin; шрифты веба TTF → WOFF2.
// Style Dictionary разбирает формат и ссылки; форматы собираем сами, чтобы светлая и тёмная
// темы попадали в один файл для каждой платформы.
// Запуск: node scripts/build.mjs [--check]  (--check: только сравнить Swift/Kotlin с сохранёнными)
import StyleDictionary from "style-dictionary";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ttfToWoff2, woff2MatchesTtf } from "./woff2.mjs";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(pkg, "../..");
const check = process.argv.includes("--check");

async function resolveSet(colorFile) {
  const sd = new StyleDictionary({
    source: [resolve(pkg, "tokens/base/*.json"), resolve(pkg, colorFile)],
    platforms: { raw: { transformGroup: "js" } },
    log: { verbosity: "silent" },
  });
  const { allTokens } = await sd.getPlatformTokens("raw");
  return allTokens.map((t) => ({
    path: t.path,
    raw: t.$value ?? t.value,
    value: Array.isArray(t.$value ?? t.value) ? (t.$value ?? t.value).join(", ") : String(t.$value ?? t.value),
    type: t.$type ?? t.type,
    description: t.$description ?? t.description ?? "",
  }));
}

const light = await resolveSet("tokens/color/light.json");
const dark = await resolveSet("tokens/color/dark.json");
const darkByPath = new Map(dark.map((t) => [t.path.join("."), t]));

const isPalette = (t) => t.path[0] === "color" && t.path[1] === "palette";
const semanticColors = light.filter((t) => t.type === "color" && !isPalette(t));
const base = light.filter((t) => t.type !== "color");
const group = (name) => base.filter((t) => t.path[0] === name);

const camel = (parts) =>
  parts.map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join("");
const kebab = (parts) => parts.join("-").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const px = (v) => Number(String(v).replace("px", ""));
const ms = (v) => Number(String(v).replace("ms", ""));
const hex6 = (v) => v.replace("#", "").toUpperCase();
const SWIFT_WEIGHTS = { 100: "ultraLight", 200: "thin", 300: "light", 400: "regular", 500: "medium", 600: "semibold", 700: "bold", 800: "heavy", 900: "black" };
const swiftWeight = (w) => {
  const name = SWIFT_WEIGHTS[w];
  if (!name) throw new Error(`Вес шрифта ${w} не кратен 100 (100–900)`);
  return name;
};
const doc = (t, indent) => (t.description ? `${indent}/// ${t.description}\n` : "");
const kdoc = (t, indent) => (t.description ? `${indent}/** ${t.description} */\n` : "");
const darkOf = (t) => {
  const d = darkByPath.get(t.path.join("."));
  if (!d) throw new Error(`Нет значения тёмной темы для ${t.path.join(".")}`);
  return d.value;
};
const fontStack = (t) =>
  t.path[1] === "display"
    ? `"${t.value}", "Golos Text", system-ui, sans-serif`
    : `"${t.value}", system-ui, sans-serif`;
const header = (c) =>
  `${c} СГЕНЕРИРОВАНО из packages/design-tokens/tokens (W3C DTCG). Не редактировать вручную.\n${c} Перегенерация: pnpm --filter @teletau/design-tokens build\n`;

// ---------- CSS ----------
const cssVar = (t) => `--tt-${kebab(t.path)}`;
// Размеры шрифтов в CSS — в rem (база 16 px): текст следует настройке «размер шрифта» браузера.
// Swift и Kotlin получают те же значения в pt/sp — масштаб там дают Dynamic Type и масштаб шрифта Android.
const rem = (v) => `${Number((px(v) / 16).toFixed(4))}rem`;
const cssValue = (t) => {
  if (t.type === "fontFamily") return fontStack(t);
  if (t.path[0] === "fontSize") return rem(t.value);
  if (t.type === "cubicBezier") return `cubic-bezier(${t.value})`;
  return t.value;
};
const cssBase = base.map((t) => `  ${cssVar(t)}: ${cssValue(t)};`).join("\n");
const cssColors = (pick) => semanticColors.map((t) => `  ${cssVar(t)}: ${pick(t)};`).join("\n");
// Светлая тема — в :root; тёмная — только атрибутом data-theme="dark" (выбор пользователя), без prefers-color-scheme.
const css =`${header("/*").replace(/\n\/\* /g, "\n * ").replace(/\n$/, "")} */
:root {
  color-scheme: light;
${cssBase}
${cssColors((t) => t.value)}
}

:root[data-theme="dark"] {
  color-scheme: dark;
${cssColors(darkOf)}
}
`;

// ---------- JSON (для тестов контраста и документации) ----------
const flat = (list) => Object.fromEntries(list.map((t) => [t.path.join("."), t.value]));
const json = JSON.stringify(
  {
    light: flat(semanticColors),
    dark: Object.fromEntries(semanticColors.map((t) => [t.path.join("."), darkOf(t)])),
    base: flat(base),
  },
  null,
  2,
);

// ---------- Swift ----------
const swiftColorName = (t) => camel(t.path.slice(1));
const swift = `${header("//")}
import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Семантические цвета «Борть». Каждый цвет автоматически переключается между светлой и тёмной темой.
public enum TeleTauColor {
${semanticColors.map((t) => `${doc(t, "    ")}    public static let ${swiftColorName(t)} = Color(ttLight: 0x${hex6(t.value)}, ttDark: 0x${hex6(darkOf(t))})`).join("\n")}
}

public enum TeleTauSpace {
${group("space").map((t) => `    public static let ${t.path[1]}: CGFloat = ${px(t.value)}`).join("\n")}
}

public enum TeleTauRadius {
${group("radius").map((t) => `    public static let ${t.path[1]}: CGFloat = ${px(t.value)}`).join("\n")}
}

public enum TeleTauSize {
${group("size").map((t) => `${doc(t, "    ")}    public static let ${t.path[1]}: CGFloat = ${px(t.value)}`).join("\n")}
}

public enum TeleTauFontSize {
${group("fontSize").map((t) => `${doc(t, "    ")}    public static let ${t.path[1]}: CGFloat = ${px(t.value)}`).join("\n")}
}

public enum TeleTauFontFamily {
${group("fontFamily").map((t) => `${doc(t, "    ")}    public static let ${t.path[1]} = "${t.value}"`).join("\n")}
}

/// Начертания. У вариативного Nunito вес по умолчанию 200 — вес задаётся явно.
public enum TeleTauFontWeight {
${group("fontWeight").map((t) => `${doc(t, "    ")}    public static let ${t.path[1]}: Font.Weight = .${swiftWeight(t.raw)}`).join("\n")}
}

/// Межстрочный интервал — множитель размера шрифта.
public enum TeleTauLineHeight {
${group("lineHeight").map((t) => `${doc(t, "    ")}    public static let ${t.path[1]}: CGFloat = ${t.raw}`).join("\n")}
}

/// Длительности анимаций в секундах.
public enum TeleTauDuration {
${group("duration").map((t) => `${doc(t, "    ")}    public static let ${t.path[1]}: Double = ${ms(t.value) / 1000}`).join("\n")}
}

/// Кривые анимаций.
public enum TeleTauEasing {
${group("easing").map((t) => `${doc(t, "    ")}    public static let ${t.path[1]} = UnitCurve.bezier(startControlPoint: UnitPoint(x: ${t.raw[0]}, y: ${t.raw[1]}), endControlPoint: UnitPoint(x: ${t.raw[2]}, y: ${t.raw[3]}))`).join("\n")}
}

extension Color {
    init(ttLight: UInt32, ttDark: UInt32) {
        #if canImport(UIKit)
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(ttHex: ttDark) : UIColor(ttHex: ttLight)
        })
        #elseif canImport(AppKit)
        self.init(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor(ttHex: ttDark) : NSColor(ttHex: ttLight)
        })
        #endif
    }
}

#if canImport(UIKit)
extension UIColor {
    convenience init(ttHex: UInt32) {
        self.init(
            red: CGFloat((ttHex >> 16) & 0xFF) / 255,
            green: CGFloat((ttHex >> 8) & 0xFF) / 255,
            blue: CGFloat(ttHex & 0xFF) / 255,
            alpha: 1
        )
    }
}
#elseif canImport(AppKit)
extension NSColor {
    convenience init(ttHex: UInt32) {
        self.init(
            srgbRed: CGFloat((ttHex >> 16) & 0xFF) / 255,
            green: CGFloat((ttHex >> 8) & 0xFF) / 255,
            blue: CGFloat(ttHex & 0xFF) / 255,
            alpha: 1
        )
    }
}
#endif
`;

// ---------- Kotlin (Compose) ----------
const kColorName = (t) => camel(t.path.slice(1));
const kColors = (pick) =>
  semanticColors.map((t) => `    ${kColorName(t)} = Color(0xFF${hex6(pick(t))}),`).join("\n");
const constName = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
// Явные public и типы — в core-модулях Android включён Kotlin explicit API (CLAUDE.md, «Соглашения»).
const kotlin = `${header("//")}
package ru.teletau.core.designsystem

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Семантические цвета «Борть». */
@Immutable
public data class TeleTauColors(
${semanticColors.map((t) => `${kdoc(t, "    ")}    public val ${kColorName(t)}: Color,`).join("\n")}
)

public val TeleTauLightColors: TeleTauColors = TeleTauColors(
${kColors((t) => t.value)}
)

public val TeleTauDarkColors: TeleTauColors = TeleTauColors(
${kColors(darkOf)}
)

public object TeleTauSpace {
${group("space").map((t) => `    public val ${t.path[1]}: Dp = ${px(t.value)}.dp`).join("\n")}
}

public object TeleTauRadius {
${group("radius").map((t) => `    public val ${t.path[1]}: Dp = ${px(t.value)}.dp`).join("\n")}
}

public object TeleTauSize {
${group("size").map((t) => `${kdoc(t, "    ")}    public val ${t.path[1]}: Dp = ${px(t.value)}.dp`).join("\n")}
}

public object TeleTauFontSize {
${group("fontSize").map((t) => `${kdoc(t, "    ")}    public val ${t.path[1]}: TextUnit = ${px(t.value)}.sp`).join("\n")}
}

public object TeleTauFontFamilyName {
${group("fontFamily").map((t) => `${kdoc(t, "    ")}    public const val ${constName(t.path[1])}: String = "${t.value}"`).join("\n")}
}

/** Начертания. У вариативного Nunito вес по умолчанию 200 — вес задаётся явно. */
public object TeleTauFontWeight {
${group("fontWeight").map((t) => `${kdoc(t, "    ")}    public val ${t.path[1]}: FontWeight = FontWeight(${t.raw})`).join("\n")}
}

/** Межстрочный интервал — множитель размера шрифта. */
public object TeleTauLineHeight {
${group("lineHeight").map((t) => `${kdoc(t, "    ")}    public const val ${constName(t.path[1])}: Float = ${t.raw}f`).join("\n")}
}

/** Длительности анимаций в миллисекундах. */
public object TeleTauDuration {
${group("duration").map((t) => `${kdoc(t, "    ")}    public const val ${constName(t.path[1])}: Int = ${ms(t.value)}`).join("\n")}
}

/** Кривые анимаций. */
public object TeleTauEasing {
${group("easing").map((t) => `${kdoc(t, "    ")}    public val ${t.path[1]}: Easing = CubicBezierEasing(${t.raw.map((v) => `${v}f`).join(", ")})`).join("\n")}
}
`;

// ---------- запись / проверка ----------
const platformTargets = [
  ["ios/Packages/TeleTauCore/Sources/DesignSystem/TeleTauTokens.generated.swift", swift],
  ["android/core/designsystem/src/main/kotlin/ru/teletau/core/designsystem/TeleTauTokens.generated.kt", kotlin],
];
const buildTargets = [
  ["packages/design-tokens/build/css/tokens.css", css],
  ["packages/design-tokens/build/json/tokens.json", json + "\n"],
];

// ---------- WOFF2 для веба ----------
// Каждый TTF из fonts/fonts.css получает рядом WOFF2 (вдвое меньше; scripts/woff2.mjs). Сверка — по содержимому таблиц,
// а не по байтам: сжатие Brotli может отличаться между версиями Node.js.
const fontsCss = readFileSync(resolve(pkg, "fonts/fonts.css"), "utf8");
const webFonts = [...new Set([...fontsCss.matchAll(/url\("\.\/([^"]+\.ttf)"\)/g)].map((m) => m[1]))];
const woff2Of = (ttf) => ttf.replace(/\.ttf$/, ".woff2");
const woff2Fresh = (ttf) => {
  const path = resolve(pkg, "fonts", woff2Of(ttf));
  return existsSync(path) && woff2MatchesTtf(readFileSync(path), readFileSync(resolve(pkg, "fonts", ttf)));
};

if (check) {
  let stale = 0;
  for (const [rel, content] of platformTargets) {
    const path = resolve(root, rel);
    if (!existsSync(path) || readFileSync(path, "utf8") !== content) {
      console.error(`УСТАРЕЛО: ${rel} — запустите pnpm --filter @teletau/design-tokens build`);
      stale++;
    }
  }
  for (const ttf of webFonts) {
    if (!woff2Fresh(ttf)) {
      console.error(`УСТАРЕЛО: packages/design-tokens/fonts/${woff2Of(ttf)} — запустите pnpm --filter @teletau/design-tokens build`);
      stale++;
    }
  }
  if (stale) process.exit(1);
  console.log("design-tokens: сгенерированные Swift/Kotlin и WOFF2 актуальны");
} else {
  for (const [rel, content] of [...buildTargets, ...platformTargets]) {
    const path = resolve(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.log(`записано: ${rel}`);
  }
  for (const ttf of webFonts) {
    if (woff2Fresh(ttf)) continue;
    writeFileSync(resolve(pkg, "fonts", woff2Of(ttf)), ttfToWoff2(readFileSync(resolve(pkg, "fonts", ttf))));
    console.log(`записано: packages/design-tokens/fonts/${woff2Of(ttf)}`);
  }
}
