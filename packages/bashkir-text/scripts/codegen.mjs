// Генерирует из единственного источника contracts/shared/bashkir-homoglyphs.json:
//   • таблицы нормализации и нижнего регистра для TS, Swift и Kotlin;
//   • табличный набор векторов contracts/test-vectors/bashkir-text/normalize-table.json.
// Запуск: node packages/bashkir-text/scripts/codegen.mjs [--check]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTableSuite } from "./vectors-table.mjs";
import { formatSuite } from "./format-vectors.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const source = "contracts/shared/bashkir-homoglyphs.json";
const spec = JSON.parse(readFileSync(resolve(root, source), "utf8"));
const check = process.argv.includes("--check");

const hex = (cp) => "0x" + (typeof cp === "number" ? cp.toString(16) : cp).toUpperCase().padStart(4, "0");
const header = (comment) =>
  `${comment} СГЕНЕРИРОВАНО из ${source} (версия ${spec.version}). Не редактировать вручную.\n` +
  `${comment} Перегенерация: pnpm codegen\n`;

const removeAlways = spec.removeCodePoints.filter((e) => !e.onlyNearLetters);
const removeNearLetters = spec.removeCodePoints.filter((e) => e.onlyNearLetters);

/**
 * Таблица нижнего регистра: простые соответствия «одна кодовая точка → одна» в диапазонах spec.lowercase.ranges.
 * Строится один раз при генерации и одинакова для всех платформ — результат не зависит от версии Unicode
 * среды выполнения. Если полное отображение даёт несколько кодовых точек, берётся simpleOverrides.
 */
function buildLowerTable() {
  const overrides = new Map(spec.lowercase.simpleOverrides.map((e) => [parseInt(e.from, 16), parseInt(e.to, 16)]));
  const table = [];
  for (const range of spec.lowercase.ranges) {
    for (let cp = parseInt(range.from, 16); cp <= parseInt(range.to, 16); cp++) {
      let lower;
      if (overrides.has(cp)) {
        lower = overrides.get(cp);
      } else {
        const full = [...String.fromCodePoint(cp).toLowerCase()];
        if (full.length !== 1) {
          throw new Error(`U+${cp.toString(16)}: нижний регистр из ${full.length} кодовых точек — добавьте simpleOverrides`);
        }
        lower = full[0].codePointAt(0);
      }
      if (lower !== cp) table.push([cp, lower]);
    }
  }
  return table;
}
const lowerTable = buildLowerTable();

function ts() {
  const pairs = (list) => list.map((e) => `  [${hex(e.from)}, ${hex(e.to)}], // ${e.why}`).join("\n");
  const lowerRows = [];
  for (let i = 0; i < lowerTable.length; i += 8) {
    lowerRows.push("  " + lowerTable.slice(i, i + 8).map(([a, b]) => `[${hex(a)}, ${hex(b)}]`).join(", ") + ",");
  }
  return `${header("//")}
export const CYRILLIC_FROM = ${hex(spec.cyrillicRange.from)};
export const CYRILLIC_TO = ${hex(spec.cyrillicRange.to)};

/** Удаляются всегда. */
export const REMOVE: ReadonlySet<number> = new Set([
${removeAlways.map((e) => `  ${hex(e.cp)}, // ${e.why}`).join("\n")}
]);

/** Удаляются, только если ближайший сосед (не из этого же набора) — буква или знак. */
export const REMOVE_NEAR_LETTERS: ReadonlySet<number> = new Set([
${removeNearLetters.map((e) => `  ${hex(e.cp)}, // ${e.why}`).join("\n")}
]);

export const WHITESPACE: ReadonlySet<number> = new Set([
  ${spec.whitespaceCodePoints.map(hex).join(", ")},
]);

export const SEQUENCES: ReadonlyArray<readonly [number, number, number]> = [
${spec.sequences.map((e) => `  [${hex(e.from[0])}, ${hex(e.from[1])}, ${hex(e.to)}], // ${e.why}`).join("\n")}
];

export const LETTER_MAP: ReadonlyMap<number, number> = new Map<number, number>([
${pairs(spec.letterMap)}
]);

export const FOLD_MAP: ReadonlyMap<number, number> = new Map<number, number>([
${pairs(spec.foldMap)}
]);

