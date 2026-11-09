// Подмена API и BFF сессии сетевыми моками Playwright по контракту (типы — @teletau/contracts).
// Сквозные тесты с настоящим API — в e2e/; здесь — экраны и их доступность.
import type { Page, Route } from "@playwright/test";
import type { Problem, Schema } from "@teletau/contracts";
import { applyCompletion, judge, learnWorld, type LearnWorld } from "./mock-learn";
import { completeJump, jumpAttempt } from "./mock-jump";
import { ASSIGNMENT_OPTIONS, LESSON_PREVIEWS, demoAssignmentsWorld, demoSeatCard, newAssignment, studentNumbers, tallyVotes, teacherWorld, type TeacherWorld } from "./mock-teacher";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Me = Schema<"Me">;

const iso = (offsetMs = 0) => new Date(Date.parse("2026-11-03T09:12:00Z") + offsetMs).toISOString();
const now = () => new Date().toISOString();
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

export const SCHOOL: Schema<"SchoolRef"> = { id: "0193f7a4-0000-7000-8000-00000000a001", shortNameRu: "Школа № 7", districtId: "0193f7a4-0000-7000-8000-00000000d001" };
export const CLASS_ID = "0193f7a4-0000-7000-8000-00000000c005";
export const FOREIGN_CLASS_ID = "0193f7a4-0000-7000-8000-00000000c999";
export const SECOND_CLASS_ID = "0193f7a4-0000-7000-8000-00000000c006";

export const NICKS = [
  "Смелая пчела",
  "Ловкий шмель",
  "Тихая липа",
  "Быстрый курай",
  "Ясный ручей",
  "Звонкий жаворонок",
  "Добрый барсук",
  "Мудрая сова",
  "Весёлый хомяк",
  "Сонный ёжик",
  "Тёплый ветер",
  "Зоркий сокол",
];

export function childMe(overrides: Partial<Me> = {}): Me {
  return {
    id: "0193f7a4-0000-7000-8000-0000000c0007",
    kind: "child",
    roles: ["student"],
    locale: "ru",
    uiMode: "bortnik",
    teacherStatus: "none",
    nickname: "Смелая пчела",
    classes: [{ id: CLASS_ID, title: "5 «Б»", schoolName: "Школа № 7", role: "student", seatNumber: 7 }],
    pendingConsents: [],
    ...overrides,
  };
}

export function adultMe(overrides: Partial<Me> = {}): Me {
  return {
    id: "0193f7a4-0000-7000-8000-0000000a0001",
    kind: "adult",
    roles: ["teacher"],
    locale: "ru",
    teacherStatus: "verified",
    classes: [{ id: CLASS_ID, title: "5 «Б»", schoolName: "Школа № 7", role: "teacher" }],
    profile: { email: "teacher@school7.example", fullName: "Учитель Демонстрационный" },
    pendingConsents: [],
    ...overrides,
  };
}

const DISTRICTS: Schema<"District">[] = [
  { id: "0193f7a4-0000-7000-8000-00000000d001", oktmo: "80701000", nameRu: "Уфа", kind: "urban_okrug" },
  { id: "0193f7a4-0000-7000-8000-00000000d002", oktmo: "80615000", nameRu: "Бурзянский район", kind: "municipal_district" },
  { id: "0193f7a4-0000-7000-8000-00000000d003", oktmo: "80602000", nameRu: "Абзелиловский район", kind: "municipal_district" },
  { id: "0193f7a4-0000-7000-8000-00000000d004", oktmo: "80613000", nameRu: "Белорецкий район", kind: "municipal_district" },
  { id: "0193f7a4-0000-7000-8000-00000000d005", oktmo: "80745000", nameRu: "Стерлитамак", kind: "urban_okrug" },
];

const SCHOOLS: Schema<"School">[] = [
  { id: SCHOOL.id, districtId: SCHOOL.districtId, nameRu: "Муниципальное бюджетное общеобразовательное учреждение «Школа № 7»", shortNameRu: "Школа № 7", address: "ул. Ленина, 1", isDemo: false },
  { id: "0193f7a4-0000-7000-8000-00000000a002", districtId: SCHOOL.districtId, nameRu: "Гимназия № 3", shortNameRu: "Гимназия № 3", address: "ул. Пушкина, 10", isDemo: false },
  { id: "0193f7a4-0000-7000-8000-00000000a003", districtId: SCHOOL.districtId, nameRu: "Демонстрационная школа", shortNameRu: "Демонстрационная школа", isDemo: true },
];

const DOCS: Schema<"LegalDocument">[] = [
  { id: "0193f7a4-0000-7000-8000-0000000f0001", kind: "terms", version: "2026-11-01", title: "Пользовательское соглашение", url: "/legal/terms", effectiveFrom: iso() },
  { id: "0193f7a4-0000-7000-8000-0000000f0002", kind: "privacy", version: "2026-11-01", title: "Политика обработки персональных данных", url: "/legal/privacy", effectiveFrom: iso() },
  { id: "0193f7a4-0000-7000-8000-0000000f0003", kind: "consent_adult", version: "2026-11-01", title: "Согласие на обработку персональных данных", effectiveFrom: iso() },
];

