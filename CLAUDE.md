# CLAUDE.md — «ТелеТау — Башкирская языковая школа»

Геймифицированная платформа изучения башкирского языка с краудсорсингом подтверждённых переводов рус↔баш. Заказчик — Министерство просвещения Республики Башкортостан; потребитель базы переводов — Фонд башкирского языка. Каналы: веб, нативные iOS (Swift/SwiftUI) и Android (Kotlin/Compose), Telegram-бот и Telegram Mini App. AI — GigaChat.

## Где что лежит
- `docs/00-vision.md` … `docs/14-owner-tasks.md` — продукт, методика, консенсус, AI, дизайн, архитектура, данные/API, безопасность, роадмап, цикл жюри, рынок, финансы, риски, задачи владельца.
- `docs/research/` — исследования с источниками (факты — оттуда, не из памяти).
- `docs/STATUS.md` — **текущая веха и состояние гейтов. Читай первым.**
- `docs/adr/` — архитектурные решения. Отклонение от архитектуры = новый ADR.
- `docs/demo/M<n>.md` — сценарий демо вехи (что повторяет человек или жюри); автоматическая версия — `e2e/`.
- `apps/api/data/` — справочник районов и школ РБ (CSV, методика — `rb-directory.README.md`); `README.md` там — демо-школы и демо-сотрудники консоли (e-mail, секреты TOTP).
- `packages/auth-codes` — формат QR-карточки и кода класса (ADR 0016); векторы — `contracts/test-vectors/{qr-card,class-code}/`.
- `packages/ui` — компоненты веба и консоли на токенах; `packages/session` — клиент сессии и BFF (refresh в httpOnly-cookie, CSP, IP клиента). Код, общий для веба и консоли, кладётся только сюда, без путей tsconfig к чужим приложениям (M1-10).
- `e2e/` — сквозные тесты Playwright против настоящего стека; `apps/web/test/e2e`, `apps/console/test/e2e` — экраны на моках API.
- `.claude/agents/jury-*.md` — агенты-жюри; `.claude/skills/milestone`, `.claude/skills/jury` — цикл разработки.

## Как работаем
Цикл вехи: план → разработка → самопроверка → **гейт жюри** → доработка → … (`docs/10-jury-loop.md`). Запуск: `/milestone` (весь цикл) или `/jury Mx` (только проверка).

## Непреложные правила
1. **Contract-first.** Любое изменение API начинается с `packages/contracts/openapi.yaml`; клиенты TS/Swift/Kotlin только генерируются. Ручные DTO, дублирующие контракт, запрещены.
2. **Общие тест-векторы.** Логика, которая есть на нескольких платформах (`bashkir-text`, `srs`, `ornament`, `xp`, `consensus`), сначала описывается векторами в `contracts/test-vectors/`, затем реализуется; все реализации проходят одни векторы.
3. **Нативные клиенты.** iOS — Swift/SwiftUI, Android — Kotlin/Compose. Никаких Flutter, React Native, KMP-UI, WebView вместо экранов (кроме Telegram Mini App, которое — веб по определению).
4. **Границы модулей API.** Модуль не читает чужие таблицы; только публичный сервис модуля или доменные события. Таблицы модуля — в `src/modules/<m>/<m>.schema.ts`, их не реэкспортируют из `index.ts`; `src/{infra,common,db,config}` не зависят от модулей (ADR 0014). Проверяется `apps/api/scripts/boundaries.mjs` в `pnpm lint`.
5. **ПДн детей.** Не собираем ФИО, телефон, e-mail, фото, геолокацию детей. ПДн взрослых — только в схеме `pii`. Никаких ПДн в логах, аналитике, трейсах, отчётах об ошибках и промптах GigaChat.
6. **Башкирский текст.** Никогда не показывать ученику башкирский текст от LLM/MT без пометки «машинный, не проверен». Любой новый башкирский текст в интерфейсе или контенте — с флагом `needs_native_review` и строкой в `docs/native-review-queue.md`. Не выдумывать башкирские слова «по аналогии с татарским».
7. **Юникод.** Башкирские буквы — только правильные кодовые точки (ә U+04D9, ө U+04E9, ү U+04AF, ғ U+0493, ҡ U+04A1, ң U+04A3, ҙ U+0499, ҫ U+04AB, һ U+04BB). Нормализация и сравнение — только через пакет `bashkir-text` и его порты.
8. **Дизайн-токены.** Цвета, отступы, радиусы, шрифты, длительности анимаций — только из `packages/design-tokens`. Хардкод запрещён линтером.
9. **Голоса неизменяемы.** Таблица `judgments` — только вставка; состояние корпуса пересчитываемо из журнала.
10. **AI через шлюз.** Вызовы GigaChat только через `apps/ai-gateway` (бюджеты, кеш, удаление ПДн, реестр промптов). Промпты — файлы в репозитории с версией и golden-набором для оценки.
11. **Не коммитить и не пушить** без явной просьбы пользователя.
12. **Без зарубежных SaaS-SDK в клиентах.** Никаких Firebase Analytics/Crashlytics, Google Analytics и т. п.: аналитика и ошибки уходят в собственный контур (ADR 0012). Пуши на Android — через RuStore Universal Push SDK.
13. **Никаких персональных данных** в push-уведомлениях и сообщениях Telegram-бота. Бот хранит только `chat_id`.
14. **FSRS-6 на всех платформах:** версия алгоритма и параметры зафиксированы, сервер — источник истины.
15. **Никакого Python** (решение владельца): весь серверный код, скрипты и ML-расчёты — на TypeScript; модели (эмбеддинги, речь) — через ONNX Runtime для Node или готовые серверы инференса, без собственного Python-кода.
16. **Юридические вопросы вне скоупа** (хакатон, решение владельца): не тратить на них время и не менять из-за них продукт.

