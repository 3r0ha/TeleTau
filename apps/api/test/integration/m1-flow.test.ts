// Сценарий демо (docs/demo/M1.md) против Docker-стека: учитель → модератор → класс → карточки → PDF →
// декодирование QR из PDF → вход по QR → ник → учитель видит ученика; код класса; перевыпуск; отзыв согласия;
// повторное использование refresh-токена; 429; аудит только для вставки; в pii нет детей;
// и весь сценарий — под перехватом логов: в них нет e-mail, ФИО, секретов карточек и токенов (критерий приёмки 7).
process.env["NEST_LOG_LEVEL"] = "verbose,debug,log,warn,error,fatal";

import { randomUUID } from "node:crypto";
import { buildQrPayload, generateQrCard, parseQrPayload } from "@teletau/auth-codes";
import type { Schema } from "@teletau/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import { VALKEY } from "../../src/infra/tokens.js";
import { AccountsService } from "../../src/modules/identity/accounts.service.js";
import { scanPdf } from "../support/pdf-qr.js";
import { bootApi, email, expectStatus, newDevice, randomIp, type AuthSession, type TestApi } from "./harness.js";

type Problem = Schema<"Problem">;
type ClassDetail = Schema<"ClassDetail">;
type Me = Schema<"Me">;

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;

