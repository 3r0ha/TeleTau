# 07. Модель данных и API

## 1. Модель данных (ключевые таблицы PostgreSQL)

Соглашения: первичные ключи — UUIDv7 (сортируемые по времени, генерируются и на клиенте для офлайн-событий); все таблицы с `created_at`, `updated_at`; мягкое удаление только там, где нужно для истории; крупные журналы секционируются по месяцам. ПДн выделены в отдельную схему `pii` с отдельными правами доступа.

### 1.1. Идентичность, организации, согласия (фактические таблицы M1)

Таблицы принадлежат модулям (ADR 0014). Схемы описаны в `apps/api/src/modules/<m>/<m>.schema.ts`, миграции лежат в `apps/api/drizzle/0001…0004`. Ссылки между модулями — простые `uuid` без внешних ключей. Секреты хранятся только хешами: SHA-256 для значений с высокой энтропией, HMAC-SHA-256 с перцем для значений с низкой энтропией (ADR 0015, 0016).

```
identity
  accounts             id, kind(child|adult|staff), roles[](student|teacher|moderator|admin), status(active|blocked|deleted),
                       nickname_key, nickname (только child), ui_mode(bee|bortnik|keeper), ui_mode_manual (выбран самим,
                       иначе — по номеру класса при входе ученика), locale(ru|ba), last_login_at
  credentials          account_id, type(email|totp), subject = HMAC(e-mail) (email), secret_enc = AES-256-GCM (totp),
                       verified_at, last_used_at                         -- e-mail открытым текстом здесь нет
  devices              account_id, install_id (UUID установки), platform(web|ios|android|bot), app_version, last_seen_at
  sessions             id, family_id (= sid в JWT), account_id, device_id, refresh_hash = SHA-256, expires_at (30 дн.),
                       family_expires_at (90 дн.; сотрудники — 12 ч), rotated_at, replaced_by_id, revoked_at,
                       revoke_reason(logout|logout_all|refresh_reuse|account_blocked|admin|device_mismatch|consent_revoked|
                       card_reissued|superseded)
  pii.adult_profiles   account_id, email (нижний регистр), full_name, position   -- только взрослые и сотрудники (триггер)
org
  districts            id, oktmo, name_ru, name_ba (needs_native_review, в API не отдаётся), kind(municipal_district|urban_okrug),
                       source, is_demo
  schools              id, district_id, name_ru, short_name_ru, name_ba, inn?, address, category?, bashkir_medium?, source, is_demo
                       -- поиск: триграммные GIN-индексы по org_search_fold(name_ru | short_name_ru)
  classes              id, school_id, teacher_account_id, grade, letter, program(native|state|elective), academic_year,
                       status(active|archived), join_code_hash = HMAC(код), join_code_expires_at (15 мин)
  class_seats          id, class_id, seat_number (1–99), account_id?, bound_at     -- «№ места ↔ ребёнок» знает только учитель
  seat_cards           id, seat_id, version, handle (публичный id из QR), secret_hash = SHA-256, status(active|revoked),
                       issued_by_account_id, issued_at, revoked_at        -- история выпусков карточек места
  memberships          class_id, account_id, role(student|teacher|assistant), seat_id, joined_at, left_at
  join_requests        id, class_id, nickname_key, nickname, status(pending|approved|rejected|expired|consumed),
                       poll_token_hash = SHA-256, device_install_id, device_platform, app_version?, account_id?, seat_id?, decided_*,
                       expires_at
consent
  legal_documents      id, kind(privacy|terms|consent_child|consent_adult), version, title, url (страница веба
                       ${PUBLIC_WEB_URL}/legal/<kind>/<version>; при сиде), body_sha256, effective_from   -- текст версии неизменяем
  consents             id, document_id, method(electronic|paper), subject_account_id | (subject_seat_id + subject_class_id),
                       given_by_account_id, scope[] (пока пусто), signed_on?, given_at, revoked_at, revoked_by_account_id
moderation
  teacher_verifications id, account_id, school_id, status(pending|approved|rejected), decided_by_account_id, decided_at
                                                                           -- ФИО и должность — в pii.adult_profiles
  pii.teacher_verification_reasons verification_id, reason                -- причина отказа (свободный текст, бывают ПДн)
admin
  audit_log            id, created_at, actor_account_id, actor_kind, actor_roles[], action (<объект>.<событие>), target_type,
                       target_id, metadata (без ПДн и секретов), ip_hash = HMAC(IP), request_id   -- только вставка (триггер)
```

