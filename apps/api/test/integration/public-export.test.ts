// Публичный словарь и доска почёта (ТЗ §5, §4.5): анонимные выгрузки без регистрации против Docker-стека.
// Словарь: принятые пары корпуса с источниками и статусами проверки — JSON и CSV (разделитель «;», BOM, CRLF),
// ?status=expert_review — только проверенные носителем. Пары обеих языковых пар: ba-ru и ba-kz (казахские исходники
// грузятся importDuels с lang = kz) — строки kz-пар помечены langPair, фраза дня остаётся парой ba-ru; `confirmed` —
// число подтвердивших вариант. Доска: топ школ и классов по урокам за период, порог малых групп (группа < 5 активных не
// показана) и дополнительное скрытие школы, чей остаток вне показанных классов — малая группа; демо-школы и демо-районы
// справочника — не на доске; прямые кавычки названий — «ёлочки»; ?period=day; мусорный период — 422 проверки схемы.
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
import { ConsensusService } from "../../src/modules/consensus/index.js";
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
/** Дуэли пары ba-kz: казахский исходник (lang = kz) → принятый башкирский вариант. */
const KZ_UNIT = `it-kz-${RUN}`;
const kzPairs = [
  { kz: "Сәлем қалай", ba: "Сәләм, нисек", alt: "Һаумы, яҡшы" },
  { kz: "ана", ba: "инә", alt: "әсәй" },
  { kz: "бір", ba: "бер", alt: "берәү" },
];
const kzSources = new Map<string, string>();
/**
 * Школы доски — не демо-записи справочника: большая (5 активных из 6, название с прямыми кавычками), малая (2 из 3 —
 * ниже порога), смешанная (класс 5 из 5 на доске и класс 2 из 3 — его числа получались бы вычитанием); демо-школа
 * (is_demo, 5 из 5) — не на доске. Район — демо-запись теста: районы справочника РБ в общей базе прогона считает
 * m1-edges.test.ts. Уроки смешанной и демо-школы — в начале года (доска за год): лиги текущей недели других файлов
 * они не задевают.
 */
const ids = { district: "", big: "", small: "", mixed: "", demo: "" };
const BIG_SCHOOL = `Публичная школа "Большая" ${RUN}`;
const BIG_SCHOOL_SHOWN = `Публичная школа «Большая» ${RUN}`;
const MIXED_SCHOOL = `Публичная школа смешанная ${RUN}`;
const DEMO_SCHOOL = `Публичная демо-школа ${RUN}`;
const studentIds: string[] = [];
const nicknames: string[] = [];
const BIG_CLASS_LETTER = "П";

const principalOf = (s: AuthSession): Principal => ({ accountId: s.account.id, kind: s.account.kind, roles: s.account.roles, sessionId: "", deviceId: "" });

