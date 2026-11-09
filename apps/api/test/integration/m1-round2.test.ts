// Против Docker-стека: ошибки БД в логах, Problem 500 и Valkey при refresh, параллельные пачки на лимиты,
// Idempotency-Key, повторная выдача сессии по коду класса, льготное окно refresh, аудит повторов, режим интерфейса
// по классу, курсоры, блокировка сотрудника, демо-сотрудники, пустой справочник документов, поиск школ.
import { randomUUID } from "node:crypto";
import { buildQrPayload, generateClassCode, generateQrCard } from "@teletau/auth-codes";
import type { Schema } from "@teletau/contracts";
import type { Redis } from "ioredis";
import { generate } from "otplib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encodeCursor } from "../../src/common/cursor.js";
import { sha256Hex } from "../../src/common/crypto.js";
import { VALKEY } from "../../src/infra/tokens.js";
import { AccountsService } from "../../src/modules/identity/accounts.service.js";
import { REFRESH_GRACE_MS, REFRESH_TOKEN_LIMIT } from "../../src/modules/identity/sessions.service.js";
import { StaffSeed } from "../../src/modules/identity/staff-seed.js";
import { DirectoryService, searchKey } from "../../src/modules/org/directory.service.js";
import { PrintJobStore } from "../../src/modules/org/print-jobs.js";
import { bootApi, DEMO_CODE, email, expectStatus, newDevice, randomIp, RUN, type AuthSession, type Device, type Res, type TestApi } from "./harness.js";

type Problem = Schema<"Problem">;

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;
let moderator: AuthSession;
let admin: AuthSession;
let teacher: Awaited<ReturnType<TestApi["verifiedTeacher"]>>;

beforeAll(async () => {
  ({ api, pool, close } = await bootApi());
  moderator = await api.loginStaff("moderator");
  admin = await api.loginStaff("admin");
  teacher = await api.verifiedTeacher("round2", moderator.accessToken, 1);
});

afterAll(async () => {
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

const letters = ["А", "Б", "В", "Г", "Д", "Е", "Ж", "З", "И", "К"];
let letterIndex = 0;

/** Класс учителя с N карточками; полезные нагрузки — из задания печати (как их увидел бы PDF). */
async function classWithCards(grade: number, count: number): Promise<{ classId: string; payloads: string[] }> {
  const c = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher.accessToken, body: { grade, letter: letters[letterIndex++]!, program: "native" } });
  expectStatus(c, 201);
  const seats = await api.post<Schema<"SeatIssueResult">>(`/classes/${c.body.id}/seats`, { token: teacher.accessToken, body: { count } });
  expectStatus(seats, 201);
  const job = await api.app.get(PrintJobStore).load(seats.body.printJob.id);
  return { classId: c.body.id, payloads: job!.cards.map((card) => card.payload) };
}

const qrLogin = (payload: string, device: Device = newDevice(), ip?: string) =>
  api.post<AuthSession>("/auth/qr", { body: { payload, device }, ...(ip ? { ip } : {}) });

const refresh = (refreshToken: string, device: Device, ip?: string) =>
  api.post<AuthSession & Problem>("/auth/refresh", { body: { refreshToken, deviceInstallId: device.installId }, ...(ip ? { ip } : {}) });

async function auditFor(action: string, targetId: string): Promise<Schema<"AuditEntry">[]> {
  const r = await api.get<Schema<"AuditLogPage">>(`/admin/audit-log?action=${action}&targetId=${targetId}&limit=100`, { token: admin.accessToken });
  expectStatus(r, 200);
  return r.body.items;
}

async function familyOf(refreshToken: string): Promise<string> {
  const { rows } = await pool.query<{ family_id: string }>("SELECT family_id FROM sessions WHERE refresh_hash = $1", [sha256Hex(refreshToken)]);
  return rows[0]!.family_id;
}