В Valkey (без ПДн открытым текстом):

| Ключ | Что хранится | Срок |
|---|---|---|
| `otp:<challengeId>` | HMAC адреса, адрес под AES-GCM, HMAC кода, счётчик попыток (расходуется Lua-скриптом, код удаляется при входе) | 10 мин |
| `print-job:<id>` | задание печати с секретами карточек под AES-GCM | 30 мин |
| `sid-revoked:<familyId>` | стоп-лист отозванных семейств сессий | 15 мин |
| `rl:*` | счётчики ограничения частоты; IP — только как HMAC. У лимитов неудач — пара: `rl:<ключ>` (неудачи в окне) и `rl:<ключ>:inflight` (попытки «в работе», у каждой срок 10 с; ADR 0016, уточнения раунда 2) | окно лимита |
| `idem:*` | маркер «в работе» (60 с) или первый ответ по `Idempotency-Key` вместе с хешем тела запроса | 24 ч |
| `staff-lock:<accountId>` | блокировка входа сотрудника после 10 неверных TOTP за час | 1 ч |
| `totp-used:*` | защита от повтора кода TOTP | |

Позже, по роадмапу: `guardianships` (M9), геометрия районов для карты, `tamga_seed` класса.

### 1.1a. Обучение, мотивация и дуэль (фактические таблицы M2)

Миграции `apps/api/drizzle/0006…0014` (`0006_m2` — обучение и корпус, `0007_telegram`, `0008_m2b_srs`, `0009_assignments`, `0010_self_learners`, `0011_staff_roles`, `0012_attempt_hints`, `0013_jump`, `0014_tz_daily_duel`), схемы — `apps/api/src/modules/<m>/<m>.schema.ts`. Ссылки между модулями — `uuid` и `text` без внешних ключей. Ниже — план M2b–M4 (§1.2–1.4); то, что из него уже есть, — здесь.