// ── перехват логов на весь сценарий ──
const captured: string[] = [];
const secrets = new Set<string>();
const remember = (...values: Array<string | undefined>) => values.forEach((v) => v && secrets.add(v));
const restore: Array<() => void> = [];
function capture(stream: NodeJS.WriteStream): void {
  const original = stream.write.bind(stream);
  stream.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return (original as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof stream.write;
  restore.push(() => (stream.write = original as typeof stream.write));
}

const session = <T extends AuthSession>(s: T): T => {
  remember(s.accessToken, s.refreshToken);
  return s;
};

// Общее состояние сценария (шаги идут по порядку).
let moderator: AuthSession;
let admin: AuthSession;
let teacher: Awaited<ReturnType<TestApi["verifiedTeacher"]>>;
let classId: string;
/** Содержимое QR карточек из PDF — сама полезная нагрузка TT1.… (без ссылки, ADR 0016 §2). */
let cardLinks: string[] = [];
let studentOne: AuthSession;

beforeAll(async () => {
  capture(process.stdout);
  capture(process.stderr);
  ({ api, pool, close } = await bootApi());
});

afterAll(async () => {
  await close?.();
  for (const r of restore) r();
});

const audit = async (action: string) => {
  const r = await api.get<Schema<"AuditLogPage">>(`/admin/audit-log?action=${action}&limit=100`, { token: admin.accessToken });
  expectStatus(r, 200);
  return r.body.items;
};

describe("M1 demo path (docs/demo/M1.md §1–4)", () => {
  it("staff log in with the demo e-mail code and TOTP; a missing TOTP is refused", async () => {
    await api.app.get<Redis>(VALKEY).del(`rl:otp:email:${api.app.get(AccountsService).emailSubject("moderator@demo.teletau.local").slice(0, 24)}`);
    const ch = await api.post<Schema<"OtpChallenge">>("/auth/otp/request", { body: { email: "moderator@demo.teletau.local" } });
    expectStatus(ch, 202);
    const noTotp = await api.post<Problem>("/auth/otp/verify", { body: { challengeId: ch.body.challengeId, code: "0000", device: newDevice() } });
    expect(noTotp.status).toBe(401);
    expect(noTotp.body.code).toBe("totp_required");
    moderator = session(await api.loginStaff("moderator"));
    admin = session(await api.loginStaff("admin"));
    expect(moderator.account.kind).toBe("staff");
    expect(moderator.account.roles).toContain("moderator");
    expect(admin.account.roles).toContain("admin");
    remember("moderator@demo.teletau.local", "admin@demo.teletau.local");
  });

  it("a teacher registers: e-mail → code 0000 → terms → verification request; the moderator approves it", async () => {
    const address = email("teacher-a");
    remember(address);
    const s = session(await api.loginAdult(address));
    expect(s.account).toMatchObject({ kind: "adult", roles: [], teacherStatus: "none", profile: { email: address } });
    expect([...s.account.pendingConsents].sort()).toEqual(["consent_adult", "privacy", "terms"]);
    const school = await api.demoSchool(s.accessToken);

    const early = await api.post<Problem>("/teacher/verification", {
      token: s.accessToken,
      body: { schoolId: school.id, fullName: "Учитель Ранний Тестович", position: "Учитель" },
    });
    expect(early.body.code).toBe("consent_required");

    teacher = await api.verifiedTeacher("teacher-a2", moderator.accessToken);
    session(teacher);
    remember(teacher.email, teacher.fullName);
    expect(teacher.account.roles).toContain("teacher");
    expect(teacher.account.teacherStatus).toBe("verified");
    const mine = await api.get<Schema<"TeacherVerification">>("/teacher/verification", { token: teacher.accessToken });
    expect(mine.body).toMatchObject({ status: "approved", position: "Учитель башкирского языка", applicant: { email: teacher.email } });
    expect((await audit("teacher_verification.approved")).some((e) => e.target?.id === teacher.verificationId)).toBe(true);
    expect((await audit("teacher_verification.submitted")).some((e) => e.target?.id === teacher.verificationId)).toBe(true);
  });

  it("an unverified adult cannot create a class (teacher_not_verified)", async () => {
    const other = session(await api.loginAdult(email("not-yet-teacher")));
    remember(email("not-yet-teacher"));
    const r = await api.post<Problem>("/classes", { token: other.accessToken, body: { grade: 5, letter: "Б", program: "native" } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("teacher_not_verified");
  });

  it("the teacher creates 5 «Б», issues 24 cards and gets a PDF: 3 card pages + consent form; every QR decodes to a bare payload", async () => {
    const c = await api.post<ClassDetail>("/classes", { token: teacher.accessToken, body: { grade: 5, letter: "б", program: "native" } });
    expectStatus(c, 201);
    expect(c.body).toMatchObject({ title: "5 «Б»", letter: "Б", myRole: "teacher", seats: [], school: { id: teacher.school.id } });
    classId = c.body.id;
    const dup = await api.post<Problem>("/classes", { token: teacher.accessToken, body: { grade: 5, letter: "Б", program: "native" } });
    expect(dup.body.code).toBe("class_exists");

    const issued = await api.post<Schema<"SeatIssueResult">>(`/classes/${classId}/seats`, { token: teacher.accessToken, body: { count: 24 } });
    expectStatus(issued, 201);
    expect(issued.body.seats.map((s) => s.number)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(JSON.stringify(issued.body)).not.toMatch(/TT1\./);

    const pdf = await api.get(issued.body.printJob.pdfPath, { token: teacher.accessToken });
    expectStatus(pdf, 200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(String(pdf.headers["content-disposition"])).toMatch(/^attachment; filename="teletau-cards-5/);
    expect(pdf.headers["cache-control"]).toBe("no-store");
    const scan = await scanPdf(pdf.raw);
    expect(scan.pages).toBe(4);
    expect(scan.qr.map((p) => p.length)).toEqual([8, 8, 8, 0]);
    cardLinks = scan.qr.flat();
    for (const link of cardLinks) {
      // В QR нет адреса — системная камера не откроет браузер с секретом.
      expect(link).toMatch(/^TT1\.[0-9A-Z]{10}\.[0-9A-Z]{26}\.[0-9A-Z]{2}$/);
      expect(parseQrPayload(link).ok).toBe(true);
      remember(link, (parseQrPayload(link) as { secret: string }).secret);
    }
    // Адрес сайта (без секрета) и шаги входа напечатаны текстом.
    expect(scan.text[0]).toContain("Открой сайт localhost:3000");
    expect(scan.text[0]).toContain("Сканировать карточку");
    expect(scan.text[3]).toContain("ФИО родителя");
    expect(scan.text.join(" ")).not.toContain(teacher.fullName);

    const expired = await api.get<Problem>(`/classes/${classId}/cards.pdf?printJob=${randomUUID()}`, { token: teacher.accessToken });
    expect(expired.status).toBe(410);
    expect(expired.body.code).toBe("print_job_expired");
    expect((await audit("card.issued")).some((e) => e.target?.id === classId && (e.metadata as { count?: number }).count === 24)).toBe(true);
  });

  it("a student logs in with the QR payload, picks a nickname in under 30 s; the teacher sees «№01 · <nickname>»", async () => {
    const started = Date.now();
    const s = await api.post<AuthSession>("/auth/qr", { body: { payload: cardLinks[0], device: newDevice() } });
    expectStatus(s, 200);
    studentOne = session(s.body);
    expect(studentOne.account).toMatchObject({ kind: "child", roles: ["student"], classes: [{ id: classId, title: "5 «Б»", role: "student", seatNumber: 1 }] });
    expect(studentOne.account.nickname).toBeUndefined();
    expect(studentOne.account.profile).toBeUndefined();
    // Режим интерфейса — по номеру класса (5 класс — «Бортник»).
    expect(studentOne.account.uiMode).toBe("bortnik");

    const suggestions = await api.get<Schema<"NicknameSuggestions">>("/nicknames/suggest");
    expectStatus(suggestions, 200);
    expect(suggestions.body.items).toHaveLength(3);
    const pick = suggestions.body.items[0]!;
    const me = await api.patch<Me>("/me", { token: studentOne.accessToken, body: { nicknameId: pick.id } });
    expectStatus(me, 200);
    expect(me.body.nickname).toBe(pick.text);
    expect(Date.now() - started).toBeLessThan(30_000);

    const detail = await api.get<ClassDetail>(`/classes/${classId}`, { token: teacher.accessToken });
    expect(detail.body.seats![0]).toMatchObject({ number: 1, cardStatus: "active", cardVersion: 1, student: { accountId: studentOne.account.id, nickname: pick.text } });
    expect(Object.keys(detail.body.seats![0]!.student!).sort()).toEqual(["accountId", "joinedAt", "nickname"]);

    const asStudent = await api.get<ClassDetail>(`/classes/${classId}`, { token: studentOne.accessToken });
    expect(asStudent.body).toMatchObject({ myRole: "student", mySeatNumber: 1 });
    expect(asStudent.body.seats).toBeUndefined();

    const again = await api.post<AuthSession>("/auth/qr", { body: { payload: cardLinks[0], device: newDevice("ios") } });
    expect(again.body.account.id).toBe(studentOne.account.id);
    session(again.body);
  });

  it("child accounts have no rows in pii (ADR 0009)", async () => {
    const { rows } = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pii.adult_profiles p JOIN accounts a ON a.id = p.account_id WHERE a.kind = 'child'",
    );
    expect(rows[0]!.n).toBe(0);
    const { rows: kids } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM accounts WHERE id = $1 AND kind = 'child'", [studentOne.account.id]);
    expect(kids[0]!.n).toBe(1);
  });
});

describe("class code login (docs/demo/M1.md §5)", () => {
  it("code → request with a dictionary nickname → teacher approves → one session, then consumed", async () => {
    const code = await api.post<Schema<"JoinCode">>(`/classes/${classId}/join-code`, { token: teacher.accessToken });
    expectStatus(code, 201);
    expect(code.body.display).toMatch(/^[0-9A-Z]{3}-[0-9A-Z]{3}$/);
    remember(code.body.code);
    const detail = await api.get<ClassDetail>(`/classes/${classId}`, { token: teacher.accessToken });
    expect(detail.body.joinCode?.expiresAt).toBe(code.body.expiresAt);

    const wrong = await api.post<Problem>("/auth/class-code", { body: { code: "ZZZ-ZZZ", nicknameId: "a00.n00", device: newDevice() } });
    expect(wrong.status).toBe(404);
    expect(wrong.body.code).toBe("class_code_not_found");

    const device = newDevice("android");
    const ticket = await api.post<Schema<"ClassCodeLoginTicket">>("/auth/class-code", {
      body: { code: ` ${code.body.display.toLowerCase()} `, nicknameId: "a03.n01", device },
    });
    expectStatus(ticket, 202);
    remember(ticket.body.pollToken);
    expect(ticket.body).toMatchObject({ status: "pending", pollIntervalSeconds: 3, class: { title: "5 «Б»", grade: 5, letter: "Б" } });
    // Ответ на угаданный код не раскрывает школу (и идентификатор класса).
    expect(Object.keys(ticket.body.class).sort()).toEqual(["grade", "letter", "title"]);
    expect(JSON.stringify(ticket.body)).not.toContain(teacher.school.shortNameRu);
    const poll = (token = ticket.body.pollToken) =>
      api.get<Schema<"ClassCodeLoginStatus">>(`/auth/class-code/${ticket.body.requestId}`, { headers: { "x-poll-token": token } });
    expect((await poll()).body.status).toBe("pending");
    expect((await poll("ttp_not-the-right-token-at-all")).status).toBe(404);

    const list = await api.get<Schema<"JoinRequestList">>(`/classes/${classId}/join-requests?status=pending`, { token: teacher.accessToken });
    expect(list.body.items.map((i) => i.id)).toContain(ticket.body.requestId);
    expect((await api.get<ClassDetail>(`/classes/${classId}`, { token: teacher.accessToken })).body.pendingJoinRequestCount).toBe(1);

    const approved = await api.post<Schema<"JoinRequest">>(`/classes/${classId}/join-requests/${ticket.body.requestId}/approve`, { token: teacher.accessToken });
    expectStatus(approved, 200);
    expect(approved.body).toMatchObject({ status: "approved", seatNumber: 25, nickname: "Мудрый шмель" });
    const again = await api.post<Problem>(`/classes/${classId}/join-requests/${ticket.body.requestId}/approve`, { token: teacher.accessToken });
    expect(again.body.code).toBe("join_request_closed");

    const first = await poll();
    expect(first.body.status).toBe("approved");
    expect(first.body.session).toBeDefined();
    session(first.body.session!);
    expect(first.body.session!.account).toMatchObject({ kind: "child", nickname: "Мудрый шмель", uiMode: "bortnik", classes: [{ id: classId, seatNumber: 25 }] });
    const second = await poll();
    expect(second.body.status).toBe("consumed");
    expect(second.body.session).toBeUndefined();

    const seat = (await api.get<ClassDetail>(`/classes/${classId}`, { token: teacher.accessToken })).body.seats!.find((s) => s.number === 25)!;
    expect(seat).toMatchObject({ cardStatus: "none", cardVersion: 0, student: { nickname: "Мудрый шмель" } });
    expect((await audit("join_request.approved")).some((e) => e.target?.id === ticket.body.requestId)).toBe(true);
  });

  it("a rejected request never yields a session", async () => {
    const code = await api.post<Schema<"JoinCode">>(`/classes/${classId}/join-code`, { token: teacher.accessToken });
    remember(code.body.code);
    const t = await api.post<Schema<"ClassCodeLoginTicket">>("/auth/class-code", { body: { code: code.body.code, nicknameId: "a01.n02", device: newDevice() } });
    remember(t.body.pollToken);
    expectStatus(await api.post(`/classes/${classId}/join-requests/${t.body.requestId}/reject`, { token: teacher.accessToken }), 200);
    const p = await api.get<Schema<"ClassCodeLoginStatus">>(`/auth/class-code/${t.body.requestId}`, { headers: { "x-poll-token": t.body.pollToken } });
    expect(p.body).toMatchObject({ status: "rejected" });
    expect(p.body.session).toBeUndefined();
  });
});

describe("protection (docs/demo/M1.md §6)", () => {
  it("§6.1: another teacher cannot open the first teacher's class (403); a student of another class neither", async () => {
    const second = session(await api.verifiedTeacher("teacher-b", moderator.accessToken, 2));
    remember(second.email, second.fullName);
    const r = await api.get<Problem>(`/classes/${classId}`, { token: second.accessToken });
    expect(r.status).toBe(403);
    const own = await api.post<ClassDetail>("/classes", { token: second.accessToken, body: { grade: 7, letter: "А", program: "state" } });
    const seats = await api.post<Schema<"SeatIssueResult">>(`/classes/${own.body.id}/seats`, { token: second.accessToken, body: { count: 1 } });
    const pdf = await api.get(seats.body.printJob.pdfPath, { token: second.accessToken });
    const link = (await scanPdf(pdf.raw)).qr[0]![0]!;
    remember(link);
    const otherStudent = session((await api.post<AuthSession>("/auth/qr", { body: { payload: link, device: newDevice() } })).body);
    expect((await api.get(`/classes/${classId}`, { token: otherStudent.accessToken })).status).toBe(403);
    // Учитель B не может печатать задание учителя A, даже зная его идентификатор.
    expect((await api.get(`/classes/${classId}/cards.pdf?printJob=${seats.body.printJob.id}`, { token: second.accessToken })).status).toBe(403);
  });

  it("§6.2: reusing an old refresh token (its successor already used) revokes the whole family and is audited (session.refresh_reuse_detected)", async () => {
    const device = newDevice();
    const s0 = session((await api.post<AuthSession>("/auth/qr", { body: { payload: cardLinks[2], device } })).body);
    const r1 = await api.post<AuthSession>("/auth/refresh", { body: { refreshToken: s0.refreshToken, deviceInstallId: device.installId } });
    expectStatus(r1, 200);
    session(r1.body);
    expect(r1.body.refreshToken).not.toBe(s0.refreshToken);
    // Законный клиент уже пользуется преемником — значит, ответ не терялся, и льготного окна нет (ADR 0015 §2).
    const r2 = await api.post<AuthSession>("/auth/refresh", { body: { refreshToken: r1.body.refreshToken, deviceInstallId: device.installId } });
    expectStatus(r2, 200);
    session(r2.body);

    const reuse = await api.post<Problem>("/auth/refresh", { body: { refreshToken: s0.refreshToken, deviceInstallId: device.installId } });
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe("refresh_reused");
    // всё семейство отозвано: и новый refresh-токен, и access-токен из него
    const next = await api.post<Problem>("/auth/refresh", { body: { refreshToken: r2.body.refreshToken, deviceInstallId: device.installId } });
    expect(next.body.code).toBe("refresh_reused");
    const me = await api.get<Problem>("/me", { token: r2.body.accessToken });
    expect(me.status).toBe(401);
    expect(me.body.code).toBe("session_revoked");
    const { rows: fam } = await pool.query<{ n: number; revoked: number }>(
      "SELECT count(*)::int AS n, count(*) FILTER (WHERE revoke_reason = 'refresh_reuse')::int AS revoked FROM sessions WHERE account_id = $1 AND family_id = (SELECT family_id FROM sessions WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1)",
      [s0.account.id],
    );
    expect(fam[0]).toEqual({ n: 3, revoked: 3 });
    expect((await audit("session.refresh_reuse_detected")).some((e) => e.actor?.accountId === s0.account.id)).toBe(true);
  });

  it("a refresh token presented from another device revokes the family (session.device_mismatch)", async () => {
    const s = session((await api.post<AuthSession>("/auth/qr", { body: { payload: cardLinks[3], device: newDevice() } })).body);
    const r = await api.post<Problem>("/auth/refresh", { body: { refreshToken: s.refreshToken, deviceInstallId: randomUUID() } });
    expect(r.body.code).toBe("refresh_invalid");
    expect((await api.get("/me", { token: s.accessToken })).status).toBe(401);
    expect((await audit("session.device_mismatch")).some((e) => e.actor?.accountId === s.account.id)).toBe(true);
  });

  it("logout revokes the current session immediately", async () => {
    const s = session((await api.post<AuthSession>("/auth/qr", { body: { payload: cardLinks[4], device: newDevice() } })).body);
    expect((await api.post("/auth/logout", { token: s.accessToken })).status).toBe(204);
    expect((await api.get<Problem>("/me", { token: s.accessToken })).body.code).toBe("session_revoked");
  });

  it("§6.3: reissuing card №01 makes the old QR card_revoked, ends every session of the seat (card_reissued); the new card logs the same student in", async () => {
    // Посторонний успел войти потерянной карточкой.
    const thiefDevice = newDevice();
    const thief = session((await api.post<AuthSession>("/auth/qr", { body: { payload: cardLinks[0], device: thiefDevice } })).body);
    expect(thief.account.id).toBe(studentOne.account.id);
    expectStatus(await api.get("/me", { token: thief.accessToken }), 200);

    const r = await api.post<Schema<"SeatIssueResult">>(`/classes/${classId}/seats/1/reissue`, { token: teacher.accessToken });
    expectStatus(r, 200);
    // Все сессии ученика места завершены сразу: access-токен — 401 session_revoked, refresh — тоже.
    for (const token of [thief.accessToken, studentOne.accessToken]) {
      const me = await api.get<Problem>("/me", { token });
      expect(me.status).toBe(401);
      expect(me.body.code).toBe("session_revoked");
    }
    const refreshed = await api.post<Problem>("/auth/refresh", { body: { refreshToken: thief.refreshToken, deviceInstallId: thiefDevice.installId } });
    expect(refreshed.status).toBe(401);
    expect(refreshed.body.code).toBe("session_revoked");
    const { rows: open } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM sessions WHERE account_id = $1 AND revoked_at IS NULL", [studentOne.account.id]);
    expect(open[0]!.n).toBe(0);
    const { rows: why } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM sessions WHERE account_id = $1 AND revoke_reason = 'card_reissued'", [studentOne.account.id]);
    expect(why[0]!.n).toBeGreaterThanOrEqual(3);
    expect(r.body.seats[0]).toMatchObject({ number: 1, cardStatus: "active", cardVersion: 2, student: { accountId: studentOne.account.id } });
    const old = await api.post<Problem>("/auth/qr", { body: { payload: cardLinks[0], device: newDevice() } });
    expect(old.status).toBe(403);
    expect(old.body.code).toBe("card_revoked");
    const pdf = await api.get(r.body.printJob.pdfPath, { token: teacher.accessToken });
    const scan = await scanPdf(pdf.raw);
    expect(scan.qr[0]).toHaveLength(1);
    const fresh = scan.qr[0]![0]!;
    remember(fresh);
    const s = await api.post<AuthSession>("/auth/qr", { body: { payload: fresh, device: newDevice() } });
    expectStatus(s, 200);
    session(s.body);
    expect(s.body.account.id).toBe(studentOne.account.id);
    // в аудите — сколько семейств сессий завершено
    const entry = (await audit("card.reissued")).find((e) => (e.metadata as { classId?: string }).classId === classId)!;
    expect(entry.metadata).toMatchObject({ seatNumber: 1, version: 2, sessionsRevoked: 3 });
  });

  it("§6.4: revoking the paper consent of seat №02 blocks its card (consent_revoked) and ends the student's sessions", async () => {
    const given = await api.post<Schema<"Consent">>(`/classes/${classId}/seats/2/paper-consent`, { token: teacher.accessToken });
    expectStatus(given, 201);
    expect(given.body).toMatchObject({ method: "paper", status: "given", subject: { type: "seat", classId, seatNumber: 2 }, document: { kind: "consent_child" } });
    expect((await api.post<Problem>(`/classes/${classId}/seats/2/paper-consent`, { token: teacher.accessToken })).body.code).toBe("consent_exists");

    const kid = session((await api.post<AuthSession>("/auth/qr", { body: { payload: cardLinks[1], device: newDevice() } })).body);
    const revoked = await api.post<Schema<"Consent">>(`/consents/${given.body.id}/revoke`, { token: teacher.accessToken });
    expectStatus(revoked, 200);
    expect(revoked.body.status).toBe("revoked");
    expect((await api.post<Problem>(`/consents/${given.body.id}/revoke`, { token: teacher.accessToken })).body.code).toBe("consent_already_revoked");

    const blocked = await api.post<Problem>("/auth/qr", { body: { payload: cardLinks[1], device: newDevice() } });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("consent_revoked");
    expect(blocked.body.title).toMatch(/согласие/);
    expect((await api.get("/me", { token: kid.accessToken })).status).toBe(401);
    const seat = (await api.get<ClassDetail>(`/classes/${classId}`, { token: teacher.accessToken })).body.seats!.find((s) => s.number === 2)!;
    expect(seat.consent).toMatchObject({ status: "revoked", consentId: given.body.id });
    expect((await audit("consent.revoked")).some((e) => e.target?.id === given.body.id)).toBe(true);

    // Родитель снова подписал бланк — учитель отмечает новое согласие, вход возвращается.
    expectStatus(await api.post(`/classes/${classId}/seats/2/paper-consent`, { token: teacher.accessToken, body: { signedOn: "2026-11-02" } }), 201);
    expectStatus(await api.post("/auth/qr", { body: { payload: cardLinks[1], device: newDevice() } }), 200);
  });

  it("criterion 5: the 21st wrong QR attempt from one IP within a minute gets 429 with Retry-After", async () => {
    const ip = randomIp();
    for (let i = 0; i < 20; i++) {
      const r = await api.post<Problem>("/auth/qr", { ip, body: { payload: generateQrCard().payload, device: newDevice() } });
      expect(r.status, `попытка ${i + 1}`).toBe(401);
      expect(r.body.code).toBe("card_invalid");
    }
    const blocked = await api.post<Problem>("/auth/qr", { ip, body: { payload: generateQrCard().payload, device: newDevice() } });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("rate_limited");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    // и настоящая карточка с этого IP тоже ждёт
    expect((await api.post("/auth/qr", { ip, body: { payload: cardLinks[5], device: newDevice() } })).status).toBe(429);
    // другой IP не затронут
    expectStatus(await api.post("/auth/qr", { body: { payload: cardLinks[5], device: newDevice() } }), 200);
  });

  it("10 wrong secrets for one card block that card for everyone (per-card limit)", async () => {
    const real = parseQrPayload(cardLinks[6]!) as { seat: string };
    for (let i = 0; i < 10; i++) {
      // настоящий идентификатор карточки, чужой секрет, верная контрольная сумма
      const payload = buildQrPayload(real.seat, generateQrCard().secret);
      expect((await api.post("/auth/qr", { ip: randomIp(), body: { payload, device: newDevice() } })).status).toBe(401);
    }
    expect((await api.post("/auth/qr", { ip: randomIp(), body: { payload: cardLinks[6], device: newDevice() } })).status).toBe(429);
  });
});

describe("audit log (ADR 0017 §5)", () => {
  it("has the scenario's entries, pages with a cursor, and refuses UPDATE/DELETE even for the table owner", async () => {
    for (const action of [
      "staff.login",
      "teacher_verification.submitted",
      "teacher_verification.approved",
      "card.issued",
      "card.reissued",
      "class.join_code_issued",
      "join_request.approved",
      "join_request.rejected",
      "consent.given",
      "consent.revoked",
      "session.refresh_reuse_detected",
      "session.device_mismatch",
    ]) {
      expect((await audit(action)).length, action).toBeGreaterThan(0);
    }
    const p1 = await api.get<Schema<"AuditLogPage">>("/admin/audit-log?limit=2", { token: moderator.accessToken });
    expect(p1.body.items).toHaveLength(2);
    const p2 = await api.get<Schema<"AuditLogPage">>(`/admin/audit-log?limit=2&cursor=${p1.body.nextCursor}`, { token: moderator.accessToken });
    expect(p2.body.items[0]!.at <= p1.body.items[1]!.at).toBe(true);
    expect(p2.body.items.map((i) => i.id)).not.toContain(p1.body.items[0]!.id);
    // в метаданных нет ПДн и секретов
    const all = JSON.stringify((await api.get("/admin/audit-log?limit=100", { token: admin.accessToken })).body);
    for (const s of secrets) expect(all.includes(s), "секрет или ПДн в журнале аудита").toBe(false);

    const id = p1.body.items[0]!.id;
    await expect(pool.query("UPDATE audit_log SET action = 'card.revoked' WHERE id = $1", [id])).rejects.toMatchObject({ code: "42501" });
    await expect(pool.query("DELETE FROM audit_log WHERE id = $1", [id])).rejects.toMatchObject({ code: "42501" });
    const { rowCount } = await pool.query("SELECT 1 FROM audit_log WHERE id = $1", [id]);
    expect(rowCount).toBe(1);
  });
});

describe("logs (criterion 7)", () => {
  it("contain no e-mail, full name, card payload or secret, refresh/access/poll token or class code", () => {
    const text = captured.join("");
    expect(text).toContain("POST /api/v1/auth/qr 200");
    expect(secrets.size).toBeGreaterThan(40);
    const leaks = [...secrets].filter((s) => s.length >= 6 && text.includes(s));
    expect(leaks).toEqual([]);
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(text).not.toMatch(/tt[rp]_[A-Za-z0-9_-]{20,}/);
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
  });
});
