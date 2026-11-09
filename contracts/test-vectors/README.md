# Общие тест-векторы

Логика, которая работает на нескольких платформах (сервер на TS, iOS на Swift, Android на Kotlin), описывается здесь **один раз** и проверяется одними и теми же векторами. Так мы получаем выгоду общего кода без кроссплатформенного фреймворка (ADR 0003).

## Формат файла

```json
{
  "suite": "bashkir-text/normalize",
  "version": 1,
  "function": "normalize",
  "cases": [
    { "id": "n001", "input": "…", "expected": "…", "note": "что проверяем" }
  ]
}
```

- `id` уникален в пределах набора и никогда не переиспользуется: удалённый вектор оставляет «дыру» в нумерации.
- Неотличимые на глаз символы (латинские двойники, комбинирующие знаки) в `input` записываются через `\uXXXX`.
- Изменение поведения = новая `version` набора + обновление всех реализаций в одном изменении. Каждый порт объявляет в тестах, какие версии наборов он реализует (`SUPPORTED_VERSIONS`), и падает, если набор новее: так нельзя забыть обновить одну из платформ.
- Файлы форматируются скриптом `node packages/bashkir-text/scripts/format-vectors.mjs`: он сам экранирует двойники, невидимые символы и комбинирующие знаки.

## Наборы

| Набор | Функция | Как получен |
|---|---|---|
| `bashkir-text/normalize.json` (v3) | `normalize` — алгоритм v3: NFC → удаление невидимых и управляющих символов направления текста (ZWJ/ZWNJ — только рядом с буквами, за линейное время) → NFC → последовательности → двойники в кириллических словах → пробелы → NFC | вручную |
| `bashkir-text/comparable.json` (v4) | `toComparable` — неподвижная точка NFC(нижний регистр(normalize)) | вручную |
| `bashkir-text/fold.json` (v4) | `fold` — неподвижная точка NFC(свёртка особых букв(toComparable)) | вручную |
| `bashkir-text/normalize-table.json` (v2) | `normalize` — по вектору на каждую запись правил (`letterMap`, `removeCodePoints`, `whitespaceCodePoints`, `sequences`); ожидания выведены из правил, а не из реализации | `pnpm codegen` (проверка — `pnpm codegen:check`) |
| `bashkir-text/fuzz-{normalize,comparable,fold}.json` (v2) | дифференциальный фазз: 1000 строк из детерминированного генератора (seed), ожидания от TS-эталона; Swift и Kotlin проходят их как обычные векторы | `pnpm --filter @teletau/bashkir-text vectors:fuzz` (проверка — `vectors:fuzz:check`; TS-тест дополнительно сверяет входы с генератором) |
| `qr-card/{parse,build,generate}.json` (v2) | QR-карточка: разбор ссылки или полезной нагрузки `TT1.<seat>.<secret>.<check>` с нормализацией ручного ввода, сборка, генерация из байтов. Здесь `input` и `expected` — структуры, `expected` сравнивается целиком | вручную; контрольные суммы — независимым расчётом |
| `class-code/{parse,generate}.json` (v1) | Код класса из 6 символов: разбор ручного ввода, генерация из байтов | вручную |
| `login-card/{parse,build,generate}.json` (v2) | Личная карточка входа `TP1.<handle>.<secret>.<check>` (ADR 0022) и общий разбор сканера: карточка места `TT1` или личная `TP1`, вид — по префиксу, суммы различны. Правила — `login-card/README.md` | вручную; контрольные суммы — независимым расчётом |
| `answer-check/match.json` (v1) | `matchAnswer` — проверка ответа ученика: `correct` / `almost` с буквой и позицией (все 9 пар особых букв и ё/е) / `typo` / `wrong`, плитки. Правила — `answer-check/README.md` | вручную, из правил docs/02 §4; строки синтетические |
| `xp/{lesson,vote}.json` (v1) | `lessonHoney` — мёд за урок с лимитом повтора; `voteHoney` — «мёд созревает» за голос. Правила — `xp/README.md` | вручную, из правил docs/plans/M2.md §3 |
| `streak/streak.json` (v1) | `computeStreak` — серия по суткам Уфы с заморозками, неделя пн–вс. Правила — `streak/README.md` | вручную |
| `consensus/duel-v0.json` (v1) | `duelV0` — состояние дуэли по группам голосов до Consensus Engine (ADR 0019). Правила — `consensus/README.md` | вручную |
| `srs/fsrs6.json` (v1) | `fsrsReplay` — состояние памяти слова по FSRS-6 с параметрами по умолчанию (S, D, R, интервал, срок по суткам Уфы); числа — с допуском `tolerance`. Правила — `srs/README.md` | независимым расчётом по опубликованным формулам, сверено с тестами `py-fsrs` |
| `srs/{rating,status}.json` (v1) | `ratingFromVerdicts` — оценка FSRS по вердиктам проверки; `srsStatus` — «выучено» / «пора повторить» | вручную |
| `achievements/achievements.json` (v1) | `computeAchievements` — 12 наград по истории ученика: день получения и прогресс. Правила — `achievements/README.md` | вручную |

Формат QR-карточки и кода класса для портов описан в `qr-card/README.md` (ADR 0016). Эталон — `packages/auth-codes`. Порты Swift и Kotlin появятся в M6 и M7: клиентам нужен только разбор.

Эталон `answer-check` — `packages/bashkir-text` (`src/match.ts`); `xp`, `streak`, `consensus`, `srs`, `achievements` — `packages/domain-rules`. Раннеры Swift и Kotlin пока читают только `bashkir-text/`, поэтому новые каталоги их не ломают; порты — в M6/M7 (решение владельца, docs/plans/M2.md §3). Правила лиги проверяются юнит-тестами `packages/domain-rules/test/league.test.ts`, без общих векторов.

Реализации bashkir-text: `packages/bashkir-text` (TS, эталон), `ios/Packages/TeleTauCore/Sources/BashkirText`, `android/core/bashkirtext`. Все три раннера читают **все** `*.json` каталога и падают, если набор неизвестен порту (`SUPPORTED_VERSIONS`) или функция неизвестна.

Правила нормализации и нижнего регистра — в `contracts/shared/bashkir-homoglyphs.json`. Таблицы для TS, Swift и Kotlin генерируются из него (`pnpm codegen`), включая собственную таблицу нижнего регистра (латиница, греческий, кириллица): результат не зависит от версии Unicode платформы. В фазз-генератор не включаются символы новее Unicode 15 — их общая категория на JDK 21 и старых ОС другая.

Свойства (идемпотентность и NFC для `normalize`, `toComparable`, `fold`) проверяются на 2000 строк на каждой платформе: TS — fast-check, Swift и Kotlin — генератор SplitMix64 с тем же seed. Отдельные тесты — вход из 200 000 кодовых точек и цепочки из 200 000 ZWJ/ZWNJ (обработка за линейное время; порог 1 с в TS и Kotlin, 3 с в debug-сборке Swift).

## Как запускать

| Платформа | Команда |
|---|---|
| TS | `pnpm vectors` (bashkir-text, answer-check, qr-card, class-code, xp, streak, consensus, srs, achievements) |
| Swift | `swift test --package-path ios/Packages/TeleTauCore` |
| Kotlin | `cd android && ./gradlew :core:bashkirtext:test` |