```
content       (импорт content:import из content/course, версия — content_versions)
  content_versions     course_id, version, content_hash, imported_at          -- та же version с другим хешем — ошибка импорта
  units                id, course_id, position, status(open|locked), place_slug, title_ru, title_ba (+ review, source), topic_ru
  lessons              id (= lessonId API), unit_id, position, kind(lesson|help_language|place_test), title_ru, icon,
                       duel_count (у «Помоги языку»), new_words jsonb
  exercises            id, lesson_id, position, type(tiles_ru_ba|choice_ba_ru|free_ru_ba|duel), payload jsonb (без ключей),
                       answer_key jsonb (только на сервере), review, sources jsonb, duel_ref
learning
  lesson_runs          id (= runId клиента), account_id, lesson_id, kind, content_version, plan jsonb (упражнения в порядке
                       показа + ключи проверки), status(active|completed), started_at, completed_at, completed_on (сутки
                       Уфы), completion_index (какое за сутки), accuracy, summary jsonb (ответ complete при повторе)
  attempts             id (= attemptId клиента), run_id, account_id, run_exercise_id, exercise_id, answer jsonb,
                       verdict(correct|almost|typo|wrong|recorded), first_attempt, latency_ms, result jsonb   -- только вставка
progress
  xp_ledger            account_id, amount, reason(lesson|vote), ref_id (забег или голос; уникально с reason),
                       status(pending|final|revoked), earned_on, finalized_at    -- «мёд созревает» = pending
  activity_days        account_id, day, lessons, honey, first_at              -- источник серии (streaks — её кеш)
  streaks              account_id, current, longest, freezes, last_day
  lesson_progress      account_id, lesson_id, completions, best_accuracy, first/last_completed_at   -- состояния узлов тропы
  progress_counters    account_id, lessons_completed, words_learned, votes_total, votes_matured
competition
  league_groups        id, week_start (пн по Уфе), tier(clover…linden), age_group(child|adult), closed_at   -- ≤ 20 участников
  league_members       group_id, account_id, week_start, points, scored_at, rank, outcome(promoted|stayed|demoted),
                       tier_after, result_seen_at                             -- итоги — при ленивом закрытии недели
  class_week_activity  class_id, day, week_start, account_id, lessons         -- квест и участие класса (наружу — агрегаты)
corpus        (импорт corpus:import из content/corpus/duels)
  source_items         id, external_id, lang, text, text_norm, kind, domain, unit_id, source_ref jsonb
  variants             id, source_item_id, lang, text, text_norm, raw (как в источнике), origin(import в M2), source_ref,
                       review(needs_native_review|native_approved|native_rejected), author_account_id, tags
consensus
  judgments            id (judgmentId или attemptId), created_at, source_item_id, variant_a_id, variant_b_id (порядок
                       показа), judge_account_id, voter_group(child|teacher|adult|expert), type(pairwise), choice(a|b|both|
                       skip), context(lesson|corpus|telegram), run_id, latency_ms, weight_snapshot, rules_version(duel-v0)
                       -- только вставка: триггеры на UPDATE/DELETE/TRUNCATE и отзыв прав у teletau_app
  item_state           source_item_id, status(voting|accepted|escalated), accepted_variant_ids, main_variant_id,
                       children_prefer_variant_id, votes_by_group jsonb, scores jsonb, decided_by, decided_at, rules_version
                       -- пересчитывается из judgments (правило 9); решение v0 закреплено до M4 (ADR 0019)
telegram      (модуль ADR 0020/0024; миграции 0007_telegram, 0014_tz_daily_duel)
  telegram_links       chat_id (PK = user.id Telegram), account_id, reminders_enabled, reminder_hour (8–20 по Уфе),
                       last_reminded_on, linked_at   -- только привязка чата: ни имени, ни ника, ни фото (правило 13)
  telegram_dialogs     dialog_id (PK), chat_id, account_id, item_id, variant_a_id, variant_b_id, judgment_id (голоса;
                       генерирует API), day (сутки Уфы выдачи), status(issued|answered|cancelled), choice(a|b|both|skip),
                       item_status (снимок статуса на момент ответа), answered_at, cancelled_at   -- FSM ежедневного
                       задания (ADR 0024): активный issued — один на аккаунт, выдача идемпотентна, replay — по
                       judgment_id; учтённая дуэль — одна в сутки по Уфе (по answered_at)
```

Сбросить мир с голосами можно только пересозданием базы: `pnpm demo:reset` (dev) и `e2e/run.mjs` (своя база `<имя>_e2e`).

### 1.2. Контент и обучение

```
courses / units / lessons     иерархия курса; unit: place_slug, culture_card_id, order
lexemes                       id, lemma_ba, forms jsonb, pos, audio_id, frequency_rank
constructions                 id, pattern, explanation_ru, explanation_ba
exercises                     id, lesson_id, type, payload jsonb (по JSON-схеме типа),
                              difficulty_elo, skills[], source_item_id?
media                         id, kind(audio|image|rive), s3_key, speaker_id?, license, duration
content_releases              id, version, manifest jsonb, published_at  -- офлайн-пакеты
attempts                      id(клиентский UUIDv7), account_id, exercise_id, answer jsonb,
                              verdict(correct|almost|wrong|pending_review), latency_ms,
                              client_ts, server_ts, session_id                 [секции/мес.]
skill_ratings                 account_id, skill_id, elo, n
srs_cards                     account_id, word_id (content.words.id), stability, difficulty, reps, lapses,
                              last_review_on, due_on (сутки Уфы), fsrs_version        -- M2b, модуль learning
srs_reviews                   id, account_id, word_id, run_id, attempt_id?, rating(1-4), reviewed_on,
                              elapsed_days, stability, difficulty, due_on             -- только вставка
words                         course_id, id (ключ слова), text, review, translation_ru, audio jsonb,
                              sources, lesson_id                                       -- M2b, модуль content
daily_missions                account_id, date, cells jsonb, completed_cells, finished_at
```

