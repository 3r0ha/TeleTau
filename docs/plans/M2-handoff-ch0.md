# M2 · Ч0 «Фундамент» — передача (Ч0 завершена)

**Обновление: Ч0 завершена.** Миграция `0006_m2` применена к dev-базе; зелёные `pnpm lint`, `pnpm typecheck`, `pnpm --filter @teletau/api test` (99), `pnpm --filter @teletau/api test:integration` (215), `pnpm vectors`, `pnpm contracts:check`, `pnpm codegen:check`, `pnpm tokens:check` (132). Модули content, learning, progress, competition, corpus, consensus переданы Ч2 и Ч3; новые миграции M2 генерирует Ч2. Ниже — исходная запись об остановке, статусы обновлены.

## Статус по пунктам

| # | Пункт | Статус | Проверка |
|---|---|---|---|
| 1 | Формат контента `content/schema/*.schema.json` | **готово** | примеры из схем проходят ajv 2020 + ajv-formats (временный скрипт вне репозитория) |
| 2 | Контракт: 13 операций | **готово** | `pnpm --filter @teletau/contracts generate`, `pnpm contracts:check` — OK (oasdiff: ломающих изменений нет) |
| 3 | Векторы `answer-check`, `xp`, `streak`, `consensus` + README | **готово** | `pnpm vectors` — зелёный (bashkir-text 3377, auth-codes 90, domain-rules 79) |
| 4 | `packages/domain-rules` (xp, streak, league, duel-v0) + `matchAnswer` | **готово** (функции реализованы, не заготовки) | входит в `pnpm vectors` |
| 5 | Каркасы модулей API (6 шт.), регистрация, матрица | **готово** | lint, typecheck, unit (contract-routes) и integration (матрица) — зелёные |
| 6 | Миграция `0006_m2` | **готово, применена** | 18 таблиц; у `judgments` триггеры `judgments_no_update_delete`, `judgments_no_truncate` и отзыв UPDATE/DELETE/TRUNCATE у `teletau_app` |
| 7 | ADR 0019 «Дуэль v0 до Consensus Engine» | **готово** | `docs/adr/0019-duel-v0-before-consensus-engine.md`, строка в `docs/06` §10 |
| 8 | Зависимости | **готово** | `yaml` (корень dev, `apps/api`), `ajv`, `ajv-formats` (корень dev — для `scripts/check-content.mjs` Ч1), `@teletau/domain-rules` в `apps/api`; `pnpm-lock.yaml` обновлён |
| 9 | Токен цвета серии (по просьбе Ч4) | **готово** | `color.streak.{fill,lip,text,soft}` (CSS `--kz-color-streak-*`), светлая и тёмная темы, пары контраста в `tokens/contrast-pairs.json` |

**Миграция применена.** Сброс демо-мира — пересоздание dev-базы (`demo:reset`, «Сборка»), триггер на `judgments` остаётся.

## Что сделано (для Ч1, Ч2, Ч3, Ч4, Ч5)

- **Формат контента** (Ч1): `common.schema.json` (`Slug`, `RuText`, `Review`, `SourceRef`, `BaText`), `sources.schema.json`,
  `course.schema.json`, `unit.schema.json` (узлы `lesson` / `help_language` с `duels` / `place_test`; закрытый юнит — узлы с `title_ru`),
  `lesson.schema.json` (`tiles_ru_ba`, `choice_ba_ru`, `free_ru_ba`, `duel`), `duels.schema.json` (ровно 2 варианта).
  `$id` — относительные имена файлов; URL — шаблоном `^https?://\S+$` (кириллица в URL допустима). Валидатор: `ajv/dist/2020` + `ajv-formats` с `allowUnionTypes: true`, без `strict: true`.
- **Контракт** (Ч4, Ч5): `packages/contracts/openapi.yaml` v0.3.0, типы — `packages/contracts/src/generated/api.ts` (`Schema<"…">` из `@teletau/contracts`).
  Операции: `getCourse`, `startLessonRun`, `submitLessonAttempt`, `completeLessonRun`, `getMyProgress`, `getClassProgress`,
  `getCurrentLeague`, `markLeagueResultSeen`, `getClassHive`, `listCorpusDuels`, `submitCorpusJudgment`, `getCorpusItemVotes`, `listMyCorpusCells`.
  Новые коды Problem (M2) — в описании `Problem` и в `apps/api/src/common/problem.ts` (`TITLES`, хелпер `notImplemented()` → 501).
- **Векторы и эталоны**: `contracts/test-vectors/{answer-check,xp,streak,consensus}/` с README (правила — там);
  `packages/bashkir-text/src/match.ts` (`matchAnswer`, `answerTokens`, `osaDistance`) + `test/answer-check.test.ts`;
  `packages/domain-rules/src/{calendar,xp,streak,league,duel-v0}.ts`, тесты `test/{vectors,league,streak}.test.ts`.
  Корневой `pnpm vectors` включает `@teletau/domain-rules`; `contracts/test-vectors/README.md` дополнен.
