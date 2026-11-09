// Краевые случаи против Docker-стека: вход по e-mail (лимит попыток, демо-режим выключен → 503, одинаковый ответ),
// справочник (импорт идемпотентен, поиск без учёта регистра и «ё/е», пагинация), Idempotency-Key, лимит мест,
// пустое JSON-тело, отказ и повторная заявка учителя, версии документов и их тексты, проверка схемы.
import { createHash } from "node:crypto";
import type { Schema } from "@teletau/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importDirectory } from "../../src/modules/org/directory-import.js";
import { bootApi, email, expectStatus, newDevice, testConfig, type AuthSession, type TestApi } from "./harness.js";

type Problem = Schema<"Problem">;

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;
let moderator: AuthSession;
let teacher: Awaited<ReturnType<TestApi["verifiedTeacher"]>>;

beforeAll(async () => {
  ({ api, pool, close } = await bootApi());
  moderator = await api.loginStaff("moderator");
  teacher = await api.verifiedTeacher("edges", moderator.accessToken, 3);
});

afterAll(async () => {
  await close?.();
});

describe("e-mail login (ADR 0015 §4)", () => {
  it("answers the same for a new and an existing address", async () => {
    const a = await api.post<Schema<"OtpChallenge">>("/auth/otp/request", { body: { email: teacher.email } });
    const b = await api.post<Schema<"OtpChallenge">>("/auth/otp/request", { body: { email: email("never-seen") } });
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(Object.keys(a.body).sort()).toEqual(Object.keys(b.body).sort());
    expect(a.body).toMatchObject({ codeLength: 4, resendAfterSeconds: b.body.resendAfterSeconds });
  });

  it("gives 5 attempts: wrong codes → otp_invalid, the 5th → 429 otp_attempts_exceeded, then the challenge is gone", async () => {
    const ch = await api.post<Schema<"OtpChallenge">>("/auth/otp/request", { body: { email: email("brute") } });
    const tryCode = (code: string) => api.post<Problem>("/auth/otp/verify", { body: { challengeId: ch.body.challengeId, code, device: newDevice() } });
    for (let i = 0; i < 4; i++) expect((await tryCode("1111")).body.code).toBe("otp_invalid");
    const fifth = await tryCode("2222");
    expect(fifth.status).toBe(429);
    expect(fifth.body.code).toBe("otp_attempts_exceeded");
    expect((await tryCode("0000")).body.code).toBe("otp_expired");
  });

  it("limits code requests per address", async () => {
    const address = email("spam");
    for (let i = 0; i < 5; i++) expectStatus(await api.post("/auth/otp/request", { body: { email: address } }), 202);
    const sixth = await api.post<Problem>("/auth/otp/request", { body: { email: address } });
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("without demo mode and without a mail provider answers 503 email_login_unavailable", async () => {
    const off = await bootApi({ ...testConfig(), AUTH_DEMO_OTP: undefined });
    try {
      const r = await off.api.post<Problem>("/auth/otp/request", { body: { email: email("no-mail") } });
      expect(r.status).toBe(503);
      expect(r.body.code).toBe("email_login_unavailable");
    } finally {
      await off.close();
    }
  });

  it("a nickname is for children only; unknown dictionary ids are 422", async () => {
    const r = await api.patch<Problem>("/me", { token: teacher.accessToken, body: { nicknameId: "a00.n00" } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("nickname_not_allowed");
    const ok = await api.patch<Schema<"Me">>("/me", { token: teacher.accessToken, body: { uiMode: "keeper", locale: "ba" } });
    expect(ok.body).toMatchObject({ uiMode: "keeper", locale: "ba" });
    expect((await api.patch<Problem>("/me", { token: teacher.accessToken, body: {} })).status).toBe(422);
  });
});

describe("directory of districts and schools (apps/api/data)", () => {
  it("imports idempotently: a second run changes nothing", async () => {
    await importDirectory(pool, { demo: true });
    const again = await importDirectory(pool, { demo: true });
    expect(again.districts).toMatchObject({ inserted: 0, updated: 0 });
    expect(again.schools).toMatchObject({ inserted: 0, updated: 0 });
    expect(again.schools.unchanged).toBeGreaterThan(1600);
  });

  it("lists 63 districts and urban okrugs (okrugs first) plus the demo district last", async () => {
    const r = await api.get<Schema<"DistrictList">>("/districts", { token: teacher.accessToken });
    const real = r.body.items.filter((d) => !d.oktmo.startsWith("demo"));
    expect(real).toHaveLength(63);
    expect(real[0]!.kind).toBe("urban_okrug");
    expect(r.body.items.at(-1)!.oktmo).toBe("demo-0001");
    expect(r.body.items.every((d) => d.nameBa === undefined)).toBe(true);
  });

  it("searches by name ignoring case and ё/е, filters by district and pages with a cursor", async () => {
    const lower = await api.get<Schema<"SchoolPage">>(`/schools?q=${encodeURIComponent("гимназия")}&limit=5`, { token: teacher.accessToken });
    expect(lower.body.items).toHaveLength(5);
    expect(lower.body.items.every((s) => /гимнази/i.test(s.nameRu + s.shortNameRu))).toBe(true);
    const next = await api.get<Schema<"SchoolPage">>(`/schools?q=${encodeURIComponent("гимназия")}&limit=5&cursor=${lower.body.nextCursor}`, {
      token: teacher.accessToken,
    });
    expect(next.body.items.map((s) => s.id)).not.toContain(lower.body.items[0]!.id);
    const yo = await api.get<Schema<"SchoolPage">>(`/schools?q=${encodeURIComponent("Киселева")}`, { token: teacher.accessToken });
    expect(yo.body.items.some((s) => s.nameRu.includes("Киселёва"))).toBe(true);
    // Свёртка @teletau/bashkir-text (правило 7): особые буквы и казахский двойник «қ» сравниваются как русские.
    for (const q of ["Ҡиселёва", "қиселева"]) {
      const folded = await api.get<Schema<"SchoolPage">>(`/schools?q=${encodeURIComponent(q)}`, { token: teacher.accessToken });
      expect(folded.body.items.some((s) => s.nameRu.includes("Киселёва")), q).toBe(true);
    }
    const ufa = (await api.get<Schema<"DistrictList">>("/districts", { token: teacher.accessToken })).body.items.find((d) => d.nameRu.includes("Уфа"))!;
    const inUfa = await api.get<Schema<"SchoolPage">>(`/schools?district=${ufa.id}&limit=100`, { token: teacher.accessToken });
    expect(inUfa.body.items.every((s) => s.districtId === ufa.id)).toBe(true);
    expect(inUfa.body.nextCursor).toBeDefined();
    expect((await api.get<Problem>("/schools?q=a", { token: teacher.accessToken })).status).toBe(422);
    expect((await api.get<Problem>("/schools?cursor=garbage", { token: teacher.accessToken })).body.code).toBe("validation_failed");
  });
});

describe("classes and seats", () => {
  it("Idempotency-Key returns the first result for createClass and issueSeats", async () => {
    const key = { "idempotency-key": `create-${Date.now()}` };
    const a = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher.accessToken, headers: key, body: { grade: 3, letter: "Ә", program: "native" } });
    expectStatus(a, 201);
    expect(a.body.title).toBe("3 «Ә»");
    const b = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher.accessToken, headers: key, body: { grade: 3, letter: "Ә", program: "native" } });
    expect(b.body.id).toBe(a.body.id);

    const seatKey = { "idempotency-key": `seats-${Date.now()}` };
    const s1 = await api.post<Schema<"SeatIssueResult">>(`/classes/${a.body.id}/seats`, { token: teacher.accessToken, headers: seatKey, body: { count: 40 } });
    const s2 = await api.post<Schema<"SeatIssueResult">>(`/classes/${a.body.id}/seats`, { token: teacher.accessToken, headers: seatKey, body: { count: 40 } });
    expect(s2.body.printJob.id).toBe(s1.body.printJob.id);
    expectStatus(await api.post(`/classes/${a.body.id}/seats`, { token: teacher.accessToken, body: { count: 40 } }), 201);
    const over = await api.post<Problem>(`/classes/${a.body.id}/seats`, { token: teacher.accessToken, body: { count: 20 } });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe("seat_limit_exceeded");
    const detail = await api.get<Schema<"ClassDetail">>(`/classes/${a.body.id}`, { token: teacher.accessToken });
    expect(detail.body.seats).toHaveLength(80);
    const list = await api.get<Schema<"ClassList">>("/classes", { token: teacher.accessToken });
    expect(list.body.items.find((c) => c.id === a.body.id)).toMatchObject({ seatCount: 80, studentCount: 0, myRole: "teacher" });
    expect((await api.get<Problem>(`/classes/${a.body.id}/seats/99/reissue`, { token: teacher.accessToken })).status).toBe(404);
    expect((await api.post<Problem>(`/classes/${a.body.id}/seats/99/reissue`, { token: teacher.accessToken })).body.code).toBe("not_found");
  });

  it("accepts an empty JSON body on POST without a request body (fetch from the browser)", async () => {
    const c = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher.accessToken, body: { grade: 2, letter: "Г", program: "state" } });
    const res = await api.app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: `/api/v1/classes/${c.body.id}/join-code`,
      headers: { authorization: `Bearer ${teacher.accessToken}`, "content-type": "application/json" },
      payload: "",
    });
    expect(res.statusCode).toBe(201);
    const broken = await api.app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/api/v1/auth/qr",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(broken.statusCode).toBe(400);
    expect(broken.json()).toMatchObject({ code: "bad_request" });
  });

  it("polling without X-Poll-Token is a 422, too many nicknames is a 422", async () => {
    expect((await api.get<Problem>(`/auth/class-code/${crypto.randomUUID()}`)).status).toBe(422);
    expect((await api.get<Problem>("/nicknames/suggest?count=11")).status).toBe(422);
  });
});

