# Android — «ТелеТау»

Нативное приложение на Kotlin + Jetpack Compose (ADR 0003, `docs/06-architecture.md` §8).

## Требования

- JDK для запуска `./gradlew` — любой ≥ 17 (локально подходит и JDK 27). Демон Gradle и компиляция
  работают на **JDK 21**: критерии демона — `gradle/gradle-daemon-jvm.properties`, toolchain — в
  `build-logic`. Если JDK 21 не найден, Gradle скачивает его сам (foojay, Eclipse Adoptium) в `~/.gradle/jdks`.
- Android SDK: `local.properties` с `sdk.dir=…` (не в git) или переменная `ANDROID_HOME`.
  Недостающая платформа (`android-37.2`) скачивается AGP автоматически, если приняты лицензии.

## Команды

Все команды — из каталога `android/`.

| Задача | Команда |
|---|---|
| Векторы `bashkir-text` + debug-APK | `./gradlew :core:bashkirtext:test :app:assembleDebug` |
| Все тесты M2 (векторы bashkir-text и QR/кода класса, сессия, JSON контракта, автомат урока, ViewModel на моках, формы Ҫ/Ҙ) | `./gradlew :core:bashkirtext:test :core:authcodes:test :core:session:test :core:designsystem:testDebugUnitTest :feature:student:testDebugUnitTest` |
| Сверка снимков экранов с эталонами | `./gradlew :core:designsystem:verifyRoborazziDebug :feature:student:verifyRoborazziDebug` |
| Перезапись эталонов (только осознанно, после просмотра картинок) | `./gradlew :feature:student:recordRoborazziDebug` (дизайн-система — `:core:designsystem:recordRoborazziDebug`) |
| Клиент API заново из контракта (делает каждая сборка) | `./gradlew :core:network:openApiGenerateModels :core:network:openApiGenerateClient` |
| Иконки Phosphor заново (из корня репозитория) | `node android/scripts/phosphor-icons.mjs` |
| Lint | `./gradlew :app:lintDebug :feature:student:lintDebug :core:designsystem:lintDebug` |
| Установить на устройство/эмулятор | `./gradlew :app:installDebug` |

APK: `app/build/outputs/apk/debug/app-debug.apk`; сборка для показа — `dist/teletau-m2-debug.apk` (как поставить и указать адрес API — `docs/demo/M2-android.md`).
Эталоны снимков: экраны ученика — `feature/student/src/test/snapshots/*.png` (телефон 390×844 dp, как снимки прототипа
`prototypes/trail-expedition/shots`), дизайн-система — `core/designsystem/src/test/snapshots/*.png`; при расхождении Roborazzi
кладёт `*_compare.png` в `<модуль>/build/outputs/roborazzi/`.

## Модули

