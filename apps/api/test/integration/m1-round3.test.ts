// Вход на место, лимиты, управляющие символы и идемпотентность — против Docker-стека:
// - опрос заявки по коду класса выдаёт сессию только на место, куда можно войти (та же проверка, что у QR),
//   а отзыв сессий аккаунта закрывает выдачу по его заявкам;
// - лимит неудач не считает верные попытки «в работе»; код класса — на устройство с потолком на IP;
// - первая карточка на место, занятое по коду класса, завершает сессии;
// - управляющие символы в любой строке запроса — 422 до обработчика (матрица по операциям контракта);
// - Idempotency-Key у перевыпуска, точный 410 заменённого задания печати, порядок проверок должности,
//   русские заголовки встроенных ошибок.
import { randomUUID } from "node:crypto";
import { generateClassCode, generateQrCard } from "@teletau/auth-codes";
import type { Schema } from "@teletau/contracts";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { contractOperations } from "../../src/common/contract.js";
import { RateLimiter } from "../../src/infra/rate-limiter.js";
import { VALKEY } from "../../src/infra/tokens.js";
import { CLASS_CODE_DEVICE_FAILURES, CLASS_CODE_IP_FAILURES, QR_IP_FAILURES } from "../../src/modules/identity/student-login.service.js";
import { ClassesService } from "../../src/modules/org/index.js";
import { PrintJobStore } from "../../src/modules/org/print-jobs.js";
import { bootApi, DEMO_CODE, email, expectStatus, newDevice, randomIp, RUN, testConfig, type AuthSession, type Device, type Res, type TestApi } from "./harness.js";

type Problem = Schema<"Problem">;
type Ticket = Schema<"ClassCodeLoginTicket">;
/** Поля Problem, кроме `status` (у статуса заявки он строковый). */
type Fail = Partial<Pick<Problem, "code" | "title" | "errors">>;
type PollStatus = Schema<"ClassCodeLoginStatus"> & Fail;
type Consent = Schema<"Consent">;
type SeatIssueResult = Schema<"SeatIssueResult">;

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;
let moderator: AuthSession;
let admin: AuthSession;
/** Кабинет министерства и словарь для Фонда (ADR 0023): операции только своих ролей. */
let ministry: AuthSession;
let fund: AuthSession;
let teacher: Awaited<ReturnType<TestApi["verifiedTeacher"]>>;

beforeAll(async () => {
  ({ api, pool, close } = await bootApi());
  moderator = await api.loginStaff("moderator");
  admin = await api.loginStaff("admin");
  ministry = await api.loginStaff("ministry");
  fund = await api.loginStaff("fund");
  teacher = await api.verifiedTeacher("round3", moderator.accessToken, 1);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await close?.();
});