export function seats(total = 24, joined = 12): Schema<"Seat">[] {
  return Array.from({ length: total }, (_, i) => {
    const number = i + 1;
    const seat: Schema<"Seat"> = { number, cardStatus: number === 5 ? "revoked" : "active", cardVersion: number === 5 ? 2 : 1, cardIssuedAt: iso(-86_400_000) };
    if (number <= joined) {
      seat.student = { accountId: `0193f7a4-0000-7000-8000-0000000s00${String(number).padStart(2, "0")}`, nickname: NICKS[i % NICKS.length]!, joinedAt: iso(-3_600_000) };
      if (number === 5) seat.cardStatus = "active";
    }
    if (number % 3 === 0) seat.consent = { consentId: `0193f7a4-0000-7000-8000-0000000e00${String(number).padStart(2, "0")}`, status: number === 9 ? "revoked" : "given", documentVersion: "2026-11-01", givenAt: iso(-172_800_000) };
    return seat;
  });
}

export function classDetail(overrides: Partial<Schema<"ClassDetail">> = {}): Schema<"ClassDetail"> {
  return {
    id: CLASS_ID,
    title: "5 «Б»",
    grade: 5,
    letter: "Б",
    program: "native",
    academicYear: 2026,
    school: SCHOOL,
    myRole: "teacher",
    seats: seats(),
    pendingJoinRequestCount: 2,
    ...overrides,
  };
}

export interface World {
  /** Что вернёт BFF на refresh: аккаунт (вошёл) или null (нет сессии). */
  account: Me | null;
  /** GET /me, если отличается от account. */
  me?: Me;
  classes: Schema<"ClassSummary">[];
  classDetail: Schema<"ClassDetail">;
  /** Другие классы учителя по id (главная кабинета); остальные id — classDetail. */
  classDetails: Record<string, Schema<"ClassDetail">>;
  joinRequests: Schema<"JoinRequest">[];
  verification: Schema<"TeacherVerification"> | null;
  /** Ответ на вход по QR. */
  qr: { ok: true; account: Me } | { ok: false; status: number; code: string };
  /** Кого впускает вход по коду из письма (BFF otp): например, ребёнка с привязанной почтой. Нет — нового взрослого. */
  otpAccount?: Me;
  /** Постоянный код класса стенда показа (AUTH_DEMO_CLASS_CODE): «Показать код класса» выдаёт «000-000» на год. */
  permanentJoinCode?: boolean;
  /** Статусы заявки по коду класса при опросе (по очереди; последний повторяется). */
  joinStatuses: Schema<"JoinRequestStatus">[];
  /** Опрос заявки отвечает ошибкой (например, 403 consent_revoked — вход на место закрыт). */
  joinPollProblem?: { status: number; code: string };
  /** Что браузер прислал в BFF при входе по QR (поле payload) — проверка, что уходит сырая нагрузка `TT1.…`. */
  qrPayloads: string[];
  /** Сколько раз вызван выход (BFF /api/session/logout). */
  logouts: number;
  /** Ответ на обновление сессии, если она завершена сервером (например, card_reissued). */
  refreshProblem?: { status: number; code: string };
  /**
   * Сбои API по ключу «МЕТОД /путь» (без /api/v1, например `GET /me`): `offline` — запрос не дошёл до сервера,
   * иначе — Problem Details с этим статусом и кодом (и ошибками полей для 422). Тест может удалить ключ — «сеть вернулась».
   */
  failures: Record<string, Failure>;
  /**
   * Ответы BFF (/api/session/<действие>) по очереди: каждый вызов действия забирает первый ответ из списка, пустой
   * список — обычное поведение мока. `offline` — запрос не дошёл; иначе Problem Details (и `Retry-After`).
   */
  bffReplies: Record<string, BffReply[]>;
  /** Сколько раз вызвано каждое действие BFF. */
  bffCalls: Record<string, number>;
  /** Вызовы API по порядку: «МЕТОД /путь» (без /api/v1 и query). */
  calls: string[];
  /** Школы постранично: столько на странице и столько школ сверх трёх основных; ответ «Показать ещё» — с задержкой. */
  schoolPages?: { pageSize: number; extra: number; slowMs?: number };
  /** Ученик: тропа, урок, итог, лига, улей, вклад (mock-learn.ts). */
  learn: LearnWorld;
  /** Учитель: «Прогресс» класса и «Помогите языку» (mock-teacher.ts). */
  teacher: TeacherWorld;
  /** Задержка ответа API по ключу «МЕТОД /путь», мс (состояния загрузки). */
  delays?: Record<string, number>;
  /** «Учусь сам» (ADR 0022): личная карточка входа (null — ещё не выпущена), что прислал браузер в BFF self и card. */
  loginCard: Schema<"LoginCard"> | null;
  selfSignups: Array<{ nicknameId: string; ageBand: string; dailyGoal?: number }>;
  cardPayloads: string[];
  /** Статусы заявки «Вступить в класс» при опросе (по очереди; последний повторяется). */
  classJoinStatuses: Schema<"JoinRequestStatus">[];
}

