// Публичный словарь и доска почёта (ТЗ §5, §4.5): анонимные выгрузки без регистрации против Docker-стека.
// Словарь: принятые пары корпуса с источниками и статусами проверки — JSON и CSV (разделитель «;», BOM, CRLF),
// ?status=expert_review — только проверенные носителем. Доска: топ школ и классов по урокам за период,
// порог малых групп (группа < 5 активных не показана), ?period=day; мусорный период — 422 проверки схемы.
// ПДн (правило 13): в ответах только тексты пар и агрегаты школ/классов — ни аккаунтов, ни ников.
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Schema } from "@teletau/contracts";
import { ufaDate } from "@teletau/domain-rules";
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
const staff = {} as Record<"moderator", AuthSession>;
/** Дуэли словаря: обычная и с вариантом, проверенным носителем. */
const UNIT = `it-pub-${RUN}`;
const VOTED = "Словарь голосованный";
const NATIVE = "Словарь экспертный";
const votedText = `${VOTED} икс ${RUN}`;
const nativeText = `${NATIVE} икс ${RUN}`;
/** Школы доски: большая (5 активных из 6) и малая (2 из 3 — ниже порога). */
const ids = { district: "", big: "", small: "" };
const studentIds: string[] = [];
const nicknames: string[] = [];
const BIG_CLASS_LETTER = "П";

const principalOf = (s: AuthSession): Principal => ({ accountId: s.account.id, kind: s.account.kind, roles: s.account.roles, sessionId: "", deviceId: "" });