> **Озвучка (M2 → день 5).** Записи носителей (Commons / Lingua Libre, 35) лежат в `content/audio`,
> синтез башкирского (Silero `v5_cis_base_nostress`, 172 строки без записи, MIT) — в `content/audio/tts`;
> копии обоих — `apps/web/public/audio` (`prepare-audio.mjs`, AAC m4a + Ogg). В `words.audio`/упражнениях —
> путь на своём сайте (`/audio/<id>.m4a`) и `source` с происхождением: синтез помечен источником
> `silero-tts-v5-cis` (sources.yaml) — синтез ≠ запись носителя; запись всегда предпочтительнее синтеза.

### 1.3. Мотивация и соревнование

```
xp_ledger                     id, account_id, amount, reason, ref_id, status(pending|
                              final|revoked), created_at                       -- «мёд созревает» = pending
streaks                       account_id, current, longest, freezes_left, last_day
achievements                  account_id, code, earned_at
leagues / league_members      неделя, тир (clover..linden), группа, участник, очки, итог
hive_index                    entity_type(class|school|district), entity_id, period,
                              participation, progress, contribution, value, flags
seasons, class_quests         сезон, цель, прогресс, награда
battles / battle_rounds       live-сессии урок-битв и их итоги
```

### 1.4. Корпус и консенсус

```
source_items                  id, lang, text, text_norm, kind(word|phrase|sentence|term),
                              domain, difficulty, origin, license, priority, order_id?,
                              embedding vector, status
variants                      id, source_item_id, lang, text, text_norm, author_account_id?,
                              origin(human|import|mt|llm), parent_variant_id?, tags[],
                              created_at
judgments                     id, source_item_id, variant_id?, variant_b_id?, judge_account_id,
                              type(approve|reject|unsure|pairwise|edit|flag|expert_decision),
                              outcome jsonb, is_gold, latency_ms, weight_snapshot, rules_version,
                              created_at                                        [секции, только вставка]
reliability                   account_id, slice(direction:domain), alpha_a, alpha_b,
                              beta_a, beta_b, n_gold, n_resolved, updated_at
item_state                    source_item_id, status, accepted_variant_ids[], main_variant_id,
                              scores jsonb (P(v), BT), confidence, decided_by(rule|expert),
                              reason jsonb, rules_version, updated_at
gold_items                    variant_id, truth(correct|incorrect), created_by_expert_id
escalations                   id, source_item_id, reason, assigned_expert_id, sla_due, resolved_at
orders                        id, partner_id, title, status, priority, due_at, require_expert
releases                      id, version, stats jsonb, files jsonb (s3 keys + sha256), changelog
```

### 1.5. Партнёры, уведомления, служебное

```
partners, api_keys(hash, scopes[], quota_tier), webhooks(url, secret_hash, events[])
notification_prefs(account_id, channels, quiet_hours, frequency)
outbox(id, aggregate, type, payload, created_at, dispatched_at)
audit_log(id, actor_id, action, target, ip_hash, at)                            -- только вставка
feature_flags(key, rules jsonb)
```

### 1.6. Аналитика (ClickHouse)
События клиентов и сервера без ПДн: `account_id` заменён на ключ, псевдонимизированный солью, которая меняется раз в учебный год для аналитических выгрузок; школа/район/класс хранятся как атрибуты для агрегатов. Сроки хранения сырых событий — 13 месяцев, агрегатов — бессрочно.

## 2. Внутренний API (для собственных клиентов)

Базовый путь `/api/v1`. Источник правды — `packages/contracts/openapi.yaml`. API валидирует запросы по его JSON-копии (`@teletau/contracts/openapi.json`) и берёт оттуда правила доступа `x-access`.

