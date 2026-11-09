# iOS-клиент «ТелеТау»

SwiftUI, iOS 17+, Swift 6 (строгая конкурентность). Играбельный клиент ученика: вход по QR-карточке и коду класса,
тропа, урок (плитки, выбор, ввод с панелью башкирских букв, «Пары», дуэль), итог, серия, новая лига, лига, класс,
профиль, «Мой словарь», «Послушать», повторение слов и задания учителя, «Учусь сам» (ADR 0022): онбординг без ПДн,
личная карточка входа `TP1` (QR CoreImage, «Сохранить картинку» в Фото, перевыпуск), «Вступить в класс» по коду. Почта
взрослого — только на сайте (ссылки «по почте» и «Сохранить прогресс по почте» открывают его). Кабинет учителя — только на сайте («Я учитель или взрослый» открывает его).
Как поставить на свой iPhone — `docs/demo/M2-ios.md`.

```
ios/
├── project.yml                     # XcodeGen → TeleTau.xcodeproj (генерируется, в git не хранится)
├── TeleTau/                          # приложение: точка входа, Info.plist, значки AppIcon/*.png
├── scripts/
│   ├── generate-api.sh             # клиент API из packages/contracts/openapi.yaml (--check — актуальность)
│   ├── import-illustrations.sh     # design/assets/approved/*.webp → PNG (magick) + перечисление Illustration
│   └── import-icons.mjs            # иконки Phosphor из @phosphor-icons/react (--check — актуальность)
├── Tools/APIGen/                   # swift-openapi-generator как CLI (только для generate-api.sh)
└── Packages/TeleTauCore/             # Swift Package
    ├── Sources/BashkirText/        # порт packages/bashkir-text
    ├── Sources/AuthCodes/          # порт packages/auth-codes: карточка места TT1, личная карточка TP1, код класса
    ├── Sources/TeleTauAPI/Generated/ # сгенерированный клиент (swift-openapi-generator), руками не правится
    ├── Sources/TeleTauSession/       # сессия: Keychain, single-flight refresh, Problem Details, фасад операций
    ├── Sources/DesignSystem/       # токены «Борть», шрифты, иконки, иллюстрации, компоненты, башкирский набор
    ├── Sources/TeleTauFeatures/      # экраны и модели: вход, тропа, урок, после урока, лига, класс, профиль
    └── Tests/                      # векторы, сессия, автомат урока, снимки экранов
```

## Клиент API (CLAUDE.md, правило 1)