## Соглашения
- Код, идентификаторы, коммиты — на английском. Документация, тексты интерфейса — на русском и башкирском.
- Коммиты — Conventional Commits (`feat(api): …`, `fix(ios): …`).
- TypeScript strict; Swift 6 strict concurrency; Kotlin — explicit API в core-модулях.
- Ошибки API — RFC 9457 (Problem Details). Время — UTC в хранении, Уфа (Asia/Yekaterinburg, UTC+5) для учебных суток.

## Команды

Окружение: Node 24 LTS (локально допустим 25), pnpm 9, Docker. Порты хоста — нестандартные, чтобы не конфликтовать с другими проектами (Postgres 15432, Valkey 16379, ClickHouse 18123, S3 18333; api 4000, web 3000, console 3100, ai-gateway 4100, ml-worker 4200).

| Задача | Команда |
|---|---|
| **Всё локально одной командой** | `pnpm dev` (создаёт `.env` из `.env.example` и добирает из него новые переменные, поднимает Docker, применяет миграции, загружает справочник, запускает все приложения) |
| **Полная самопроверка (= CI)** | `bash scripts/verify.sh` (флаги `--skip-mobile`, `--skip-integration` — без Docker, `--skip-e2e` — без сквозных тестов). CI работает на Node из `.nvmrc` (24): при другой локальной версии скрипт громко предупреждает — прогоняйте и под целевой: `PATH=/opt/homebrew/opt/node@24/bin:$PATH bash scripts/verify.sh` |
| Линт + границы модулей + запрет хардкода токенов (цвета — `scripts/check-hardcoded-colors.mjs`, длительности и радиусы — `scripts/check-hardcoded-tokens.mjs`) | `pnpm lint` |
| Типы | `pnpm typecheck` |
| Тесты TS | `pnpm test` (включая тесты скриптов: `node --test 'scripts/test/*.test.mjs'` — только glob: форма с каталогом не работает на Node 24) |
| Тест-векторы TS (`bashkir-text`, `auth-codes`) | `pnpm vectors` |
| Фазз-векторы (сгенерировать / проверить актуальность) | `pnpm --filter @teletau/bashkir-text vectors:fuzz` / `pnpm --filter @teletau/bashkir-text vectors:fuzz:check` |
| Кодогенерация (таблицы bashkir-text, токены) / проверка актуальности | `pnpm codegen` / `pnpm codegen:check` |
| Контракт (линт, актуальность типов, ломающие изменения) | `pnpm contracts:check`; после правки `openapi.yaml` — `pnpm --filter @teletau/contracts generate` |
| Контраст токенов | `pnpm tokens:check` |
| Миграции | `pnpm db:migrate` (новая: `pnpm --filter @teletau/api db:generate` — нужна хотя бы одна `src/modules/<m>/<m>.schema.ts`, первые появятся в M1). Обе читают корневой `.env` |
| Интеграционные тесты API (нужен Docker; своя база `<имя>_it` и база Valkey `/1` на серверах из корневого `.env` — пересоздаются и мигрируются перед каждым прогоном, dev-база не меняется; `apps/api/test/README.md`) | `pnpm --filter @teletau/api test:integration` |
| Справочник районов и школ РБ + демо-школы (идемпотентно; `pnpm dev` и `pnpm e2e` делают сами) | `pnpm --filter @teletau/api org:import` |
| Курс из `content/course` (идемпотентно по версии; та же `version` с другим содержимым — ошибка, поднимите `version` в `course.yaml`; `pnpm dev` и `pnpm e2e` делают сами) | `pnpm --filter @teletau/api content:import` |
| Дуэли «Помоги языку» из `content/corpus/duels` (идемпотентно; варианты загруженной дуэли не меняются, ADR 0019) | `pnpm --filter @teletau/api corpus:import` |
| **Демо-мир показа M2 с нуля** (`docs/demo/M2.md`): пересоздаёт dev-базу из `.env` и чистит Valkey → миграции → справочник → курс → дуэли → `demo:seed`. Голоса удалить нельзя (правило 9), поэтому только так. При запущенном `pnpm dev` отказывается — остановите его. Затем `pnpm dev` | `pnpm demo:reset` |
| Демо-сид (`apps/api/src/demo`): учитель `teacher@demo.teletau.local` (код 0000), 5 «Б», ученик №07 · «Смелая пчела»; карточка и `world.json` — в `.demo/`. Только на чистой базе и при `AUTH_DEMO_STAFF=1` — обычно его вызывает `demo:reset` | `pnpm demo:seed` |
| Экраны веба и консоли на моках API: axe, клавиатура, потоки (нужна сборка `pnpm build`) | `pnpm --filter @teletau/web test:a11y`, `pnpm --filter @teletau/console test:a11y`; снимки экранов — `TELETAU_SCREENS=1 pnpm --filter @teletau/web test:a11y -- screens` |
| **Сквозные тесты** против настоящего стека (Docker, сборка; своя база `<имя>_e2e` и Valkey №2 пересоздаются с демо-миром на каждый прогон — dev-база не меняется; api, web и console — на портах из `.env`, после прогона останавливаются; порты должны быть свободны — без `pnpm dev`) | `pnpm e2e` (повтор: `pnpm e2e --repeat-each=3`, не больше 3 — по числу миров сида) |
| iOS: векторы + рендер экрана | `swift test --package-path ios/Packages/TeleTauCore` |
| iOS: перезапись эталонных снимков экрана | `TELETAU_RECORD_SNAPSHOTS=1 swift test --package-path ios/Packages/TeleTauCore` (только осознанно, после ревью картинки) |
| iOS: сборка (без рантайма симулятора; общие SYMROOT/OBJROOT нужны SPM-пакетам клиента API) | `cd ios && xcodegen generate && xcodebuild build -project TeleTau.xcodeproj -target TeleTau -sdk iphonesimulator -configuration Debug ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO SYMROOT="$PWD/.build/xcode" OBJROOT="$PWD/.build/xcode/obj"` |
| iOS: клиент API из контракта (после правки `openapi.yaml`) / проверка актуальности | `bash ios/scripts/generate-api.sh` / `bash ios/scripts/generate-api.sh --check` |
| Android: векторы + сборка | `cd android && ./gradlew :core:bashkirtext:test :app:assembleDebug` |
| Android: снапшоты экранов (Roborazzi) | `cd android && ./gradlew :core:designsystem:verifyRoborazziDebug` (перезапись эталонов — `recordRoborazziDebug`) |
| Форматирование тест-векторов | `node packages/bashkir-text/scripts/format-vectors.mjs` |
| Telegram-бот (long polling; нужен `TELEGRAM_BOT_TOKEN` в `.env`, Mini App — `TELEGRAM_MINIAPP_URL` с https) | `pnpm --filter @teletau/bot dev` (запускается и в `pnpm dev`); тесты — `pnpm --filter @teletau/bot test` |
| ML-воркер | `pnpm --filter @teletau/ml-worker test` |
| Симулятор консенсуса | `pnpm --filter @teletau/ml-worker sim` (с M4) |

