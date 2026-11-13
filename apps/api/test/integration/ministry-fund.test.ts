// Кабинет министерства и словарь для Фонда (ADR 0023): настоящее приложение против Docker-стека.
// Министерство: свой тестовый район с тремя подключёнными школами (6, 3 и 7 учеников) и одной без классов —
// числа района и школ, «< 5» у малой школы и дополнительное скрытие самой маленькой из остальных, динамика по неделям,
// ни ников, ни идентификаторов учеников в ответах. Фонд: принятая пара синтетической дуэли — голоса по группам,
// источник варианта, «предварительно». Доступ — только у своих ролей.
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Schema } from "@teletau/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "../../src/common/auth.js";
import { uuidv7 } from "../../src/common/uuidv7.js";
import type { Db } from "../../src/db/database.js";
import { DB } from "../../src/infra/tokens.js";
import { CorpusService } from "../../src/modules/corpus/index.js";
import { importDuels } from "../../src/modules/corpus/duels-import.js";
import { ClassesService } from "../../src/modules/org/index.js";
import { ProgressService } from "../../src/modules/progress/index.js";
import { bootApi, email, expectStatus, newDevice, RUN, teacherName, type AuthSession, type TestApi } from "./harness.js";

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;
let dir: string;
const staff = {} as Record<"moderator" | "admin" | "ministry" | "fund", AuthSession>;
/** Тестовый район: школы S1 (6 учеников), S2 (3), S3 (7) и S4 без классов; второй район D2 — 5 учеников. */
const ids = { district: "", district2: "", s1: "", s2: "", s3: "", s4: "", d2s1: "" };
const nicknames: string[] = [];
const studentIds: string[] = [];

const principalOf = (s: AuthSession): Principal => ({ accountId: s.account.id, kind: s.account.kind, roles: s.account.roles, sessionId: "", deviceId: "" });

/**
 * Демо-район теста (is_demo, ОКТМО «demo-…», название раньше «Демо-района» по алфавиту): общий справочник прогона
 * остаётся «63 района и демо-район последним» для m1-edges, а числа района не зависят от других файлов.
 */
async function insertDistrict(name: string, schools: string[]): Promise<{ id: string; schools: string[] }> {
  const id = randomUUID();
  await pool.query("INSERT INTO districts (id, oktmo, name_ru, kind, source, is_demo) VALUES ($1, $2, $3, 'municipal_district', 'it', true)", [id, `demo-it-${RUN}-${name.length}`, `${name} ${RUN}`]);
  const out: string[] = [];
  for (const school of schools) {
    const sid = randomUUID();
    await pool.query("INSERT INTO schools (id, district_id, name_ru, short_name_ru, source, is_demo) VALUES ($1, $2, $3, $3, 'it', true)", [sid, id, `${school} ${RUN}`]);
    out.push(sid);
  }
  return { id, schools: out };
}

/** Учитель, подтверждённый модератором в школе `schoolId`, с классом на `n` мест и `n` учениками (вход по карточке). */
async function schoolWithStudents(who: string, schoolId: string, n: number): Promise<AuthSession[]> {
  const s = await api.loginAdult(email(who));
  await api.acceptRequiredConsents(s.accessToken);
  const v = await api.post<Schema<"TeacherVerification">>("/teacher/verification", { token: s.accessToken, body: { schoolId, fullName: teacherName(who), position: "Учитель башкирского языка" } });
  expectStatus(v, 201);
  expectStatus(await api.post(`/moderation/teacher-verifications/${v.body.id}/approve`, { token: staff.moderator.accessToken }), 200);
  const teacher = await api.post<AuthSession>("/auth/refresh", { body: { refreshToken: s.refreshToken, deviceInstallId: s.device.installId } });
  expectStatus(teacher, 200);
  const cls = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher.body.accessToken, body: { grade: 6, letter: "М", program: "native" } });
  expectStatus(cls, 201);
  const issued = await api.post<Schema<"SeatIssueResult">>(`/classes/${cls.body.id}/seats`, { token: teacher.body.accessToken, body: { count: n } });
  expectStatus(issued, 201);
  const cards = await api.app.get(ClassesService).printJobCards(principalOf(teacher.body), cls.body.id, issued.body.printJob.id);
  const kids: AuthSession[] = [];
  for (const card of cards) {
    const kid = await api.post<AuthSession>("/auth/qr", { body: { payload: card.payload, device: newDevice() } });
    expectStatus(kid, 200);
    const me = await api.patch<Schema<"Me">>("/me", { token: kid.body.accessToken, body: { nicknameId: `a${String(kids.length % 30).padStart(2, "0")}.n${String((n * 7 + kids.length) % 30).padStart(2, "0")}` } });
    expectStatus(me, 200);
    if (me.body.nickname) nicknames.push(me.body.nickname);
    studentIds.push(kid.body.account.id);
    kids.push(kid.body);
  }
  return kids;
}