- **Аутентификация** — Bearer access-токен: JWT ES256, 15 мин (ADR 0015). Refresh-токен `ttr_…` одноразовый: он ротируется при каждом обновлении, повторное предъявление отзывает всё семейство. Исключение — льготное окно потерянного ответа: повтор с того же устройства в течение 60 с, пока преемник не использован, выдаёт новую пару (ADR 0015 §2).
- **Ошибки** — RFC 9457 (`application/problem+json`). Машиночитаемая причина — поле `code`, у 422 есть `errors[].pointer` и `errors[].detail` (по-русски, для показа человеку), у 429 и 409 `request_in_progress` — заголовок `Retry-After`. `title` всегда по-русски, в том числе у встроенных ошибок фреймворка (неизвестный маршрут, битый URL, 413).
- **`Retry-After` — обязателен к учёту во всех клиентах** (веб, консоль, Telegram Mini App, iOS M6, Android M7; M1-55). Клиент читает заголовок (число секунд или дата HTTP) и не заменяет его своим «подождите минуту». API открывает его в CORS (`Access-Control-Expose-Headers`), BFF веба передаёт как есть.
  - **Короткий 429** — `rate_limited` с `Retry-After` ≤ 5 с: сервер отклонил запрос только из-за попыток, которые ещё проверяются (ADR 0016, M1-36), это очередь, а не блокировка. Отклонённый запрос ничего не создал, поэтому вход по QR (`POST /auth/qr`) и заявку по коду класса (`POST /auth/class-code`) клиент повторяет молча: до двух раз, пауза — `Retry-After` плюс случайные 0–250 мс. Не помогло — текст «Секунду, сейчас много входов — попробуй ещё раз» (взрослым — на «вы»).
  - **Длинный 429** (`Retry-After` > 5 с или без заголовка) — без автоповтора, текст «Подожди минуту и попробуй снова».
  - **Свои коды 429 не повторяются автоматически**, даже с коротким `Retry-After`: `join_queue_full` (в классе 40 заявок ждут решения — текст ребёнку «Учитель уже разбирает много заявок. Подожди немного и попробуй снова.»), `staff_locked`.
  - Эталон — `packages/session` (`ApiProblem.retryAfter`, `isShortRateLimit`, `withShortRetry`) и его тесты `test/retry.test.ts`.
- **Управляющие символы** (C0, кроме `\t`, `\n`, `\r`; DEL; C1) в любой строке тела, query, пути и заголовков-параметров — 422 `validation_failed` до выполнения операции (ADR 0015, уточнения раунда 2).
- **Пагинация** — курсорная (`limit`, `cursor` → `nextCursor`). Курсор проверяется схемой своего эндпоинта, битый — 422. Клиент запрашивает следующую страницу одним запросом за раз (кнопка «Показать ещё» на время загрузки — в состоянии загрузки), добавляет элементы без дублей по `id` и отбрасывает страницу, если список за это время сменился (M1-50; веб и консоль — `useCursorList` из `packages/session`).
- **Идемпотентность** — заголовок `Idempotency-Key` (сутки) у `POST /classes`, `POST /classes/{id}/seats` и `POST /classes/{id}/seats/{seat}/reissue`. Пока первый запрос выполняется, повтор — 409 `request_in_progress`; тот же ключ с другим телом — 422 `idempotency_key_reused`.
- **Доступ** — правило `x-access` у каждой операции. Аноним и чужая роль отсекаются до разбора тела (хук `onRequest`), политики ресурса проверяют сервисы модулей (ADR 0017).
- **Вход в вебе и консоли** идёт через BFF Next.js (`/api/session/{qr|otp|class-code|class-code-status|refresh|logout}`): refresh-токен живёт только в httpOnly-cookie BFF, браузер получает access-токен (ADR 0015 §3). Остальные вызовы браузер делает в API напрямую (CORS: `PUBLIC_WEB_URL`, `PUBLIC_CONSOLE_URL`).
- **IP для ограничений частоты** — `request.ip` Fastify. BFF передаёт IP браузера в `X-Forwarded-For`; API доверяет заголовку только от адресов из `TRUST_PROXY` (dev — `loopback`, прод — подсети балансировщика и BFF или число хопов). Иначе все ученики за сервером Next делили бы один лимит.
- **Свободный текст** (ФИО, должность, причина отказа, литера класса, названия из справочника) приводится к канонической форме `@teletau/bashkir-text` до записи; поиск школ сравнивает свёртку пакета (`fold`; в SQL — `translate()` по его таблице `FOLD_MAP`).

**Операции.** Группы с пометками M1 и M2 реализованы, остальные — план:

