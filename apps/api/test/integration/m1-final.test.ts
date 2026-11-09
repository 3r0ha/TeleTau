// Код класса, выдача по заявкам и проверка должности — против Docker-стека:
// - код класса гасится на сервере (DELETE /classes/{id}/join-code); ожидающих решения заявок в классе
//   не больше 40 — сверх 429 join_queue_full, атомарно при параллельных заявках; с одного устройства в классе ждёт
//   одна заявка — новая заменяет прежнюю (та — expired);
// - JoinGrants.close находит заявки аккаунта по частичному индексу, а не полным просмотром join_requests;
// - должность без единой буквы — «Нужна хотя бы одна буква».
// Отдельная база тестов проверяет db.test.ts.
import { randomUUID } from "node:crypto";
import type { Schema } from "@teletau/contracts";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../../src/db/database.js";
import { JoinGrants, JoinService } from "../../src/modules/org/index.js";
import { bootApi, email, expectStatus, newDevice, randomIp, type AuthSession, type Device, type Res, type TestApi } from "./harness.js";

type Problem = Schema<"Problem">;
type Ticket = Schema<"ClassCodeLoginTicket">;
/** Поля Problem, кроме `status` (у заявки он строковый). */
type Fail = Partial<Pick<Problem, "code" | "title">>;
type PollStatus = Schema<"ClassCodeLoginStatus"> & Fail;
type JoinRequestList = Schema<"JoinRequestList">;
type ClassDetail = Schema<"ClassDetail">;

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;
let moderator: AuthSession;
let teacher: Awaited<ReturnType<TestApi["verifiedTeacher"]>>;

beforeAll(async () => {
  ({ api, pool, close } = await bootApi());
  moderator = await api.loginStaff("moderator");
  teacher = await api.verifiedTeacher("final", moderator.accessToken, 1);
});