/** Урок пройден (как его записывает learning): activity_days, счётчики, лига — через ProgressService. */
async function lessonDone(kid: AuthSession, at: Date, newWords = 4) {
  const db = api.app.get<Db>(DB);
  await db.transaction((tx) =>
    api.app.get(ProgressService).recordLessonCompletion(tx, {
      accountId: kid.account.id,
      accountKind: "child",
      runId: uuidv7(at.getTime()),
      lessonId: `it-${RUN}-lesson`,
      kind: "lesson",
      firstAttempts: ["correct", "correct", "wrong"],
      accuracy: 0.67,
      newWords,
      completionToday: 1,
      completedAt: at,
    }),
  );
}

beforeAll(async () => {
  ({ api, pool, close } = await bootApi());
  for (const who of ["moderator", "admin", "ministry", "fund"] as const) staff[who] = await api.loginStaff(who);
  const d = await insertDistrict("Демо-волость министерства", ["Школа С1", "Школа С2", "Школа С3", "Школа С4"]);
  const d2 = await insertDistrict("Демо-волость вторая", ["Школа Д1"]);
  [ids.s1, ids.s2, ids.s3, ids.s4] = d.schools as [string, string, string, string];
  ids.district = d.id;
  ids.district2 = d2.id;
  ids.d2s1 = d2.schools[0]!;
  await schoolWithStudents("min-s1", ids.s1, 6);
  await schoolWithStudents("min-s2", ids.s2, 3);
  const s3 = await schoolWithStudents("min-s3", ids.s3, 7);
  await schoolWithStudents("min-d2", ids.d2s1, 5);
  // S3: двое занимались на этой неделе (один — дважды), один — три недели назад.
  const now = Date.now();
  await lessonDone(s3[0]!, new Date(now - 60_000));
  await lessonDone(s3[0]!, new Date(now - 30_000));
  await lessonDone(s3[1]!, new Date(now - 45_000), 2);
  await lessonDone(s3[2]!, new Date(now - 21 * 86_400_000));
});

afterAll(async () => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  await close?.();
});