| Группа | Эндпоинты (основные) |
|---|---|
| Auth (M1) | `POST /auth/qr` (вход по QR-карточке) · `POST /auth/class-code` (заявка по коду класса) · `GET /auth/class-code/{requestId}` (опрос с `X-Poll-Token`; с `X-Device-Install-Id` устройства заявки — повторная выдача потерянной сессии; вход на место закрыт — 403 `consent_revoked` или `class_archived`, как у QR) · `POST /auth/otp/request` · `POST /auth/otp/verify` (+ `totp` для сотрудников) · `POST /auth/refresh` · `POST /auth/logout`; позже — `POST /auth/oauth/{provider}`, `POST /auth/link-telegram` |
| Me (M1) | `GET /me` · `PATCH /me` (ник из словаря, режим UI, язык) · `GET /nicknames/suggest` (M2: `GET /me/progress` — в группе Progress); позже — `GET /me/ornament`, `DELETE /me` |
| Consent (M1) | `GET /legal-documents/current` · `GET /legal-documents/{kind}/{version}` (текст версии по абзацам; его показывает страница веба `/legal/{kind}/{version}`) · `POST /consents` · `POST /classes/{id}/seats/{seat}/paper-consent` · `POST /consents/{id}/revoke` |
| Org (M1) | `GET /districts` · `GET /schools?district=&q=` · `POST /classes` · `GET /classes` · `GET /classes/{id}` · `POST /classes/{id}/seats` · `GET /classes/{id}/cards.pdf?printJob=` · `POST /classes/{id}/seats/{seat}/reissue` · `POST /classes/{id}/join-code` · `DELETE /classes/{id}/join-code` (погасить код сразу) · `GET /classes/{id}/join-requests` · `POST /classes/{id}/join-requests/{rid}/approve` / `reject`; позже — `POST /classes/{id}/transfer` |
| Teacher (M1) | `POST /teacher/verification` · `GET /teacher/verification` |
| Moderation | M1: `GET /moderation/teacher-verifications` · `POST /moderation/teacher-verifications/{id}/approve` / `reject`; позже — `GET /moderation/reports`, `POST /moderation/actions` |
| Admin (M1) | `GET /admin/audit-log` (moderator, admin) |
| Learning (M2) | `GET /course` (тропа: юниты, места, узлы `done/current/open/locked`) · `POST /lessons/{lessonId}/runs` (`runId` клиента; упражнения без ключей, стороны дуэли — в случайном порядке; «Помоги языку» с исчерпанным пулом — забег без упражнений) · `POST /lesson-runs/{runId}/attempts` (`attemptId` клиента → вердикт `correct/almost/typo/wrong`, буква-подсказка; у дуэли — `recorded`) · `POST /lesson-runs/{runId}/complete` (мёд, точность, время, новые слова, серия, непросмотренный итог лиги); позже — `GET /missions/today`, `GET /phrase-of-day` |
| Что в уроке (M2) | `GET /lessons/{lessonId}/preview` (только учитель: новые слова урока с переводом и записью, фразы, виды заданий со счётом; у дуэлей — только вид и число, без вариантов; узел закрытого места тоже) |
| Content | позже — `GET /units/{id}` · `GET /content/packs/{version}` (подписанный пакет); в M2 курс загружает `content:import` |
| Progress (M2) | `GET /me/progress` (мёд начисленный и «созревает», серия, лига, уроки, слова, голоса) · `GET /classes/{id}/progress` (учитель класса: по номерам мест, сводка недели, прохождение уроков) |
| SRS (M2b) | `POST /reviews/runs` (забег повторения из слов, срок которых наступил: до 8 слов, первая попытка обновляет карточку FSRS-6; повторять нечего — забег без упражнений) · `GET /me/words` («Мой словарь»: слово, перевод, «выучено» / «повторить»); сколько слов ждут — `review.due` в `GET /course`. Ответы и итог — общие `POST /lesson-runs/{runId}/attempts` и `/complete`. Векторы — `contracts/test-vectors/srs` |
| Награды (M2) | `GET /me/achievements` (12 наград: название, что сделать, значок, день получения или прогресс «3 из 7»; пересчитываются из истории, отдельной таблицы нет) · новые — в `newAchievements` итога `POST /lesson-runs/{runId}/complete`. Векторы — `contracts/test-vectors/achievements` |
| Corpus (M2) | `GET /corpus/duels` (взрослый: пары, где голосование идёт, без своих голосов) · `POST /corpus/judgments` (голос взрослого или учителя вне урока; дети голосуют только в уроке) · `GET /corpus/items/{id}/votes` (голоса по группам и статус — после своего голоса) · `GET /corpus/my-cells` («Мой вклад»: созрело / ждёт); позже — `GET /corpus/tasks`, `POST /corpus/variants`, `POST /corpus/reports` |
| Competition (M2) | `GET /leagues/current` (тир, группа, зоны, конец недели по Уфе, итог прошлой недели) · `POST /leagues/result-seen` · `GET /classes/{id}/hive` (квест недели и участие — только агрегаты); позже — `GET /ratings/schools`, `GET /ratings/districts`, урок-битвы |
| Telegram (M2) | `POST /telegram/link` (привязка чата из Mini App: проверка подписи initData токеном бота; вошедший ученик или взрослый). Служебные операции бота — роль `service` (заголовок `X-Service-Token`, ADR 0020/0024): `GET /telegram/bot/chats/{chatId}` · `PUT /telegram/bot/chats/{chatId}/reminders` · `DELETE /telegram/bot/chats/{chatId}` (отвязка) · `POST /telegram/bot/chats/{chatId}/daily-duel` (выдать задание дня — идемпотентно) · `POST /telegram/bot/dialogs/{dialogId}/answer` (replay той же кнопки — тот же ответ; другой выбор — 409 `already_voted`) · `POST /telegram/bot/chats/{chatId}/daily-duel/cancel` · `POST /telegram/bot/reminders/claim` (пачка «кому напомнить») |
| Ministry (M2) | `GET /ministry/summary` · `GET /ministry/districts` · `GET /ministry/districts/{districtId}` (агрегаты республики; школы < 5 учеников скрыты сервером — ADR 0023) |
| Fund (M2) | `GET /fund/dictionary` (принятые пары с голосами по группам — ADR 0023) · `GET /fund/escalated` (спорные случаи: `item_state.status = escalated`, голоса по группам — ТЗ §4.4/§5) |
| Public (M2) | `GET /public/phrase-of-day` (фраза дня — ТЗ §3.6: аноним, без привязки; детерминированный выбор из принятых основных вариантов — FNV-1a учебных суток по Уфе, в полночь по Уфе пара меняется; лендинг и `/phrase` бота) · `GET /public/dictionary` (ТЗ §5: публичная выгрузка словаря — принятые пары анонимно, `format=json\|csv`, `status=confirmed\|expert_review`; CSV для Excel — «;» и BOM) · `GET /public/leaderboard` (ТЗ §4.5: доска почёта школ и классов за день/неделю/месяц/год по Уфе; только агрегаты, малые группы скрыты — ADR 0023) |
| Teacher | `GET /classes/{id}/heatmap` · `POST /classes/{id}/assignments` · `GET /classes/{id}/insights` (AI-сводка) · `GET /classes/{id}/report.xlsx` |
| Parent | `POST /guardianships` · `GET /children/{id}/progress` · `PATCH /children/{id}/limits` |
| Expert | `GET /expert/queue` · `POST /expert/decisions` · `GET /expert/items/{id}` (с историей и сводкой спора) · `POST /expert/gold` |
| Sync | `POST /sync/push` · `GET /sync/pull?cursor=` |
| AI | `POST /ai/explain` · `POST /ai/hint` (лимиты по роли/возрасту) |
| Analytics | `POST /events` (пачки клиентских событий) |
| Realtime | `WS /realtime` — каналы `battle:{code}`, `class:{id}:hive` |