afterEach(() => {
  vi.restoreAllMocks();
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

async function newClass(): Promise<string> {
  const c = await api.post<ClassDetail>("/classes", { token: teacher.accessToken, body: { grade: 4, letter: letters[letterIndex++]!, program: "native" } });
  expectStatus(c, 201);
  return c.body.id;
}

async function joinCode(classId: string): Promise<string> {
  const code = await api.post<Schema<"JoinCode">>(`/classes/${classId}/join-code`, { token: teacher.accessToken });
  expectStatus(code, 201);
  return code.body.code;
}

const request = (code: string, device: Device = newDevice(), ip = randomIp(), nicknameId = "a03.n04") =>
  api.post<Ticket & Fail>("/auth/class-code", { body: { code, nicknameId, device }, ip });

const poll = (ticket: Ticket) =>
  api.get<PollStatus>(`/auth/class-code/${ticket.requestId}`, { headers: { "x-poll-token": ticket.pollToken }, ip: randomIp() });

const listRequests = (classId: string, status?: Schema<"JoinRequestStatus">) =>
  api.get<JoinRequestList>(`/classes/${classId}/join-requests${status ? `?status=${status}` : ""}`, { token: teacher.accessToken });

async function pendingInDb(classId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM join_requests WHERE class_id = $1 AND status = 'pending' AND expires_at > now()",
    [classId],
  );
  return rows[0]!.n;
}

const closeCode = (classId: string, token = teacher.accessToken) => api.del<Problem>(`/classes/${classId}/join-code`, { token });

describe("M1-49: the join queue of a class is bounded, one pending request per device", () => {
  it("100 parallel requests by one code from different devices on one IP: exactly 40 pending, the rest 429 join_queue_full", async () => {
    const classId = await newClass();
    const code = await joinCode(classId);
    const ip = randomIp();
    const devices = Array.from({ length: 100 }, () => newDevice());
    const results = await Promise.all(devices.map((d) => request(code, d, ip)));
    expect(tally(results)).toEqual({ "202": 40, "429 join_queue_full": 60 });
    const full = results.find((r) => r.status === 429)!;
    expect(full.headers["retry-after"]).toBe("30");
    expect(full.headers["content-type"]).toContain("application/problem+json");
    expect(full.body.title).toBe("В классе слишком много заявок — подождите, пока учитель их разберёт");

    expect(await pendingInDb(classId)).toBe(40);
    expect((await listRequests(classId, "pending")).body.items).toHaveLength(40);
    expect((await api.get<ClassDetail>(`/classes/${classId}`, { token: teacher.accessToken })).body.pendingJoinRequestCount).toBe(40);

    // Устройство с ожидающей заявкой подаёт новую и при полной очереди: она заменяет прежнюю, очередь не растёт.
    const accepted = results.findIndex((r) => r.status === 202);
    const again = await request(code, devices[accepted]!, ip, "a01.n02");
    expectStatus(again, 202);
    expect(await pendingInDb(classId)).toBe(40);
    expect((await poll(results[accepted]!.body)).body.status).toBe("expired");
    // Устройство без ожидающей заявки — по-прежнему 429.
    const refused = results.findIndex((r) => r.status === 429);
    expect((await request(code, devices[refused]!, ip)).body.code).toBe("join_queue_full");

    // Учитель отклонил заявку — место в очереди освободилось ровно на одну.
    const victim = results.find((r, i) => r.status === 202 && i !== accepted)!.body;
    expectStatus(await api.post(`/classes/${classId}/join-requests/${victim.requestId}/reject`, { token: teacher.accessToken }), 200);
    expectStatus(await request(code), 202);
    expect((await request(code)).body.code).toBe("join_queue_full");

    // Истёкшие заявки (15 минут без решения) в очереди не считаются.
    await pool.query(
      `UPDATE join_requests SET expires_at = now() - interval '1 second'
       WHERE id IN (SELECT id FROM join_requests WHERE class_id = $1 AND status = 'pending' ORDER BY created_at LIMIT 3)`,
      [classId],
    );
    expect(tally(await Promise.all([request(code), request(code), request(code), request(code)]))).toEqual({ "202": 3, "429 join_queue_full": 1 });
    expect(await pendingInDb(classId)).toBe(40);
  });

  it("the same device twice: one pending request; the replaced one polls as expired and can no longer be approved", async () => {
    const classId = await newClass();
    const code = await joinCode(classId);
    const device = newDevice();
    const first = await request(code, device, randomIp(), "a00.n00");
    expectStatus(first, 202);
    const second = await request(code, device, randomIp(), "a02.n03");
    expectStatus(second, 202);
    expect(second.body.requestId).not.toBe(first.body.requestId);

    const pending = (await listRequests(classId, "pending")).body.items;
    expect(pending.map((r) => r.id)).toEqual([second.body.requestId]);
    expect((await listRequests(classId, "expired")).body.items.map((r) => r.id)).toEqual([first.body.requestId]);
    expect((await listRequests(classId)).body.items.map((r) => r.id)).toEqual([second.body.requestId, first.body.requestId]);

    const polled = await poll(first.body);
    expect(polled.status).toBe(200);
    expect(polled.body.status).toBe("expired");
    expect((await poll(second.body)).body.status).toBe("pending");
    const approveOld = await api.post<Problem>(`/classes/${classId}/join-requests/${first.body.requestId}/approve`, { token: teacher.accessToken });
    expect(approveOld.status).toBe(409);
    expect(approveOld.body.code).toBe("join_request_closed");

    // Другое устройство в том же классе свою заявку не теряет; то же устройство в другом классе — тоже.
    const other = await request(code);
    expectStatus(other, 202);
    const otherClass = await newClass();
    expectStatus(await request(await joinCode(otherClass), device), 202);
    expect((await listRequests(classId, "pending")).body.items.map((r) => r.id).sort()).toEqual([second.body.requestId, other.body.requestId].sort());
  });
});

describe("M1-49: the teacher closes the class code on the server (DELETE /classes/{id}/join-code)", () => {
  it("a new request by the closed code is 404; a request submitted before stays with the teacher and is approved; a repeated DELETE is 204", async () => {
    const classId = await newClass();
    const code = await joinCode(classId);
    const before = await request(code);
    expectStatus(before, 202);

    const closed = await closeCode(classId);
    expect(closed.status).toBe(204);
    expect(closed.raw.length).toBe(0);

    const late = await request(code);
    expect(late.status).toBe(404);
    expect(late.body.code).toBe("class_code_not_found");
    const detail = await api.get<ClassDetail>(`/classes/${classId}`, { token: teacher.accessToken });
    expect(detail.body.joinCode).toBeUndefined();
    expect(detail.body.pendingJoinRequestCount).toBe(1);

    expect((await listRequests(classId, "pending")).body.items.map((r) => r.id)).toEqual([before.body.requestId]);
    expectStatus(await api.post(`/classes/${classId}/join-requests/${before.body.requestId}/approve`, { token: teacher.accessToken }), 200);
    const granted = await poll(before.body);
    expect(granted.body.status).toBe("approved");
    expect(granted.body.session?.accessToken).toBeTruthy();

    // Повтор и закрытие без действующего кода — 204; в аудите одна запись — о погашенном действующем коде.
    expect((await closeCode(classId)).status).toBe(204);
    const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE action = 'class.join_code_closed' AND target_id = $1", [classId]);
    expect(rows[0]!.n).toBe(1);
    const otherClass = await newClass();
    expect((await closeCode(otherClass)).status).toBe(204);

    // Новый код после закрытия действует.
    expectStatus(await request(await joinCode(classId)), 202);
  });

  it("a request that found the code just before it was closed is rejected under the class lock: 404, no pending request", async () => {
    const classId = await newClass();
    const code = await joinCode(classId);
    const join = api.app.get(JoinService);
    const stale = await join.findClassByCode(code);
    expect(stale?.id).toBe(classId);
    expect((await closeCode(classId)).status).toBe(204);
    // Код проверен до закрытия (findClassByCode вернул класс), заявка дошла до записи уже после него.
    vi.spyOn(join, "findClassByCode").mockResolvedValueOnce(stale);
    const late = await request(code);
    expect(late.status).toBe(404);
    expect(late.body.code).toBe("class_code_not_found");
    expect(await pendingInDb(classId)).toBe(0);
  });

  it("another teacher gets 403 and the code keeps working; a student gets 403", async () => {
    const classId = await newClass();
    const code = await joinCode(classId);
    const other = await api.verifiedTeacher("final-b", moderator.accessToken, 2);
    const foreign = await closeCode(classId, other.accessToken);
    expect(foreign.status).toBe(403);
    const ticket = await request(code);
    expectStatus(ticket, 202);
    expectStatus(await api.post(`/classes/${classId}/join-requests/${ticket.body.requestId}/approve`, { token: teacher.accessToken }), 200);
    const student = (await poll(ticket.body)).body.session!;
    expect((await closeCode(classId, student.accessToken)).status).toBe(403);
    expect((await api.del(`/classes/${classId}/join-code`)).status).toBe(401);
    expect((await closeCode(randomUUID())).status).toBe(404);
    expectStatus(await request(code), 202);
  });
});

describe("M1-56: JoinGrants.close finds the grants of an account by the partial index", () => {
  it("EXPLAIN of the close query uses join_requests_account_grant_idx (with seq scan disabled)", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      const db = drizzle({ client, logger: { logQuery: (sql, params) => statements.push({ sql, params }) } }) as unknown as Db;
      await api.app.get(JoinGrants).close(db, randomUUID());
      const close = statements.find((s) => /update "join_requests"/i.test(s.sql));
      expect(close, "JoinGrants.close должен обновлять join_requests").toBeDefined();
      const { rows } = await client.query<{ "QUERY PLAN": string }>(`EXPLAIN ${close!.sql}`, close!.params);
      const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
      expect(plan).toContain("join_requests_account_grant_idx");
      expect(plan).not.toMatch(/Seq Scan on join_requests/);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("M1-62: a position without a single letter", () => {
  it("«1», «12», «—» get «Нужна хотя бы одна буква», not the list of allowed characters", async () => {
    const s = await api.loginAdult(email("no-letter-position"));
    await api.acceptRequiredConsents(s.accessToken);
    const school = await api.demoSchool(s.accessToken, 1);
    for (const position of ["1", "12", "—", "№ 2"]) {
      const r = await api.post<Problem>("/teacher/verification", { token: s.accessToken, body: { schoolId: school.id, fullName: "Иванова Мария Петровна", position } });
      expect(r.status, position).toBe(422);
      expect(r.body.errors, position).toEqual([{ pointer: "/position", detail: "Нужна хотя бы одна буква" }]);
    }
  });
});