/** Демо-район теста с двумя школами (как insertDistrict в ministry-fund.test.ts). */
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
async function schoolWithStudents(who: string, schoolId: string, letter: string, n: number): Promise<AuthSession[]> {
  const s = await api.loginAdult(email(who));
  await api.acceptRequiredConsents(s.accessToken);
  const v = await api.post<Schema<"TeacherVerification">>("/teacher/verification", { token: s.accessToken, body: { schoolId, fullName: teacherName(who), position: "Учитель башкирского языка" } });
  expectStatus(v, 201);
  expectStatus(await api.post(`/moderation/teacher-verifications/${v.body.id}/approve`, { token: staff.moderator.accessToken }), 200);
  const teacher = await api.post<AuthSession>("/auth/refresh", { body: { refreshToken: s.refreshToken, deviceInstallId: s.device.installId } });
  expectStatus(teacher, 200);
  const cls = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher.body.accessToken, body: { grade: 6, letter, program: "native" } });
  expectStatus(cls, 201);
  const issued = await api.post<Schema<"SeatIssueResult">>(`/classes/${cls.body.id}/seats`, { token: teacher.body.accessToken, body: { count: n } });
  expectStatus(issued, 201);
  const cards = await api.app.get(ClassesService).printJobCards(principalOf(teacher.body), cls.body.id, issued.body.printJob.id);
  const kids: AuthSession[] = [];
  for (const card of cards) {
    const kid = await api.post<AuthSession>("/auth/qr", { body: { payload: card.payload, device: newDevice() } });
    expectStatus(kid, 200);
    const me = await api.patch<Schema<"Me">>("/me", { token: kid.body.accessToken, body: { nicknameId: `a${String(kids.length % 30).padStart(2, "0")}.n${String((n * 5 + kids.length) % 30).padStart(2, "0")}` } });
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
  staff.moderator = await api.loginStaff("moderator");

  // ── словарь: две принятые дуэли, у второй «икс» уже проверен носителем ──
  dir = mkdtempSync(join(tmpdir(), "teletau-public-"));
  writeFileSync(join(dir, "sources.yaml"), `sources:\n  - id: synthetic-public\n    title: "Синтетика публичного словаря"\n    url: https://example.org/public\n    license: CC0\n    accessed: "2026-11-12"\n`);
  mkdirSync(join(dir, "duels"));
  const v = (text: string, review: string) => `\n      - ba: ${text}\n        source:\n          ref: synthetic-public\n          url: https://example.org/public/${encodeURIComponent(text)}\n          locator: строка «${text}»\n        review: ${review}`;
  const duel = (n: number, ru: string, review: string) => `  - id: ${UNIT}-d0${n}\n    ru: "${ru} ${RUN}"\n    kind: phrase\n    variants:${v(`${ru} икс ${RUN}`, review)}${v(`${ru} игрек ${RUN}`, "needs_native_review")}\n`;
  writeFileSync(join(dir, "duels", `${UNIT}.yaml`), `unit: ${UNIT}\nduels:\n${duel(1, VOTED, "needs_native_review")}${duel(2, NATIVE, "native_approved")}`);
  await importDuels(pool, { dir: join(dir, "duels"), sourcesFile: join(dir, "sources.yaml") });
  const items = await api.app.get(CorpusService).duelPool(UNIT);
  expect(items).toHaveLength(2);

  // Трое взрослых за «икс» в каждой дуэли (2+2+2 ≥ 3 голосов, перевес ≥ 2): приняты по duel-v0.
  const voters: AuthSession[] = [];
  for (const i of [1, 2, 3]) voters.push(await api.loginAdult(email(`pub-adult-${i}`)));
  for (const s of voters) await api.acceptRequiredConsents(s.accessToken);
  for (const item of items) {
    const x = item.variants.find((w) => w.text.includes("икс"))!;
    const y = item.variants.find((w) => w.text.includes("игрек"))!;
    for (const s of voters) {
      const r = await api.post<Schema<"CorpusItemVotes">>("/corpus/judgments", { token: s.accessToken, body: { judgmentId: uuidv7(), itemId: item.itemId, shown: [x.id, y.id], choice: "a" } });
      expectStatus(r, 201);
    }
  }

  // ── доска: большая школа (5 из 6 занимались по 3 урока) и малая (2 из 3 — скрыта) ──
  const d = await insertDistrict("Демо-волость доски", ["Публичная школа большая", "Публичная школа малая"]);
  ids.district = d.id;
  [ids.big, ids.small] = d.schools as [string, string];
  const big = await schoolWithStudents("pub-big", ids.big, BIG_CLASS_LETTER, 6);
  const small = await schoolWithStudents("pub-small", ids.small, "М", 3);
  const now = Date.now();
  for (const kid of big.slice(0, 5)) for (let k = 0; k < 3; k++) await lessonDone(kid, new Date(now - 60_000));
  for (const kid of small.slice(0, 2)) await lessonDone(kid, new Date(now - 30_000));
});

afterAll(async () => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  await close?.();
});