/** Демо-район теста со школами (как insertDistrict в ministry-fund.test.ts); `demo` — признак is_demo каждой школы. */
async function insertDistrict(name: string, schools: { name: string; demo: boolean }[]): Promise<{ id: string; schools: string[] }> {
  const id = randomUUID();
  await pool.query("INSERT INTO districts (id, oktmo, name_ru, kind, source, is_demo) VALUES ($1, $2, $3, 'municipal_district', 'it', true)", [id, `demo-it-${RUN}-${name.length}`, `${name} ${RUN}`]);
  const out: string[] = [];
  for (const school of schools) {
    const sid = randomUUID();
    await pool.query("INSERT INTO schools (id, district_id, name_ru, short_name_ru, source, is_demo) VALUES ($1, $2, $3, $3, 'it', $4)", [sid, id, school.name, school.demo]);
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
    // Возрастной диапазон 15–17: очки уроков этих учеников идут в свою группу лиги, а не в группу 11–14, где лигу
    // текущей недели проверяет m2-learning.test.ts (база прогона общая).
    const me = await api.patch<Schema<"Me">>("/me", {
      token: kid.body.accessToken,
      body: { nicknameId: `a${String(kids.length % 30).padStart(2, "0")}.n${String((n * 5 + kids.length) % 30).padStart(2, "0")}`, ageBand: "age_15_17" },
    });
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

  // ── пара ba-kz: казахские исходники (importDuels lang = kz), принятый вариант — первый ──
  mkdirSync(join(dir, "kz-duels"));
  const kv = (text: string) => `\n      - ba: ${text}\n        source:\n          ref: synthetic-kz\n          url: https://example.org/kz/${encodeURIComponent(text)}\n          locator: строка «${text}»\n        review: needs_native_review`;
  const kzDuel = (n: number, kz: string, ba: string, alt: string) => `  - id: ${KZ_UNIT}-d0${n}\n    ru: "${kz} ${RUN}"\n    kind: word\n    variants:${kv(ba)}${kv(alt)}\n`;
  writeFileSync(
    join(dir, "kz-duels", `${KZ_UNIT}.yaml`),
    `unit: ${KZ_UNIT}\nduels:\n${kzPairs.map((p, n) => kzDuel(n + 1, p.kz, `${p.ba} ${RUN}`, `${p.alt} ${RUN}`)).join("")}`,
  );
  writeFileSync(join(dir, "kz-sources.yaml"), `sources:\n  - id: synthetic-kz\n    title: "Синтетика казахской пары"\n    url: https://example.org/kz\n    license: CC0\n    accessed: "2026-11-12"\n`);
  await importDuels(pool, { dir: join(dir, "kz-duels"), sourcesFile: join(dir, "kz-sources.yaml"), lang: "kz" });
  const kzItems = await api.app.get(CorpusService).duelPool(KZ_UNIT);
  expect(kzItems).toHaveLength(kzPairs.length);
  for (const item of kzItems) {
    // Голос — за «верный» вариант (p.ba), а не просто за первый: порядок вариантов в базе не гарантирован.
    const pair = kzPairs.find((p) => item.sourceRu === `${p.kz} ${RUN}`)!;
    const x = item.variants.find((v) => v.text === `${pair.ba} ${RUN}`)!;
    const y = item.variants.find((v) => v.text === `${pair.alt} ${RUN}`)!;
    kzSources.set(x.text, item.sourceRu);
    for (const s of voters) {
      const r = await api.post<Schema<"CorpusItemVotes">>("/corpus/judgments", { token: s.accessToken, body: { judgmentId: uuidv7(), itemId: item.itemId, shown: [x.id, y.id], choice: "a" } });
      expectStatus(r, 201);
    }
  }

  // ── доска: большая школа (5 из 6 занимались по 3 урока), малая (2 из 3 — скрыта), смешанная и демо-школа ──
  const d = await insertDistrict("Демо-волость доски", [
    { name: BIG_SCHOOL, demo: false },
    { name: `Публичная школа малая ${RUN}`, demo: false },
    { name: MIXED_SCHOOL, demo: false },
    { name: DEMO_SCHOOL, demo: true },
  ]);
  ids.district = d.id;
  [ids.big, ids.small, ids.mixed, ids.demo] = d.schools as [string, string, string, string];
  const big = await schoolWithStudents("pub-big", ids.big, BIG_CLASS_LETTER, 6);
  const small = await schoolWithStudents("pub-small", ids.small, "М", 3);
  const mixedShown = await schoolWithStudents("pub-mixed-a", ids.mixed, "А", 5);
  const mixedHidden = await schoolWithStudents("pub-mixed-b", ids.mixed, "Б", 3);
  const demoKids = await schoolWithStudents("pub-demo", ids.demo, "Д", 5);
  const now = Date.now();
  for (const kid of big.slice(0, 5)) for (let k = 0; k < 3; k++) await lessonDone(kid, new Date(now - 60_000));
  for (const kid of small.slice(0, 2)) await lessonDone(kid, new Date(now - 30_000));
  const yearStart = new Date(Date.UTC(new Date(now).getUTCFullYear(), 0, 1, 6));
  for (const kid of mixedShown) await lessonDone(kid, yearStart);
  for (const kid of mixedHidden.slice(0, 2)) for (let k = 0; k < 2; k++) await lessonDone(kid, yearStart);
  for (const kid of demoKids) for (let k = 0; k < 4; k++) await lessonDone(kid, yearStart);
});

