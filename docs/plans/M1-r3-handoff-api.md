# M1, раунд 3 — передача работы агента API

> **Закрыто:** оставшиеся шаги доделаны координатором, `verify.sh` на Node 24 зелёный целиком. Файл — история работы.

Состояние на момент остановки: все правки согласованы. Код компилируется. Фоновых процессов нет. Миграций нет.

Последние прогоны (Node 24):
- `pnpm --filter @teletau/api typecheck` и `lint` (с границами модулей) — зелёные;
- `pnpm --filter @teletau/api test` — 91/91;
- `pnpm --filter @teletau/api test:integration` — 175/175, **один прогон**: 154 старых и 21 новый;
- `pnpm --filter @teletau/contracts generate`, `build` и `pnpm contracts:check` — зелёные;
- `pnpm --filter @teletau/web typecheck` и `lint` — зелёные.

После последнего прогона менялись только документы: ADR 0015, ADR 0016, `docs/07-data-and-api.md`.

Новые тесты — `apps/api/test/integration/m1-round3.test.ts`, 21 тест. На коде до исправления 20 из них падали. 21-й — страховка от регресса: «неудачи исчерпаны → `Retry-After` — остаток окна».

## M1-35 [P1] — готово
- **Что сделано.** Вход на место проверяет одна функция — `ClassesService.admitSeat(tx, seatId, cardHandle?)` в `apps/api/src/modules/org/classes.service.ts`. Порядок проверок как в ADR 0016 §5: карточка действует → класс не в архиве → согласие не отозвано. Проверка идёт под рекомендательной блокировкой места `ClassPolicy.lockSeat`; порт `ClassAccessPort.lockSeat` описан в `src/common/ports.ts`.
  - Кто вызывает проверку:
    - QR — `StudentLoginService.loginWithQr`, внутри транзакции выдачи;
    - опрос заявки — `JoinService.poll` (`org/join.service.ts`), и первая выдача, и повторная. Заявка перечитывается `FOR UPDATE` под блокировкой. Срок выдачи сравнивается с `statement_timestamp()` Postgres.
  - Отзыв всех сессий закрывает выдачу. `AccountsService.revokeAllSessions` (`identity/accounts.service.ts`) сначала вызывает `JoinGrants.close(tx, accountId)`, потом отзывает сессии. `JoinGrants` — новый провайдер в `org/join-grants.ts`, без зависимостей, поэтому цикла DI нет. Он экспортирован из `org/index.ts`, `org.module.ts`.
  - Отзыв согласия (`consent/consent.service.ts`, `revoke`) теперь сначала блокирует место через порт. Ученика места он читает уже в транзакции: у `seatInfo` и `isSeatBlocked`/`seatConsents` появился параметр `db`.
- **Контракт.** У `getClassCodeLoginStatus` добавлен ответ `403` и описание.
- **Веб.** `apps/web/app/student/wait/page.tsx`: при 403 опрос останавливается, заявка удаляется. Показывается EmptyState с кнопкой «Выйти».
  - `class_archived` — текст из `describeProblem`.
  - `consent_revoked` — свой текст: «Вход в этот класс закрыт. Подойди к учителю.» Общий текст «…по этой карточке…» не подходит: ученик входил по коду, а не по карточке.
  - `ticket.ts` не менялся.
- **Тесты** (`M1-35` в `m1-round3.test.ts`), все зелёные:
  - отзыв согласия → повторный опрос 403;
  - выпуск карточки и повторный выпуск → повторный опрос без сессии;
  - отзыв до первого опроса → 403;
  - архив → 403;
  - гонки «повторные опросы против отзыва» и «вход по QR против отзыва» → живых сессий 0.
- **Осталось.**
  - Веб-агенту: тест на моках для 403 на странице ожидания. Мок `apps/web/test/e2e/mock-api.ts`, ветка `class-code-status`, сейчас не умеет отдавать 403.
  - `pnpm --filter @teletau/web build` и `test:a11y` после правки страницы ожидания **не запускались**.

## M1-36 [P2] — готово
- **Что сделано.** `apps/api/src/infra/rate-limiter.ts` переписан. Два счётчика в одном Lua-скрипте:
  - F — неудачи в окне, ключ `rl:<key>`;
  - P — попытки «в работе», sorted set `rl:<key>:inflight` со сроком 10 с у каждой попытки (`INFLIGHT_TTL_MS`).

  Слот выдаётся, если F + P < max. API явное: `Reservation.fail()` или `release()`; исключение посередине неудачей не считается. Если мешает только P, сервер ждёт до 2 с (`INFLIGHT_WAIT_MS`) и отвечает 429 с `Retry-After: 1`. Если F ≥ max — 429 с остатком окна.
- **`student-login.service.ts`.**
  - QR: `checkCard` с `try/finally`.
  - Код класса: `CLASS_CODE_DEVICE_FAILURES` 10/мин на `device.installId`, `CLASS_CODE_IP_FAILURES` 100/мин на IP, `CLASS_CODE_IP_REQUESTS` 300/мин (было 120).
  - Опрос: неверный токен → `fail()`.