describe("GET /public/dictionary (ТЗ §5)", () => {
  it("анониму — JSON: принятые пары с источниками и статусами; предварительные решения — не подтверждены", async () => {
    const res = await api.get<Schema<"PublicDictionary">>("/public/dictionary");
    expectStatus(res, 200);
    const body = res.body;
    expect(body.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.langPair).toBe("ba-ru");
    const byText = new Map(body.items.map((i) => [i.textBa, i]));
    const voted = byText.get(votedText)!;
    expect(voted).toBeDefined();
    expect(voted).toMatchObject({ langPair: "ba-ru", translation: `${VOTED} ${RUN}`, confirmed: false, status: "confirmed" });
    expect(voted.fragmentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(voted.sources[0]).toMatchObject({ title: "Синтетика публичного словаря", license: "CC0" });
    expect(byText.get(nativeText)).toMatchObject({ translation: `${NATIVE} ${RUN}`, status: "expert_review" });
    // Правило 13: ни голосовавших, ни их групп — только тексты и статусы.
    const text = JSON.stringify(body);
    for (const id of studentIds) expect(text).not.toContain(id);
    expect(text).not.toMatch(/nickname|email|accountId/i);
  });

  it("?status=expert_review — только проверенные носителем языка", async () => {
    const res = await api.get<Schema<"PublicDictionary">>("/public/dictionary?status=expert_review");
    expectStatus(res, 200);
    const texts = res.body.items.map((i) => i.textBa);
    expect(texts).toContain(nativeText);
    expect(texts).not.toContain(votedText);
    for (const item of res.body.items) expect(item.status).toBe("expert_review");
  });

  it("?format=csv — text/csv с BOM, заголовок, разделитель «;», CRLF, источники названиями", async () => {
    const res = await api.get<string>("/public/dictionary?format=csv");
    expectStatus(res, 200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    const text = res.body;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).split("\r\n");
    expect(lines[0]).toBe("fragmentId;langPair;translation;textBa;status;confirmed;sources");
    expect(text.endsWith("\r\n")).toBe(true);
    const native = lines.find((l) => l.includes(nativeText))!;
    expect(native).toBeDefined();
    expect(native).toContain(`${NATIVE} ${RUN}`);
    expect(native).toContain("expert_review");
    expect(native).toContain("false");
    expect(native).toContain("Синтетика публичного словаря");
    expect(native).not.toContain("https://example.org");
  });
});

describe("GET /public/leaderboard (ТЗ §4.5)", () => {
  it("анониму — топ школ и классов за неделю; малая группа (< 5 активных) не показана; без ПДн", async () => {
    const res = await api.get<Schema<"PublicLeaderboard">>("/public/leaderboard");
    expectStatus(res, 200);
    const body = res.body;
    expect(body.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.period).toBe("week");
    expect(body.periodStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.smallGroupThreshold).toBe(5);

    const school = body.schools.find((s) => s.school === `Публичная школа большая ${RUN}`)!;
    expect(school).toBeDefined();
    expect(school).toMatchObject({ district: `Демо-волость доски ${RUN}`, lessons: 15, activeStudents: 5, wordsLearned: 20 });
    expect(body.schools.find((s) => s.school === `Публичная школа малая ${RUN}`)).toBeUndefined();

    const cls = body.classes.find((c) => c.classLabel === `6 «${BIG_CLASS_LETTER}»` && c.school === `Публичная школа большая ${RUN}`)!;
    expect(cls).toBeDefined();
    expect(cls).toMatchObject({ district: `Демо-волость доски ${RUN}`, lessons: 15, activeStudents: 5, wordsLearned: 20 });
    expect(body.classes.find((c) => c.school === `Публичная школа малая ${RUN}`)).toBeUndefined();

    // Места с 1 и по убыванию уроков.
    expect(body.schools.map((s) => s.rank)).toEqual(body.schools.map((s, i) => i + 1));
    const lessons = body.schools.map((s) => s.lessons);
    expect(lessons).toEqual([...lessons].sort((a, b) => b - a));

    // Правило 13: только школы, классы и числа.
    const text = JSON.stringify(body);
    for (const id of studentIds) expect(text).not.toContain(id);
    for (const nick of nicknames) expect(text).not.toContain(nick);
    expect(text).not.toMatch(/nickname|email|accountId/i);
  });

  it("?period=day — учебные сутки по Уфе: та же активность сегодняшнего дня", async () => {
    const res = await api.get<Schema<"PublicLeaderboard">>("/public/leaderboard?period=day");
    expectStatus(res, 200);
    expect(res.body.period).toBe("day");
    expect(res.body.periodStart).toBe(ufaDate(new Date()));
    const school = res.body.schools.find((s) => s.school === `Публичная школа большая ${RUN}`)!;
    expect(school).toMatchObject({ lessons: 15, activeStudents: 5 });
  });

  it("?period=мусор — 422 проверки схемы с указателем на query", async () => {
    const res = await api.get<Schema<"Problem">>("/public/leaderboard?period=мусор");
    expectStatus(res, 422);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.body).toMatchObject({ code: "validation_failed" });
    expect(res.body.errors?.[0]?.pointer).toBe("#/query/period");
  });
});