/** Нижний регистр: ${lowerTable.length} простых соответствий (латиница, греческий, кириллица). */
export const LOWER_MAP: ReadonlyMap<number, number> = new Map<number, number>([
${lowerRows.join("\n")}
]);
`;
}

function swift() {
  const dict = (list) => list.map((e) => `        ${hex(e.from)}: ${hex(e.to)}, // ${e.why}`).join("\n");
  const lowerRows = [];
  for (let i = 0; i < lowerTable.length; i += 6) {
    lowerRows.push("        " + lowerTable.slice(i, i + 6).map(([a, b]) => `${hex(a)}: ${hex(b)}`).join(", ") + ",");
  }
  return `${header("//")}
enum BashkirTable {
    static let cyrillicRange: ClosedRange<UInt32> = ${hex(spec.cyrillicRange.from)}...${hex(spec.cyrillicRange.to)}

    /// Удаляются всегда.
    static let remove: Set<UInt32> = [
${removeAlways.map((e) => `        ${hex(e.cp)}, // ${e.why}`).join("\n")}
    ]

    /// Удаляются, только если ближайший сосед (не из этого же набора) — буква или знак.
    static let removeNearLetters: Set<UInt32> = [
${removeNearLetters.map((e) => `        ${hex(e.cp)}, // ${e.why}`).join("\n")}
    ]

    static let whitespace: Set<UInt32> = [
        ${spec.whitespaceCodePoints.map(hex).join(", ")},
    ]

    static let sequences: [(first: UInt32, second: UInt32, replacement: UInt32)] = [
${spec.sequences.map((e) => `        (${hex(e.from[0])}, ${hex(e.from[1])}, ${hex(e.to)}), // ${e.why}`).join("\n")}
    ]

    static let letterMap: [UInt32: UInt32] = [
${dict(spec.letterMap)}
    ]

    static let foldMap: [UInt32: UInt32] = [
${dict(spec.foldMap)}
    ]

    /// Нижний регистр: ${lowerTable.length} простых соответствий (латиница, греческий, кириллица).
    static let lowerMap: [UInt32: UInt32] = [
${lowerRows.join("\n")}
    ]
}
`;
}

function kotlin() {
  const map = (list) => list.map((e) => `        ${hex(e.from)} to ${hex(e.to)}, // ${e.why}`).join("\n");
  // Таблица нижнего регистра — двумя параллельными массивами: огромный mapOf(...) упирается в лимит размера метода JVM.
  const keys = [];
  const values = [];
  for (let i = 0; i < lowerTable.length; i += 12) {
    keys.push("        " + lowerTable.slice(i, i + 12).map(([a]) => hex(a)).join(", ") + ",");
    values.push("        " + lowerTable.slice(i, i + 12).map(([, b]) => hex(b)).join(", ") + ",");
  }
  return `${header("//")}
package ru.teletau.core.bashkirtext

internal object BashkirTable {
    const val CYRILLIC_FROM: Int = ${hex(spec.cyrillicRange.from)}
    const val CYRILLIC_TO: Int = ${hex(spec.cyrillicRange.to)}

    /** Удаляются всегда. */
    val REMOVE: Set<Int> = setOf(
${removeAlways.map((e) => `        ${hex(e.cp)}, // ${e.why}`).join("\n")}
    )

    /** Удаляются, только если ближайший сосед (не из этого же набора) — буква или знак. */
    val REMOVE_NEAR_LETTERS: Set<Int> = setOf(
${removeNearLetters.map((e) => `        ${hex(e.cp)}, // ${e.why}`).join("\n")}
    )

    val WHITESPACE: Set<Int> = setOf(
        ${spec.whitespaceCodePoints.map(hex).join(", ")},
    )

    val SEQUENCES: List<Triple<Int, Int, Int>> = listOf(
${spec.sequences.map((e) => `        Triple(${hex(e.from[0])}, ${hex(e.from[1])}, ${hex(e.to)}), // ${e.why}`).join("\n")}
    )

    val LETTER_MAP: Map<Int, Int> = mapOf(
${map(spec.letterMap)}
    )

    val FOLD_MAP: Map<Int, Int> = mapOf(
${map(spec.foldMap)}
    )

    private val LOWER_KEYS: IntArray = intArrayOf(
${keys.join("\n")}
    )

    private val LOWER_VALUES: IntArray = intArrayOf(
${values.join("\n")}
    )

    /** Нижний регистр: ${lowerTable.length} простых соответствий (латиница, греческий, кириллица). */
    val LOWER_MAP: Map<Int, Int> = HashMap<Int, Int>(LOWER_KEYS.size * 2).apply {
        for (i in LOWER_KEYS.indices) put(LOWER_KEYS[i], LOWER_VALUES[i])
    }
}
`;
}

const targets = [
  ["packages/bashkir-text/src/table.generated.ts", ts()],
  ["ios/Packages/TeleTauCore/Sources/BashkirText/BashkirTable.generated.swift", swift()],
  ["android/core/bashkirtext/src/main/kotlin/ru/teletau/core/bashkirtext/BashkirTable.generated.kt", kotlin()],
  ["contracts/test-vectors/bashkir-text/normalize-table.json", formatSuite(buildTableSuite(spec, source))],
];

let stale = 0;
for (const [rel, content] of targets) {
  const path = resolve(root, rel);
  if (check) {
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current !== content) {
      console.error(`УСТАРЕЛО: ${rel} — запустите pnpm codegen`);
      stale++;
    }
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.log(`записано: ${rel}`);
  }
}
if (check) {
  if (stale) process.exit(1);
  console.log("bashkir-text: сгенерированные таблицы и табличные векторы актуальны");
}
