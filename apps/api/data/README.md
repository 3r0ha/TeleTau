# Данные API: справочник, демо-школы, демо-сотрудники

Здесь лежат данные, которые API загружает в базу, и инструкции для демо-режима вехи M1.
Методика и источники справочника — в [`rb-directory.README.md`](rb-directory.README.md).

## Справочник районов и школ РБ

| Что | Где |
|---|---|
| 54 района и 9 городских округов | `rb-districts.csv` |
| 1 691 школа и филиал | `rb-schools.csv` |
| Импорт | `src/modules/org/directory-import.ts` (модуль `org`) |

**Команда:** `pnpm --filter @teletau/api org:import`. Её же вызывает `pnpm dev` после миграций.
Скрипт читает корневой `.env` (`DATABASE_URL`). Файл запускается встроенным в Node ≥ 22.18 удалением типов, без сборки.

Импорт идемпотентен, работает в одной транзакции под рекомендательной блокировкой. Тексты из CSV приводятся к канонической форме `@teletau/bashkir-text` (NFC, двойники, пробелы), поэтому пакет должен быть собран — `pnpm dev` и `pnpm e2e` собирают его сами:

- районы — upsert по ОКТМО;
- школы-юрлица — upsert по ИНН;
- филиалы (без ИНН) — по паре «район + наименование», сравнение — свёртка `@teletau/bashkir-text` (без учёта регистра, «ё/е» и особых башкирских букв).

Неизменённые строки не перезаписываются. Первый запуск занимает около 0,6 с, повторный — около 0,2 с.
Записи, пропавшие из источника, не удаляются: на школы ссылаются классы.

Флаги:
- `--demo` — добавить демо-записи;
- `--no-demo` — не добавлять их.

По умолчанию демо-записи добавляются вне `NODE_ENV=production`.

### Демо-школы (`is_demo = true`)

Для тестов и показа импорт добавляет:
- район «Демо-район (для проверки)» с ОКТМО `demo-0001`;
- три школы «Демо-школа № 1…3 (для проверки)».

`GET /districts` отдаёт демо-район последним. У школ `isDemo: true`.
Интеграционные тесты сами добавляют только демо-записи (`importDirectory(pool, { demo: true, directory: … })`), полный импорт им не нужен.

Названия районов на башкирском (`name_ba`) хранятся в базе, но **API их пока не отдаёт**. Они взяты из башкирской Википедии и ждут проверки носителем (`docs/native-review-queue.md`, строка 16).

## Демо-сотрудники консоли (только dev и демо)

Почтового сервиса в M1 нет (решение владельца). При `AUTH_DEMO_OTP=0000`:
- код из письма всегда `0000`;
- письмо не отправляется.

Сотрудник входит в три шага: e-mail → код `0000` → код TOTP из приложения-аутентификатора. Для показа жюри
шаг TOTP можно убрать: `AUTH_DEMO_STAFF_WITHOUT_TOTP=1` (только вместе с `AUTH_DEMO_STAFF`, не в production) —
вход становится «e-mail → код», как у учителя. На стенде хакатона флаг включён.

API заводит четырёх сотрудников при каждом старте (идемпотентно). Это происходит **только** при `AUTH_DEMO_STAFF=1` и `NODE_ENV` ≠ `production` — флаг отдельный от демо-кода: стенд для показа может принимать код `0000`, но не пускать в консоль по второму фактору из репозитория. В production флаг запрещён проверкой конфигурации. Если флаг выключен, заведённые раньше демо-сотрудники при старте блокируются, их сессии завершаются; включили снова — сид их разблокирует. В `.env.example`, dev, e2e и интеграционных тестах флаг включён.

10 неверных кодов TOTP за час блокируют вход сотрудника на час (ADR 0015).

| Роль | E-mail | Секрет TOTP (base32) |
|---|---|---|
| модератор | `moderator@demo.teletau.local` | `KEREZDEMOMODERATORTOTPSECRETAAAA` |
| администратор (+ модератор) | `admin@demo.teletau.local` | `KEREZDEMOADMINTOTPSECRETBBBBBBBB` |
| министерство — раздел «Республика» (ADR 0023) | `ministry@demo.teletau.local` | `KEREZDEMOMINISTRYTOTPSECRETCCCCC` |
| Фонд — раздел «Словарь для Фонда» (ADR 0023) | `fund@demo.teletau.local` | `KEREZDEMOFUNDTOTPSECRETDDDDDDDDD` |

> Эти секреты знает любой, кто читает репозиторий. Это демо-учётки, а не защита.
> Код сида — `src/modules/identity/staff-seed.ts`.

TOTP по RFC 6238: 6 цифр, шаг 30 с, SHA-1, окно ±1 шаг. Один и тот же код дважды не принимается (защита от повтора).

**Добавить в приложение-аутентификатор.** Подойдёт любое: Яндекс Ключ, FreeOTP, Aegis и др. Вручную введите секрет из таблицы или откройте ссылку:

```text
otpauth://totp/TeleTau:moderator@demo.teletau.local?secret=KEREZDEMOMODERATORTOTPSECRETAAAA&issuer=TeleTau&digits=6&period=30
otpauth://totp/TeleTau:admin@demo.teletau.local?secret=KEREZDEMOADMINTOTPSECRETBBBBBBBB&issuer=TeleTau&digits=6&period=30
otpauth://totp/TeleTau:ministry@demo.teletau.local?secret=KEREZDEMOMINISTRYTOTPSECRETCCCCC&issuer=TeleTau&digits=6&period=30
otpauth://totp/TeleTau:fund@demo.teletau.local?secret=KEREZDEMOFUNDTOTPSECRETDDDDDDDDD&issuer=TeleTau&digits=6&period=30
```

**Получить код без телефона** (из каталога `apps/api`):

```sh
node -e 'import("otplib").then(async (o) => console.log(await o.generate({ secret: "KEREZDEMOMODERATORTOTPSECRETAAAA" })))'
```

Секрет TOTP хранится в `credentials.secret_enc` под AES-256-GCM ключом `AUTH_ENCRYPTION_KEY`. Если ключ в dev пуст, он выводится из `AUTH_SECRET_PEPPER` (`src/config/secrets.ts`). Сид перешифровывает секрет при каждом старте, поэтому смена ключа в dev ничего не ломает.

## Документы для согласий

Действующие версии хранятся в `src/modules/consent/legal-texts.ts`: `terms`, `privacy`, `consent_adult`, `consent_child`, все версии `2026-11-01`.

API заносит их в `legal_documents` при старте. Это идемпотентно, по паре (вид, версия), вместе с SHA-256 текста и адресом страницы `url` = `${PUBLIC_WEB_URL}/legal/<вид>/<версия>`. Если `PUBLIC_WEB_URL` поменялся, при старте обновляется только `url`. Страница веба показывает текст из `GET /api/v1/legal-documents/{kind}/{version}` — копии текста в вебе нет.

Новый текст — это новая версия, старая не меняется. Тексты — черновик разработчика. Текст `consent_child` печатается на бланке согласия в PDF карточек.