Типы и клиент генерирует [swift-openapi-generator](https://github.com/apple/swift-openapi-generator) 1.14 из
`packages/contracts/openapi.yaml`; в клиент входят операции из `Packages/TeleTauCore/openapi-generator-config.yaml`
(вход ученика M1 и операции M2: тропа, урок, повторение, прогресс, лига, улей, вклад). Ручных DTO нет: экраны
работают с `Components.Schemas.*`, а `TeleTauSession/TeleTauClient.swift` только вызывает сгенерированный `Client`.

```sh
bash ios/scripts/generate-api.sh          # после правки контракта
bash ios/scripts/generate-api.sh --check  # сгенерированное совпадает с контрактом
```

Генератор запускается как CLI (`ios/Tools/APIGen`), а не SPM-плагином сборки: плагин сборки требует подтверждения
в Xcode (`-skipPackagePluginValidation` в CLI) и пересобирает генератор (~1,5 мин) при каждой чистой сборке.
Сгенерированные файлы лежат в репозитории, как остальные `*.generated.swift`.

В рантайме — `swift-openapi-runtime`, `swift-openapi-urlsession`, `swift-http-types` (Apple, Apache 2.0). Сторонних
SaaS-SDK нет (правило 12).

## Сессия

- Access- и refresh-токены, аккаунт и идентификатор установки — в Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`).
- `AuthMiddleware` ставит `Authorization`, истекающий токен обновляет заранее, на 401 обновляет и повторяет запрос.
  Обновление строго одно на всех (`SessionStore.refresh`): refresh-токен одноразовый, второе параллельное обновление
  сервер счёл бы повторным предъявлением (`refresh_reused`).
- Отказ сервера в обновлении (401) — выход с причиной (`session_revoked`, `refresh_reused`); экран входа её объясняет.
  Временный сбой (нет сети, 503) сессию не стирает.
- Ответы не 2xx → `APIProblem` (RFC 9457) → тексты для ребёнка на «ты» (`ChildText`, как `describeProblem` веба).

## Башкирский текст (правила 6, 7; M0-P01)

- Весь башкирский текст — из API (и бренд «ТелеТау», «Аҡбуҙат» — строки 1 и 5 `docs/native-review-queue.md`).
- Рисуется `BashkirText`/`RichText` (DesignSystem): CoreText с `kCTLanguageAttributeName = "ba"` и шрифтом Nunito из
  `packages/design-tokens/fonts`. SwiftUI `Text` язык в шейпинг не передаёт (ни `typesettingLanguage`, ни `locale`,
  ни `AttributedString.languageIdentifier`), поэтому `locl BSH` через него не включить. Тест проверяет, что набор
  выбирает глифы `uni04AA.loclBSH`/`uni0499.loclBSH`. В Nunito эти глифы совпадают с основными (отличаются только
  чувашские формы), так что Ҫ и Ҙ верные и там, где башкирский набран обычным `Text`.
- Поле ввода — `UITextView` с тем же языком в атрибутах; панель букв `ә ө ү ғ ҡ ң ҙ ҫ һ` вставляет в позицию курсора.

## «Послушать»

- Кнопка — там, где в ответе API есть запись: карточка «Что значит это слово?» (`promptAudio`), лист ответа и строка
  «Моего словаря» (`BaString.audio`). Воспроизведение — AVFoundation (`SpeakPlayer`), запись грузится по нажатию.
- Адрес записи (`AudioClip.url`) берётся как есть; относительный путь (`/audio/…`) — от адреса сайта (настройки:
  «Адрес сайта» рядом с адресом сервера; пусто — тот же хост на порту 3000).
- AVFoundation не играет Ogg (Vorbis, Opus) и WebM: для таких адресов кнопки нет (`SpeakPlayer.playableExtensions`).
  Пока API отдаёт ссылки Commons на `.ogg`/`.oga`, кнопок на iOS не будет; появятся, когда адрес станет `/audio/<id>.m4a`
  (такие копии уже лежат на сайте) или другим поддерживаемым форматом.

## Картинки, шрифты, иконки, токены

- Иллюстрации — PNG в `DesignSystem/Resources/Illustrations` (`ios/scripts/import-illustrations.sh`, размер — ≈ @3x
  самого крупного показа). Не Asset Catalog: без рантайма iOS-симулятора `actool` не собирает ни один каталог под
  `iphonesimulator` («No available simulator runtimes»). Значок приложения — файлами `TeleTau/AppIcon/*.png`.
  Когда рантайм появится, каталог можно вернуть (`.process`) — `IllustrationStore` читает файл по имени.
- Шрифты — копии `packages/design-tokens/fonts` (тест сверяет побайтно): Nunito (заголовки, цифры, кнопки, башкирский),
  Golos Text (русский текст). Вариативные: вес — ось `wght`.
- Иконки — Phosphor (как в вебе), контуры SVG разбирает `SVGPath`.
- Цвета, отступы, радиусы, размеры шрифтов, длительности — только `TeleTauTokens.generated.swift`
  (`pnpm --filter @teletau/design-tokens build`). Множитель «Пчёлки» 1,125 = `bodyLarge / body` (в Swift-токены
  `fontScale` не выводится).
- Режим «Пчёлка» (`Me.uiMode = bee`): цели 56 pt, текст крупнее, буквы панели по 5 в ряд; экраны входа — тоже «Пчёлка».
  «Хранитель» — без пчелы у задания и на тропе.

## Тесты (macOS, без симулятора)

```sh
swift test --package-path ios/Packages/TeleTauCore
```

| Набор | Что проверяет |
|---|---|
| BashkirTextTests | векторы `contracts/test-vectors/bashkir-text/` |
| AuthCodesTests | векторы `qr-card/`, `class-code/` и `login-card/` (все наборы каталогов, версии), свойства на SplitMix64 (seeds 20261103, 20261105) |
| TeleTauSessionTests | single-flight refresh (8 параллельных запросов — одно обновление), упреждающее обновление, отказ и временный сбой обновления, хранение, вход по QR, опрос заявки, Problem Details, Keychain |
| DesignSystemTests | стартовый экран M0 в эталон; шрифты = design-tokens; глифы `loclBSH`; все картинки импортированы; иконки; цвет аватара как `toneFor` веба |
| TeleTauFeaturesTests | автомат урока (порт `machine.ts`), тексты, адрес записи «Послушать», QR карточки читается обратно, тексты выхода «Учусь сам», подсказка закрытого узла, выделенная буква «Почти!», знакомство с пчелой (один раз), синтез звуков, карточка «Новое слово» без ответа, разбор условия с подсказками, награды (значок и тон по `AchievementIcon`, подписи VoiceOver, загрузка с профилем, шаг «Новая награда!» после урока); снимки экранов |

Снимки экранов: `ImageRenderer`, 390 pt, @2x, светлая тема (тропа и плитки — ещё и тёмная). Эталоны —
`Packages/TeleTauCore/Tests/TeleTauFeaturesTests/__Snapshots__/`: старт, тропа (+ целиком, + задания учителя, + подсказка
закрытого узла), знакомство с пчелой (два листа), урок («Новое слово» (+ тёмный, + «Пчёлка»), подсказка к слову
(+ «Пчёлка»), плитки, «Верно!» с «3 подряд» (+ тёмный), плитки «Пока не так»,
выбор, «Пока не так», ввод, «Почти!», ввод в «Пчёлке», дуэль, «Голос учтён», «Пары», «Уже уходишь?»), итог, серия,
новая лига, «Новая награда!» (+ тёмный, + несколько наград), лига, класс, профиль, награды в профиле (+ тёмный), лист награды (получена и в процессе, + тёмные), «Мой словарь» (и пустой), «Нет связи», пустая лига; «Учусь сам»: старт (+ тёмный,
+ «Продолжить»), возраст, ник, «Цель дня» в профиле, карточка входа (нет, выпущена, тёмная, картинка для Фото), профиль, «Класса пока нет», для взрослого, вступить в
класс, ожидание учителя. Перезапись — только осознанно, после
просмотра картинки:

```sh
TELETAU_RECORD_SNAPSHOTS=1 swift test --package-path ios/Packages/TeleTauCore
```

`ImageRenderer` не рисует платформенные контролы, поэтому экраны в тестах рендерятся с `teletauStaticRender`:
прокрутка → статичный столбец, поле ввода → текст, камера → заглушка. Остальное — тот же код, что на устройстве.

## Сборка приложения

```sh
cd ios
xcodegen generate
xcodebuild build -project TeleTau.xcodeproj -target TeleTau -sdk iphonesimulator \
  -configuration Debug ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO \
  SYMROOT="$PWD/.build/xcode" OBJROOT="$PWD/.build/xcode/obj"
```

Так же собирает `scripts/verify.sh`. Короткая форма без `SYMROOT`/`OBJROOT` с пакетами SPM не работает: при
`-target` каждый пакет собирается в свой `build/`, и `OpenAPIRuntime` не находит модуль `HTTPTypes` соседнего пакета;
`SYMROOT` в самом проекте Xcode запрещает («Packages are not supported when using legacy build locations»).
С рантаймом симулятора можно собирать схемой: `xcodebuild build -scheme TeleTau -destination 'generic/platform=iOS Simulator'`.

Адрес API по умолчанию — настройка сборки `TELETAU_API_BASE_URL` (`project.yml`, по умолчанию `http://localhost:4000`);
на устройстве — шестерёнка на стартовом экране → «Адрес сервера». ATS разрешает http только в локальной сети
(`NSAllowsLocalNetworking`).
