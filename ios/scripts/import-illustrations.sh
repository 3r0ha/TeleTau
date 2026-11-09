#!/usr/bin/env bash
# Иллюстрации для iOS: design/assets/approved/*.webp → PNG (ImageMagick) в ресурсы пакета DesignSystem
# (ios/Packages/TeleTauCore/Sources/DesignSystem/Resources/Illustrations), перечисление Illustration для Swift и
# значки приложения ios/TeleTau/AppIcon/*.png. Не Asset Catalog: actool без рантайма симулятора не собирает каталоги
# под iphonesimulator (ошибка «No available simulator runtimes»), поэтому PNG лежат папкой и читаются IllustrationStore.
# Размер ограничен по роли картинки: ≈ @3x самого крупного показа на экране — ресурсы не раздуваются, на iPhone чётко.
#
#   bash ios/scripts/import-illustrations.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT/design/assets/approved"
CAT="$ROOT/ios/Packages/TeleTauCore/Sources/DesignSystem/Resources/Illustrations"

command -v magick >/dev/null || { echo "Нужен ImageMagick (magick)" >&2; exit 1; }

# Наибольшая сторона в пикселях по префиксу имени (показ в pt × 3).
max_side() {
  case "$1" in
    avatar-*) echo 300 ;;          # аватар ника до 96 pt
    badge-*) echo 360 ;;           # значок лиги до 104 pt
    item-*) echo 240 ;;            # заморозка серии 26 pt (с запасом на крупный шрифт)
    app-icon-alt) echo 300 ;;      # запасной аватар
    bee-*) echo 720 ;;             # пчела до 236 pt
    deco-*) echo 600 ;;            # декорации тропы до 188 pt
    empty-* | scene-*) echo 800 ;; # сцены после урока и пустые состояния до 260 pt
    place-* | hero-*) echo 1100 ;; # вывески мест и герои на всю ширину колонки
    *) echo 800 ;;
  esac
}

rm -rf "$CAT" "${CAT}.xcassets"
mkdir -p "$CAT"

count=0
for file in "$SRC"/*.webp; do
  name="$(basename "$file" .webp)"
  case "$name" in
    tg-bot-cover | app-icon) continue ;; # обложка бота и значок — не экранные картинки
  esac
  side="$(max_side "$name")"
  magick "$file" -strip -resize "${side}x${side}>" -define png:compression-level=9 -define png:compression-filter=5 "$CAT/$name.png"
  count=$((count + 1))
done

# Значок приложения — файлами (CFBundleIcons в project.yml), а не каталогом: без рантайма симулятора actool
# не собирает каталоги под iphonesimulator.
ICONS="$ROOT/ios/TeleTau/AppIcon"
rm -rf "$ICONS" "$ROOT/ios/TeleTau/Assets.xcassets"
mkdir -p "$ICONS"
for spec in "AppIcon60x60@2x.png:120" "AppIcon60x60@3x.png:180" "AppIcon76x76~ipad.png:76" "AppIcon76x76@2x~ipad.png:152" "AppIcon83.5x83.5@2x~ipad.png:167"; do
  magick "$SRC/app-icon-1024.png" -strip -resize "${spec##*:}x${spec##*:}" -background "#FFB703" -alpha remove -alpha off "$ICONS/${spec%%:*}"
done

# Перечисление картинок для Swift: имя набора `bee-idle` → `case beeIdle = "bee-idle"`.
SWIFT="$ROOT/ios/Packages/TeleTauCore/Sources/DesignSystem/Illustration.generated.swift"
{
  echo "// СГЕНЕРИРОВАНО ios/scripts/import-illustrations.sh из design/assets/approved. Не редактировать вручную."
  echo ""
  echo "/// Иллюстрации единой серии (docs/15-art-brief.md §0): PNG в Resources/Illustrations пакета DesignSystem."
  echo "public enum Illustration: String, CaseIterable, Sendable {"
  for png in "$CAT"/*.png; do
    name="$(basename "$png" .png)"
    case_name="$(printf '%s' "$name" | perl -pe 's/-(\w)/\u$1/g')"
    echo "    case $case_name = \"$name\""
  done
  echo "}"
} > "$SWIFT"

echo "Иллюстраций: $count, каталог: $(du -sh "$CAT" | cut -f1)"