describe("кабинет министерства (ADR 0023)", () => {
  it("школы района: числа, «< 5» у малой школы и дополнительное скрытие; школа без классов не показывается", async () => {
    const res = await api.get<Schema<"RepublicDistrictDetail">>(`/ministry/districts/${ids.district}`, { token: staff.ministry.accessToken });
    expectStatus(res, 200);
    const detail = res.body;
    expect(detail.smallGroupThreshold).toBe(5);
    expect(detail.district).toMatchObject({ districtId: ids.district, isDemo: true, schools: { connected: 3, total: 4 }, classes: 3 });
    expect(detail.district.activity).toEqual({ students: 16, activeWeek: 2, lessonsWeek: 3, lessonsTotal: 4 });
    const bySchool = new Map(detail.items.map((x) => [x.schoolId, x]));
    expect([...bySchool.keys()].sort()).toEqual([ids.s1, ids.s2, ids.s3].sort());
    expect(bySchool.get(ids.s2)!.activity).toEqual({ suppression: "small_group" });
    // Без дополнительного скрытия S2 = район − S1 − S3: скрыта и самая маленькая из остальных (S1, 6 учеников).
    expect(bySchool.get(ids.s1)!.activity).toEqual({ suppression: "complementary" });
    expect(bySchool.get(ids.s3)!.activity).toEqual({ students: 7, activeWeek: 2, lessonsWeek: 3, lessonsTotal: 4 });
    expect(bySchool.get(ids.s1)!.classes).toBe(1);

    expect(detail.weeks).toHaveLength(8);
    expect(detail.weeks.at(-1)).toMatchObject({ week: detail.week, lessons: 3, active: 2 });
    expect(detail.weeks.reduce((n, w) => n + w.lessons, 0)).toBe(4);
    expect(detail.weeks.map((w) => w.week.start)).toEqual([...detail.weeks.map((w) => w.week.start)].sort());
  });

  it("районы республики и сводка: только числа — ни ников, ни идентификаторов учеников", async () => {
    const list = await api.get<Schema<"RepublicDistrictList">>("/ministry/districts", { token: staff.ministry.accessToken });
    expectStatus(list, 200);
    const mine = list.body.items.find((x) => x.districtId === ids.district)!;
    expect(mine).toMatchObject({ nameRu: `Демо-волость министерства ${RUN}`, kind: "municipal_district", schools: { connected: 3, total: 4 }, classes: 3 });
    const d2 = list.body.items.find((x) => x.districtId === ids.district2)!;
    expect(d2.schools).toEqual({ connected: 1, total: 1 });
    // Районы справочника без классов — в списке с нулями (подключение видно), демо-район — только с классами.
    const empty = list.body.items.find((x) => !x.isDemo && x.schools.connected === 0);
    if (empty) expect(empty.activity).toEqual({ students: 0, activeWeek: 0, lessonsWeek: 0, lessonsTotal: 0 });

    const summary = await api.get<Schema<"RepublicSummary">>("/ministry/summary", { token: staff.ministry.accessToken });
    expectStatus(summary, 200);
    const s = summary.body;
    expect(s.learners).toEqual(list.body.total);
    expect(s.students.school.value).toBeGreaterThanOrEqual(21);
    expect(s.schools.connected).toBeGreaterThanOrEqual(4);
    expect(s.teachersVerified).toBeGreaterThanOrEqual(4);
    expect(s.wordsLearned).toBeGreaterThanOrEqual(10);
    expect(s.weeks).toHaveLength(8);
    expect(s.weeks.at(-1)!.lessons).toBe(s.learners.lessonsWeek);

    for (const body of [summary.body, list.body]) {
      const text = JSON.stringify(body);
      for (const id of studentIds) expect(text).not.toContain(id);
      for (const nick of nicknames) expect(text).not.toContain(nick);
      expect(text).not.toMatch(/seat|nickname|email/i);
    }
  });

  it("«Учусь сам» — отдельной строкой; малая группа скрыта и не входит в итоги", async () => {
    const solo = await api.post<AuthSession>("/auth/self", { body: { device: newDevice(), nicknameId: "a02.n03", ageBand: "age_11_14" } });
    expectStatus(solo, 201);
    const list = await api.get<Schema<"RepublicDistrictList">>("/ministry/districts", { token: staff.ministry.accessToken });
    const summary = await api.get<Schema<"RepublicSummary">>("/ministry/summary", { token: staff.ministry.accessToken });
    const self = list.body.selfLearners;
    expect(Boolean(summary.body.students.self.suppression)).toBe(Boolean(self.suppression));
    if (self.suppression) expect(Object.keys(self)).toEqual(["suppression"]);
    else expect(self.students).toBe(summary.body.students.self.value);
    // Итог — школьники и «Учусь сам», только если эта группа не скрыта (иначе её число получалось бы вычитанием).
    expect(list.body.total.students).toBe(summary.body.students.school.value! + (self.suppression ? 0 : self.students!));
  });

  it("неизвестный район — 404, неверный идентификатор — 422", async () => {
    expectStatus(await api.get(`/ministry/districts/${randomUUID()}`, { token: staff.ministry.accessToken }), 404);
    expectStatus(await api.get("/ministry/districts/not-a-uuid", { token: staff.ministry.accessToken }), 422);
  });

  it("доступ — только у роли ministry: администратор, модератор, Фонд и учитель получают 403", async () => {
    for (const who of ["admin", "moderator", "fund"] as const) {
      for (const path of ["/ministry/summary", "/ministry/districts", `/ministry/districts/${ids.district}`]) expectStatus(await api.get(path, { token: staff[who].accessToken }), 403);
    }
    // У сотрудника министерства нет чужих разделов консоли.
    expectStatus(await api.get("/admin/audit-log", { token: staff.ministry.accessToken }), 403);
    expectStatus(await api.get("/moderation/teacher-verifications", { token: staff.ministry.accessToken }), 403);
    expectStatus(await api.get("/fund/dictionary", { token: staff.ministry.accessToken }), 403);
  });

  it("GET /me сотрудника министерства: роли вне закрытого Role — в staffRoles", async () => {
    const me = await api.get<Schema<"Me">>("/me", { token: staff.ministry.accessToken });
    expectStatus(me, 200);
    expect(me.body).toMatchObject({ kind: "staff", roles: [], staffRoles: ["ministry"] });
    const admin = await api.get<Schema<"Me">>("/me", { token: staff.admin.accessToken });
    expect(admin.body).toMatchObject({ roles: ["admin", "moderator"], staffRoles: ["admin", "moderator"] });
    // Журнал аудита: вход сотрудника министерства — роли в staffRoles, в roles только закрытый набор.
    const log = await api.get<Schema<"AuditLogPage">>(`/admin/audit-log?action=staff.login&actorId=${staff.ministry.account.id}`, { token: staff.admin.accessToken });
    expectStatus(log, 200);
    expect(log.body.items[0]?.actor).toMatchObject({ kind: "staff", roles: [], staffRoles: ["ministry"] });
  });
});