export type Failure = "offline" | { status: number; code: string; errors?: Schema<"FieldError">[] };
export type BffReply = "offline" | { status: number; code: string; retryAfter?: number };

export function defaultWorld(): World {
  return {
    account: null,
    classes: [
      { id: CLASS_ID, title: "5 «Б»", grade: 5, letter: "Б", program: "native", academicYear: 2026, school: SCHOOL, myRole: "teacher", studentCount: 12, seatCount: 24 },
      { id: SECOND_CLASS_ID, title: "6 «А»", grade: 6, letter: "А", program: "state", academicYear: 2026, school: SCHOOL, myRole: "teacher", studentCount: 0, seatCount: 0 },
    ],
    classDetail: classDetail(),
    // 6 «А» — новый класс без мест и учеников: на главной у него следующий шаг, а не сводка.
    classDetails: { [SECOND_CLASS_ID]: classDetail({ id: SECOND_CLASS_ID, title: "6 «А»", grade: 6, letter: "А", program: "state", seats: [], pendingJoinRequestCount: 0 }) },
    joinRequests: [
      { id: "0193f7a4-0000-7000-8000-0000000b0001", status: "pending", nickname: "Тёплый ветер", createdAt: inMinutes(-2), expiresAt: inMinutes(13) },
      { id: "0193f7a4-0000-7000-8000-0000000b0002", status: "pending", nickname: "Зоркий сокол", createdAt: inMinutes(-1), expiresAt: inMinutes(14) },
    ],
    verification: {
      id: "0193f7a4-0000-7000-8000-0000000v0001",
      status: "pending",
      applicant: { accountId: "0193f7a4-0000-7000-8000-0000000a0001", email: "teacher@school7.example", fullName: "Учитель Демонстрационный" },
      school: SCHOOL,
      position: "Учитель башкирского языка",
      createdAt: iso(),
    },
    qr: { ok: true, account: childMe({ nickname: undefined }) },
    joinStatuses: ["pending"],
    qrPayloads: [],
    logouts: 0,
    failures: {},
    bffReplies: {},
    bffCalls: {},
    calls: [],
    learn: learnWorld(),
    teacher: teacherWorld(),
    loginCard: null,
    selfSignups: [],
    cardPayloads: [],
    classJoinStatuses: ["pending"],
  };
}

/** Ученик «Учусь сам» (ADR 0022): без класса, с карточкой входа или без неё. */
export function soloMe(overrides: Partial<Me> = {}): Me {
  return childMe({ id: "0193f7a4-0000-7000-8000-0000000c0042", nickname: "Мудрая сова", ageBand: "age_11_14", loginCard: "none", classes: [], ...overrides });
}

/** Карточка входа для мока: полезная нагрузка из векторов login-card (p001). */
export const DEMO_LOGIN_CARD: Schema<"LoginCard"> = { payload: "TP1.0123456789.ABCDEFGHJKMNPQRSTVWXYZ0123.4S", version: 1, issuedAt: "2026-11-05T06:00:00.000Z" };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, idempotency-key, x-poll-token, accept",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  // Как настоящий API (bootstrap.ts): Retry-After виден браузеру.
  "access-control-expose-headers": "retry-after, content-disposition, x-request-id",
};

const json = (route: Route, status: number, body: unknown, extra: Record<string, string> = {}) =>
  route.fulfill({ status, headers: { ...CORS, "content-type": "application/json", ...extra }, body: JSON.stringify(body) });

const problem = (route: Route, status: number, code: string, title = "Ошибка", extra: Record<string, string> = {}, errors?: Schema<"FieldError">[]) => {
  const body: Problem = { type: "about:blank", title, status, code, ...(errors ? { errors } : {}) };
  return route.fulfill({ status, headers: { ...CORS, "content-type": "application/problem+json", ...extra }, body: JSON.stringify(body) });
};

/**
 * BFF — тот же origin, что страница: как настоящий сервер Next.js, отвечает с заголовком Date по часам сервера
 * (часы теста). По нему клиент поправляет сбитые часы устройства (@teletau/session/clock).
 * API (другой origin) Date в CORS не открывает — как настоящий (Access-Control-Expose-Headers без date).
 */
const serverDate = () => ({ date: new Date().toUTCString() });

/** Access-токен в форме JWT (подпись не проверяется): клиент читает из него роли — снимок на момент выпуска. */
const fakeAccessToken = (account: Me) =>
  ["e30", Buffer.from(JSON.stringify({ sub: account.id, kind: account.kind, roles: account.roles })).toString("base64url"), "test-signature"].join(".");

const browserSession = (account: Me) => ({ accessToken: fakeAccessToken(account), accessTokenExpiresAt: inMinutes(15), account });

