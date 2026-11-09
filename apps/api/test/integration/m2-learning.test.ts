// Уроки, мёд, серия, лига (docs/plans/M2.md §1 шаги 1–5, §3 «Ч2»). Настоящее приложение против Docker-стека.
// Курс и дуэли — синтетические (test/fixtures/content: сочетания букв, а не слова языка — правило 6), загружаются
// тем же content:import и corpus:import, что и демо-контент.
//
// Поток: импорт → ученик начинает урок → ответы верно, «почти», опечатка, неверно и голос в дуэли → итог с мёдом
// и серией по векторам → повторы урока за сутки (½ и 0) → прогресс класса у учителя (чужой учитель — 403) → улей
// → лига. Плюс идемпотентность runId/attemptId/complete, мёд за голос в дуэли, закрытие недели лиги с подменёнными часами,
// повторный импорт курса.
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Schema } from "@teletau/contracts";
import { ufaDate } from "@teletau/domain-rules";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "../../src/common/auth.js";
import { uuidv7 } from "../../src/common/uuidv7.js";
import type { Db } from "../../src/db/database.js";
import { DB } from "../../src/infra/tokens.js";
import { CompetitionService } from "../../src/modules/competition/index.js";
import { buildCourse, importCourse, readContent } from "../../src/modules/content/content-import.js";
import { importDuels } from "../../src/modules/corpus/duels-import.js";
import { ProgressService } from "../../src/modules/progress/index.js";
import { scanPdf } from "../support/pdf-qr.js";
import { bootApi, expectStatus, newDevice, type AuthSession, type TestApi } from "./harness.js";

type Problem = Schema<"Problem">;
type Run = Schema<"LessonRun">;
type Result = Schema<"AttemptResult">;
type Summary = Schema<"LessonRunSummary">;

const FIXTURE = fileURLToPath(new URL("../fixtures/content/", import.meta.url));

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;
let db: Db;
let teacher: AuthSession;
let teacherB: AuthSession;
let student: AuthSession;
let student2: AuthSession;
let classId: string;

beforeAll(async () => {
  ({ api, pool, close } = await bootApi());
  db = api.app.get<Db>(DB);
  const moderator = await api.loginStaff("moderator");
  teacher = await api.verifiedTeacher("m2-learning-a", moderator.accessToken, 1);
  teacherB = await api.verifiedTeacher("m2-learning-b", moderator.accessToken, 2);
  const c = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher.accessToken, body: { grade: 5, letter: "Г", program: "native" } });
  expectStatus(c, 201);
  classId = c.body.id;
  const seats = await api.post<Schema<"SeatIssueResult">>(`/classes/${classId}/seats`, { token: teacher.accessToken, body: { count: 3 } });
  expectStatus(seats, 201);
  const links = (await scanPdf((await api.get(seats.body.printJob.pdfPath, { token: teacher.accessToken })).raw)).qr[0]!;
  const login = async (payload: string) => {
    const s = await api.post<AuthSession>("/auth/qr", { body: { payload, device: newDevice() } });
    expectStatus(s, 200);
    return s.body;
  };
  student = await login(links[0]!);
  student2 = await login(links[1]!);

  // Синтетический курс — «последний загруженный» на время этого файла (force обновляет момент импорта).
  await importCourse(pool, buildCourse(readContent(FIXTURE)[0]!), { force: true });
  await importDuels(pool, { dir: `${FIXTURE}corpus/duels`, sourcesFile: `${FIXTURE}sources.yaml` });
});

afterAll(async () => {
  await close?.();
});

const tx = <T>(fn: (t: Db) => Promise<T>) => db.transaction(fn);
const ledger = async (refId: string) => (await pool.query<{ amount: number; status: string }>("SELECT amount, status FROM xp_ledger WHERE ref_id = $1", [refId])).rows;
const counters = async (accountId: string) =>
  (await pool.query<{ votes_total: number; votes_matured: number }>("SELECT votes_total, votes_matured FROM progress_counters WHERE account_id = $1", [accountId])).rows[0];

