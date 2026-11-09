#!/usr/bin/env node
// Иконки Phosphor (MIT) для iOS — тот же набор и те же начертания, что у веба (docs/05 §0, правило 3 против
// «нейрослопа»: один набор, одна сетка). Берёт контуры из установленного @phosphor-icons/react и пишет
// ios/Packages/TeleTauCore/Sources/DesignSystem/PhosphorIcons.generated.swift (сетка 256×256, контуры SVG `d`).
//
//   node ios/scripts/import-icons.mjs          # перегенерировать
//   node ios/scripts/import-icons.mjs --check  # проверить актуальность
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, "ios/Packages/TeleTauCore/Sources/DesignSystem/PhosphorIcons.generated.swift");

/** [имя в Swift, файл Phosphor, начертание] — как в вебе (apps/web/app, packages/ui). */
const ICONS = [
  ["fire", "Fire", "fill"],
  ["drop", "Drop", "fill"],
  ["path", "Path", "fill"],
  ["shieldStar", "ShieldStar", "fill"],
  ["usersThree", "UsersThree", "fill"],
  ["userCircle", "UserCircle", "fill"],
  ["star", "Star", "fill"],
  ["chatCircleText", "ChatCircleText", "fill"],
  ["bookOpen", "BookOpen", "fill"],
  ["bookOpenText", "BookOpenText", "fill"],
  ["speakerHigh", "SpeakerHigh", "fill"],
  ["speakerSlash", "SpeakerSlash", "fill"],
  ["moon", "Moon", "fill"],
  ["caretLeft", "CaretLeft", "bold"],
  ["caretRight", "CaretRight", "bold"],
  ["identificationCard", "IdentificationCard", "fill"],
  ["downloadSimple", "DownloadSimple", "bold"],
  ["envelopeSimple", "EnvelopeSimple", "fill"],
  ["target", "Target", "fill"],
  ["barbell", "Barbell", "fill"],
  ["scales", "Scales", "fill"],
  ["check", "Check", "bold"],
  ["checkCircle", "CheckCircle", "fill"],
  ["lockSimple", "LockSimple", "fill"],
  ["mapTrifold", "MapTrifold", "fill"],
  ["trophy", "Trophy", "fill"],
  ["x", "X", "bold"],
  ["sparkle", "Sparkle", "fill"],
  ["arrowsClockwise", "ArrowsClockwise", "bold"],
  ["arrowsLeftRight", "ArrowsLeftRight", "bold"],
  ["pencilSimple", "PencilSimple", "fill"],
  ["lightbulb", "Lightbulb", "bold"],
  ["camera", "Camera", "fill"],
  ["cameraSlash", "CameraSlash", "bold"],
  ["imageSquare", "ImageSquare", "fill"],
  ["keyboard", "Keyboard", "fill"],
  ["qrCode", "QrCode", "bold"],
  ["signOut", "SignOut", "bold"],
  ["student", "Student", "fill"],
  ["chalkboardTeacher", "ChalkboardTeacher", "fill"],
  ["arrowLeft", "ArrowLeft", "bold"],
  ["arrowUp", "ArrowUp", "bold"],
  ["arrowDown", "ArrowDown", "bold"],
  ["info", "Info", "fill"],
  ["warningCircle", "WarningCircle", "fill"],
  ["gearSix", "GearSix", "fill"],
  ["wifiSlash", "WifiSlash", "bold"],
  // Значки наград (AchievementIcon контракта).
  ["footprints", "Footprints", "fill"],
  ["sealCheck", "SealCheck", "fill"],
  ["books", "Books", "fill"],
  ["mapPin", "MapPin", "fill"],
  ["flagBanner", "FlagBanner", "fill"],
];

function phosphorDefs() {
  const pnpm = join(root, "node_modules/.pnpm");
  const dir = readdirSync(pnpm).find((d) => d.startsWith("@phosphor-icons+react@"));
  if (!dir) throw new Error("Не найден @phosphor-icons/react в node_modules (pnpm install)");
  const defs = join(pnpm, dir, "node_modules/@phosphor-icons/react/dist/defs");
  const version = JSON.parse(readFileSync(join(pnpm, dir, "node_modules/@phosphor-icons/react/package.json"), "utf8")).version;
  return { defs, version };
}

/** Контуры начертания: все `d` элементов `path` внутри записи `["fill", …]` файла определения. */
function paths(defs, file, weight) {
  const src = readFileSync(join(defs, `${file}.es.js`), "utf8");
  const start = src.indexOf(`"${weight}",`);
  if (start < 0) throw new Error(`${file}: нет начертания ${weight}`);
  const rest = src.slice(start + weight.length + 3);
  const end = rest.search(/\n  \],?\n  \[|\n\]\);/);
  const block = end >= 0 ? rest.slice(0, end) : rest;
  if (/createElement\("(circle|rect|line|polyline|polygon|ellipse)"/.test(block)) {
    throw new Error(`${file} ${weight}: есть элементы кроме path — добавьте их разбор`);
  }
  const ds = [...block.matchAll(/d: "([^"]+)"/g)].map((m) => m[1]);
  if (!ds.length) throw new Error(`${file} ${weight}: контуры не найдены`);
  return ds;
}

const { defs, version } = phosphorDefs();
const lines = [
  "// СГЕНЕРИРОВАНО ios/scripts/import-icons.mjs из @phosphor-icons/react " + version + " (MIT). Не редактировать вручную.",
  "// Перегенерация: node ios/scripts/import-icons.mjs",
  "",
  "/// Иконки Phosphor: контуры SVG в сетке 256×256 (`TeleTauIcon` рисует их как `Shape`).",
  "public enum TeleTauIcon: String, CaseIterable, Sendable {",
  ...ICONS.map(([name, file, weight]) => `    /// ${file} (${weight})\n    case ${name}`),
  "",
  "    /// Контуры SVG `d`.",
  "    var svgPaths: [String] {",
  "        switch self {",
];
for (const [name, file, weight] of ICONS) {
  lines.push(`        case .${name}:`, `            [${paths(defs, file, weight).map((d) => JSON.stringify(d)).join(", ")}]`);
}
lines.push("        }", "    }", "}", "");
const text = lines.join("\n");

if (process.argv.includes("--check")) {
  if (!existsSync(out) || readFileSync(out, "utf8") !== text) {
    console.error("PhosphorIcons.generated.swift устарел: node ios/scripts/import-icons.mjs");
    process.exit(1);
  }
  console.log("Иконки актуальны.");
} else {
  writeFileSync(out, text);
  console.log(`Записано ${ICONS.length} иконок в ${out.slice(root.length + 1)}`);
}