afterAll(async () => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  await close?.();
});

describe("GET /public/dictionary (ТЗ §5)", () => {
  it("анониму — JSON: принятые пары с источниками и статусами; confirmed — сколько пользователей подтвердили вариант", async () => {
    const res = await api.get<Schema<"PublicDictionary">>("/public/dictionary");
    expectStatus(res, 200);
    const body = res.body;
    expect(body.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.langPair).toBe("ba-ru");
    const byText = new Map(body.items.map((i) => [i.textBa, i]));
    const voted = byText.get(votedText)!;
    expect(voted).toBeDefined();
    // Трое взрослых выбрали «икс»: confirmed — число голосов за вариант во всех группах (целое, не флаг).
    expect(voted).toMatchObject({ langPair: "ba-ru", translation: `${VOTED} ${RUN}`, confirmed: 3, status: "confirmed" });
    expect(Number.isInteger(voted.confirmed)).toBe(true);
    expect(voted.fragmentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(voted.sources[0]).toMatchObject({ title: "Синтетика публичного словаря", license: "CC0" });
    expect(byText.get(nativeText)).toMatchObject({ translation: `${NATIVE} ${RUN}`, status: "expert_review", confirmed: 3 });
    // Публичная операция кешируется: Cache-Control public (в тестах кеш процесса выключен — max-age из PUBLIC_CACHE_SECONDS).
    expect(res.headers["cache-control"]).toMatch(/^public, max-age=\d+$/);
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
    // Колонка confirmed — число подтвердивших (3 голоса за «икс»), а не true/false.
    expect(native.split(";")[5]).toBe("3");
    expect(native).not.toMatch(/;(true|false);/);
    expect(native).toContain("Синтетика публичного словаря");
    expect(native).not.toContain("https://example.org");
  });
});

describe("GET /public/dictionary — пара ba-kz (башкирский ← казахский)", () => {
  it("анониму — строки обеих пар: kz-пары с langPair ba-kz и казахским исходником, ru-пары — ba-ru", async () => {
    const res = await api.get<Schema<"PublicDictionary">>("/public/dictionary");
    expectStatus(res, 200);
    // Верхнее поле — основная пара словаря (лендинг и бот работают с ba-ru); пара строки — в поле строки.
    expect(res.body.langPair).toBe("ba-ru");
    const byText = new Map(res.body.items.map((i) => [i.textBa, i]));
    for (const [ba, kz] of kzSources) {
      const row = byText.get(ba);
      expect(row, kz).toBeDefined();
      expect(row).toMatchObject({ langPair: "ba-kz", translation: kz });
      expect(row!.sources[0]).toMatchObject({ title: "Синтетика казахской пары", license: "CC0" });
    }
    expect(byText.get(votedText)).toMatchObject({ langPair: "ba-ru", translation: `${VOTED} ${RUN}` });
    expect(byText.get(nativeText)).toMatchObject({ langPair: "ba-ru", translation: `${NATIVE} ${RUN}` });
  });

  it("выгрузка Фонда помечает пару каждой принятой строки (langPair ba-ru / ba-kz)", async () => {
    const rows = (await api.app.get(ConsensusService).fundDictionary()).items;
    const byText = new Map(rows.map((r) => [r.textBa, r]));
    for (const [ba] of kzSources) expect(byText.get(ba)?.langPair).toBe("ba-kz");
    expect(byText.get(votedText)?.langPair).toBe("ba-ru");
    expect(byText.get(nativeText)?.langPair).toBe("ba-ru");
  });

  it("?format=csv — kz-строки в той же таблице: колонка langPair = ba-kz, заголовок прежний", async () => {
    const res = await api.get<string>("/public/dictionary?format=csv");
    expectStatus(res, 200);
    const lines = res.body.slice(1).split("\r\n");
    expect(lines[0]).toBe("fragmentId;langPair;translation;textBa;status;confirmed;sources");
    const kz = lines.find((l) => l.includes(`инә ${RUN}`));
    expect(kz).toBeDefined();
    expect(kz).toContain("ba-kz");
    expect(kz).toContain(`ана ${RUN}`);
  });

  it("фраза дня остаётся парой ba-ru: за 62 суток казахские исходники не выпадают", async () => {
    const consensus = api.app.get(ConsensusService);
    const dictionary = await consensus.publicDictionary();
    const langOf = new Map(dictionary.items.map((i) => [`${i.translation}\u0000${i.textBa}`, i.langPair]));
    const kzTexts = new Set([...kzSources.values()]);
    for (let k = 0; k < 62; k++) {
      const { pair } = await consensus.phraseOfDay(new Date(Date.UTC(2026, 0, 1) + k * 86_400_000));
      if (!pair) continue;
      expect(kzTexts.has(pair.sourceRu)).toBe(false);
      expect(langOf.get(`${pair.sourceRu}\u0000${pair.textBa}`)).toBe("ba-ru");
    }
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

    // Название из справочника с прямыми кавычками — «ёлочками».
    const school = body.schools.find((s) => s.school === BIG_SCHOOL_SHOWN)!;
    expect(school).toBeDefined();
    expect(school).toMatchObject({ district: `Демо-волость доски ${RUN}`, lessons: 15, activeStudents: 5, wordsLearned: 20 });
    expect(body.schools.find((s) => s.school === BIG_SCHOOL)).toBeUndefined();
    expect(body.schools.find((s) => s.school === `Публичная школа малая ${RUN}`)).toBeUndefined();

    const cls = body.classes.find((c) => c.classLabel === `6 «${BIG_CLASS_LETTER}»` && c.school === BIG_SCHOOL_SHOWN)!;
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

  it("дополнительное скрытие: школа, чей остаток вне показанных классов — малая группа, не показывается (класс — да)", async () => {
    const res = await api.get<Schema<"PublicLeaderboard">>("/public/leaderboard?period=year");
    expectStatus(res, 200);
    // Класс «А» (5 из 5) на доске; класс «Б» (2 активных из 3) — нет. Школа целиком дала бы «Б» вычитанием: 5 + 4 урока − 5.
    expect(res.body.classes.find((c) => c.school === MIXED_SCHOOL && c.classLabel === "6 «А»")).toMatchObject({ lessons: 5, activeStudents: 5 });
    expect(res.body.classes.find((c) => c.school === MIXED_SCHOOL && c.classLabel === "6 «Б»")).toBeUndefined();
    expect(res.body.schools.find((s) => s.school === MIXED_SCHOOL)).toBeUndefined();
  });

  it("демо-школы справочника — не на доске (ни школой, ни классом), даже с активностью выше порога", async () => {
    const res = await api.get<Schema<"PublicLeaderboard">>("/public/leaderboard?period=year");
    expectStatus(res, 200);
    expect(res.body.schools.find((s) => s.school === DEMO_SCHOOL)).toBeUndefined();
    expect(res.body.classes.find((c) => c.school === DEMO_SCHOOL)).toBeUndefined();
    // Не демо-школа того же района на доске — скрывается сама демо-запись, а не район целиком.
    expect(res.body.schools.find((s) => s.school === BIG_SCHOOL_SHOWN)).toBeDefined();
  });

  it("?period=day — учебные сутки по Уфе: та же активность сегодняшнего дня", async () => {
    const res = await api.get<Schema<"PublicLeaderboard">>("/public/leaderboard?period=day");
    expectStatus(res, 200);
    expect(res.body.period).toBe("day");
    expect(res.body.periodStart).toBe(ufaDate(new Date()));
    const school = res.body.schools.find((s) => s.school === BIG_SCHOOL_SHOWN)!;
    expect(school).toMatchObject({ lessons: 15, activeStudents: 5 });
  });

  it("?period=мусор — 422 проверки схемы с указателем на query", async () => {
    const res = await api.get<Schema<"Problem">>("/public/leaderboard?period=мусор");
    expectStatus(res, 422);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.body).toMatchObject({ code: "validation_failed" });
    expect(res.body.errors?.[0]?.pointer).toBe("#/query/period");
    // Ошибка публичной операции не кешируется.
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