describe("M2 · honey for votes — ProgressService for consensus (Ч3)", () => {
  it("creditVote: pending 3 once per judgmentId; «Не знаю» — nothing", async () => {
    const progress = api.app.get(ProgressService);
    const accountId = randomUUID();
    const [j1, j2] = [uuidv7(), uuidv7()];
    await tx((t) => progress.creditVote(t, { accountId, judgmentId: j1, choice: "a", at: new Date() }));
    await tx((t) => progress.creditVote(t, { accountId, judgmentId: j1, choice: "a", at: new Date() }));
    await tx((t) => progress.creditVote(t, { accountId, judgmentId: j2, choice: "skip", at: new Date() }));
    expect(await ledger(j1)).toEqual([{ amount: 3, status: "pending" }]);
    expect(await ledger(j2)).toEqual([]);
    expect(await counters(accountId)).toEqual({ votes_total: 1, votes_matured: 0 });
    expect(await progress.pendingHoney(accountId, [j1, j2])).toBe(3);
  });

  it("settleVotes: pending → final (3 agree, 1 disagree, «оба» — только если приняты оба); repeat changes nothing", async () => {
    const progress = api.app.get(ProgressService);
    const accountId = randomUUID();
    const [agree, disagree, both] = [uuidv7(), uuidv7(), uuidv7()];
    for (const [judgmentId, choice] of [
      [agree, "a"],
      [disagree, "b"],
      [both, "both"],
    ] as const) {
      await tx((t) => progress.creditVote(t, { accountId, judgmentId, choice, at: new Date() }));
    }
    const votes = [
      { accountId, judgmentId: agree, choice: "a" as const },
      { accountId, judgmentId: disagree, choice: "b" as const },
      { accountId, judgmentId: both, choice: "both" as const },
    ];
    await tx((t) => progress.settleVotes(t, { accepted: ["a"] }, votes, new Date()));
    await tx((t) => progress.settleVotes(t, { accepted: ["a", "b"] }, votes, new Date()));
    expect(await ledger(agree)).toEqual([{ amount: 3, status: "final" }]);
    expect(await ledger(disagree)).toEqual([{ amount: 1, status: "final" }]);
    expect(await ledger(both)).toEqual([{ amount: 1, status: "final" }]);
    expect(await counters(accountId)).toEqual({ votes_total: 3, votes_matured: 3 });
  });

  it("settleVotes without a pending row: inserts final at once (total and matured grow together, no CHECK violation)", async () => {
    const progress = api.app.get(ProgressService);
    const fresh = randomUUID();
    const judgmentId = uuidv7();
    await tx((t) => progress.settleVotes(t, { accepted: ["b"] }, [{ accountId: fresh, judgmentId, choice: "b" }], new Date()));
    expect(await ledger(judgmentId)).toEqual([{ amount: 3, status: "final" }]);
    expect(await counters(fresh)).toEqual({ votes_total: 1, votes_matured: 1 });
    // Аккаунт со счётчиками: созревание голоса без строки «созревает» тоже не нарушает matured ≤ total.
    const other = uuidv7();
    await tx((t) => progress.settleVotes(t, { accepted: ["a"] }, [{ accountId: fresh, judgmentId: other, choice: "b" }], new Date()));
    expect(await counters(fresh)).toEqual({ votes_total: 2, votes_matured: 2 });
  });
});