/** Перехват stdout/stderr на время fn. */
async function captureLogs(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const restore: Array<() => void> = [];
  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write.bind(stream);
    stream.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return (original as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stream.write;
    restore.push(() => (stream.write = original as typeof stream.write));
  }
  try {
    await fn();
  } finally {
    for (const r of restore) r();
  }
  return chunks.join("");
}

describe("M1-01, M1-04: database errors never put personal data or params into logs; 500 is a Problem", () => {
  it("a forced DB error while submitting a teacher verification → Problem 500; the log has SQLSTATE and the operation, no full name, position or params", async () => {
    const s = await api.loginAdult(email("db-failure"));
    await api.acceptRequiredConsents(s.accessToken);
    const school = await api.demoSchool(s.accessToken, 1);
    const fullName = `Сбойная Секретова Зульфия`;
    const position = `Завуч гимназии сбоя`;
    // Триггер срабатывает только на маркер «Сбойная» — другим тестам и стенду он не мешает. В тексте исключения — ФИО.
    await pool.query(`CREATE OR REPLACE FUNCTION pii.teletau_test_forced_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.full_name LIKE 'Сбойная%' THEN RAISE EXCEPTION 'forced failure for %', NEW.full_name USING ERRCODE = 'P0001'; END IF;
        RETURN NEW;
      END $$`);
    await pool.query("CREATE OR REPLACE TRIGGER teletau_test_forced_failure BEFORE UPDATE ON pii.adult_profiles FOR EACH ROW EXECUTE FUNCTION pii.teletau_test_forced_failure()");
    let res: Res<Problem> | undefined;
    let logs: string | undefined;
    try {
      logs = await captureLogs(async () => {
        res = await api.post<Problem>("/teacher/verification", { token: s.accessToken, body: { schoolId: school.id, fullName, position } });
      });
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS teletau_test_forced_failure ON pii.adult_profiles");
      await pool.query("DROP FUNCTION IF EXISTS pii.teletau_test_forced_failure()");
    }
    expect(res!.status).toBe(500);
    expect(String(res!.headers["content-type"])).toMatch(/^application\/problem\+json/);
    expect(res!.body).toEqual({ type: "about:blank", title: "Внутренняя ошибка", status: 500, code: "internal", instance: "/api/v1/teacher/verification" });
    expect(logs).toContain("POST /api/v1/teacher/verification → 500");
    expect(logs).toContain("SQLSTATE=P0001");
    expect(logs).toContain('update "pii"."adult_profiles"');
    for (const leak of ["Сбойная", "Секретова", "Зульфия", "Завуч", "сбоя", "forced failure for"]) expect(logs, leak).not.toContain(leak);
    expect(logs).not.toMatch(/params: (?!\[redacted\])/);
    expect(logs).not.toContain("Cannot read properties of undefined");
  });

  it("control characters in a full name are a 422, not a 500 (NUL used to reach Postgres)", async () => {
    const s = await api.loginAdult(email("nul-name"));
    await api.acceptRequiredConsents(s.accessToken);
    const school = await api.demoSchool(s.accessToken, 1);
    const r = await api.post<Problem>("/teacher/verification", {
      token: s.accessToken,
      body: { schoolId: school.id, fullName: "Секретова\u0000 Зульфия Рашитовна", position: "Завуч" },
    });
    expect(r.status).toBe(422);
    expect(r.body.errors).toEqual([{ pointer: "/fullName", detail: "Недопустимые управляющие символы" }]);
    const emoji = await api.post<Problem>("/teacher/verification", { token: s.accessToken, body: { schoolId: school.id, fullName: "😀😀 😀", position: "Завуч" } });
    expect(emoji.status).toBe(422);
    expect(emoji.body.errors?.[0]).toEqual({ pointer: "/fullName", detail: "Только русские или башкирские буквы, пробел, дефис и апостроф" });
  });

  it("validation details are in Russian: a broken UUID is «Неверный идентификатор» (M1-34)", async () => {
    const r = await api.get<Problem>("/classes/not-a-uuid", { token: teacher.accessToken });
    expect(r.status).toBe(422);
    expect(r.body.errors).toEqual([{ pointer: "#/path/id", detail: "Неверный идентификатор" }]);
    const extra = await api.post<Problem>("/classes", { token: teacher.accessToken, body: { grade: 5, letter: "Б", program: "native", color: "red" } });
    expect(extra.body.errors).toEqual([{ pointer: "/color", detail: "Лишнее поле — его нет в описании запроса" }]);
  });

  it("with Valkey unavailable a refresh-token replay answers 503, and the family is still revoked in the database (stop-list after commit)", async () => {
    const own = await bootApi();
    try {
      const device = newDevice();
      const s0 = await own.api.loginAdult(email("valkey-down"), device);
      const r1 = await own.api.post<AuthSession>("/auth/refresh", { body: { refreshToken: s0.refreshToken, deviceInstallId: device.installId } });
      expectStatus(r1, 200);
      const r2 = await own.api.post<AuthSession>("/auth/refresh", { body: { refreshToken: r1.body.refreshToken, deviceInstallId: device.installId } });
      expectStatus(r2, 200);
      const valkey = own.api.app.get<Redis>(VALKEY);
      valkey.disconnect();
      try {
        const replay = await own.api.post<Problem>("/auth/refresh", { body: { refreshToken: s0.refreshToken, deviceInstallId: device.installId } });
        expect(replay.status).toBe(503);
        expect(replay.body.code).toBe("service_unavailable");
        // Обычное обновление без Valkey тоже не проходит (лимиты и стоп-лист недоступны).
        const fresh = await own.api.loginAdult(email("valkey-down-2")).catch(() => undefined);
        expect(fresh).toBeUndefined();
      } finally {
        await valkey.connect();
      }
      const family = await familyOf(s0.refreshToken);
      const { rows } = await pool.query<{ n: number; reuse: number }>(
        "SELECT count(*)::int AS n, count(*) FILTER (WHERE revoke_reason = 'refresh_reuse')::int AS reuse FROM sessions WHERE family_id = $1",
        [family],
      );
      expect(rows[0]).toEqual({ n: 3, reuse: 3 });
      expect(await auditFor("session.refresh_reuse_detected", family)).toHaveLength(1);
      const after = await own.api.post<Problem>("/auth/refresh", { body: { refreshToken: r2.body.refreshToken, deviceInstallId: device.installId } });
      expect(after.status).toBe(401);
      expect(after.body.code).toBe("refresh_reused");
    } finally {
      await own.close();
    }
  });
});

