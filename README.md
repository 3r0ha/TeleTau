# 🐝 ТелеТау — Башкирская языковая школа

Платформа изучения башкирского языка для школ Республики Башкортостан: уроки с геймификацией,
краудсорсинговый корпус переводов рус↔баш и публичный словарь.

**Заказчик:** Министерство просвещения Республики Башкортостан · **AI:** GigaChat
**Каналы:** веб · нативные iOS/Android · Telegram-бот и Mini App

---

## 🎬 Демо-стенд

| Что | Ссылка |
|---|---|
| Веб (лендинг, вход, уроки, кабинет учителя) | **https://teletau.study** |
| Telegram Mini App | https://teletau.study/miniapp |
| Консоль сотрудников (министерство, Фонд, модерация) | https://console.teletau.study |
| API | https://api.teletau.study/api/v1/health |
| Telegram-бот | [@TeleTauBot](https://t.me/TeleTauBot) — `/start`, задание дня, фраза дня, напоминания |
| Android (APK) | https://teletau.study/teletau.apk |

Сценарий показа и демо-мир — [`docs/demo/M2.md`](docs/demo/M2.md). Развёртывание стенда — [`docs/deploy.md`](docs/deploy.md).

### Вход для демонстрации

Стенд в демо-режиме: письма не отправляются, код из «письма» — всегда **0000**, для сотрудников
шаг TOTP отключён. Персональных данных детей в демо-мире нет — только номер места и псевдоним.

| Кто | Как войти |
|---|---|
| **Учитель** | `teletau.study/teacher/login` → `teacher@demo.teletau.local` → код **0000**. Класс **5 «Б»** Демо-школы № 1 |
| **Ученик (новый)** | `teletau.study` → «У меня есть карточка или код» → код класса **000-000** → выбрать ник → заявку подтверждает учитель (страница 5 «Б», баннер «ученик ждёт») |
| **Ученик (демо-карточка)** | QR-карточка демо-ученика №07 «Смелая пчела» — камера на `/student` |
| **Министерство** | `console.teletau.study/login` → `ministry@demo.teletau.local` → код 0000 → раздел «Республика» |
| **Фонд башкирского языка** | так же, `fund@demo.teletau.local` → раздел «Словарь для Фонда» (выгрузка CSV) |
| **Модератор** | `moderator@demo.teletau.local` — заявки учителей |

Фоновые аккаунты (`teacher2@`, `adult1…@`, `region1…12@`) — не входить: их голоса уже в дуэлях.

### Публичное API — без регистрации

```sh
curl https://api.teletau.study/api/v1/public/dictionary                  # словарь JSON (ТЗ §5)
curl "https://api.teletau.study/api/v1/public/dictionary?format=csv"     # CSV для Excel («;», BOM)
curl "https://api.teletau.study/api/v1/public/dictionary?status=expert_review"  # только проверено носителем
curl "https://api.teletau.study/api/v1/public/leaderboard?period=week"   # доска почёта школ и классов (ТЗ §4.5)
curl https://api.teletau.study/api/v1/public/phrase-of-day               # фраза дня
```

Выгрузка — те же принятые пары, что для Фонда, но без голосов по группам и без персональных данных.
Языковая пара MVP — одна: башкирский ← русский (`ba-ru`).

---

## Быстрый старт (локально)

```sh
pnpm install          # Node ≥ 24, pnpm ≥ 9
pnpm demo:reset       # Docker (Postgres, Valkey, ClickHouse, MinIO) + миграции + демо-мир
pnpm dev              # веб :3000, API :4000, консоль :3100, бот
```

Локально вход тот же, но сотрудникам после кода 0000 нужен TOTP — секреты в [`apps/api/data/README.md`](apps/api/data/README.md).

Полная самопроверка (CI-паритет: типы, линтеры, тесты, контракты, сборки, iOS/Android, e2e) — `bash scripts/verify.sh`.

## Состав

| Каталог | Что там |
|---|---|
| `apps/api` | NestJS: identity, org, learning, consensus, corpus, progress, telegram, ministry, assignments |
| `apps/web` | Веб ученика и учителя (Next.js), Mini App, BFF, лендинг |
| `apps/console` | Консоль сотрудников: модерация, министерство, словарь Фонда |
| `apps/bot` | Telegram-бот (grammY): вход, напоминания, ежедневная дуэль, фраза дня |
| `ios/`, `android/` | Нативные клиенты ученика (Swift/SwiftUI, Kotlin/Compose) |
| `packages/contracts` | OpenAPI-контракт (contract-first), генерация типов и JSON |
| `packages/*` | дизайн-токены, UI, сессия, башкирский текст (нормализация), FSRS, доменные правила |
| `content/` | Курс и корпус дуэлей (открытые источники, YAML + импорт) |

## Документы

| № | Документ | О чём |
|---|---|---|
| 00 | [Видение](docs/00-vision.md) | Проблема, решение, позиционирование, 7 отличий, метрики |
| 01 | [Продукт](docs/01-product.md) | Роли, сценарии, функциональный состав (R1/R2/R3), НФТ |
| 02 | [Методика и геймификация](docs/02-learning-gamification.md) | FSRS, упражнения, экономика мотивации, «Индекс улья», этика |
| 03 | [Consensus Engine](docs/03-consensus-engine.md) | Как голоса сообщества превращаются в надёжную базу |
| 04 | [AI на GigaChat](docs/04-ai-gigachat.md) | Сценарии, ограничения, шлюз, качество, бюджет |
| 05 | [Дизайн-система «Борть»](docs/05-design-system.md) | Визуальный язык, токены, маскоты, ключевые экраны |
| 06 | [Архитектура](docs/06-architecture.md) | Компоненты, стек, монорепозиторий, офлайн, ADR |
| 07 | [Данные и API](docs/07-data-and-api.md) | Модель данных, внутренний и публичный API, релизы датасета |
| 08 | [Инфраструктура и безопасность](docs/08-infra-security-compliance.md) | Хостинг, CI/CD, наблюдаемость, Telegram, магазины |
| 09 | [Роадмап](docs/09-roadmap.md) | Вехи M0–M13 и пилоты |
| 10 | [Цикл с агентами-жюри](docs/10-jury-loop.md) | Разработали → проверили жюри → доделали → по кругу |
| 11 | [Рынок и конкуренты](docs/11-market-competitors.md) | Цифры, конкурентная карта, уроки аналогов |
| 12 | [Финансы](docs/12-finance.md) | Бюджет, эксплуатация, TCO, финансирование |
| 13 | [Риски](docs/13-risks.md) | Реестр рисков и меры |
| 14 | [Задачи владельца](docs/14-owner-tasks.md) | Аккаунты, юридика, партнёрства, контент |
| 15 | [Бриф на ассеты](docs/15-art-brief.md) | Маскоты, иллюстрации, звук — с промптами |
| — | [Демо](docs/demo/M2.md) · [Деплой](docs/deploy.md) · [Статус](docs/STATUS.md) | Показ, развёртывание стенда, текущее состояние |
| — | [Исследования](docs/research/) | Первичные исследования с источниками |

## Как идёт разработка

```
/milestone      — полный цикл текущей вехи: план → код → самопроверка → жюри → доработка → …
/jury M3        — только гейт жюри для вехи M3
```

Агенты-жюри: `.claude/agents/jury-{product,ux,architecture,security,qa,language-ai,customer}.md`.
Правила для агента-разработчика — [CLAUDE.md](CLAUDE.md).