- **Каркасы модулей** `apps/api/src/modules/{content,corpus,competition,progress,consensus,learning}/`:
  `*.schema.ts`, `*.api.ts` (интерфейсы между частями: `ContentApi`, `CorpusApi`, `CompetitionApi`, `ProgressApi`, `ConsensusApi`, `LearningApi`),
  `*.service.ts` (методы бросают `notImplemented()`), `*.controller.ts` (маршруты всех 13 операций), `*.module.ts`, `index.ts`.
  Политики уже работают до 501: `ProgressService.classProgress` → `ClassPolicy.requireTeacher`, `CompetitionService.classHive` → `ClassPolicy.requireMember`.
  Регистрация — `apps/api/src/app.module.ts`. Граф: learning → content, corpus, consensus, progress; consensus → corpus, progress;
  progress → competition, org; competition → org (ники — через `ACCOUNTS_PORT`).
- **Матрица авторизации**: `apps/api/test/integration/authz-matrix.test.ts` — 13 строк + 2 в `EXTRA_FOREIGN`
  (`getClassProgress` учителем A на класс B, `getClassHive` учителем B).

## Изменённые и новые файлы

Новые: `content/schema/{common,sources,course,unit,lesson,duels}.schema.json`;
`contracts/test-vectors/answer-check/{match.json,README.md}`, `xp/{lesson.json,vote.json,README.md}`, `streak/{streak.json,README.md}`, `consensus/{duel-v0.json,README.md}`;
`packages/domain-rules/**` (package.json, tsconfig*.json, vitest.config.ts, src/*, test/*);
`packages/bashkir-text/src/match.ts`, `packages/bashkir-text/test/answer-check.test.ts`;
`apps/api/src/modules/{content,corpus,competition,progress,consensus,learning}/*`.

Изменённые: `packages/contracts/openapi.yaml`, `packages/contracts/src/generated/{api.ts,openapi.json}`;
`packages/bashkir-text/src/index.ts` (экспорт `matchAnswer`); `contracts/test-vectors/README.md`;
`apps/api/src/app.module.ts`; `apps/api/src/common/problem.ts`; `apps/api/src/modules/org/index.ts` и `org.module.ts`
(экспорт `ClassPolicy`, `ClassRow` — публичный интерфейс M1, нужен политикам M2);
`apps/api/test/integration/authz-matrix.test.ts`; `apps/api/package.json`; корневой `package.json`; `pnpm-lock.yaml`.

## Что осталось (конкретно)

1. **Проверить каркасы**: `pnpm lint` (eslint по `apps/api/src`, `packages/domain-rules`, `packages/bashkir-text`), `pnpm --filter @teletau/api test`
   (`test/contract-routes.test.ts` — все 13 маршрутов должны найтись, лишних нет), `pnpm typecheck` по всему репозиторию.
2. **Миграция `0006_m2`**: `pnpm --filter @teletau/api db:generate --name m2` (проверить, что файл назван `0006_m2.sql`), затем дописать вручную в конец SQL
   (по образцу `apps/api/drizzle/0002_m1_guards.sql`): функция `judgments_forbid_mutation()`, триггеры `BEFORE UPDATE OR DELETE … FOR EACH ROW`
   и `BEFORE TRUNCATE … FOR EACH STATEMENT` на `judgments`, `REVOKE UPDATE, DELETE, TRUNCATE ON judgments FROM teletau_app` (внутри `DO`-блока
   с проверкой роли, как в 0002), `COMMENT ON TABLE judgments`. Применить: `pnpm db:migrate`. Затем `pnpm --filter @teletau/api test:integration`
   (матрица: новые строки проверяют только 401/403 — до 501).
3. **ADR 0019** — `docs/adr/0019-duel-v0-before-consensus-engine.md`: контекст (M4 ещё нет, а показ уже скоро), решение (правила из
   `contracts/test-vectors/consensus/README.md`, веса 1/2/3, `rules_version = duel-v0`, варианты только `origin = import`, мёд за голос
   pending → final из `xp/README.md`, детям распределение не показываем), последствия (пересчёт в M4 из неизменяемого журнала, `xp_ledger` → `revoked`
   при смене решения), альтернативы. Добавить строку в реестр ADR `docs/06-architecture.md` §10.
4. Для Ч2/Ч3 — реализовать методы-заглушки в `*.service.ts` своих модулей; импорты `content:import` / `corpus:import` — скрипты в модулях content/corpus.

## Известные поломки и риски

- **Пока нет миграции**, любые запросы к таблицам M2 упадут (таблиц нет в базе). Интеграционные тесты матрицы пройдут — они не доходят до SQL.
- **Сброс демо-мира и `judgments`**: триггер «только вставка» (как у `audit_log`) запретит сиду удалять демо-голоса — повтор `demo:seed`
  не сможет «сбросить» мир. Решать координатору (например, пересоздание базы или новые демо-исходники); `attempts` — только вставка по соглашению, без триггера.
- `common/problem.ts` вне списка моих каталогов — изменение аддитивное (новые коды и `notImplemented`), чтобы Ч2/Ч3 не правили один файл параллельно.
- `matchAnswer` положен в `packages/bashkir-text` (по плану §3 Ч2), реализован сразу — Ч2 его только использует.
- Факты в `docs/06` и `docs/07` (модули, таблицы, операции M2) не обновлены — это пункт «Сборки».