describe("M1-05: rate limits are atomic — a parallel burst gets exactly the limit", () => {
  it("60 parallel wrong QR payloads from one IP → exactly 20 × 401, 40 × 429", async () => {
    const ip = randomIp();
    const results = await Promise.all(Array.from({ length: 60 }, () => qrLogin(generateQrCard().payload, newDevice(), ip)));
    expect(tally(results)).toEqual({ "401 card_invalid": 20, "429 rate_limited": 40 });
  });

  it("40 parallel wrong secrets for one card from different IPs → exactly 10 × 401, 30 × 429; then the card is locked", async () => {
    const { payloads } = await classWithCards(6, 1);
    const seat = payloads[0]!.split(".")[1]!;
    const results = await Promise.all(Array.from({ length: 40 }, () => qrLogin(buildQrPayload(seat, generateQrCard().secret), newDevice(), randomIp())));
    expect(tally(results)).toEqual({ "401 card_invalid": 10, "429 rate_limited": 30 });
    expect((await qrLogin(payloads[0]!, newDevice(), randomIp())).status).toBe(429);
  });

  // Неудачи кода класса считаются на устройство (10 в минуту) с потолком на IP (100 в минуту), чтобы
  // опечатки одних детей за школьным NAT не блокировали других. Гарантия та же: ровно `max` неудач при любой
  // параллельности — здесь у каждого запроса своё устройство, поэтому срабатывает потолок IP.
  it("300 parallel wrong class codes from one IP (each from its own device) → exactly 100 × 404, 200 × 429", async () => {
    const ip = randomIp();
    const results = await Promise.all(
      Array.from({ length: 300 }, () => api.post<Problem>("/auth/class-code", { ip, body: { code: generateClassCode().code, nicknameId: "a00.n00", device: newDevice() } })),
    );
    expect(tally(results)).toEqual({ "404 class_code_not_found": 100, "429 rate_limited": 200 });
  });

  it("60 parallel wrong e-mail codes on one challenge → exactly 4 × otp_invalid, the rest exhausted; the challenge is gone, not recreated", async () => {
    const ch = await api.post<Schema<"OtpChallenge">>("/auth/otp/request", { body: { email: email("otp-burst") }, ip: randomIp() });
    expectStatus(ch, 202);
    const results = await Promise.all(
      Array.from({ length: 60 }, () => api.post<Problem>("/auth/otp/verify", { body: { challengeId: ch.body.challengeId, code: "1234", device: newDevice() }, ip: randomIp() })),
    );
    const counts = tally(results);
    expect(counts["401 otp_invalid"]).toBe(4);
    expect((counts["429 otp_attempts_exceeded"] ?? 0) + (counts["401 otp_expired"] ?? 0)).toBe(56);
    expect(Object.keys(counts).every((k) => /^(401 otp_invalid|429 otp_attempts_exceeded|401 otp_expired)$/.test(k))).toBe(true);
    expect(await api.app.get<Redis>(VALKEY).exists(`otp:${ch.body.challengeId}`)).toBe(0);
    const late = await api.post<Problem>("/auth/otp/verify", { body: { challengeId: ch.body.challengeId, code: DEMO_CODE, device: newDevice() } });
    expect(late.body.code).toBe("otp_expired");
  });

  it("a double click with the correct e-mail code gives one session; the second request is otp_expired (M1-34)", async () => {
    const ch = await api.post<Schema<"OtpChallenge">>("/auth/otp/request", { body: { email: email("otp-double") }, ip: randomIp() });
    const verify = () => api.post<AuthSession & Problem>("/auth/otp/verify", { body: { challengeId: ch.body.challengeId, code: DEMO_CODE, device: newDevice() }, ip: randomIp() });
    const results = await Promise.all([verify(), verify()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(results.find((r) => r.status === 401)!.body.code).toBe("otp_expired");
  });
});

describe("M1-06: Idempotency-Key is atomic and bound to the request body", () => {
  it("5 parallel issueSeats with one key → one 201 and 4 × 409 request_in_progress; 24 seats, not 120; a later retry returns the first result", async () => {
    const c = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher.accessToken, body: { grade: 4, letter: "Ғ", program: "native" } });
    expectStatus(c, 201);
    const headers = { "idempotency-key": `race-${RUN}-${randomUUID()}` };
    const issue = (count: number) => api.post<Schema<"SeatIssueResult"> & Problem>(`/classes/${c.body.id}/seats`, { token: teacher.accessToken, headers, body: { count } });
    const results = await Promise.all(Array.from({ length: 5 }, () => issue(24)));
    expect(tally(results)).toEqual({ "201": 1, "409 request_in_progress": 4 });
    expect(Number(results.find((r) => r.status === 409)!.headers["retry-after"])).toBeGreaterThan(0);
    const detail = await api.get<Schema<"ClassDetail">>(`/classes/${c.body.id}`, { token: teacher.accessToken });
    expect(detail.body.seats).toHaveLength(24);
    const first = results.find((r) => r.status === 201)!;
    const retry = await issue(24);
    expect(retry.status).toBe(201);
    expect(retry.body.printJob.id).toBe(first.body.printJob.id);
    // Тот же ключ с другим телом — 422, мест не прибавилось.
    const other = await issue(5);
    expect(other.status).toBe(422);
    expect(other.body.code).toBe("idempotency_key_reused");
    expect(other.body.errors?.[0]?.pointer).toBe("#/header/idempotency-key");
    expect((await api.get<Schema<"ClassDetail">>(`/classes/${c.body.id}`, { token: teacher.accessToken })).body.seats).toHaveLength(24);
  });

  it("a failed first request frees the key: the retry with the same key and body is executed", async () => {
    const headers = { "idempotency-key": `fail-${RUN}-${randomUUID()}` };
    const body = { grade: 4, letter: "Ғ", program: "native" };
    const dup = await api.post<Problem>("/classes", { token: teacher.accessToken, headers, body });
    expect(dup.body.code).toBe("class_exists");
    const again = await api.post<Problem>("/classes", { token: teacher.accessToken, headers, body });
    expect(again.body.code).toBe("class_exists"); // выполнен заново, а не «в работе» и не закешированная ошибка
  });
});

