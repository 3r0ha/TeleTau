#!/usr/bin/env bash
# Локальная проверка = то же, что CI (.github/workflows/ci.yml). Используется для самопроверки.
# Флаги: --skip-mobile (без iOS/Android), --skip-integration (без Docker: ни интеграционных, ни сквозных тестов),
# --skip-e2e (без сквозных тестов Playwright против настоящего стека — для быстрого прогона).
set -euo pipefail
cd "$(dirname "$0")/.."
export NEXT_TELEMETRY_DISABLED=1

SKIP_MOBILE=0
SKIP_INTEGRATION=0
SKIP_E2E=0
for arg in "$@"; do
  case "$arg" in
    --skip-mobile) SKIP_MOBILE=1 ;;
    --skip-integration) SKIP_INTEGRATION=1 ;;
    --skip-e2e) SKIP_E2E=1 ;;
    *) echo "Неизвестный флаг: $arg" >&2; exit 2 ;;
  esac
done

FAILED=()
SKIPPED=()

# CI берёт Node из .nvmrc. Проверка под другой мажорной версией не равна CI — предупреждаем громко.
WANT_NODE="$(tr -d " \n\r" < .nvmrc)"
HAVE_NODE="$(node -p "process.versions.node.split(\".\")[0]")"
if [[ "$HAVE_NODE" != "$WANT_NODE" ]]; then
  echo "⚠️  ВНИМАНИЕ: локально Node $HAVE_NODE, а целевая версия проекта (.nvmrc, CI) — $WANT_NODE."
  echo "    Результат может отличаться от CI. Прогоните также под целевой версией, например:"
  echo "    PATH=/opt/homebrew/opt/node@$WANT_NODE/bin:\$PATH bash scripts/verify.sh"
  SKIPPED+=("совпадение с CI по версии Node: локально $HAVE_NODE, целевая $WANT_NODE")
else
  echo "Node $HAVE_NODE — совпадает с .nvmrc"
fi
step() {
  local name="$1"; shift
  echo; echo "━━━ $name"
  if "$@"; then echo "✔ $name"; else echo "✘ $name"; FAILED+=("$name"); fi
}

step "Зависимости (frozen lockfile)" pnpm install --frozen-lockfile
step "Кодогенерация актуальна (bashkir-text, design-tokens)" pnpm codegen:check
step "Фазз-векторы bashkir-text актуальны" pnpm --filter @teletau/bashkir-text vectors:fuzz:check
step "Линт + границы модулей + запрет хардкода токенов (цвета, длительности, радиусы)" pnpm lint
step "Типы" pnpm typecheck
step "Тесты TS (векторы bashkir-text, контраст токенов, приложения, скрипты)" pnpm test
if command -v gitleaks >/dev/null 2>&1; then
  step "Поиск секретов (gitleaks)" gitleaks dir . --no-banner --redact
else
  SKIPPED+=("поиск секретов (gitleaks не установлен: brew install gitleaks)")
fi
step "Контракт OpenAPI (линт, актуальность типов, ломающие изменения)" pnpm contracts:check
step "Сборка TS-приложений" pnpm build
# Playwright на сетевых моках по контракту (нужна сборка выше). Браузер — из кеша Playwright, ничего не скачивается.
step "Веб: доступность (axe) и потоки экранов, моки API" pnpm --filter @teletau/web test:a11y
step "Консоль: доступность (axe) и потоки экранов, моки API" pnpm --filter @teletau/console test:a11y

if [[ $SKIP_INTEGRATION -eq 0 ]] && docker info >/dev/null 2>&1; then
  step "Docker: Postgres, Valkey, ClickHouse, S3" docker compose up -d --wait
  # Та же команда, что у разработчика, — drizzle.config.ts читает корневой .env. Миграции dev-базы нужны
  # pnpm dev; интеграционные и сквозные тесты работают в своих базах и сами применяют миграции.
  step "Миграции" pnpm db:migrate
  # Герметично — своя база <имя>_it и своя база Valkey на серверах из .env; global-setup пересоздаёт их
  # и применяет миграции перед прогоном, dev-база не меняется.
  step "Интеграционные тесты API" pnpm --filter @teletau/api test:integration
  if [[ $SKIP_E2E -eq 0 ]]; then
    # Сценарии демо (docs/demo) в браузере против настоящего стека: своя база <имя>_e2e с демо-миром (e2e/run.mjs),
    # api, web и console — на портах из .env.
    step "Сквозные тесты (Playwright, настоящий стек)" pnpm e2e
  else
    SKIPPED+=("сквозные тесты (--skip-e2e)")
  fi
else
  SKIPPED+=("интеграционные и сквозные тесты (нет Docker или --skip-integration)")
fi

if [[ $SKIP_MOBILE -eq 0 ]]; then
  if command -v swift >/dev/null 2>&1; then
    step "iOS: swift test (векторы + рендер стартового экрана)" swift test --package-path ios/Packages/TeleTauCore
  else
    SKIPPED+=("iOS swift test (нет Swift)")
  fi
  if command -v xcodegen >/dev/null 2>&1 && command -v xcodebuild >/dev/null 2>&1; then
    step "iOS: сборка приложения под SDK симулятора" bash -c 'cd ios && xcodegen generate --quiet && xcodebuild build -quiet -project TeleTau.xcodeproj -target TeleTau -sdk iphonesimulator -configuration Debug ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO SYMROOT="$PWD/.build/xcode" OBJROOT="$PWD/.build/xcode/obj"'
  else
    SKIPPED+=("iOS сборка (нет xcodegen/xcodebuild)")
  fi
  if [[ -x android/gradlew ]]; then
    step "Android: векторы + сборка + снапшоты экранов" bash -c 'cd android && ./gradlew --quiet :core:bashkirtext:test :app:assembleDebug :core:designsystem:verifyRoborazziDebug'
  else
    SKIPPED+=("Android (нет android/gradlew)")
  fi
else
  SKIPPED+=("мобильные платформы (--skip-mobile)")
fi

echo; echo "━━━ Итог"
for s in "${SKIPPED[@]+"${SKIPPED[@]}"}"; do echo "⏭  пропущено: $s"; done
if [[ ${#FAILED[@]} -gt 0 ]]; then
  for f in "${FAILED[@]}"; do echo "✘ $f"; done
  exit 1
fi
echo "✔ Все проверки пройдены"