/** Подменить BFF (/api/session/*) и API (NEXT_PUBLIC_API_URL). Возвращает состояние мира — тест может его менять. */
export async function mockBackend(page: Page, init: Partial<World> = {}): Promise<World> {
  const w: World = { ...defaultWorld(), ...init };
  // Один мир класса: задания — по тем же ученикам (места с аккаунтом), что страница класса и «Прогресс», как у API.
  if (!init.teacher) w.teacher.assignments = demoAssignmentsWorld(studentNumbers(w.classDetail.seats ?? []));
  let nickRound = 0;
  let polls = 0;

  await page.route("**/api/session/*", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    const ok = (status: number, body: unknown) => json(route, status, body, serverDate());
    const fail = (status: number, code: string) => problem(route, status, code, "Ошибка", serverDate());
    w.bffCalls[action] = (w.bffCalls[action] ?? 0) + 1;
    const reply = w.bffReplies[action]?.shift();
    if (reply === "offline") return route.abort("internetdisconnected");
    if (reply) return problem(route, reply.status, reply.code, "Ошибка", { ...serverDate(), ...(reply.retryAfter !== undefined ? { "retry-after": String(reply.retryAfter) } : {}) });
    if (action === "refresh") {
      if (w.refreshProblem) return fail(w.refreshProblem.status, w.refreshProblem.code);
      return w.account ? ok(200, browserSession(w.account)) : fail(401, "refresh_invalid");
    }
    if (action === "logout") {
      w.account = null;
      w.logouts++;
      return route.fulfill({ status: 204, headers: serverDate() });
    }
    if (action === "qr") {
      w.qrPayloads.push((route.request().postDataJSON() as { payload: string }).payload);
      if (!w.qr.ok) return fail(w.qr.status, w.qr.code);
      w.account = w.qr.account;
      return ok(200, browserSession(w.account));
    }
    if (action === "self") {
      const body = route.request().postDataJSON() as { nicknameId: string; ageBand: Schema<"AgeBand">; dailyGoal?: number };
      w.selfSignups.push(body);
      const nickname = NICKS[Number(body.nicknameId.split(":")[1] ?? 0) % NICKS.length]!;
      const adult = body.ageBand === "adult";
      const mode = body.ageBand === "age_7_10" ? "bee" : body.ageBand === "age_11_14" ? "bortnik" : "keeper";
      w.account = adult
        ? adultMe({ id: "0193f7a4-0000-7000-8000-0000000a0042", roles: [], teacherStatus: "none", classes: [], profile: undefined, nickname, uiMode: "keeper", ageBand: "adult", loginCard: "none", pendingConsents: ["terms", "privacy", "consent_adult"], ...(body.dailyGoal ? { dailyGoal: body.dailyGoal } : {}) })
        : soloMe({ nickname, uiMode: mode, ageBand: body.ageBand, ...(body.dailyGoal ? { dailyGoal: body.dailyGoal } : {}) });
      return ok(200, browserSession(w.account));
    }
    if (action === "card") {
      const { payload } = route.request().postDataJSON() as { payload: string };
      w.cardPayloads.push(payload);
      if (!w.loginCard || payload !== w.loginCard.payload) return fail(401, "card_invalid");
      w.account = soloMe({ loginCard: "issued" });
      return ok(200, browserSession(w.account));
    }
    if (action === "otp") {
      const body = route.request().postDataJSON() as { code: string };
      if (body.code !== "0000") return fail(401, "otp_invalid");
      w.account = w.otpAccount ?? w.account ?? adultMe({ teacherStatus: "none", roles: [], classes: [], pendingConsents: ["terms", "privacy", "consent_adult"] });
      return ok(200, browserSession(w.account));
    }
    if (action === "class-code") {
      const body = route.request().postDataJSON() as { code: string };
      if (body.code !== "K7Q4MZ") return fail(404, "class_code_not_found");
      return ok(202, {
        requestId: "0193f7a4-0000-7000-8000-0000000r0001",
        pollToken: "poll-token-for-tests-0001",
        status: "pending",
        expiresAt: inMinutes(15),
        pollIntervalSeconds: 1,
        // Школу ответ на код класса не раскрывает (контракт ClassCodeLoginClass).
        class: { title: "5 «Б»", grade: 5, letter: "Б" },
      });
    }
    if (action === "class-code-status") {
      if (w.joinPollProblem) return fail(w.joinPollProblem.status, w.joinPollProblem.code);
      const status = w.joinStatuses[Math.min(polls++, w.joinStatuses.length - 1)]!;
      const base = { requestId: "0193f7a4-0000-7000-8000-0000000r0001", status, expiresAt: inMinutes(14), pollIntervalSeconds: 1 };
      if (status === "approved") {
        w.account = childMe({ nickname: "Тёплый ветер", classes: [{ id: CLASS_ID, title: "5 «Б»", schoolName: "Школа № 7", role: "student", seatNumber: 25 }] });
        return ok(200, { ...base, session: browserSession(w.account) });
      }
      return ok(200, base);
    }
    return fail(404, "not_found");
  });

  await page.route(`${API}/api/v1/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const path = url.pathname.replace("/api/v1", "");
    const key = `${req.method()} ${path}`;
    const me = () => w.me ?? w.account;
    w.calls.push(key);

    const delay = w.delays?.[key];
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const failure = w.failures[key];
    if (failure === "offline") return route.abort("internetdisconnected");
    if (failure) return problem(route, failure.status, failure.code, "Ошибка", {}, failure.errors);

    if (key === "GET /me") return me() ? json(route, 200, me()) : problem(route, 401, "unauthenticated");
    if (key === "PATCH /me") {
      const body = req.postDataJSON() as Schema<"UpdateMeRequest">;
      const next: Me = { ...(me() as Me) };
      if (body.nicknameId) next.nickname = NICKS[Number(body.nicknameId.split(":")[1] ?? 0) % NICKS.length]!;
      if (body.ageBand) {
        next.ageBand = body.ageBand;
        next.uiMode = body.ageBand === "age_7_10" ? "bee" : body.ageBand === "age_11_14" ? "bortnik" : "keeper";
      }
      if (body.dailyGoal) next.dailyGoal = body.dailyGoal;
      w.account = next;
      w.me = undefined;
      return json(route, 200, w.account);
    }
    // ───── «Учусь сам» (ADR 0022): карточка входа, почта взрослого, вступление в класс ─────
    if (key === "GET /me/login-card") return w.loginCard ? json(route, 200, w.loginCard) : problem(route, 404, "not_found");
    if (key === "POST /me/login-card") {
      w.loginCard = w.loginCard
        ? { payload: "TP1.7M2QK9XD4T.H3VN8RZ6P1CWEA0FJ5GKY2SB7Q.EG", version: w.loginCard.version + 1, issuedAt: now() }
        : DEMO_LOGIN_CARD;
      if (w.account) w.account = { ...w.account, loginCard: "issued" };
      return json(route, 201, w.loginCard);
    }
    if (key === "POST /me/email") {
      const { code } = req.postDataJSON() as Schema<"AttachEmailRequest">;
      if (code !== "0000") return problem(route, 401, "otp_invalid");
      const prev = me() as Me;
      // Как настоящий API: ребёнку адрес не возвращается — только флаг emailLogin (ADR 0022 §10); взрослому — profile.email.
      const next: Me = prev.kind === "child" ? { ...prev, emailLogin: true } : { ...prev, profile: { email: "grown@mail.example" } };
      delete next.loginCard;
      w.account = next;
      w.me = undefined;
      return json(route, 200, w.account);
    }
    if (key === "POST /me/class-join") {
      const { code } = req.postDataJSON() as Schema<"ClassJoinRequest">;
      if (code.replace("-", "") !== "K7Q4MZ") return problem(route, 404, "class_code_not_found");
      return json(route, 202, { requestId: "0193f7a4-0000-7000-8000-0000000r0042", status: "pending", expiresAt: inMinutes(15), pollIntervalSeconds: 1, class: { title: "5 «Б»", grade: 5, letter: "Б" } });
    }
    if (req.method() === "GET" && path.startsWith("/me/class-join/")) {
      const status = w.classJoinStatuses.shift() ?? "pending";
      if (w.classJoinStatuses.length === 0) w.classJoinStatuses.push(status);
      if (status === "approved" && w.account) {
        w.account = { ...w.account, classes: [{ id: CLASS_ID, title: "5 «Б»", schoolName: "Школа № 7", role: "student", seatNumber: 25 }] };
        w.me = undefined;
      }
      return json(route, 200, { requestId: "0193f7a4-0000-7000-8000-0000000r0042", status, expiresAt: inMinutes(14), pollIntervalSeconds: 1, class: { title: "5 «Б»", grade: 5, letter: "Б" } });
    }
    if (key === "GET /nicknames/suggest") {
      const start = (nickRound++ * 3) % NICKS.length;
      return json(route, 200, { items: [0, 1, 2].map((i) => ({ id: `nick:${start + i}`, text: NICKS[(start + i) % NICKS.length]! })) });
    }
    if (key === "POST /auth/otp/request") return json(route, 202, { challengeId: "0193f7a4-0000-7000-8000-0000000o0001", expiresAt: inMinutes(10), resendAfterSeconds: 30, codeLength: 4 });
    if (key === "GET /legal-documents/current") return json(route, 200, { items: DOCS });
    if (key === "POST /consents") {
      if (w.account) w.account = { ...w.account, pendingConsents: [] };
      return json(route, 201, { items: [] });
    }
    const revoke = /^\/consents\/([^/]+)\/revoke$/.exec(path);
    if (req.method() === "POST" && revoke) {
      const seat = w.classDetail.seats?.find((s) => s.consent?.consentId === revoke[1]);
      if (seat?.consent) seat.consent = { ...seat.consent, status: "revoked", revokedAt: now() };
      return json(route, 200, { id: revoke[1], document: { id: DOCS[0]!.id, kind: "consent_child", version: "2026-11-01" }, method: "paper", status: "revoked", subject: { type: "seat" }, givenAt: iso(), revokedAt: now() });
    }
    if (key === "GET /districts") return json(route, 200, { items: DISTRICTS });
    if (key === "GET /schools") {
      const q = url.searchParams.get("q")?.toLowerCase();
      const all = [...SCHOOLS, ...extraSchools(w.schoolPages?.extra ?? 0)].filter((s) => !q || s.shortNameRu.toLowerCase().includes(q));
      if (!w.schoolPages) return json(route, 200, { items: all });
      const cursor = url.searchParams.get("cursor");
      const start = cursor ? Number(cursor.replace("offset-", "")) : 0;
      const end = start + w.schoolPages.pageSize;
      if (cursor && w.schoolPages.slowMs) await new Promise((r) => setTimeout(r, w.schoolPages!.slowMs));
      return json(route, 200, { items: all.slice(start, end), ...(end < all.length ? { nextCursor: `offset-${end}` } : {}) });
    }
    if (key === "POST /teacher/verification") {
      if (w.account) w.account = { ...w.account, teacherStatus: "pending" };
      return json(route, 201, w.verification);
    }
    if (key === "GET /teacher/verification") return w.verification ? json(route, 200, w.verification) : problem(route, 404, "not_found");
    if (key === "GET /classes") return json(route, 200, { items: w.classes });

    // ───── Тропа, урок, мотивация (операции контракта: getCourse … listMyCorpusCells) ─────
    const L = w.learn;
    if (key === "GET /course") return json(route, 200, L.course);
    if (key === "GET /me/progress") return json(route, 200, L.progress);
    // Привязка чата Telegram из Mini App (ADR 0020): мост шлёт initData один раз после входа.
    if (key === "POST /telegram/link") return json(route, 200, { reminders: { enabled: false, hour: 18 } });
    if (key === "GET /leagues/current") return json(route, 200, L.league);
    if (key === "POST /leagues/result-seen") {
      L.resultSeen.push((req.postDataJSON() as Schema<"LeagueResultSeenRequest">).weekStart);
      L.summary = { ...L.summary, leagueResult: undefined };
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (key === "GET /corpus/my-cells") return json(route, 200, L.cells);
    if (key === "GET /me/words") return json(route, 200, L.words);
    if (key === "GET /me/achievements") return json(route, 200, L.achievements);
    if (key === "POST /reviews/runs") {
      const { runId } = req.postDataJSON() as Schema<"StartLessonRunRequest">;
      const lesson = (L.course.review?.due ?? 0) > 0 ? L.lessons["review"] : undefined;
      if (!L.runs.some((r) => r.runId === runId)) L.runs.push({ lessonId: "review", runId });
      const run: Schema<"LessonRun"> = { ...(lesson?.run ?? { lessonId: "review", kind: "review", titleRu: "Повторение", exercises: [] }), runId, status: "active", startedAt: now() };
      return json(route, 201, run);
    }
    // Испытание для перехода к закрытому месту (startJumpRun, mock-jump.ts).
    const jumpStart = /^\/units\/([^/]+)\/jump-runs$/.exec(path);
    if (req.method() === "POST" && jumpStart) {
      const unitId = decodeURIComponent(jumpStart[1]!);
      const unit = L.course.units.find((u) => u.id === unitId);
      const lesson = L.lessons[unitId];
      if (!unit || !lesson) return problem(route, 404, "not_found");
      const { runId } = req.postDataJSON() as Schema<"StartLessonRunRequest">;
      const known = L.runs.some((r) => r.runId === runId);
      if (!known && !unit.jump) return problem(route, 409, "jump_unavailable");
      if (!known) L.runs.push({ lessonId: unitId, runId, kind: "jump" });
      return json(route, 201, { ...lesson.run, runId, status: "active", startedAt: now() } satisfies Schema<"LessonRun">);
    }
    const runStart = /^\/lessons\/([^/]+)\/runs$/.exec(path);
    if (req.method() === "POST" && runStart) {
      const lessonId = decodeURIComponent(runStart[1]!);
      const { runId, accepts } = req.postDataJSON() as Schema<"StartLessonRunRequest">;
      const lesson = L.lessons[lessonId] ?? Object.values(L.lessons)[0];
      if (!lesson) return problem(route, 404, "not_found");
      if (!L.runs.some((r) => r.runId === runId)) L.runs.push({ lessonId, runId, ...(accepts ? { accepts } : {}) });
      // Как API: карточки «Новое слово» — только клиенту, который их попросил.
      const exercises = lesson.run.exercises.filter((e) => e.type !== "word_intro" || accepts?.includes("word_intro"));
      const run: Schema<"LessonRun"> = { ...lesson.run, exercises, lessonId, runId, status: "active", startedAt: now() };
      return json(route, 201, run);
    }
    const runOp = /^\/lesson-runs\/([^/]+)\/(attempts|complete)$/.exec(path);
    if (req.method() === "POST" && runOp) {
      const runId = decodeURIComponent(runOp[1]!);
      const run = L.runs.find((r) => r.runId === runId);
      if (!run) return problem(route, 404, "not_found");
      const lesson = L.lessons[run.lessonId] ?? Object.values(L.lessons)[0]!;
      if (runOp[2] === "complete" && run.kind === "jump") return json(route, 200, completeJump(L, run, lesson.run.exercises.length));
      if (runOp[2] === "complete") {
        if (!L.completes.includes(runId)) {
          L.completes.push(runId);
          applyCompletion(L, run.lessonId);
        }
        return json(route, 200, { ...(run.lessonId === "review" ? L.reviewSummary : L.summary), runId, lessonId: run.lessonId });
      }
      const body = req.postDataJSON() as Schema<"AttemptRequest">;
      const answerKey = lesson.keys[body.exerciseId];
      if (lesson.run.exercises.some((e) => e.id === body.exerciseId && e.type === "word_intro")) return problem(route, 422, "answer_type_mismatch");
      if (!answerKey) return problem(route, 422, "exercise_not_in_run");
      const repeat = L.attempts.find((x) => x.body.attemptId === body.attemptId);
      if (repeat) return json(route, 200, repeat.result);
      const first = !L.attempts.some((x) => x.runId === runId && x.body.exerciseId === body.exerciseId);
      const judged = judge(answerKey, body.answer, { attemptId: body.attemptId, exerciseId: body.exerciseId }, first);
      const result = run.kind === "jump" ? jumpAttempt(L, runId, judged) : judged;
      L.attempts.push({ runId, body, result });
      return json(route, 200, result);
    }
    // ───── «Что в уроке» (getLessonPreview): только учителю; урока нет в моке — 404 ─────
    const lessonPreview = /^\/lessons\/([^/]+)\/preview$/.exec(path);
    if (req.method() === "GET" && lessonPreview) {
      if (!me()?.roles?.includes("teacher")) return problem(route, 403, "forbidden", "Нет доступа");
      const found = LESSON_PREVIEWS[decodeURIComponent(lessonPreview[1]!)];
      return found ? json(route, 200, found) : problem(route, 404, "not_found");
    }
    // ───── «Помогите языку» для взрослого (listCorpusDuels, submitCorpusJudgment, getCorpusItemVotes) ─────
    const T = w.teacher;
    if (key === "GET /corpus/duels") {
      if (me()?.kind !== "adult") return problem(route, 403, "forbidden", "Нет доступа");
      const limit = Number(url.searchParams.get("limit") ?? 3);
      return json(route, 200, { items: T.items.filter((i) => !T.judgments.has(i.duel.itemId)).slice(0, limit).map((i) => i.duel) });
    }
    if (key === "POST /corpus/judgments") {
      if (me()?.kind !== "adult") return problem(route, 403, "forbidden", "Нет доступа");
      const body = req.postDataJSON() as Schema<"JudgmentRequest">;
      const item = T.items.find((i) => i.duel.itemId === body.itemId);
      if (!item) return problem(route, 404, "not_found");
      const prev = T.judgments.get(body.itemId);
      if (prev) return prev.body.judgmentId === body.judgmentId ? json(route, 201, prev.votes) : problem(route, 409, "already_voted", "Вы уже голосовали за эту пару");
      const ids = item.duel.variants.map((v) => v.variantId);
      if (body.shown.length !== 2 || !body.shown.every((v) => ids.includes(v))) return problem(route, 422, "validation_failed");
      const votes = tallyVotes(item, body, now());
      T.judgments.set(body.itemId, { body, votes });
      return json(route, 201, votes);
    }
    const itemVotes = /^\/corpus\/items\/([^/]+)\/votes$/.exec(path);
    if (req.method() === "GET" && itemVotes) {
      const voted = T.judgments.get(decodeURIComponent(itemVotes[1]!));
      return voted ? json(route, 200, voted.votes) : problem(route, 403, "vote_required", "Сначала проголосуйте");
    }
    if (key === "POST /classes") return json(route, 201, classDetail({ id: "0193f7a4-0000-7000-8000-00000000c007", title: "5 «В»", letter: "В", seats: [], pendingJoinRequestCount: 0 }));

    const m = /^\/classes\/([^/]+)(\/.*)?$/.exec(path);
    if (m) {
      const [, id, rest = ""] = m;
      if (id === FOREIGN_CLASS_ID) return problem(route, 403, "forbidden", "Нет доступа");
      if (req.method() === "GET" && rest === "") return json(route, 200, w.classDetails[id!] ?? w.classDetail);
      if (req.method() === "GET" && rest === "/hive") return json(route, 200, { ...w.learn.hive, classId: id! });
      if (req.method() === "GET" && rest === "/progress") return json(route, 200, w.teacher.progress(id!, w.classDetail.seats ?? []));
      // Задания учителя (ADR 0021): список, «Дать задание» (не больше двух активных), «Снять задание».
      const A = w.teacher.assignments;
      if (req.method() === "GET" && rest === "/assignments") return json(route, 200, { classId: id!, maxActive: 2, active: A.active, past: A.past, options: ASSIGNMENT_OPTIONS });
      if (req.method() === "POST" && rest === "/assignments") {
        const body = req.postDataJSON() as Schema<"CreateAssignmentRequest">;
        if (A.active.some((a) => a.kind === body.kind && a.lessonId === body.lessonId)) return problem(route, 409, "assignment_exists");
        if (A.active.length >= 2) return problem(route, 409, "assignment_limit");
        const created = newAssignment(body, A.active.length + A.past.length + 1, studentNumbers(w.classDetail.seats ?? []));
        A.active = [...A.active, created];
        return json(route, 201, created);
      }
      const cancel = /^\/assignments\/([^/]+)$/.exec(rest);
      if (req.method() === "DELETE" && cancel) {
        A.active = A.active.filter((a) => a.id !== cancel[1]);
        A.past = A.past.filter((a) => a.id !== cancel[1]);
        return route.fulfill({ status: 204, headers: CORS });
      }
      const seatCard = /^\/seats\/(\d+)\/progress$/.exec(rest);
      if (req.method() === "GET" && seatCard) {
        const card = demoSeatCard(id!, Number(seatCard[1]), w.classDetail.seats ?? []);
        return card ? json(route, 200, card) : problem(route, 404, "not_found");
      }
      if (req.method() === "POST" && rest === "/seats") {
        const { count } = req.postDataJSON() as { count: number };
        const first = (w.classDetail.seats?.length ?? 0) + 1;
        const nums = Array.from({ length: count }, (_, i) => first + i);
        return json(route, 201, {
          printJob: { id: "0193f7a4-0000-7000-8000-0000000p0001", expiresAt: inMinutes(30), seatNumbers: nums, pdfPath: `/api/v1/classes/${id}/cards.pdf?printJob=0193f7a4-0000-7000-8000-0000000p0001` },
          seats: nums.map((number) => ({ number, cardStatus: "active", cardVersion: 1 })),
        });
      }
      if (req.method() === "POST" && rest === "/join-code") {
        if (w.permanentJoinCode) return json(route, 201, { code: "000000", display: "000-000", expiresAt: inMinutes(365 * 24 * 60), permanent: true });
        return json(route, 201, { code: "K7Q4MZ", display: "K7Q-4MZ", expiresAt: inMinutes(15), permanent: false });
      }
      // Погасить код: идемпотентно, 204 и без активного кода.
      if (req.method() === "DELETE" && rest === "/join-code") return route.fulfill({ status: 204, headers: CORS });
      if (req.method() === "GET" && rest === "/join-requests") return json(route, 200, { items: w.joinRequests });
      const jr = /^\/join-requests\/([^/]+)\/(approve|reject)$/.exec(rest);
      if (jr) {
        const r = w.joinRequests.find((x) => x.id === jr[1]);
        w.joinRequests = w.joinRequests.filter((x) => x.id !== jr[1]);
        return r ? json(route, 200, { ...r, status: jr[2] === "approve" ? "approved" : "rejected", decidedAt: now(), seatNumber: jr[2] === "approve" ? 25 : undefined }) : problem(route, 409, "join_request_closed");
      }
      if (/^\/seats\/\d+\/reissue$/.test(rest)) {
        const n = Number(rest.split("/")[2]);
        return json(route, 200, {
          printJob: { id: "0193f7a4-0000-7000-8000-0000000p0002", expiresAt: inMinutes(30), seatNumbers: [n], pdfPath: `/api/v1/classes/${id}/cards.pdf?printJob=0193f7a4-0000-7000-8000-0000000p0002` },
          seats: [{ number: n, cardStatus: "active", cardVersion: 2 }],
        });
      }
      if (/^\/seats\/\d+\/paper-consent$/.test(rest)) {
        return json(route, 201, { id: "0193f7a4-0000-7000-8000-0000000e0100", document: { id: DOCS[0]!.id, kind: "consent_child", version: "2026-11-01" }, method: "paper", status: "given", subject: { type: "seat" }, givenAt: now() });
      }
    }
    return problem(route, 404, "not_found", `Нет мока для ${key}`);
  });

  return w;
}

/** Школы сверх основных — для списка из нескольких страниц: «Школа № 101», «Школа № 102»… */
function extraSchools(n: number): Schema<"School">[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `0193f7a4-0000-7000-8000-${(0x30000 + i).toString(16).padStart(12, "0")}`,
    districtId: SCHOOL.districtId,
    nameRu: `Школа № ${101 + i}`,
    shortNameRu: `Школа № ${101 + i}`,
    isDemo: false,
  }));
}

/** Фото карточки: PNG с QR-кодом — как его загружает ученик через «Загрузить фото карточки». */
export async function qrPhoto(text: string): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const QRCode = (await import("qrcode")).default;
  return { name: "card.png", mimeType: "image/png", buffer: await QRCode.toBuffer(text, { errorCorrectionLevel: "M", margin: 4, width: 480 }) };
}