describe("M1-07: a lost class-code poll response can be picked up again by the same device", () => {
  it("re-polling with X-Device-Install-Id of the request device returns a new session and revokes the previous one; other devices get consumed", async () => {
    const { classId } = await classWithCards(7, 1);
    const code = await api.post<Schema<"JoinCode">>(`/classes/${classId}/join-code`, { token: teacher.accessToken });
    const device = newDevice("android");
    const ticket = await api.post<Schema<"ClassCodeLoginTicket">>("/auth/class-code", { body: { code: code.body.code, nicknameId: "a02.n03", device } });
    expectStatus(ticket, 202);
    expectStatus(await api.post(`/classes/${classId}/join-requests/${ticket.body.requestId}/approve`, { token: teacher.accessToken }), 200);
    const poll = (installId?: string) =>
      api.get<Schema<"ClassCodeLoginStatus">>(`/auth/class-code/${ticket.body.requestId}`, {
        headers: { "x-poll-token": ticket.body.pollToken, ...(installId ? { "x-device-install-id": installId } : {}) },
      });

    const lost = await poll();
    expect(lost.body.status).toBe("approved");
    const lostSession = lost.body.session!;
    const again = await poll(device.installId);
    expect(again.body.status).toBe("approved");
    const session = again.body.session!;
    expect(session.account.id).toBe(lostSession.account.id);
    expect(session.refreshToken).not.toBe(lostSession.refreshToken);
    expect(session.account.uiMode).toBe("bortnik");
    // Прежняя сессия этого устройства отозвана, новая работает.
    expect((await api.get<Problem>("/me", { token: lostSession.accessToken })).body.code).toBe("session_revoked");
    expect((await refresh(lostSession.refreshToken, device)).body.code).toBe("session_revoked");
    expectStatus(await api.get("/me", { token: session.accessToken }), 200);
    expectStatus(await refresh(session.refreshToken, device), 200);
    // Без заголовка и с чужим устройством — consumed без сессии.
    for (const installId of [undefined, randomUUID()]) {
      const other = await poll(installId);
      expect(other.body.status).toBe("consumed");
      expect(other.body.session).toBeUndefined();
    }
    // После срока выдачи — тоже нет.
    await pool.query("UPDATE join_requests SET expires_at = now() - interval '1 second' WHERE id = $1", [ticket.body.requestId]);
    const late = await poll(device.installId);
    expect(late.body.status).toBe("consumed");
    expect(late.body.session).toBeUndefined();
  });
});