describe("teacher verification and consents", () => {
  it("rejection with a reason is visible to the applicant, who may apply again; a decision cannot be changed", async () => {
    const s = await api.loginAdult(email("rejected"));
    await api.acceptRequiredConsents(s.accessToken);
    const school = await api.demoSchool(s.accessToken, 2);
    const v = await api.post<Schema<"TeacherVerification">>("/teacher/verification", {
      token: s.accessToken,
      body: { schoolId: school.id, fullName: "Отказанова Анна Ивановна", position: "Учитель" },
    });
    expect((await api.post<Problem>("/teacher/verification", { token: s.accessToken, body: { schoolId: school.id, fullName: "Отказанова А. И.", position: "Учитель" } })).body.code).toBe(
      "verification_pending",
    );
    const page = await api.get<Schema<"TeacherVerificationPage">>("/moderation/teacher-verifications?limit=100", { token: moderator.accessToken });
    expect(page.body.items.find((i) => i.id === v.body.id)?.applicant).toMatchObject({ email: email("rejected"), fullName: "Отказанова Анна Ивановна" });
    const r = await api.post<Schema<"TeacherVerification">>(`/moderation/teacher-verifications/${v.body.id}/reject`, {
      token: moderator.accessToken,
      body: { reason: "Школа не подтвердила" },
    });
    expect(r.body).toMatchObject({ status: "rejected", decisionReason: "Школа не подтвердила" });
    // Причина отказа (свободный текст, в нём бывают ПДн) — только в схеме pii.
    const { rows: outside } = await pool.query("SELECT decision_reason FROM teacher_verifications WHERE id = $1", [v.body.id]);
    expect(outside[0]).toEqual({ decision_reason: null });
    const { rows: inPii } = await pool.query("SELECT reason FROM pii.teacher_verification_reasons WHERE verification_id = $1", [v.body.id]);
    expect(inPii[0]).toEqual({ reason: "Школа не подтвердила" });
    expect((await api.post<Problem>(`/moderation/teacher-verifications/${v.body.id}/approve`, { token: moderator.accessToken })).body.code).toBe("already_decided");
    const me = await api.get<Schema<"Me">>("/me", { token: s.accessToken });
    expect(me.body.teacherStatus).toBe("rejected");
    expect((await api.get<Schema<"TeacherVerification">>("/teacher/verification", { token: s.accessToken })).body.decisionReason).toBe("Школа не подтвердила");
    expectStatus(
      await api.post("/teacher/verification", { token: s.accessToken, body: { schoolId: school.id, fullName: "Отказанова Анна Ивановна", position: "Завуч" } }),
      201,
    );
    // ФИО и должность — в pii, в teacher_verifications должности нет
    const { rows } = await pool.query("SELECT position FROM teacher_verifications WHERE account_id = $1", [s.account.id]);
    expect(rows.every((x: { position: string | null }) => x.position === null)).toBe(true);
    const { rows: pii } = await pool.query("SELECT full_name, position FROM pii.adult_profiles WHERE account_id = $1", [s.account.id]);
    expect(pii[0]).toEqual({ full_name: "Отказанова Анна Ивановна", position: "Завуч" });
    expect((await api.post<Problem>("/teacher/verification", { token: teacher.accessToken, body: { schoolId: school.id, fullName: "Учитель Тест", position: "Учитель" } })).body.code).toBe(
      "already_verified",
    );
  });

  it("current documents: one version per kind; only current versions are accepted; re-accepting is idempotent; revoking reopens it", async () => {
    const docs = await api.get<Schema<"LegalDocumentList">>("/legal-documents/current");
    expect(docs.body.items.map((d) => d.kind).sort()).toEqual(["consent_adult", "consent_child", "privacy", "terms"]);
    expect((await api.get<Schema<"LegalDocumentList">>("/legal-documents/current?kind=consent_child")).body.items).toHaveLength(1);
    const s = await api.loginAdult(email("consents"));
    const terms = docs.body.items.find((d) => d.kind === "terms")!;
    const first = await api.post<Schema<"ConsentList">>("/consents", { token: s.accessToken, body: { documentIds: [terms.id] } });
    const second = await api.post<Schema<"ConsentList">>("/consents", { token: s.accessToken, body: { documentIds: [terms.id] } });
    expect(second.body.items[0]!.id).toBe(first.body.items[0]!.id);
    expect((await api.post<Problem>("/consents", { token: s.accessToken, body: { documentIds: [crypto.randomUUID()] } })).body.code).toBe("document_not_current");
    expect((await api.get<Schema<"Me">>("/me", { token: s.accessToken })).body.pendingConsents.sort()).toEqual(["consent_adult", "privacy"]);
    expectStatus(await api.post(`/consents/${first.body.items[0]!.id}/revoke`, { token: s.accessToken }), 200);
    expect((await api.get<Schema<"Me">>("/me", { token: s.accessToken })).body.pendingConsents).toContain("terms");
  });

  it("document text: any published version by kind and version (anonymous); url points to the web page; unknown version is 404", async () => {
    const docs = await api.get<Schema<"LegalDocumentList">>("/legal-documents/current");
    for (const d of docs.body.items) {
      expect(d.url).toMatch(new RegExp(`^https?://[^/]+/legal/${d.kind}/${d.version}$`));
      const text = await api.get<Schema<"LegalDocumentText">>(`/legal-documents/${d.kind}/${d.version}`);
      expect(text.status).toBe(200);
      expect(text.body).toMatchObject({ id: d.id, kind: d.kind, version: d.version, title: d.title, url: d.url });
      expect(text.body.body.length).toBeGreaterThan(0);
      // Хеш принятого текста совпадает с показанным: человек читает ровно ту версию, с которой соглашается.
      expect(createHash("sha256").update(text.body.body.join("\n\n"), "utf8").digest("hex")).toBe(text.body.bodySha256);
    }
    expect((await api.get<Problem>("/legal-documents/terms/1999-01-01")).status).toBe(404);
    expect((await api.get<Problem>("/legal-documents/unknown/2026-11-01")).status).toBe(422);
    expect((await api.get<Problem>("/legal-documents/terms/latest")).status).toBe(422);
  });
});