- **Документы.** ADR 0016 (§5, §6 с обоснованием 32⁶ и т. д., фраза про NAT, уточнения раунда 2), ADR 0015 (§4 и уточнения раунда 2), `docs/07` (ключи `rl:*`).
- **Тесты.**
  - Новые, в `m1-round3.test.ts`:
    - 30 одновременных верных QR → 30 × 200;
    - класс из 30 после 10 опечаток → 30 × 202;
    - пачка неверных → ровно 100 на IP и 10 на устройство;
    - `Retry-After: 1`;
    - ожидание освободившегося слота;
    - исключение — не неудача.
  - Обновлён `m1-round2.test.ts`: «300 кодов → 100/200» с пояснением. Старые тесты 20/40, 10/30 и 4 × `otp_invalid` зелёные.

## M1-37 [P2] — готово
- **Что сделано.** `ClassesService.reissue` отзывает сессии и закрывает выдачу при любой версии карточки, если на месте есть аккаунт. В аудите `sessionsRevoked` есть при любой версии. Место блокируется, ученик перечитывается под блокировкой.
- **Тест:** `M1-37` в `m1-round3.test.ts`, зелёный.
- **Осталось (веб-агенту):** текст `SeatDialog.tsx`. Теперь обещание «Ученик выйдет на всех устройствах» верно и для `cardStatus: none`.

## M1-40 [P3] — готово
- **Что сделано.**
  - `apps/api/src/common/control-chars.ts`: `hasControlChars`, `findControlChars`.
  - Хук `preValidation` в `apps/api/src/bootstrap.ts` (`controlCharsPointer`). Он проверяет тело, query, путь и заголовки-параметры операции из схемы маршрута. Ответ — 422 `validation_failed` с указателем и текстом «Недопустимые управляющие символы» до проверки схемы и до обработчика.
  - `\t`, `\n`, `\r` допустимы. Однострочные поля отклоняет `common/text.ts`.
- **Контракт:** абзац в `info.description`.
- **Тесты** в `m1-round3.test.ts`, зелёные:
  - воспроизведения QA: поиск, QR, код из письма не сгорает, журнал аудита;
  - C1 и DEL;
  - матрица по всем операциям `contractOperations()`: тело, query, путь, заголовки.

## M1-41 [P3] — готово
1. **Перевыпуск.** У `reissueSeatCard` есть `Idempotency-Key` (`idempotency.run("reissueSeatCard:<classId>", …, fingerprint {seat})`, контроллер `classes.controller.ts`). В контракте — параметр и ответы 409/422.
   - PDF: если все карточки задания заменены — 410 `print_job_replaced` («Карточки этого задания уже заменены новым выпуском — скачайте PDF нового выпуска»); если задание истекло — по-прежнему `print_job_expired`.
   - Тесты зелёные.
2. **Проверка ФИО и должности.** `common/text.ts` переписан: управляющие символы → нормализация → символы → длина. Новая `normalizePosition`: ру/ба буквы, цифры, знаки препинания, хотя бы одна буква. Её вызывает `moderation/verification.service.ts`.
   - В контракте `minLength` у `fullName` (3 → 1) и `position` (2 → 1). Иначе ajv отвечал бы «Не короче…» раньше проверки символов. Настоящие минимумы проверяет сервер после нормализации, они записаны в описании полей. Изменение ослабляющее, не ломающее.
   - Тест зелёный.
3. **Встроенные ошибки.** `builtinCode` в `common/problem.filter.ts` даёт русские заголовки для `HttpException` и ошибок Fastify. Непредвиденная 500 теперь «Внутренняя ошибка». `frameworkErrors` в `bootstrap.ts` — без `error.message`.
   - Новые коды в `common/problem.ts` и в описании схемы Problem: `payload_too_large` (413), `print_job_replaced` (410).
   - Обновлены `test/health.e2e.test.ts` (+ тест 413) и ожидание 500 в `m1-round2.test.ts`.
   - Тесты зелёные.

## Что осталось сделать (по порядку)
1. Повторить `pnpm --filter @teletau/api test:integration` ещё дважды (просили три прогона без мигания; сделан один).
2. `pnpm --filter @teletau/web build` и `pnpm --filter @teletau/web test:a11y`. Страница ожидания поменялась, на моках её не проверяли.
3. Корневые `pnpm lint` и `pnpm typecheck`. Не запускались: в вебе и консоли параллельно работал другой агент.
4. Веб-агенту:
   - новые коды `print_job_replaced` (ADULT-текст в `packages/session/src/problem.ts`) и `payload_too_large`;
   - 403 `consent_revoked`/`class_archived` у опроса заявки;
   - текст `SeatDialog` (M1-37);
   - `CHILD.consent_revoked` говорит про карточку — для кода класса не подходит;
   - тест на моках для 403 на странице ожидания.

## Известные поломки
Нет. Риск: e2e (`pnpm e2e`) с новым кодом не прогонялся.