describe("M1-08, M1-09: lost refresh responses, reuse audit once per family, refresh rate limit", () => {
  let payloads: string[] = [];
  beforeAll(async () => {
    ({ payloads } = await classWithCards(8, 6));
  });

  it("a replay of the rotated token from the same device within the grace window gets a new pair without revoking the family", async () => {
    const device = newDevice("ios");
    const s0 = (await qrLogin(payloads[0]!, device)).body;
    const lost = await refresh(s0.refreshToken, device);
    expectStatus(lost, 200);
    const retry = await refresh(s0.refreshToken, device);
    expectStatus(retry, 200);
    expect(retry.body.refreshToken).not.toBe(lost.body.refreshToken);
    const family = await familyOf(s0.refreshToken);
    expect(await familyOf(retry.body.refreshToken)).toBe(family);
    expectStatus(await api.get("/me", { token: retry.body.accessToken }), 200);
    const next = await refresh(retry.body.refreshToken, device);
    expectStatus(next, 200);
    expect(await auditFor("session.refresh_reuse_detected", family)).toHaveLength(0);
    // Но если «потерянный» преемник всё-таки предъявлен — у токена два владельца: семейство отзывается.
    const stolen = await refresh(lost.body.refreshToken, device);
    expect(stolen.status).toBe(401);
    expect(stolen.body.code).toBe("refresh_reused");
    expect((await refresh(next.body.refreshToken, device)).body.code).toBe("refresh_reused");
    expect(await auditFor("session.refresh_reuse_detected", family)).toHaveLength(1);
  });

  it("outside the window, from another device, or after the successor was used, the replay is reuse", async () => {
    const device = newDevice();
    // окно истекло
    const a = (await qrLogin(payloads[1]!, device)).body;
    expectStatus(await refresh(a.refreshToken, device), 200);
    await pool.query("UPDATE sessions SET rotated_at = now() - make_interval(secs => $2) WHERE refresh_hash = $1", [sha256Hex(a.refreshToken), REFRESH_GRACE_MS / 1000 + 1]);
    expect((await refresh(a.refreshToken, device)).body.code).toBe("refresh_reused");
    // другое устройство
    const b = (await qrLogin(payloads[2]!, device)).body;
    expectStatus(await refresh(b.refreshToken, device), 200);
    expect((await refresh(b.refreshToken, newDevice())).body.code).toBe("refresh_reused");
  });

  it("200 parallel replays of one old token → 1 audit row for the family; the token limit lets 9 more reach the database (401), 191 get 429", async () => {
    const device = newDevice();
    const s0 = (await qrLogin(payloads[3]!, device)).body;
    const r1 = await refresh(s0.refreshToken, device);
    expectStatus(await refresh(r1.body.refreshToken, device), 200);
    const ip = randomIp();
    const results = await Promise.all(Array.from({ length: 200 }, () => refresh(s0.refreshToken, device, ip)));
    // Лимит токена — 10 в минуту, одно обновление этим токеном уже было (s0 → r1).
    expect(tally(results)).toEqual({ "401 refresh_reused": REFRESH_TOKEN_LIMIT.max - 1, "429 rate_limited": 200 - (REFRESH_TOKEN_LIMIT.max - 1) });
    expect(Number(results.find((r) => r.status === 429)!.headers["retry-after"])).toBeGreaterThan(0);
    const family = await familyOf(s0.refreshToken);
    expect(await auditFor("session.refresh_reuse_detected", family)).toHaveLength(1);
  });

  it("a replay of a token from an already revoked family is a silent 401 (no new audit row)", async () => {
    const device = newDevice();
    const s0 = (await qrLogin(payloads[4]!, device)).body;
    const r1 = await refresh(s0.refreshToken, device);
    expectStatus(await refresh(r1.body.refreshToken, device), 200);
    expect((await refresh(s0.refreshToken, device)).body.code).toBe("refresh_reused");
    const family = await familyOf(s0.refreshToken);
    for (let i = 0; i < 3; i++) expect((await refresh(s0.refreshToken, device, randomIp())).status).toBe(401);
    expect(await auditFor("session.refresh_reuse_detected", family)).toHaveLength(1);
  });
});

