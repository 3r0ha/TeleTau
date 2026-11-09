// ClassesService.printJobCards — карточки задания печати для демо-сида (src/demo/seed.ts): ровно те полезные нагрузки,
// что в PDF, с теми же проверками (учитель класса, живые карточки задания). По HTTP секреты — только в PDF.
import type { Schema } from "@teletau/contracts";
import { parseQrPayload } from "@teletau/auth-codes";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "../../src/common/auth.js";
import { ApiError } from "../../src/common/problem.js";
import { ClassesService } from "../../src/modules/org/index.js";
import { scanPdf } from "../support/pdf-qr.js";
import { bootApi, expectStatus, newDevice, type AuthSession, type TestApi } from "./harness.js";

let api: TestApi;
let close: () => Promise<void>;
let teacher: AuthSession;
let other: AuthSession;
let classId: string;

const principal = (s: AuthSession): Principal => ({ accountId: s.account.id, kind: s.account.kind, roles: s.account.roles, sessionId: "t", deviceId: "t" });

beforeAll(async () => {
  ({ api, close } = await bootApi());
  const moderator = await api.loginStaff("moderator");
  teacher = await api.verifiedTeacher("demo-cards-a", moderator.accessToken, 1);
  other = await api.verifiedTeacher("demo-cards-b", moderator.accessToken, 2);
  const c = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher.accessToken, body: { grade: 5, letter: "Д", program: "native" } });
  expectStatus(c, 201);
  classId = c.body.id;
});

afterAll(async () => {
  await close?.();
});

describe("ClassesService.printJobCards (demo seed)", () => {
  it("returns the same payloads as the PDF; a card logs the student in", async () => {
    const issued = await api.post<Schema<"SeatIssueResult">>(`/classes/${classId}/seats`, { token: teacher.accessToken, body: { count: 3 } });
    expectStatus(issued, 201);
    const cards = await api.app.get(ClassesService).printJobCards(principal(teacher), classId, issued.body.printJob.id);
    expect(cards.map((c) => c.seatNumber)).toEqual([1, 2, 3]);
    for (const c of cards) expect(parseQrPayload(c.payload).ok).toBe(true);
    const pdf = await scanPdf((await api.get(issued.body.printJob.pdfPath, { token: teacher.accessToken })).raw);
    expect(pdf.qr.flat()).toEqual(cards.map((c) => c.payload));
    const login = await api.post<AuthSession>("/auth/qr", { body: { payload: cards[0]!.payload, device: newDevice() } });
    expectStatus(login, 200);
  }, 60_000);

  it("only the class teacher; reissued cards drop out; a fully replaced job is gone", async () => {
    const issued = await api.post<Schema<"SeatIssueResult">>(`/classes/${classId}/seats`, { token: teacher.accessToken, body: { count: 2 } });
    expectStatus(issued, 201);
    const service = api.app.get(ClassesService);
    const jobId = issued.body.printJob.id;
    await expect(service.printJobCards(principal(other), classId, jobId)).rejects.toMatchObject({ status: 403 });

    const [first, second] = issued.body.seats.map((s) => s.number);
    expectStatus(await api.post(`/classes/${classId}/seats/${first}/reissue`, { token: teacher.accessToken }), 200);
    const live = await service.printJobCards(principal(teacher), classId, jobId);
    expect(live.map((c) => c.seatNumber)).toEqual([second]);

    expectStatus(await api.post(`/classes/${classId}/seats/${second}/reissue`, { token: teacher.accessToken }), 200);
    const gone = await service.printJobCards(principal(teacher), classId, jobId).catch((e: unknown) => e);
    expect(gone).toBeInstanceOf(ApiError);
    expect(gone).toMatchObject({ status: 410, code: "print_job_replaced" });
  });
});