## 3. Публичный API (`/public/v1`)

Для Фонда, школ, разработчиков. Аутентификация — API-ключ (`Authorization: ApiKey …`) или OAuth2 client credentials для крупных партнёров. Документация — интерактивная (Redoc/Scalar) на портале партнёра.

| Метод | Путь | Описание |
|---|---|---|
| GET | `/entries?q=&dir=ru-ba&fuzzy=true&domain=&tags=` | Поиск подтверждённых пар |
| GET | `/entries/{id}` | Пара с принятыми вариантами, метками и `provenance` |
| GET | `/terms?domain=` | Термины, подписанные экспертами |
| POST | `/tm/lookup` | Память переводов: нечёткие совпадения для списка сегментов (для переводчиков и CAT-инструментов) |
| GET | `/releases` · `/releases/{version}` | Релизы датасета, ссылки на файлы, контрольные суммы, отчёт о качестве |
| POST | `/orders` · GET `/orders/{id}` | Заказ переводов (CSV/JSON), статус и результаты |
| — | Вебхуки | `entry.accepted`, `entry.updated`, `entry.revoked`, `order.progress`, `order.completed`, `release.published` (подпись HMAC-SHA256, повторы с экспоненциальной задержкой) |
| GET | `/stats` | Открытая статистика корпуса |