describe("M2 · lesson from runs to complete: honey and streak by vectors (learning, progress)", () => {
  let run: Run;
  const today = () => ufaDate(new Date());
  const answers = new Map<string, Result>();
  const attempt = (r: Run, exerciseId: string, answer: Schema<"AttemptAnswer">, who: AuthSession = student, attemptId: string = uuidv7()) =>
    api.post<Result>(`/lesson-runs/${r.runId}/attempts`, { token: who.accessToken, body: { attemptId, exerciseId, answer, latencyMs: 1200 } });
  const byType = <T extends Schema<"RunExercise">["type"]>(r: Run, type: T) =>
    r.exercises.filter((e): e is Extract<Schema<"RunExercise">, { type: T }> => e.type === type);
  const tilesOf = (e: Schema<"TilesExercise">, ...texts: string[]) => texts.map((t) => e.tiles.find((x) => x.text === t)!.id);

  /** Все упражнения забега верно (дуэль — голос «a»). */
  async function passAll(r: Run): Promise<void> {
    for (const e of r.exercises) {
      const answer: Schema<"AttemptAnswer"> =
        e.type === "duel"
          ? { type: "duel", choice: "a" }
          : e.type === "choice_ba_ru"
            ? { type: "choice", optionId: e.options.find((o) => ["Значение Б", "Значение К"].includes(o.textRu))!.id }
            : e.type === "tiles_ru_ba"
              ? { type: "tiles", tileIds: e.promptRu === "Синтетика А" ? tilesOf(e, "Пиҡол", "тумә") : tilesOf(e, "ғарыҙ", "һөлөк") }
              : { type: "text", text: (e as Schema<"FreeInputExercise">).promptRu === "Синтетика Д" ? "ҡаҙым" : (e as Schema<"FreeInputExercise">).promptRu === "Синтетика Е" ? "сәлдерәм" : "тумә" };
      expectStatus(await attempt(r, e.id, answer), 200);
    }
  }

  it("GET /course: the trail with node states; locked unit shows its signs without exercise counts", async () => {
    const res = await api.get<Schema<"Course">>("/course", { token: student.accessToken });
    expectStatus(res, 200);
    expect(res.body).toMatchObject({ id: "t-course", contentVersion: 1 });
    const [u1, u2] = res.body.units;
    expect(u1).toMatchObject({ id: "t-u1", order: 1, state: "open", place: { slug: "ufa", titleRu: "Место один", titleBa: { text: "Ҡывап", review: "needs_native_review" } } });
    expect(u1!.nodes.map((n) => [n.id, n.kind, n.state, n.exerciseCount])).toEqual([
      ["t-l1", "lesson", "current", 5],
      ["t-help", "help_language", "locked", 2],
      ["t-l2", "lesson", "locked", 4],
      ["t-test", "place_test", "locked", 4],
    ]);
    expect(u2!.state).toBe("locked");
    expect(u2!.nodes.map((n) => [n.id, n.state, "exerciseCount" in n])).toEqual([
      ["t-u2-l1", "locked", false],
      ["t-u2-help", "locked", false],
    ]);
  });

  it("startLessonRun: locked node — 409 lesson_locked, unknown — 404", async () => {
    const locked = await api.post<Problem>("/lessons/t-l2/runs", { token: student.accessToken, body: { runId: uuidv7() } });
    expect([locked.status, locked.body.code]).toEqual([409, "lesson_locked"]);
    expect((await api.post("/lessons/t-nope/runs", { token: student.accessToken, body: { runId: uuidv7() } })).status).toBe(404);
  });

  it("startLessonRun: exercises without answer keys; the student's first lesson — no duel; same runId — same run, someone else's — 409", async () => {
    const runId = uuidv7();
    const res = await api.post<Run>("/lessons/t-l1/runs", { token: student.accessToken, body: { runId } });
    expectStatus(res, 201);
    run = res.body;
    expect(run).toMatchObject({ runId, lessonId: "t-l1", kind: "lesson", titleRu: "Урок один", status: "active" });
    // В первых двух уроках ученика дуэлей нет (LESSONS_BEFORE_DUELS, docs/02 §3): упражнение duel пропущено.
    expect(run.exercises.map((e) => e.type)).toEqual(["tiles_ru_ba", "choice_ba_ru", "free_ru_ba", "free_ru_ba"]);
    const raw = JSON.stringify(run);
    for (const leak of ["accepted", "answerKey", "correct", "ҡаҙым", "сәлдерәм", "meaningRu"]) expect(raw, leak).not.toContain(leak);
    expect(byType(run, "free_ru_ba")[0]!.letters).toHaveLength(9);

    const again = await api.post<Run>("/lessons/t-l1/runs", { token: student.accessToken, body: { runId } });
    expect([again.status, again.body]).toEqual([201, run]);
    const foreign = await api.post<Problem>("/lessons/t-l1/runs", { token: student2.accessToken, body: { runId } });
    expect([foreign.status, foreign.body.code]).toEqual([409, "run_conflict"]);
    const otherLesson = await api.post<Problem>("/lessons/t-help/runs", { token: student.accessToken, body: { runId } });
    expect([otherLesson.status, otherLesson.body.code]).toEqual([409, "run_conflict"]);
  });

  it("attempts: tiles correct; choice wrong → «вернём в конце»; «почти» with the letter; typo", async () => {
    const tiles = byType(run, "tiles_ru_ba")[0]!;
    const ok = await attempt(run, tiles.id, { type: "tiles", tileIds: tilesOf(tiles, "Пиҡол", "тумә") });
    expectStatus(ok, 200);
    expect(ok.body).toMatchObject({ verdict: "correct", firstAttempt: true, retry: false, correctAnswer: { text: "Пиҡол тумә!", review: "needs_native_review" } });

    const incomplete = await api.post<Problem>(`/lesson-runs/${run.runId}/complete`, { token: student.accessToken });
    expect([incomplete.status, incomplete.body.code]).toEqual([409, "run_incomplete"]);

    const choice = byType(run, "choice_ba_ru")[0]!;
    const wrong = await attempt(run, choice.id, { type: "choice", optionId: choice.options.find((o) => o.textRu === "Значение В")!.id });
    expect(wrong.body).toEqual({
      attemptId: wrong.body.attemptId,
      exerciseId: choice.id,
      verdict: "wrong",
      firstAttempt: true,
      retry: true,
      correctOptionId: choice.options.find((o) => o.textRu === "Значение Б")!.id,
      meaningRu: "Значение Б",
    });

    const [short, long] = byType(run, "free_ru_ba");
    const almost = await attempt(run, short!.id, { type: "text", text: "Казым" });
    expect(almost.body).toMatchObject({ verdict: "almost", retry: false, correctAnswer: { text: "ҡаҙым" }, hint: { expected: "ҡ", got: "к", token: 0, index: 0 } });
    const typo = await attempt(run, long!.id, { type: "text", text: "сәлдерәп" });
    expect(typo.body).toMatchObject({ verdict: "typo", retry: false, correctAnswer: { text: "сәлдерәм" } });
    answers.set("typo", typo.body);
  });

  it("attempt replay returns the same result; wrong answer type, unknown exercise, someone else's run — refused", async () => {
    const long = byType(run, "free_ru_ba")[1]!;
    const replay = await attempt(run, long.id, { type: "text", text: "сәлдерәп" }, student, answers.get("typo")!.attemptId);
    expect([replay.status, replay.body]).toEqual([200, answers.get("typo")]);
    const mismatch = await attempt(run, long.id, { type: "choice", optionId: "x" });
    expect([mismatch.status, (mismatch.body as unknown as Problem).code]).toEqual([422, "answer_type_mismatch"]);
    const missing = await attempt(run, "e99", { type: "text", text: "x" });
    expect([missing.status, (missing.body as unknown as Problem).code]).toEqual([422, "exercise_not_in_run"]);
    expect((await attempt(run, long.id, { type: "text", text: "x" }, student2)).status).toBe(404);
    expect((await api.post(`/lesson-runs/${run.runId}/complete`, { token: student2.accessToken })).status).toBe(404);
  });

  it("completeLessonRun: honey 10 + first-try (almost and typo count) ×1, accuracy, streak day 1; no votes in the first lesson", async () => {
    const choice = byType(run, "choice_ba_ru")[0]!;
    const retry = await attempt(run, choice.id, { type: "choice", optionId: choice.options.find((o) => o.textRu === "Значение Б")!.id });
    expect(retry.body).toMatchObject({ verdict: "correct", firstAttempt: false, retry: false });

    const res = await api.post<Summary>(`/lesson-runs/${run.runId}/complete`, { token: student.accessToken });
    expectStatus(res, 200);
    expect(res.body).toMatchObject({
      runId: run.runId,
      lessonId: "t-l1",
      honey: { base: 10, firstTry: 3, multiplier: 1, total: 13, pendingFromVotes: 0 },
      accuracy: 0.75,
      votes: 0,
      newWords: [
        { text: "Пиҡол тумә!", review: "needs_native_review" },
        { text: "һөлөк", review: "needs_native_review" },
      ],
      streak: { current: 1, longest: 1, freezes: 2, extendedToday: true, today: today() },
    });
    expect(res.body.streak.week).toHaveLength(7);
    expect(res.body.streak.week.find((d) => d.date === today())?.status).toBe("done");
    expect(res.body).not.toHaveProperty("leagueResult");

    const again = await api.post<Summary>(`/lesson-runs/${run.runId}/complete`, { token: student.accessToken });
    expect([again.status, again.body]).toEqual([200, res.body]);
    const late = await attempt(run, choice.id, { type: "choice", optionId: choice.options[0]!.id });
    expect([late.status, (late.body as unknown as Problem).code]).toEqual([409, "run_completed"]);
    expect(await ledger(run.runId)).toEqual([{ amount: 13, status: "final" }]);
  });

  it("repeating the lesson the same Ufa day: ½ honey, from the third time — 0; no double credit for a replayed complete", async () => {
    const totals: number[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await api.post<Run>("/lessons/t-l1/runs", { token: student.accessToken, body: { runId: uuidv7() } });
      expectStatus(r, 201);
      await passAll(r.body);
      const s = await api.post<Summary>(`/lesson-runs/${r.body.runId}/complete`, { token: student.accessToken });
      expectStatus(s, 200);
      // Повтор того же урока — всё ещё один пройденный урок: дуэли нет.
      expect(r.body.exercises.map((e) => e.type)).not.toContain("duel");
      expect(s.body.honey).toMatchObject({ base: 10, firstTry: 4, pendingFromVotes: 0 });
      totals.push(s.body.honey.total);
      expectStatus(await api.post(`/lesson-runs/${r.body.runId}/complete`, { token: student.accessToken }), 200);
    }
    expect(totals).toEqual([7, 0]);
  });

  it("«Помоги языку»: only duels — even before the third lesson; honey for the lesson — 0, for votes — ripening", async () => {
    const r = await api.post<Run>("/lessons/t-help/runs", { token: student.accessToken, body: { runId: uuidv7() } });
    expectStatus(r, 201);
    expect(r.body.exercises.map((e) => e.type)).toEqual(["duel", "duel"]);
    await passAll(r.body);
    const s = await api.post<Summary>(`/lesson-runs/${r.body.runId}/complete`, { token: student.accessToken });
    expect(s.body).toMatchObject({ honey: { base: 0, firstTry: 0, total: 0, pendingFromVotes: 6 }, votes: 2, accuracy: 1 });
  });

  it("GET /me/progress and the trail after the lessons", async () => {
    const me = await api.get<Schema<"MyProgress">>("/me/progress", { token: student.accessToken });
    expectStatus(me, 200);
    expect(me.body).toMatchObject({
      honey: { total: 20, pending: 6 },
      streak: { current: 1, extendedToday: true },
      league: { tier: "clover", points: 20, rank: expect.any(Number) },
      lessonsCompleted: 1,
      wordsLearned: 2,
      votes: { total: 2, matured: 0, pending: 2 },
    });
    const course = await api.get<Schema<"Course">>("/course", { token: student.accessToken });
    expect(course.body.units[0]!.nodes.map((n) => [n.id, n.state, n.completions])).toEqual([
      ["t-l1", "done", 3],
      ["t-help", "done", 1],
      ["t-l2", "current", 0],
      ["t-test", "locked", 0],
    ]);
    const fresh = await api.get<Schema<"MyProgress">>("/me/progress", { token: student2.accessToken });
    expect(fresh.body).toMatchObject({ honey: { total: 0, pending: 0 }, streak: { current: 0, freezes: 2, extendedToday: false }, league: { tier: "clover", points: 0 }, lessonsCompleted: 0 });
    expect(fresh.body.league).not.toHaveProperty("rank");
  });

  it("GET /classes/{id}/progress: by seat numbers, no nicknames or account ids; a teacher of another class — 403", async () => {
    const res = await api.get<Schema<"ClassProgress">>(`/classes/${classId}/progress`, { token: teacher.accessToken });
    expectStatus(res, 200);
    // 3 места, ученики с аккаунтом — на двух: «Занимались 1 из 2», а не «из 3».
    expect(res.body.summary).toEqual({ seatsTotal: 3, studentsTotal: 2, activeSeats: 1, lessonsCompleted: 4, honeyEarned: 20, votes: 2 });
    expect(res.body.seats).toEqual([
      { seatNumber: 1, lessonsCompleted: 1, wordsLearned: 2, lessonsThisWeek: 4, honeyThisWeek: 20, streak: 1, lastActiveOn: today(), accuracy: 1 },
      { seatNumber: 2, lessonsCompleted: 0, wordsLearned: 0, lessonsThisWeek: 0, honeyThisWeek: 0, streak: 0 },
    ]);
    // Уроки — по местам тропы: unitId связывает урок с заголовком места в units.
    expect(res.body.lessons).toEqual([
      { lessonId: "t-l1", titleRu: "Урок один", completedSeats: 1, unitId: "t-u1", kind: "lesson" },
      { lessonId: "t-l2", titleRu: "Урок t-l2", completedSeats: 0, unitId: "t-u1", kind: "lesson" },
      { lessonId: "t-test", titleRu: "Урок t-test", completedSeats: 0, unitId: "t-u1", kind: "place_test" },
    ]);
    expect(res.body.units?.map((u) => [u.id, u.order, u.place.titleRu])).toEqual([["t-u1", 1, "Место один"]]);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(student.account.id);
    expect(raw).not.toContain("nickname");
    expect((await api.get(`/classes/${classId}/progress`, { token: teacherB.accessToken })).status).toBe(403);
  });

  it("GET /classes/{id}/hive: the week quest and participation — aggregates only", async () => {
    const res = await api.get<Schema<"ClassHive">>(`/classes/${classId}/hive`, { token: student2.accessToken });
    expectStatus(res, 200);
    expect(res.body).toMatchObject({ classId, quest: { goal: 30, progress: 4, completed: false, titleRu: "Пройдите всем классом 30 уроков" }, participation: { active: 1, total: 2 } });
    expect(res.body.days).toHaveLength(7);
    expect(res.body.days.find((d) => d.date === today())?.active).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain(student.account.id);
    expectStatus(await api.get(`/classes/${classId}/hive`, { token: teacher.accessToken }), 200);
  });

  it("«Занимались N из M» одинаково у учителя («Прогресс») и у ученика (вкладка «Класс»): M — ученики с аккаунтом, не все места", async () => {
    const hive = await api.get<Schema<"ClassHive">>(`/classes/${classId}/hive`, { token: student2.accessToken });
    const progress = await api.get<Schema<"ClassProgress">>(`/classes/${classId}/progress`, { token: teacher.accessToken });
    expectStatus(hive, 200);
    expectStatus(progress, 200);
    const { activeSeats, studentsTotal, seatsTotal } = progress.body.summary;
    expect({ active: activeSeats, total: studentsTotal }).toEqual(hive.body.participation);
    expect(studentsTotal).toBeLessThan(seatsTotal);
  });

  it("GET /leagues/current: tier, zones, my place; before the first points — empty group", async () => {
    const mine = await api.get<Schema<"LeagueStanding">>("/leagues/current", { token: student.accessToken });
    expectStatus(mine, 200);
    expect(mine.body).toMatchObject({ tier: "clover", zones: { promote: 5, demote: 0 }, me: { points: 20, me: true, zone: "promote" } });
    expect(mine.body.members.filter((m) => m.me)).toHaveLength(1);
    expect(Date.parse(mine.body.endsAt)).toBeGreaterThan(Date.now());
    const empty = await api.get<Schema<"LeagueStanding">>("/leagues/current", { token: student2.accessToken });
    expect(empty.body).toMatchObject({ tier: "clover", members: [] });
    expect(empty.body).not.toHaveProperty("me");
    const unseen = await api.post<Problem>("/leagues/result-seen", { token: student.accessToken, body: { weekStart: "2026-10-26" } });
    expect(unseen.status).toBe(404);
    expect((await api.post("/leagues/result-seen", { token: student.accessToken, body: { weekStart: "не дата" } })).status).toBe(422);
  });

  const play = async (lessonId: string, onDuel?: (r: Run, duel: Schema<"DuelExercise">) => Promise<void>) => {
    const r = await api.post<Run>(`/lessons/${lessonId}/runs`, { token: student.accessToken, body: { runId: uuidv7() } });
    expectStatus(r, 201);
    const duel = byType(r.body, "duel")[0];
    if (duel && onDuel) await onDuel(r.body, duel);
    await passAll(r.body);
    const s = await api.post<Summary>(`/lesson-runs/${r.body.runId}/complete`, { token: student.accessToken });
    expectStatus(s, 200);
    return { types: r.body.exercises.map((e) => e.type), summary: s.body };
  };

  it("a duel in the lesson only from the student's third lesson: «Голос учтён» (recorded) without the distribution; the vote is in the journal as a child's", async () => {
    // Пройден один урок (t-l1, трижды) — дуэли всё ещё нет; второй урок (t-l2) — тоже без дуэли.
    expect((await play("t-l1")).types).toEqual(["tiles_ru_ba", "choice_ba_ru", "free_ru_ba", "free_ru_ba"]);
    const second = await play("t-l2");
    expect(second.types).toEqual(["free_ru_ba", "choice_ba_ru", "tiles_ru_ba"]);
    expect(second.summary).toMatchObject({ votes: 0, accuracy: 1, honey: { base: 10, firstTry: 3, multiplier: 1, total: 13 } });
    // Два урока пройдены — в уроке появляется дуэль из пула юнита.
    let voted: { attemptId: string; runId: string } | undefined;
    const third = await play("t-l1", async (r, duel) => {
      expect(duel).toMatchObject({ review: "needs_native_review", sourceRu: expect.stringMatching(/^Синтетическая пара \d$/) });
      expect(new Set([duel.a, duel.b]).size).toBe(2);
      const attemptId = uuidv7();
      const res = await attempt(r, duel.id, { type: "duel", choice: "a" }, student, attemptId);
      expect(res.body).toEqual({ attemptId, exerciseId: duel.id, verdict: "recorded", firstAttempt: true, retry: false });
      voted = { attemptId, runId: r.runId };
    });
    expect(third.types).toEqual(["tiles_ru_ba", "choice_ba_ru", "free_ru_ba", "free_ru_ba", "duel"]);
    expect(third.summary).toMatchObject({ votes: 1, honey: { firstTry: 4, multiplier: 0, total: 0, pendingFromVotes: 3 } });
    const { rows } = await pool.query("SELECT voter_group, choice, context, run_id FROM judgments WHERE id = $1", [voted!.attemptId]);
    expect(rows).toEqual([{ voter_group: "child", choice: "a", context: "lesson", run_id: voted!.runId }]);
    expect(await ledger(voted!.attemptId)).toEqual([{ amount: 3, status: "pending" }]);
  });

  it("the duel is skipped when the unit pool is exhausted or the referenced duel is unavailable; the lesson counts as usual", async () => {
    // Из шести дуэлей пула юнита осталось три: две забирает «Помоги языку», последнюю — урок; следующий урок — без дуэли.
    const help = await play("t-help");
    expect(help.types).toEqual(["duel", "duel"]);
    const last = await play("t-l1");
    expect(last.types).toEqual(["tiles_ru_ba", "choice_ba_ru", "free_ru_ba", "free_ru_ba", "duel"]);
    expect(last.summary).toMatchObject({ votes: 1, honey: { firstTry: 4, multiplier: 0, total: 0, pendingFromVotes: 3 } });
    const exhausted = await play("t-l1");
    expect(exhausted.types).toEqual(["tiles_ru_ba", "choice_ba_ru", "free_ru_ba", "free_ru_ba"]);
    expect(exhausted.summary).toMatchObject({ votes: 0, accuracy: 1, honey: { base: 10, firstTry: 4, total: 0, pendingFromVotes: 0 } });
    // Ссылка на дуэль, за которую уже голосовал (у t-l2 — на дуэль с отклонённым носителем вариантом, её нет в корпусе).
    const voted = await play("t-test");
    expect(voted.types).toEqual(["free_ru_ba", "choice_ba_ru", "tiles_ru_ba"]);
    expect(voted.summary.honey.total).toBe(13);
    const empty = await api.post<Run>("/lessons/t-help/runs", { token: student.accessToken, body: { runId: uuidv7() } });
    expect(empty.body.exercises).toEqual([]);

    const me = await api.get<Schema<"MyProgress">>("/me/progress", { token: student.accessToken });
    expect(me.body).toMatchObject({ honey: { total: 46, pending: 18 }, lessonsCompleted: 3, votes: { total: 6, pending: 6 } });
    const course = await api.get<Schema<"Course">>("/course", { token: student.accessToken });
    expect(course.body.units[0]!.nodes.map((n) => n.state)).toEqual(["done", "done", "done", "done"]);
  });

  it("a wrong answer returns once: the second and third wrong answers — retry: false; the lesson completes", async () => {
    const kid = await api.post<AuthSession>("/auth/self", { body: { device: newDevice(), nicknameId: "a03.n02", ageBand: "age_11_14" }, ip: `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` });
    expectStatus(kid, 201);
    const r = await api.post<Run>("/lessons/t-l1/runs", { token: kid.body.accessToken, body: { runId: uuidv7() } });
    expectStatus(r, 201);
    const choice = byType(r.body, "choice_ba_ru")[0]!;
    const wrongOption = choice.options.find((o) => o.textRu === "Значение В")!.id;
    const retries: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await attempt(r.body, choice.id, { type: "choice", optionId: wrongOption }, kid.body);
      expectStatus(res, 200);
      expect(res.body).toMatchObject({ verdict: "wrong", firstAttempt: i === 0, correctOptionId: choice.options.find((o) => o.textRu === "Значение Б")!.id });
      retries.push(res.body.retry);
    }
    expect(retries).toEqual([true, false, false]);
    // Остальные упражнения — тоже неверно, по два раза: второй ответ — retry: false. Урок всё равно завершается.
    for (const e of r.body.exercises.filter((x) => x.id !== choice.id)) {
      const wrong: Schema<"AttemptAnswer"> = e.type === "tiles_ru_ba" ? { type: "tiles", tileIds: [e.tiles[0]!.id] } : { type: "text", text: "ыыы" };
      const first = await attempt(r.body, e.id, wrong, kid.body);
      const second = await attempt(r.body, e.id, wrong, kid.body);
      expect([first.body.verdict, first.body.retry, second.body.verdict, second.body.retry]).toEqual(["wrong", true, "wrong", false]);
    }
    const done = await api.post<Summary>(`/lesson-runs/${r.body.runId}/complete`, { token: kid.body.accessToken });
    expectStatus(done, 200);
    expect(done.body).toMatchObject({ accuracy: 0, honey: { base: 10, firstTry: 0, total: 10 } });
    // Слова урока ушли в повторение с Again (первая попытка неверна).
    const { rows } = await pool.query<{ rating: number }>("SELECT rating FROM srs_reviews WHERE run_id = $1", [r.body.runId]);
    expect(rows.map((x) => x.rating)).toEqual([1, 1]);
  });
});