describe("словарь для Фонда (ADR 0023)", () => {
  const UNIT = `it-fund-${RUN}`;
  it("принятая пара: голоса по группам, источник варианта, «предварительно»; доступ — только у роли fund", async () => {
    dir = mkdtempSync(join(tmpdir(), "teletau-fund-"));
    writeFileSync(join(dir, "sources.yaml"), `sources:\n  - id: synthetic-fund\n    title: "Синтетический источник Фонда"\n    url: https://example.org/fund\n    license: CC0\n    accessed: "2026-11-05"\n`);
    mkdirSync(join(dir, "duels"));
    const v = (text: string) => `\n      - ba: ${text}\n        source:\n          ref: synthetic-fund\n          url: https://example.org/fund/${encodeURIComponent(text)}\n          locator: строка «${text}»\n        review: needs_native_review`;
    writeFileSync(join(dir, "duels", `${UNIT}.yaml`), `unit: ${UNIT}\nduels:\n  - id: ${UNIT}-d01\n    ru: "Синтетика для Фонда"\n    kind: phrase\n    variants:${v("Фонд икс")}${v("Фонд игрек")}\n`);
    await importDuels(pool, { dir: join(dir, "duels"), sourcesFile: join(dir, "sources.yaml") });
    const item = (await api.app.get(CorpusService).duelPool(UNIT))[0]!;
    const x = item.variants.find((w) => w.text.endsWith("икс"))!;
    const y = item.variants.find((w) => w.text.endsWith("игрек"))!;

    // Учитель и двое взрослых — за «икс» (3 + 2 + 2 ≥ 3 голосов, перевес ≥ 2): принят по duel-v0.
    const teacher = await api.verifiedTeacher("fund-teacher", staff.moderator.accessToken, 3);
    const voters = [teacher, await api.loginAdult(email("fund-adult-1")), await api.loginAdult(email("fund-adult-2"))];
    for (const [i, s] of voters.entries()) {
      if (i > 0) await api.acceptRequiredConsents(s.accessToken);
      const r = await api.post<Schema<"CorpusItemVotes">>("/corpus/judgments", { token: s.accessToken, body: { judgmentId: uuidv7(), itemId: item.itemId, shown: [x.id, y.id], choice: "a" } });
      expectStatus(r, 201);
    }

    const res = await api.get<Schema<"FundDictionary">>("/fund/dictionary", { token: staff.fund.accessToken });
    expectStatus(res, 200);
    const rows = res.body.items.filter((p) => p.itemId === item.itemId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      variantId: x.id,
      sourceRu: "Синтетика для Фонда",
      kind: "phrase",
      textBa: x.text,
      review: "needs_native_review",
      origin: "import",
      main: true,
      decidedBy: "rule",
      rulesVersion: "duel-v0",
      preliminary: true,
      votes: { child: { votesFor: 0, both: 0, total: 0 }, adult: { votesFor: 2, both: 0, total: 2 }, teacher: { votesFor: 1, both: 0, total: 1 } },
    });
    expect(rows[0]!.sources[0]).toMatchObject({ title: "Синтетический источник Фонда", url: `https://example.org/fund/${encodeURIComponent("Фонд икс")}`, license: "CC0" });
    const decided = res.body.items.map((p) => p.decidedAt);
    expect(decided).toEqual([...decided].sort().reverse());
    expect(JSON.stringify(res.body)).not.toContain(teacher.account.id);

    const summary = await api.get<Schema<"RepublicSummary">>("/ministry/summary", { token: staff.ministry.accessToken });
    expect(summary.body.pairsAccepted).toBe(res.body.items.length);
    expect(summary.body.votes).toBeGreaterThanOrEqual(3);

    for (const who of ["admin", "moderator", "ministry"] as const) expectStatus(await api.get("/fund/dictionary", { token: staff[who].accessToken }), 403);
  });

  it("спорные случаи (ТЗ §4.4/§5): голоса групп по вариантам, без личных данных; в словарь не попадают; доступ — только у роли fund", async () => {
    dir ??= mkdtempSync(join(tmpdir(), "teletau-fund-"));
    mkdirSync(join(dir, "duels"), { recursive: true });
    writeFileSync(join(dir, "sources.yaml"), `sources:\n  - id: synthetic-fund\n    title: "Синтетический источник Фонда"\n    url: https://example.org/fund\n    license: CC0\n    accessed: "2026-11-05"\n`);
    const v = (text: string) => `\n      - ba: ${text}\n        source:\n          ref: synthetic-fund\n          url: https://example.org/fund/${encodeURIComponent(text)}\n          locator: строка «${text}»\n        review: needs_native_review`;
    const ESC_UNIT = `it-esc-${RUN}`;
    writeFileSync(join(dir, "duels", `${ESC_UNIT}.yaml`), `unit: ${ESC_UNIT}\nduels:\n  - id: ${ESC_UNIT}-d01\n    ru: "Синтетика спорная для Фонда"\n    kind: phrase\n    variants:${v("Спор икс")}${v("Спор игрек")}\n`);
    await importDuels(pool, { dir: join(dir, "duels"), sourcesFile: join(dir, "sources.yaml") });
    const item = (await api.app.get(CorpusService).duelPool(ESC_UNIT))[0]!;
    const x = item.variants.find((w) => w.text.endsWith("икс"))!;
    const y = item.variants.find((w) => w.text.endsWith("игрек"))!;

    // Взрослый за «икс», учитель за «игрек»: duel-v0 не решает — спор ждёт эксперта (как в m2-duel).
    const adult = await api.loginAdult(email("fund-esc-adult"));
    await api.acceptRequiredConsents(adult.accessToken);
    const teacher = await api.verifiedTeacher("fund-esc-teacher", staff.moderator.accessToken, 3);
    const vote = (token: string, choice: string) =>
      api.post<Schema<"CorpusItemVotes">>("/corpus/judgments", { token, body: { judgmentId: uuidv7(), itemId: item.itemId, shown: [x.id, y.id], choice } });
    expectStatus(await vote(adult.accessToken, "a"), 201);
    const t = await vote(teacher.accessToken, "b");
    expectStatus(t, 201);
    expect(t.body.status).toBe("escalated");

    const res = await api.get<Schema<"FundEscalated">>("/fund/escalated", { token: staff.fund.accessToken });
    expectStatus(res, 200);
    const row = res.body.items.find((e) => e.itemId === item.itemId)!;
    expect(row).toMatchObject({ sourceRu: "Синтетика спорная для Фонда", kind: "phrase", lastVoteAt: expect.any(String) });
    expect(row.variants).toHaveLength(2);
    const byId = new Map(row.variants.map((w) => [w.variantId, w]));
    // total — все содержательные голоса группы (за любой вариант), votesFor — за этот вариант.
    expect(byId.get(x.id)).toMatchObject({
      text: x.text,
      review: "needs_native_review",
      origin: "import",
      votes: { child: { votesFor: 0, both: 0, total: 0 }, adult: { votesFor: 1, both: 0, total: 1 }, teacher: { votesFor: 0, both: 0, total: 1 } },
    });
    expect(byId.get(y.id)).toMatchObject({ text: y.text, votes: { adult: { votesFor: 0, both: 0, total: 1 }, teacher: { votesFor: 1, both: 0, total: 1 } } });

    // Спор и словарь не пересекаются: спорные — не «принятые», принятые — не спорные.
    const dictionary = await api.get<Schema<"FundDictionary">>("/fund/dictionary", { token: staff.fund.accessToken });
    expectStatus(dictionary, 200);
    expect(dictionary.body.items.map((p) => p.itemId)).not.toContain(item.itemId);
    const accepted = dictionary.body.items.find((p) => p.sourceRu === "Синтетика для Фонда");
    expect(accepted).toBeDefined();
    expect(res.body.items.map((e) => e.itemId)).not.toContain(accepted!.itemId);

    // Ни аккаунтов, ни ПДн голосовавших — только тексты и числа.
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(adult.account.id);
    expect(text).not.toContain(teacher.account.id);
    expect(text).not.toMatch(/nickname|email|accountId/i);

    for (const who of ["admin", "moderator", "ministry"] as const) expectStatus(await api.get("/fund/escalated", { token: staff[who].accessToken }), 403);
  });
});