/** Сколько ответов с каждым «статус код» в пачке. */
function tally(results: Array<Res<unknown>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of results) {
    const key = `${r.status}${(r.body as Problem | undefined)?.code ? ` ${(r.body as Problem).code}` : ""}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

const letters = ["А", "Б", "В", "Г", "Д", "Е", "Ж", "З", "И", "К", "Л", "М", "Н", "О", "П", "Р", "С", "Т", "У", "Ф"];
let letterIndex = 0;

async function newClass(grade: number): Promise<string> {
  const c = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher.accessToken, body: { grade, letter: letters[letterIndex++]!, program: "native" } });
  expectStatus(c, 201);
  return c.body.id;
}

/** Класс с N карточками; полезные нагрузки — из задания печати (как их увидел бы PDF). */
async function classWithCards(grade: number, count: number): Promise<{ classId: string; payloads: string[]; printJobId: string }> {
  const classId = await newClass(grade);
  const seats = await api.post<SeatIssueResult>(`/classes/${classId}/seats`, { token: teacher.accessToken, body: { count } });
  expectStatus(seats, 201);
  const job = await api.app.get(PrintJobStore).load(seats.body.printJob.id);
  return { classId, payloads: job!.cards.map((card) => card.payload), printJobId: seats.body.printJob.id };
}

const qrLogin = (payload: string, device: Device = newDevice(), ip?: string) => api.post<AuthSession & Problem>("/auth/qr", { body: { payload, device }, ...(ip ? { ip } : {}) });

async function joinCode(classId: string): Promise<string> {
  const code = await api.post<Schema<"JoinCode">>(`/classes/${classId}/join-code`, { token: teacher.accessToken });
  expectStatus(code, 201);
  return code.body.code;
}

/** Ученик по коду класса: заявка → одобрение учителем. `poll` — опрос с устройства (или без заголовка устройства). */
async function classCodeStudent(classId: string, device: Device = newDevice()) {
  const code = await joinCode(classId);
  const ticket = await api.post<Ticket>("/auth/class-code", { body: { code, nicknameId: "a03.n04", device }, ip: randomIp() });
  expectStatus(ticket, 202);
  const approved = await api.post<Schema<"JoinRequest">>(`/classes/${classId}/join-requests/${ticket.body.requestId}/approve`, { token: teacher.accessToken });
  expectStatus(approved, 200);
  const poll = (installId?: string) =>
    api.get<PollStatus>(`/auth/class-code/${ticket.body.requestId}`, {
      headers: { "x-poll-token": ticket.body.pollToken, ...(installId ? { "x-device-install-id": installId } : {}) },
      ip: randomIp(),
    });
  return { device, requestId: ticket.body.requestId, seatNumber: approved.body.seatNumber!, poll };
}

async function givePaperConsent(classId: string, seatNumber: number): Promise<string> {
  const given = await api.post<Consent>(`/classes/${classId}/seats/${seatNumber}/paper-consent`, { token: teacher.accessToken });
  expectStatus(given, 201);
  return given.body.id;
}

const revokeConsent = (consentId: string) => api.post<Consent & Problem>(`/consents/${consentId}/revoke`, { token: teacher.accessToken });

async function liveSessions(accountId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM sessions WHERE account_id = $1 AND revoked_at IS NULL", [accountId]);
  return rows[0]!.n;
}

async function seatAccount(classId: string, seatNumber: number): Promise<string> {
  const detail = await api.get<Schema<"ClassDetail">>(`/classes/${classId}`, { token: teacher.accessToken });
  return detail.body.seats!.find((s) => s.number === seatNumber)!.student!.accountId;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("M1-35: a class-code poll issues a session only to a seat that may log in, and revoking access closes the grant", () => {
  it("approve → poll (session) → consent revoked → re-poll with the same token and device: 403 consent_revoked, no session; the first session is 401", async () => {
    const classId = await newClass(5);
    const s = await classCodeStudent(classId);
    const first = await s.poll();
    expect(first.body.status).toBe("approved");
    const s1 = first.body.session!;
    const consentId = await givePaperConsent(classId, s.seatNumber);
    expectStatus(await revokeConsent(consentId), 200);

    const again = await s.poll(s.device.installId);
    expect(again.status).toBe(403);
    expect(again.body.code).toBe("consent_revoked");
    expect(again.body.session).toBeUndefined();
    // Без заголовка устройства — тот же отказ, а не «consumed».
    expect((await s.poll()).body.code).toBe("consent_revoked");
    expect((await api.get<Problem>("/me", { token: s1.accessToken })).body.code).toBe("session_revoked");
    expect(await liveSessions(s1.account.id)).toBe(0);
  });

  it("approve → poll (session) → the teacher issues a card for the seat → re-poll gives no session; old sessions are 401; the same after a second reissue", async () => {
    const classId = await newClass(5);
    const s = await classCodeStudent(classId);
    const s1 = (await s.poll()).body.session!;
    const issued = await api.post<SeatIssueResult>(`/classes/${classId}/seats/${s.seatNumber}/reissue`, { token: teacher.accessToken });
    expectStatus(issued, 200);

    const again = await s.poll(s.device.installId);
    expectStatus(again, 200);
    expect(again.body.session).toBeUndefined();
    expect((await api.get<Problem>("/me", { token: s1.accessToken })).body.code).toBe("session_revoked");
    expect(await liveSessions(s1.account.id)).toBe(0);

    // Ученик вошёл по новой карточке, учитель перевыпустил её ещё раз (v2): повторный опрос по-прежнему без сессии.
    const card = (await api.app.get(PrintJobStore).load(issued.body.printJob.id))!.cards[0]!.payload;
    const byCard = await qrLogin(card);
    expectStatus(byCard, 200);
    expectStatus(await api.post(`/classes/${classId}/seats/${s.seatNumber}/reissue`, { token: teacher.accessToken }), 200);
    expect((await s.poll(s.device.installId)).body.session).toBeUndefined();
    expect((await api.get<Problem>("/me", { token: byCard.body.accessToken })).body.code).toBe("session_revoked");
    expect(await liveSessions(s1.account.id)).toBe(0);
  });

  it("consent revoked before the first poll → the first poll is 403 consent_revoked, like the QR login", async () => {
    const classId = await newClass(6);
    const s = await classCodeStudent(classId);
    const consentId = await givePaperConsent(classId, s.seatNumber);
    expectStatus(await revokeConsent(consentId), 200);
    const first = await s.poll(s.device.installId);
    expect(first.status).toBe(403);
    expect(first.body.code).toBe("consent_revoked");
    expect(first.body.title).toMatch(/согласие/);
    expect(await liveSessions(await seatAccount(classId, s.seatNumber))).toBe(0);
    // Родитель снова подписал бланк: место открыто, но выдачу по этой заявке отзыв закрыл навсегда —
    // ученик входит по карточке (или подаёт новую заявку), а не забирает сессию старой заявки.
    await givePaperConsent(classId, s.seatNumber);
    const back = await s.poll(s.device.installId);
    expectStatus(back, 200);
    expect(back.body.status).toBe("expired");
    expect(back.body.session).toBeUndefined();
  });

  it("a class in the archive → the poll gives no session (403 class_archived), first or repeated", async () => {
    const classId = await newClass(6);
    const before = await classCodeStudent(classId);
    expect((await before.poll()).body.session).toBeDefined();
    const after = await classCodeStudent(classId);
    await pool.query("UPDATE classes SET status = 'archived' WHERE id = $1", [classId]);
    for (const res of [await before.poll(before.device.installId), await after.poll(after.device.installId)]) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("class_archived");
      expect(res.body.session).toBeUndefined();
    }
  });

  it("re-polls racing a consent revoke leave no live session (seat lock: grant and revoke do not interleave)", async () => {
    const classId = await newClass(7);
    const s = await classCodeStudent(classId);
    const s1 = (await s.poll()).body.session!;
    const consentId = await givePaperConsent(classId, s.seatNumber);
    const polls = Array.from({ length: 16 }, (_, i) => sleep(i * 4).then(() => s.poll(s.device.installId)));
    const revoke = sleep(25).then(() => revokeConsent(consentId));
    const results = await Promise.all([...polls, revoke]);
    expectStatus(results.at(-1)!, 200);
    for (const r of results.slice(0, -1)) expect([200, 403], JSON.stringify(r.body)).toContain(r.status);
    expect(await liveSessions(s1.account.id)).toBe(0);
    expect((await s.poll(s.device.installId)).body.code).toBe("consent_revoked");
  });

  it("QR logins racing a consent revoke leave no live session either", async () => {
    const { classId, payloads } = await classWithCards(7, 1);
    const kid = await qrLogin(payloads[0]!);
    expectStatus(kid, 200);
    const consentId = await givePaperConsent(classId, 1);
    const logins = Array.from({ length: 16 }, (_, i) => sleep(i * 4).then(() => qrLogin(payloads[0]!, newDevice(), randomIp())));
    const revoke = sleep(25).then(() => revokeConsent(consentId));
    const results = await Promise.all([...logins, revoke]);
    expectStatus(results.at(-1)!, 200);
    for (const r of results.slice(0, -1)) expect(["200", "403 consent_revoked"]).toContain(`${r.status}${r.body.code ? ` ${r.body.code}` : ""}`);
    expect(await liveSessions(kid.body.account.id)).toBe(0);
  });
});

describe("M1-37: the first card for a seat taken by class code ends the student's sessions", () => {
  it("class-code login → first card → old session 401, re-poll without a session, the new card opens the same account; audit counts the sessions", async () => {
    const classId = await newClass(8);
    const s = await classCodeStudent(classId);
    const s1 = (await s.poll()).body.session!;
    const issued = await api.post<SeatIssueResult>(`/classes/${classId}/seats/${s.seatNumber}/reissue`, { token: teacher.accessToken });
    expectStatus(issued, 200);
    expect(issued.body.seats[0]).toMatchObject({ number: s.seatNumber, cardStatus: "active", cardVersion: 1, student: { accountId: s1.account.id } });
    expect((await api.get<Problem>("/me", { token: s1.accessToken })).body.code).toBe("session_revoked");
    expect((await s.poll(s.device.installId)).body.session).toBeUndefined();

    const card = (await api.app.get(PrintJobStore).load(issued.body.printJob.id))!.cards[0]!.payload;
    const byCard = await qrLogin(card);
    expectStatus(byCard, 200);
    expect(byCard.body.account.id).toBe(s1.account.id);

    const log = await api.get<Schema<"AuditLogPage">>("/admin/audit-log?action=card.issued&limit=100", { token: admin.accessToken });
    const entry = log.body.items.find((e) => (e.metadata as { classId?: string }).classId === classId)!;
    expect(entry.metadata).toMatchObject({ classId, seatNumber: s.seatNumber, version: 1, sessionsRevoked: 1 });
  });
});

describe("M1-36: valid attempts in flight do not take failure slots; the class-code limit fits a school behind one NAT", () => {
  it("30 parallel valid QR logins from one IP → all 200", async () => {
    const { payloads } = await classWithCards(9, 30);
    const ip = randomIp();
    const results = await Promise.all(payloads.map((p) => qrLogin(p, newDevice(), ip)));
    expect(tally(results)).toEqual({ "200": 30 });
  });

  it("a class of 30 behind one IP after 10 typos → every valid code is accepted, also all at once; the typing device alone waits", async () => {
    const classId = await newClass(9);
    const code = await joinCode(classId);
    const ip = randomIp();
    const request = (c: string, device: Device = newDevice()) => api.post<Ticket & Fail>("/auth/class-code", { ip, body: { code: c, nicknameId: "a04.n05", device } });
    // Десять детей ошиблись по разу.
    for (let i = 0; i < 10; i++) expect((await request(generateClassCode().code)).body.code).toBe("class_code_not_found");
    const results = await Promise.all(Array.from({ length: 30 }, () => request(code)));
    expect(tally(results)).toEqual({ "202": 30 });
    // Один ребёнок ошибся 10 раз подряд: ждёт только его устройство.
    const clumsy = newDevice();
    for (let i = 0; i < CLASS_CODE_DEVICE_FAILURES.max; i++) expect((await request(generateClassCode().code, clumsy)).status).toBe(404);
    const locked = await request(code, clumsy);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(1);
    expectStatus(await request(code), 202);
  });

  it("a burst of wrong codes still gets exactly the limit: per IP and per device", async () => {
    const ip = randomIp();
    const perIp = await Promise.all(
      Array.from({ length: CLASS_CODE_IP_FAILURES.max + 50 }, () => api.post<Problem>("/auth/class-code", { ip, body: { code: generateClassCode().code, nicknameId: "a00.n00", device: newDevice() } })),
    );
    expect(tally(perIp)).toEqual({ "404 class_code_not_found": CLASS_CODE_IP_FAILURES.max, "429 rate_limited": 50 });
    const device = newDevice();
    const perDevice = await Promise.all(
      Array.from({ length: 30 }, () => api.post<Problem>("/auth/class-code", { ip: randomIp(), body: { code: generateClassCode().code, nicknameId: "a00.n00", device } })),
    );
    expect(tally(perDevice)).toEqual({ "404 class_code_not_found": CLASS_CODE_DEVICE_FAILURES.max, "429 rate_limited": 30 - CLASS_CODE_DEVICE_FAILURES.max });
  });

  it("only in-flight attempts in the way → the server waits briefly, then 429 with Retry-After: 1 (not the rest of the window)", async () => {
    const { payloads } = await classWithCards(10, 1);
    const ip = randomIp();
    const limiter = api.app.get(RateLimiter);
    const key = `qr:ip:${limiter.ipKey(ip)}`;
    const held = await Promise.all(Array.from({ length: QR_IP_FAILURES.max }, () => limiter.reserve(key, QR_IP_FAILURES)));
    const started = Date.now();
    const blocked = await qrLogin(payloads[0]!, newDevice(), ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("rate_limited");
    expect(blocked.headers["retry-after"]).toBe("1");
    expect(Date.now() - started).toBeGreaterThanOrEqual(1500);
    // Попытки «в работе» завершились верно — вход проходит; неудач в окне нет.
    await Promise.all(held.map((h) => h.release()));
    expectStatus(await qrLogin(payloads[0]!, newDevice(), ip), 200);
    expect(await api.app.get<Redis>(VALKEY).get(`rl:${key}`)).toBeNull();
  });

  it("while one slot is held, a parallel valid login waits for it instead of failing", async () => {
    const { payloads } = await classWithCards(10, 1);
    const ip = randomIp();
    const limiter = api.app.get(RateLimiter);
    const key = `qr:ip:${limiter.ipKey(ip)}`;
    const held = await Promise.all(Array.from({ length: QR_IP_FAILURES.max }, () => limiter.reserve(key, QR_IP_FAILURES)));
    const pending = qrLogin(payloads[0]!, newDevice(), ip);
    await sleep(300);
    await held[0]!.release();
    expectStatus(await pending, 200);
    await Promise.all(held.map((h) => h.release()));
  });

  it("an exception between reservation and verdict is not a failure (500 does not count, the slot is freed)", async () => {
    const ip = randomIp();
    const limiter = api.app.get(RateLimiter);
    const spy = vi.spyOn(api.app.get(ClassesService), "verifyCard").mockRejectedValueOnce(new Error("boom"));
    try {
      const res = await qrLogin(generateQrCard().payload, newDevice(), ip);
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    const valkey = api.app.get<Redis>(VALKEY);
    const key = `rl:qr:ip:${limiter.ipKey(ip)}`;
    expect(await valkey.get(key)).toBeNull();
    expect(await valkey.zcard(`${key}:inflight`)).toBe(0);
  });

  it("failures that reached the limit answer with the rest of the window, even for a valid card", async () => {
    const { payloads } = await classWithCards(11, 1);
    const ip = randomIp();
    for (let i = 0; i < QR_IP_FAILURES.max; i++) expect((await qrLogin(generateQrCard().payload, newDevice(), ip)).status).toBe(401);
    const blocked = await qrLogin(payloads[0]!, newDevice(), ip);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(30);
  });
});

/** Строковые поля схемы тела: JSON Pointer → значение-образец (вложенные объекты и списки строк). */
function stringPointers(schema: Record<string, unknown> | undefined, base = ""): string[] {
  if (!schema) return [];
  const type = schema["type"];
  if (type === "string" || (type === undefined && (schema["enum"] || schema["format"]))) return [base];
  if (type === "array") return stringPointers(schema["items"] as Record<string, unknown> | undefined, `${base}/0`);
  const props = schema["properties"] as Record<string, Record<string, unknown>> | undefined;
  if (type === "object" || props) return Object.entries(props ?? {}).flatMap(([k, v]) => stringPointers(v, `${base}/${k}`));
  for (const k of ["oneOf", "anyOf", "allOf"]) {
    const list = schema[k] as Array<Record<string, unknown>> | undefined;
    if (list) return [...new Set(list.flatMap((s) => stringPointers(s, base)))];
  }
  return [];
}

/** Объект, в котором по указателю лежит строка `value` (для `/a/0/b` — `{a: [{b: value}]}`). */
function bodyWith(pointer: string, value: string): unknown {
  const parts = pointer.split("/").slice(1);
  const build = (i: number): unknown => (i === parts.length ? value : /^\d+$/.test(parts[i]!) ? [build(i + 1)] : { [parts[i]!]: build(i + 1) });
  return build(0);
}

describe("M1-40: control characters in any string of a request → 422 before the handler", () => {
  let student: AuthSession;
  beforeAll(async () => {
    const { payloads } = await classWithCards(4, 1);
    student = (await qrLogin(payloads[0]!)).body;
  });

  const tokenFor = (roles: string[]): string | undefined => {
    if (roles.includes("anonymous")) return undefined;
    if (roles.includes("admin")) return admin.accessToken;
    if (roles.includes("ministry")) return ministry.accessToken;
    if (roles.includes("fund")) return fund.accessToken;
    if (roles.includes("moderator")) return moderator.accessToken;
    if (roles.includes("teacher") || roles.includes("adult") || roles.includes("any")) return teacher.accessToken;
    if (roles.includes("student")) return student.accessToken;
    return teacher.accessToken;
  };

  it("QA repro: search, QR and e-mail code with NUL are 422; the e-mail code is not burned, the card still works", async () => {
    const search = await api.get<Problem>(`/schools?q=${encodeURIComponent("шк\u0000ола")}`, { token: teacher.accessToken });
    expect(search.status).toBe(422);
    expect(search.body.errors).toEqual([{ pointer: "#/query/q", detail: "Недопустимые управляющие символы" }]);

    const { payloads } = await classWithCards(4, 1);
    const qr = await api.post<Problem>("/auth/qr", { body: { payload: payloads[0], device: { ...newDevice(), appVersion: "1\u00000" } } });
    expect(qr.status).toBe(422);
    expect(qr.body.errors).toEqual([{ pointer: "/device/appVersion", detail: "Недопустимые управляющие символы" }]);
    expectStatus(await qrLogin(payloads[0]!), 200);

    const ch = await api.post<Schema<"OtpChallenge">>("/auth/otp/request", { body: { email: email("nul-otp") }, ip: randomIp() });
    const bad = await api.post<Problem>("/auth/otp/verify", { body: { challengeId: ch.body.challengeId, code: DEMO_CODE, device: { ...newDevice(), appVersion: "1\u00000" } } });
    expect(bad.status).toBe(422);
    expectStatus(await api.post("/auth/otp/verify", { body: { challengeId: ch.body.challengeId, code: DEMO_CODE, device: newDevice() } }), 200);

    const audit = await api.get<Problem>(`/admin/audit-log?action=${encodeURIComponent("card\u0000")}`, { token: admin.accessToken });
    expect(audit.status).toBe(422);
    expect(audit.body.errors?.[0]?.pointer).toBe("#/query/action");
  });

  it("C1 controls and DEL are refused too; line breaks stay allowed where text is multiline (rejection reason)", async () => {
    for (const ch of ["\u007f", "\u0085", "\u009f", "\u001b"]) {
      const r = await api.get<Problem>(`/schools?q=${encodeURIComponent(`шк${ch}ола`)}`, { token: teacher.accessToken });
      expect(r.status, JSON.stringify(ch)).toBe(422);
    }
    const s = await api.loginAdult(email("multiline-reason"));
    await api.acceptRequiredConsents(s.accessToken);
    const school = await api.demoSchool(s.accessToken, 1);
    const v = await api.post<Schema<"TeacherVerification">>("/teacher/verification", { token: s.accessToken, body: { schoolId: school.id, fullName: "Иванова Мария Петровна", position: "Учитель" } });
    expectStatus(v, 201);
    const rejected = await api.post(`/moderation/teacher-verifications/${v.body.id}/reject`, { token: moderator.accessToken, body: { reason: "Нет подтверждения.\nПриложите справку\tиз школы." } });
    expectStatus(rejected, 200);
  });

  it("matrix over every contract operation: NUL in each string body field, query, path and header parameter → 422 with its pointer, never 500", async () => {
    const failures: string[] = [];
    let checked = 0;
    // Роль service (бот, ADR 0020) — секрет сервиса в X-Service-Token вместо access-токена пользователя.
    const serviceHeaders = { "x-service-token": testConfig().BOT_SERVICE_TOKEN! };
    for (const op of contractOperations()) {
      const service = op.access.roles.includes("service");
      const auth = service ? { headers: serviceHeaders } : { token: tokenFor(op.access.roles) };
      const s = op.schema as { body?: Record<string, unknown>; querystring?: { properties?: Record<string, Record<string, unknown>> }; params?: { properties?: Record<string, Record<string, unknown>> }; headers?: { properties?: Record<string, Record<string, unknown>> } };
      const pathValue = (name: string) => (s.params?.properties?.[name]?.["type"] === "integer" ? "1" : name === "kind" ? "terms" : name === "version" ? "1.0" : randomUUID());
      const url = (override?: [string, string]) =>
        op.path.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(override?.[0] === name ? override[1] : pathValue(name)));
      const cases: Array<{ label: string; pointer: string; send: () => Promise<Res<Problem>> }> = [];
      for (const pointer of stringPointers(s.body)) {
        cases.push({ label: `body ${pointer}`, pointer, send: () => api.call<Problem>(op.method, url(), { ...auth, body: bodyWith(pointer, "a\u0000b") }) });
      }
      for (const name of Object.keys(s.querystring?.properties ?? {})) {
        if (s.querystring!.properties![name]!["type"] === "integer") continue;
        cases.push({ label: `query ${name}`, pointer: `#/query/${name}`, send: () => api.call<Problem>(op.method, `${url()}?${name}=a%00b`, { ...auth, ...(op.hasBody ? { body: {} } : {}) }) });
      }
      for (const name of Object.keys(s.params?.properties ?? {})) {
        if (s.params!.properties![name]!["type"] === "integer") continue;
        cases.push({ label: `path ${name}`, pointer: `#/path/${name}`, send: () => api.call<Problem>(op.method, url([name, "a\u0000b"]), { ...auth, ...(op.hasBody ? { body: {} } : {}) }) });
      }
      for (const name of Object.keys(s.headers?.properties ?? {})) {
        cases.push({ label: `header ${name}`, pointer: `#/header/${name}`, send: () => api.call<Problem>(op.method, url(), { ...auth, headers: { ...(service ? serviceHeaders : {}), [name]: "a\u0000b".padEnd(20, "c") }, ...(op.hasBody ? { body: {} } : {}) }) });
      }
      for (const c of cases) {
        checked++;
        const r = await c.send();
        const ok = r.status === 422 && r.body.code === "validation_failed" && r.body.errors?.some((e) => e.pointer === c.pointer && e.detail === "Недопустимые управляющие символы");
        if (!ok) failures.push(`${op.id} ${c.label}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      }
    }
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(40);
  });
});

describe("M1-41: small API fixes", () => {
  it("reissueSeatCard honours Idempotency-Key: two parallel calls → one reissue and 409 request_in_progress; a retry returns the first result", async () => {
    const { classId } = await classWithCards(4, 2);
    const headers = { "idempotency-key": `reissue-${RUN}-${randomUUID()}` };
    const reissue = (seat = 1) => api.post<SeatIssueResult & Problem>(`/classes/${classId}/seats/${seat}/reissue`, { token: teacher.accessToken, headers });
    const results = await Promise.all([reissue(), reissue()]);
    expect(tally(results)).toEqual({ "200": 1, "409 request_in_progress": 1 });
    const first = results.find((r) => r.status === 200)!;
    expect(first.body.seats[0]!.cardVersion).toBe(2);
    const retry = await reissue();
    expectStatus(retry, 200);
    expect(retry.body.printJob.id).toBe(first.body.printJob.id);
    const detail = await api.get<Schema<"ClassDetail">>(`/classes/${classId}`, { token: teacher.accessToken });
    expect(detail.body.seats!.find((s) => s.number === 1)!.cardVersion).toBe(2);
    // Тот же ключ для другого места — 422, а не тихий перевыпуск.
    const other = await reissue(2);
    expect(other.status).toBe(422);
    expect(other.body.code).toBe("idempotency_key_reused");
  });

  it("the PDF of a print job whose cards were all replaced is 410 print_job_replaced; an expired job is 410 print_job_expired", async () => {
    const { classId, printJobId } = await classWithCards(4, 1);
    const reissued = await api.post<SeatIssueResult>(`/classes/${classId}/seats/1/reissue`, { token: teacher.accessToken });
    expectStatus(reissued, 200);
    const replaced = await api.get<Problem>(`/classes/${classId}/cards.pdf?printJob=${printJobId}`, { token: teacher.accessToken });
    expect(replaced.status).toBe(410);
    expect(replaced.body.code).toBe("print_job_replaced");
    expect(replaced.body.title).toBe("Карточки этого задания уже заменены новым выпуском — скачайте PDF нового выпуска");
    expectStatus(await api.get(reissued.body.printJob.pdfPath, { token: teacher.accessToken }), 200);
    await api.app.get<Redis>(VALKEY).del(`print-job:${reissued.body.printJob.id}`);
    const expired = await api.get<Problem>(reissued.body.printJob.pdfPath, { token: teacher.accessToken });
    expect(expired.status).toBe(410);
    expect(expired.body.code).toBe("print_job_expired");
  });

  it("position and full name: allowed characters are checked before the length", async () => {
    const s = await api.loginAdult(email("emoji-position"));
    await api.acceptRequiredConsents(s.accessToken);
    const school = await api.demoSchool(s.accessToken, 1);
    const submit = (fullName: string, position: string) =>
      api.post<Problem>("/teacher/verification", { token: s.accessToken, body: { schoolId: school.id, fullName, position } });
    for (const position of ["😀", "😀😀", "Учитель 😀"]) {
      const r = await submit("Иванова Мария Петровна", position);
      expect(r.status, position).toBe(422);
      expect(r.body.errors, position).toEqual([{ pointer: "/position", detail: "Только русские или башкирские буквы, цифры, пробел и знаки препинания" }]);
    }
    const short = await submit("Иванова Мария Петровна", " а ");
    expect(short.body.errors).toEqual([{ pointer: "/position", detail: "Не короче 2 символов" }]);
    const name = await submit("😀😀", "Учитель");
    expect(name.body.errors).toEqual([{ pointer: "/fullName", detail: "Только русские или башкирские буквы, пробел, дефис и апостроф" }]);
    // Обычные должности проходят.
    expectStatus(await submit("Иванова Мария Петровна", "Зам. директора по УВР (№ 2), учитель-логопед"), 201);
  });

  it("built-in framework errors have Russian titles and no internal text: unknown route, malformed URL, big body, wrong content type", async () => {
    const nope = await api.get<Problem>("/api/v1/nope");
    expect(nope.status).toBe(404);
    expect(nope.body).toMatchObject({ code: "not_found", title: "Не найдено" });
    expect(JSON.stringify(nope.body)).not.toMatch(/Cannot GET/);
    const badUrl = await api.get<Problem>("/api/v1/classes/%E0%A4%A");
    expect(badUrl.status).toBe(400);
    expect(badUrl.body).toMatchObject({ code: "bad_request", title: "Запрос не разобран" });
    expect(JSON.stringify(badUrl.body)).not.toMatch(/valid url|component/i);
    const big = await api.post<Problem>("/auth/otp/request", { body: { email: "x".repeat(70_000) } });
    expect(big.status).toBe(413);
    expect(big.body).toMatchObject({ code: "payload_too_large", title: "Слишком большой запрос" });
    const type = await api.call<Problem>("POST", "/auth/otp/request", { body: "<email/>", headers: { "content-type": "application/xml" } });
    expect([400, 415]).toContain(type.status);
    expect(type.body.title).toMatch(/[А-Яа-я]/);
    for (const r of [nope, badUrl, big, type]) expect(JSON.stringify(r.body)).not.toMatch(/FST_|Fastify|Nest/);
  });
});
