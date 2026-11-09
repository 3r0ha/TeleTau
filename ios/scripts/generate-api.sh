#!/usr/bin/env bash
# Генерирует Swift-клиент API из контракта packages/contracts/openapi.yaml через swift-openapi-generator
# (CLAUDE.md, правило 1: клиенты только генерируются). Результат — ios/Packages/TeleTauCore/Sources/TeleTauAPI/Generated/.
#
#   bash ios/scripts/generate-api.sh          # перегенерировать
#   bash ios/scripts/generate-api.sh --check  # убедиться, что сгенерированное совпадает с контрактом (CI)
#
# Первый запуск собирает генератор (~1,5 мин, зависимости SPM качаются из GitHub), дальше — секунды.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SPEC="$ROOT/packages/contracts/openapi.yaml"
CONFIG="$ROOT/ios/Packages/TeleTauCore/openapi-generator-config.yaml"
OUT="$ROOT/ios/Packages/TeleTauCore/Sources/TeleTauAPI/Generated"
TOOLS="$ROOT/ios/Tools/APIGen"

TARGET="$OUT"
if [[ "${1:-}" == "--check" ]]; then
  TARGET="$(mktemp -d)"
  trap 'rm -rf "$TARGET"' EXIT
fi

swift build -c release --package-path "$TOOLS" --product swift-openapi-generator >/dev/null
GEN="$(swift build -c release --package-path "$TOOLS" --show-bin-path)/swift-openapi-generator"

mkdir -p "$TARGET"
rm -f "$TARGET"/*.swift
"$GEN" generate "$SPEC" --config "$CONFIG" --output-directory "$TARGET" >/dev/null 2>"$TARGET/.log" || { cat "$TARGET/.log" >&2; exit 1; }
rm -f "$TARGET/.log"

if [[ "${1:-}" == "--check" ]]; then
  if ! diff -r -q "$OUT" "$TARGET" >/dev/null; then
    echo "Swift-клиент устарел относительно packages/contracts/openapi.yaml. Запустите: bash ios/scripts/generate-api.sh" >&2
    diff -r -q "$OUT" "$TARGET" >&2 || true
    exit 1
  fi
  echo "Swift-клиент актуален."
else
  echo "Сгенерировано: $(ls "$OUT" | wc -l | tr -d ' ') файлов в ${OUT#"$ROOT/"}"
fi
