// Иконки Phosphor (MIT, https://phosphoricons.com) → векторные ресурсы Android для :core:designsystem.
// Один набор, одна сетка и толщина на всех платформах (docs/05 §0, правило 3): веб берёт те же иконки из
// @phosphor-icons/react, здесь — те же контуры из того же пакета (viewport 256×256).
//
// Запуск из корня репозитория (нужен pnpm install): node android/scripts/phosphor-icons.mjs
// Результат — android/core/designsystem/src/main/kotlin/ru/teletau/core/designsystem/PhosphorIcons.generated.kt
// (в репозитории; не править руками).
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const pnpm = join(repo, "node_modules", ".pnpm");
const pkg = readdirSync(pnpm).find((d) => d.startsWith("@phosphor-icons+react@"));
if (!pkg) throw new Error("Нет @phosphor-icons/react в node_modules — выполните pnpm install");
const defs = join(pnpm, pkg, "node_modules", "@phosphor-icons", "react", "dist", "defs");
const out = join(repo, "android", "core", "designsystem", "src", "main", "kotlin", "ru", "teletau", "core", "designsystem", "PhosphorIcons.generated.kt");

/** [имя в Phosphor, вес] — только то, что рисуют экраны (как в вебе). */
const ICONS = [
  ["Fire", "fill"], ["Drop", "fill"], ["MapTrifold", "fill"], ["Check", "bold"], ["LockSimple", "fill"],
  ["Star", "fill"], ["ChatCircleText", "fill"], ["BookOpen", "fill"], ["Barbell", "fill"], ["Scales", "fill"],
  ["Trophy", "fill"], ["X", "bold"], ["Sparkle", "fill"], ["PencilSimple", "fill"], ["ArrowsClockwise", "bold"],
  ["Lightbulb", "bold"], ["Path", "fill"], ["ShieldStar", "fill"], ["UsersThree", "fill"], ["UserCircle", "fill"],
  ["ArrowUp", "bold"], ["ArrowDown", "bold"], ["SignOut", "bold"], ["Camera", "fill"], ["CameraSlash", "bold"],
  ["ImageSquare", "fill"], ["Keyboard", "fill"], ["QrCode", "bold"], ["Student", "fill"], ["ChalkboardTeacher", "fill"],
  ["GearSix", "fill"], ["ArrowLeft", "bold"], ["WifiHigh", "bold"], ["ArrowsLeftRight", "bold"], ["SpeakerHigh", "fill"], ["IdentificationCard", "fill"], ["DownloadSimple", "bold"], ["Target", "fill"], ["CaretLeft", "bold"], ["CaretRight", "bold"], ["CheckCircle", "fill"], ["SpeakerSlash", "fill"], ["Moon", "fill"],
  ["Footprints", "fill"], ["SealCheck", "fill"], ["Books", "fill"], ["MapPin", "fill"], ["FlagBanner", "fill"],
];

const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();


const camel = (name, weight) => name + weight[0].toUpperCase() + weight.slice(1);
const entries = [];
for (const [name, weight] of ICONS) {
  const src = readFileSync(join(defs, `${name}.es.js`), "utf8");
  const start = src.indexOf(`"${weight}"`);
  if (start < 0) throw new Error(`${name}: нет веса ${weight}`);
  const end = src.indexOf("\n  ]", start);
  const block = src.slice(start, end);
  const elements = [...block.matchAll(/createElement\(\s*"(\w+)",\s*\{([^}]*)\}/g)];
  const paths = elements.map(([, tag, attrs]) => {
    if (tag !== "path") throw new Error(`${name}/${weight}: элемент <${tag}> не поддержан — только path`);
    if (/opacity/.test(attrs)) throw new Error(`${name}/${weight}: полупрозрачные слои не поддержаны`);
    const d = /d:\s*"([^"]+)"/.exec(attrs)?.[1];
    if (!d) throw new Error(`${name}/${weight}: path без d`);
    return d;
  });
  if (!paths.length) throw new Error(`${name}/${weight}: контуров нет`);
  entries.push(`    /** ${name} (${weight}) */\n    public val ${camel(name, weight)}: ImageVector by lazy { icon("${name}", ${paths.map((d) => JSON.stringify(d)).join(", ")}) }`);
}
const kt = `// СГЕНЕРИРОВАНО android/scripts/phosphor-icons.mjs из @phosphor-icons/react (MIT, https://phosphoricons.com).
// Не редактировать: node android/scripts/phosphor-icons.mjs из корня репозитория.

package ru.teletau.core.designsystem

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/**
 * Иконки Phosphor — тот же набор и вес, что в вебе. Сетка 256×256, размер по умолчанию 24 dp. Цвет задаёт экран
 * (tint из токенов); заливка здесь — только маска.
 */
public object PhosphorIcons {
${entries.join("\n\n")}

    private fun icon(name: String, vararg paths: String): ImageVector =
        ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 256f, viewportHeight = 256f)
            .apply { paths.forEach { addPath(PathParser().parsePathString(it).toNodes(), fill = SolidColor(Color.Black)) } }
            .build()
}
`;
writeFileSync(out, kt);
console.log(`phosphor-icons: ${ICONS.length} иконок → ${out}`);