describe("M1-16: the UI mode follows the grade until the student picks one", () => {
  it("grade 3 → bee, grade 10 → keeper; a manual choice survives the next login", async () => {
    const young = await classWithCards(3, 1);
    const old = await classWithCards(10, 1);
    const bee = await qrLogin(young.payloads[0]!);
    expect(bee.body.account.uiMode).toBe("bee");
    const keeper = await qrLogin(old.payloads[0]!);
    expect(keeper.body.account.uiMode).toBe("keeper");
    const picked = await api.patch<Schema<"Me">>("/me", { token: bee.body.accessToken, body: { uiMode: "keeper" } });
    expect(picked.body.uiMode).toBe("keeper");
    const again = await qrLogin(young.payloads[0]!);
    expect(again.body.account.uiMode).toBe("keeper");
  });
});

describe("M1-19: cursors are validated per endpoint → 422, not 500", () => {
  it("rejects foreign and broken cursors on schools, audit log and the moderation queue", async () => {
    const bad = [
      ["/schools", teacher.accessToken, encodeCursor({ o: -5 })],
      ["/schools", teacher.accessToken, encodeCursor({ at: "x", id: "y" })],
      ["/admin/audit-log", admin.accessToken, encodeCursor({ at: "x", id: "y" })],
      ["/admin/audit-log", admin.accessToken, encodeCursor({ o: 1 })],
      ["/moderation/teacher-verifications", moderator.accessToken, encodeCursor({ at: "2026-11-03T00:00:00Z", id: "not-a-uuid" })],
    ] as const;
    for (const [path, token, cursor] of bad) {
      const r = await api.get<Problem>(`${path}?cursor=${cursor}`, { token });
      expect(r.status, path).toBe(422);
      expect(r.body.errors?.[0]?.pointer).toBe("#/query/cursor");
    }
  });
});