describe("M2 · league week closes lazily (substituted clocks, Ufa week Mon–Sun)", () => {
  const competition = () => api.app.get(CompetitionService);
  const principal = (accountId: string): Principal => ({ accountId, kind: "adult", roles: [], sessionId: "", deviceId: "" });
  const points = (accountId: string, n: number, at: string) =>
    tx((t) => competition().addLeaguePoints(t, { accountId, ageGroup: "adult", points: n, at: new Date(at) }));

  it("the week ends on Monday 00:00 Ufa (19:00 UTC on Sunday)", async () => {
    const a = randomUUID();
    await points(a, 5, "2025-04-13T18:59:59Z");
    expect(await competition().leagueBadge(a, new Date("2025-04-13T18:59:59Z"))).toMatchObject({ tier: "clover", points: 5, rank: 1 });
    expect(await competition().leagueBadge(a, new Date("2025-04-13T19:00:00Z"))).toEqual({ tier: "buckwheat", points: 0 });
  });

  it("the first request of the new week closes the group: top 5 promoted, the rest stay on the lowest tier", async () => {
    const ids = Array.from({ length: 7 }, () => randomUUID());
    for (const [i, id] of ids.entries()) await points(id, 70 - i * 10, `2025-03-05T10:0${i}:00Z`);
    const now = new Date("2025-03-11T10:00:00Z");
    expect(await competition().unseenResult(ids[0]!, now)).toEqual({ weekStart: "2025-03-03", tierBefore: "clover", tierAfter: "buckwheat", outcome: "promoted", rank: 1, points: 70 });
    expect(await competition().unseenResult(ids[6]!, now)).toEqual({ weekStart: "2025-03-03", tierBefore: "clover", tierAfter: "clover", outcome: "stayed", rank: 7, points: 10 });
    expect(await competition().unseenResult(ids[0]!, now)).toMatchObject({ rank: 1, outcome: "promoted" });

    await points(ids[0]!, 4, "2025-03-11T11:00:00Z");
    const standing = await competition().currentLeague(principal(ids[0]!), now);
    expect(standing).toMatchObject({
      week: { start: "2025-03-10", end: "2025-03-16" },
      endsAt: "2025-03-16T19:00:00.000Z",
      tier: "buckwheat",
      zones: { promote: 5, demote: 3 },
      members: [{ rank: 1, points: 4, me: true, zone: "promote" }],
      lastResult: { weekStart: "2025-03-03", outcome: "promoted" },
    });
    await competition().markResultSeen(principal(ids[0]!), { weekStart: "2025-03-03" }, now);
    expect(await competition().unseenResult(ids[0]!, now)).toBeUndefined();
    await expect(competition().markResultSeen(principal(ids[0]!), { weekStart: "2025-03-10" }, now)).rejects.toMatchObject({ status: 404 });
  });

  it("the last 3 are demoted on a middle tier", async () => {
    const group = uuidv7();
    await pool.query("INSERT INTO league_groups (id, week_start, tier, age_group) VALUES ($1, '2025-05-05', 'buckwheat', 'adult')", [group]);
    const ids = Array.from({ length: 10 }, () => randomUUID());
    for (const [i, id] of ids.entries()) {
      await pool.query("INSERT INTO league_members (group_id, account_id, week_start, points, scored_at) VALUES ($1, $2, '2025-05-05', $3, $4)", [group, id, 100 - i * 10, `2025-05-06T10:0${i}:00Z`]);
    }
    const now = new Date("2025-05-13T08:00:00Z");
    const outcome = async (i: number) => (await competition().unseenResult(ids[i]!, now))?.outcome;
    expect(await Promise.all([0, 4, 5, 6, 7, 9].map(outcome))).toEqual(["promoted", "promoted", "stayed", "stayed", "demoted", "demoted"]);
    expect(await competition().leagueBadge(ids[9]!, now)).toEqual({ tier: "clover", points: 0 });
    expect(await competition().leagueBadge(ids[0]!, now)).toEqual({ tier: "sweetclover", points: 0 });
  });
});

