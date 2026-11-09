// Постоянный код класса стенда показа (AUTH_DEMO_CLASS_CODE): «Показать код класса» выдаёт этот код на год,
// «Закрыть код класса» его не гасит, при выпуске для другого класса код переходит к нему. Заявки и одобрение — как
// у обычного кода. Без настройки (testConfig) — обычные коды на 15 минут (m1-final.test.ts).
import type { Schema } from "@teletau/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApi, expectStatus, newDevice, testConfig, type AuthSession, type TestApi } from "./harness.js";

type Ticket = Schema<"ClassCodeLoginTicket">;

let api: TestApi;
let close: () => Promise<void>;
let teacher: AuthSession;
let other: AuthSession;

beforeAll(async () => {
  ({ api, close } = await bootApi({ ...testConfig(), AUTH_DEMO_CLASS_CODE: "000000" }));
  const moderator = await api.loginStaff("moderator");
  teacher = await api.verifiedTeacher("demo-code-a", moderator.accessToken, 1);
  other = await api.verifiedTeacher("demo-code-b", moderator.accessToken, 2);
});

afterAll(async () => {
  await close?.();
});

const newClass = async (token: string, letter: string) => {
  const c = await api.post<Schema<"ClassDetail">>("/classes", { token, body: { grade: 3, letter, program: "native" } });
  expectStatus(c, 201);
  return c.body.id;
};
const issue = async (token: string, classId: string) => {
  const r = await api.post<Schema<"JoinCode">>(`/classes/${classId}/join-code`, { token });
  expectStatus(r, 201);
  return r.body;
};
const request = (code: string, nicknameId = "a05.n07") => api.post<Ticket>("/auth/class-code", { body: { code, nicknameId, device: newDevice() } });

describe("AUTH_DEMO_CLASS_CODE: permanent demo class code", () => {
  it("issues 000-000 for a year; closing keeps it; a request by it still reaches the teacher", async () => {
    const classId = await newClass(teacher.accessToken, "Ж");
    const code = await issue(teacher.accessToken, classId);
    expect(code).toMatchObject({ code: "000000", display: "000-000", permanent: true });
    expect(Date.parse(code.expiresAt) - Date.now()).toBeGreaterThan(360 * 24 * 3600 * 1000);
    // Повторный выпуск — тот же код.
    expect((await issue(teacher.accessToken, classId)).code).toBe("000000");

    expect((await api.del(`/classes/${classId}/join-code`, { token: teacher.accessToken })).status).toBe(204);
    const ticket = await request("000-000");
    expectStatus(ticket, 202);
    expect(ticket.body.class.title).toBe("3 «Ж»");
    const pending = await api.get<Schema<"JoinRequestList">>(`/classes/${classId}/join-requests?status=pending`, { token: teacher.accessToken });
    expect(pending.body.items.map((r) => r.id)).toContain(ticket.body.requestId);
    // Учитель одобряет — как с обычным кодом.
    expectStatus(await api.post(`/classes/${classId}/join-requests/${ticket.body.requestId}/approve`, { token: teacher.accessToken }), 200);
  });

  it("issued for another class, the code moves to it: the first class no longer has it", async () => {
    const first = await newClass(teacher.accessToken, "З");
    await issue(teacher.accessToken, first);
    const second = await newClass(other.accessToken, "И");
    expect((await issue(other.accessToken, second)).code).toBe("000000");

    const ticket = await request("000000", "a06.n08");
    expectStatus(ticket, 202);
    expect(ticket.body.class.title).toBe("3 «И»");
    const firstDetail = await api.get<Schema<"ClassDetail">>(`/classes/${first}`, { token: teacher.accessToken });
    expect(firstDetail.body.joinCode).toBeUndefined();
    const secondDetail = await api.get<Schema<"ClassDetail">>(`/classes/${second}`, { token: other.accessToken });
    expect(secondDetail.body.joinCode).toBeDefined();
  });
});