Важно: Turbo работает в строгом режиме окружения — новую переменную окружения добавляй в `globalPassThroughEnv` в `turbo.json`, иначе приложение её не увидит. Переменные, которые вшиваются в сборку (`NEXT_PUBLIC_*`), — в `globalEnv`: они входят в хеш кеша.

Переменные M1 (описаны в `.env.example`): `AUTH_DEMO_OTP` (демо-код входа взрослых, `0000`), `BFF_TRUST_PROXY` (каким прокси перед Next доверять при определении IP ученика; в e2e — `loopback`), `AUTH_DEMO_STAFF` (демо-сотрудники консоли с TOTP из `apps/api/data/README.md`, в dev `1`, в проде запрещено), `AUTH_JWT_PRIVATE_KEY`, `AUTH_SECRET_PEPPER`, `AUTH_ENCRYPTION_KEY` (в dev можно пустыми), `PUBLIC_WEB_URL` и `PUBLIC_CONSOLE_URL` (адрес сайта на QR-карточке — текстом, в QR только полезная нагрузка; CORS, адреса документов), `NEXT_PUBLIC_API_URL`, `TRUST_PROXY` (в dev `loopback`: лимиты по IP считаются по IP браузера за BFF Next.js).

Переменные M2: `AUTH_DEMO_CLASS_CODE` (постоянный код класса стенда показа, `000000` → на доске «000-000»: «Показать код класса» выдаёт его классу на год и снимает с прежнего, «Закрыть код класса» его не гасит; заявки учитель одобряет как обычно; пусто — обычные коды на 15 минут; в production запрещён, `pnpm e2e` и интеграционные тесты его не используют).