| Модуль | Что внутри |
|---|---|
| `:app` | `ru.teletau.app`, minSdk 26, targetSdk 36. `MainActivity` → `StudentApp`; `AppEnvironment` (адрес API, клиент на OkHttp, `installId`), `KeystoreTokenStore` (refresh-токен — AES-GCM ключом Android Keystore). HTTP без TLS — только debug (`src/debug/res/xml/network_security_config.xml`). Значок — из `design/assets/approved/app-icon.webp` |
| `:feature:student` | Экраны ученика: старт, «Учусь сам» (возраст → ник → цель), вход по QR (CameraX + ZXing; TT1 и TP1) и коду класса, ник, карточка входа (QR — ZXing, «Сохранить картинку»), «Вступить в класс», тропа, урок (плитки, выбор, ввод с панелью букв, пары, дуэль), после урока (итог, серия, «Новая награда!», новая лига), «Лига», «Класс», «Профиль» (с «Наградами» — `learn/Achievements.kt`), офлайн. `StudentViewModel` (стек экранов, сессия, автомат урока `learn/LearnMachine.kt` — порт `machine.ts` веба). Снимки Roborazzi, тесты автомата и ViewModel |
| `:core:designsystem` | Токены (`TeleTauTokens.generated.kt`), `TeleTauTheme` (тема, возрастной режим, «Убрать анимацию»), шрифты Nunito и Golos Text (`TeleTauFonts`, `TeleTauText.bashkir` — локаль `ba`, формы Ҫ/Ҙ), иконки Phosphor (`PhosphorIcons.generated.kt`), картинки серии (`Illustration`), компоненты прототипа: кнопки с «губой», узел тропы, соты, аватары ников, плитки, варианты, панель букв, листы, диалог, вкладки, лига. Картинки и шрифты не копируются в android/: задача `syncDesignAssets` кладёт их в ресурсы сборки из `design/assets/approved` и `packages/design-tokens/fonts` |
| `:core:network` | Клиент API — **только сгенерированный** из `packages/contracts/openapi.yaml` (openapi-generator 7.27, `kotlin`, kotlinx.serialization + Ktor). Модели — шаблоны `jvm-retrofit2` с обёртками `oneOf`, операции — `jvm-ktor`; обходы ограничений генератора описаны в `core/network/build.gradle.kts` |
| `:core:session` | `TeleTauClient` (операции контракта на одном движке, вход по QR и коду класса), `SessionManager` (single-flight refresh, конец сессии по 401 refresh), Problem Details → `ApiProblem`, UUIDv7 |
| `:core:authcodes` | Порт `@teletau/auth-codes`: разбор карточки места `TT1`, личной карточки `TP1` (`LoginCardCodec`, ADR 0022) и кода класса; общие векторы `contracts/test-vectors/{qr-card,class-code,login-card}` |
| `:core:bashkirtext` | Чистый Kotlin/JVM: `BashkirText.normalize / toComparable / fold` — порт `packages/bashkir-text` на таблице `BashkirTable.generated.kt` |
| `build-logic` | Convention-плагины: `teletau.android.application`, `teletau.android.library`, `teletau.android.library.compose`, `teletau.jvm.library` |

Версии — в `gradle/libs.versions.toml`; SDK и JDK — в `build-logic/convention/src/main/kotlin/ru/teletau/buildlogic/TeleTauBuild.kt`.

## Правила

- **Сгенерированные файлы не редактируются руками.** Клиент API — `build/generated/openapi` (каждая сборка), `PhosphorIcons.generated.kt` — `node android/scripts/phosphor-icons.mjs`, `TeleTauTokens.generated.kt` — `pnpm --filter @teletau/design-tokens build`,
  `BashkirTable.generated.kt` — `pnpm codegen` (из корня репозитория). Актуальность проверяет `pnpm codegen:check`.
- **Цвета, отступы, радиусы, размеры шрифтов — только из токенов** (`TeleTauTheme.colors`, `TeleTauSpace`, `TeleTauRadius`,
  `TeleTauSize`, `TeleTauFontSize`). Литералы `Color(0x…)` вне `*.generated.kt` ловит `node scripts/check-hardcoded-colors.mjs`.
- **Векторы общие для TS, Swift и Kotlin** (`contracts/test-vectors/bashkir-text`). Тест читает их напрямую из репозитория
  (путь передаётся системным свойством `teletau.repoRoot`); под реализацию векторы не правятся.
- В модулях `:core:*` включён Kotlin explicit API (кроме `:core:network`: в шаблоне обёрток `oneOf` генератора у свойства нет модификатора).
- Тексты интерфейса — как в вебе, ученику на «ты», без технических объяснений; башкирский текст — только из API (исключение — бренд «ТелеТау», `needs_native_review`, очередь №1).

## Заметки о версиях

- Gradle 9.8.2, AGP 9.5.0 (Kotlin встроен в AGP — плагин `org.jetbrains.kotlin.android` не нужен), Kotlin 2.4.21,
  Compose BOM 2026.09.00, JUnit Jupiter 6.1.3, Robolectric 4.17, Roborazzi 1.77.0.
- **compileSdk 37.2**, а не установленная 36.1: Compose UI 1.12 (BOM 2026.09.00) требует compileSdk ≥ 37. targetSdk — 36.
- Unit-тесты включены и для release (`android.onlyEnableUnitTestForTheTestedBuildType=false`): задача AGP 9.5
  `generate<Variant>ComposePreviewRunfiles` иначе не создаётся и ломает даже `./gradlew tasks`.
- Robolectric для SDK 36 требует `--add-exports=java.base/jdk.internal.access=ALL-UNNAMED` (задано в `:core:designsystem`).