**Тарифы квот** (ограничения запросов, не обязательно платные): `open` (без ключа, 60 запр./мин, только поиск), `partner` (1 000 запр./мин), `foundation` (без жёсткого лимита, приоритет).

> **MVP.** До портала партнёра выгрузка словаря доступна анонимно и без ключей: `GET /api/v1/public/dictionary` (ТЗ §5) — JSON или CSV, те же принятые пары, что у Фонда, но без голосов по группам. Языковая пара в MVP одна — `ba-ru` (башкирский ← русский): поле `langPair` в контракте готово к расширению, контент и корпус других пар — после пилота. Аудио-фрагменты с таймкодами (привязка примеров употребления к записям речи) — задел: в выгрузке их нет, схема источников (`SourceCitation`) позволяет добавить `locator` с таймкодом без ломающих изменений.

### Пример ответа `/entries/{id}`

```json
{
  "id": "01J9Z…",
  "source": { "lang": "ru", "text": "Добро пожаловать!", "kind": "phrase", "domain": "everyday" },
  "variants": [
    { "text": "Рәхим итегеҙ!", "main": true, "tags": ["literary"], "confidence": 0.993 }
  ],
  "provenance": {
    "status": "accepted",
    "decided_by": "rule",
    "rules_version": "2027.1",
    "votes_by_group": {
      "child":   { "for": 6, "against": 1, "unsure": 1, "duel_share": 0.58 },
      "teacher": { "for": 2, "against": 0, "unsure": 0, "duel_share": 0.80 },
      "adult":   { "for": 3, "against": 0, "unsure": 0, "duel_share": 0.75 },
      "expert":  { "for": 0, "against": 0, "unsure": 0 }
    },
    "schools_count": 4,
    "accepted_at": "2027-02-11T09:12:00+05:00"
  },
  "license": "указывается по решению правообладателя",
  "release": "2027.03.0"
}
```

> Пример башкирского варианта приведён для иллюстрации формата и должен быть проверен носителем.

## 4. Форматы релиза датасета

| Файл | Содержание |
|---|---|
| `pairs.jsonl` | Одна пара на строку: исходник, все принятые варианты, метки, уверенность, provenance (агрегированный) |
| `pairs.tsv` | Упрощённо: `ru \t ba \t tags \t confidence` (основной вариант) |
| `pairs.tmx` | TMX 1.4b для CAT-инструментов |
| `terms.xlsx` | Терминология для Фонда |
| `manifest.json` | Версия, дата, количество, SHA-256 файлов, лицензия, правила консенсуса, отчёт о качестве |
| `CHANGELOG.md` | Добавлено / изменено / отозвано |

## 5. Версионирование и совместимость

- Внутренний API: `/api/v1`, обратная совместимость в пределах мажорной версии; поля только добавляются. Мобильным клиентам — поддержка двух последних мажорных версий приложения; принудительное обновление ниже минимальной.
- Публичный API: `/public/v1` со сроком поддержки ≥ 12 месяцев после выхода v2, заголовки `Deprecation`/`Sunset`.
- Схемы событий (outbox, аналитика, WebSocket) — JSON Schema в `packages/contracts/events/`, версия в каждом сообщении.