describe("M1-20, M1-21: staff lockout after wrong TOTP codes; demo staff behind their own flag", () => {
  const secret = "TELETAUTESTSTAFFLOCKSECRETCCCCCC";
  const staffEmail = `staff-lock.${RUN}@demo.teletau.local`;
  const created: string[] = [];
  /** Вход сотрудника: e-mail → демо-код → TOTP (лимит запросов кода на адрес сбрасывается — он не предмет теста). */
  const staffAttempt = async (address: string, totp: string) => {
    await api.app.get<Redis>(VALKEY).del(`rl:otp:email:${api.app.get(AccountsService).emailSubject(address).slice(0, 24)}`);
    const ch = await api.post<Schema<"OtpChallenge">>("/auth/otp/request", { body: { email: address }, ip: randomIp() });
    return api.post<AuthSession & Problem>("/auth/otp/verify", { body: { challengeId: ch.body.challengeId, code: DEMO_CODE, totp, device: newDevice() }, ip: randomIp() });
  };
  // Тестовые сотрудники с известным секретом TOTP не остаются в базе (аудит без внешних ключей — его строки остаются).
  afterAll(async () => {
    if (created.length) await pool.query("DELETE FROM accounts WHERE id = ANY($1::uuid[]) AND kind = 'staff'", [created]);
  });

  it("10 wrong TOTP codes within an hour lock the staff account for an hour (429 staff_locked, audit staff.locked once)", async () => {
    const accountId = await api.app.get(StaffSeed).ensure({ email: staffEmail, roles: ["moderator"], totpSecret: secret });
    created.push(accountId);
    const attempt = (totp: string) => staffAttempt(staffEmail, totp);
    const codes: string[] = [];
    for (let i = 0; i < 10; i++) codes.push((await attempt("000000")).body.code ?? "");
    expect(codes.slice(0, 9).every((c) => c === "totp_invalid")).toBe(true);
    expect(codes[9]).toBe("staff_locked");
    // Даже верный код теперь не пускает.
    const right = await attempt(await generate({ secret }));
    expect(right.status).toBe(429);
    expect(right.body.code).toBe("staff_locked");
    expect(Number(right.headers["retry-after"])).toBeGreaterThan(3000);
    const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE action = 'staff.locked' AND actor_account_id = $1", [accountId]);
    expect(rows[0]!.n).toBe(1);
  });

  it("a replayed valid TOTP code is refused but does not count toward the lockout (the harness and e2e retry the next step)", async () => {
    const replayEmail = `staff-replay.${RUN}@demo.teletau.local`;
    const accountId = await api.app.get(StaffSeed).ensure({ email: replayEmail, roles: ["moderator"], totpSecret: secret });
    created.push(accountId);
    const code = await generate({ secret });
    expectStatus(await staffAttempt(replayEmail, code), 200);
    const replays: string[] = [];
    for (let i = 0; i < 11; i++) replays.push((await staffAttempt(replayEmail, code)).body.code ?? "");
    expect(replays.every((c) => c === "totp_invalid")).toBe(true);
    expect(await api.app.get<Redis>(VALKEY).exists(`staff-lock:${accountId}`)).toBe(0);
    expect(await api.app.get<Redis>(VALKEY).exists(`rl:totp-fail:${accountId}`)).toBe(0);
  });

  it("with AUTH_DEMO_STAFF off, previously seeded demo staff are blocked and their sessions end", async () => {
    const seed = api.app.get(StaffSeed);
    const demo = { email: `demo-off.${RUN}@demo.teletau.local`, roles: ["moderator" as const], totpSecret: secret };
    const accountId = await seed.ensure(demo);
    created.push(accountId);
    await seed.disableDemoStaff([demo]);
    const { rows } = await pool.query<{ status: string }>("SELECT status FROM accounts WHERE id = $1", [accountId]);
    expect(rows[0]!.status).toBe("blocked");
    // Включили флаг снова — сид возвращает доступ.
    await seed.ensure(demo);
    const { rows: back } = await pool.query<{ status: string }>("SELECT status FROM accounts WHERE id = $1", [accountId]);
    expect(back[0]!.status).toBe("active");
  });
});