describe("M2 · content:import is idempotent with content versions", () => {
  it("the same version — unchanged; other content under the same version — refused; a new version replaces the course", async () => {
    const files = readContent(FIXTURE)[0]!;
    expect(await importCourse(pool, buildCourse(files))).toMatchObject({ status: "unchanged", units: 2, lessons: 6, exercises: 13 });
    const changed = structuredClone(files);
    (changed.lessons["t-l2"] as { title_ru: string }).title_ru = "Урок изменён";
    await expect(importCourse(pool, buildCourse(changed))).rejects.toThrow(/другим содержимым/);
    (changed.course as { version: number }).version = 2;
    expect(await importCourse(pool, buildCourse(changed))).toMatchObject({ status: "imported", version: 2 });
    await expect(importCourse(pool, buildCourse(files))).rejects.toThrow(/ниже загруженной/);
    const course = await api.get<Schema<"Course">>("/course", { token: student.accessToken });
    expect(course.body.contentVersion).toBe(2);
    expect(course.body.units[0]!.nodes.find((n) => n.id === "t-l2")?.titleRu).toBe("Урок изменён");
    // Прохождения прошлой версии остаются: узлы с теми же id.
    expect(course.body.units[0]!.nodes.find((n) => n.id === "t-l1")?.state).toBe("done");
  });
});