describe("M1-28: an empty legal documents directory is 503, not «terms accepted»", () => {
  it("accepting and checking terms answer 503 documents_unavailable; /me lists the required kinds as pending", async () => {
    const s = await api.loginAdult(email("no-documents"));
    const school = await api.demoSchool(s.accessToken, 1);
    const docs = await api.get<Schema<"LegalDocumentList">>("/legal-documents/current");
    // Часы раньше начала действия всех версий: действующих документов нет (как при несработавшем сиде).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    try {
      const accept = await api.post<Problem>("/consents", { token: s.accessToken, body: { documentIds: docs.body.items.map((d) => d.id) } });
      expect(accept.status).toBe(503);
      expect(accept.body.code).toBe("documents_unavailable");
      const submit = await api.post<Problem>("/teacher/verification", { token: s.accessToken, body: { schoolId: school.id, fullName: "Иванова Мария Петровна", position: "Учитель" } });
      expect(submit.status).toBe(503);
      expect(submit.body.code).toBe("documents_unavailable");
      const me = await api.get<Schema<"Me">>("/me", { token: s.accessToken });
      expect([...me.body.pendingConsents].sort()).toEqual(["consent_adult", "privacy", "terms"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("M1-29, M1-34: school search uses the trigram indexes and treats «№ 1» as «№1»", () => {
  it("the SQL key org_search_fold equals the TS search key", async () => {
    const sample = "СОШ № 1 Ҡ Ғ Ҙ Ҫ Һ Ә Ө Ү Ң Ё ҡғҙҫһәөүңё №12";
    const { rows } = await pool.query<{ k: string }>("SELECT org_search_fold($1) AS k", [sample]);
    expect(rows[0]!.k).toBe(searchKey(sample));
  });

  it("EXPLAIN of the search query scans the expression indexes (with seq scan disabled)", async () => {
    const query = api.app.get(DirectoryService).searchQuery({ q: "школа №1", limit: 20 }).toSQL();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      const { rows } = await client.query<{ "QUERY PLAN": string }>(`EXPLAIN ${query.sql}`, query.params);
      const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
      expect(plan).toContain("schools_name_ru_fold_trgm_idx");
      expect(plan).toContain("schools_short_name_ru_fold_trgm_idx");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("«школа №1» and «школа № 1» find the same schools", async () => {
    const a = await api.get<Schema<"SchoolPage">>(`/schools?q=${encodeURIComponent("Демо-школа №1")}`, { token: teacher.accessToken });
    const b = await api.get<Schema<"SchoolPage">>(`/schools?q=${encodeURIComponent("Демо-школа № 1")}`, { token: teacher.accessToken });
    expect(a.body.items.map((s) => s.id)).toEqual(b.body.items.map((s) => s.id));
    expect(a.body.items[0]!.shortNameRu).toBe("Демо-школа № 1");
  });
});
