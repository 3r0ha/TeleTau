// Испытание для перехода (docs/02 §2): знающий открывает закрытое место, не проходя уроки перед ним. Настоящее
// приложение против Docker-стека; курс — синтетический (test/fixtures/content-jump: три места, у первых двух —
// «Испытание места» по 3 задания, строки — сочетания букв, правило 6).
//
// Не сдал → ничего не изменилось (тропа, мёд, серия, отметки, карточки слов). Сдал → места открыты, уроки отмечены
// «пройдено испытанием», слова — в повторении, мёд как за «Испытание места», счётчик пройденных уроков не растёт.
// Повторный переход через уже открытое место не ломает прогресс: настоящие прохождения остаются, отметок не прибавляется.
import { fileURLToPath } from "node:url";
import type { Schema } from "@teletau/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "../../src/common/uuidv7.js";
import { buildCourse, importCourse, readContent } from "../../src/modules/content/content-import.js";
import { bootApi, expectStatus, newDevice, randomIp, type AuthSession, type TestApi } from "./harness.js";

type Run = Schema<"LessonRun">;
type Result = Schema<"AttemptResult">;
type Summary = Schema<"LessonRunSummary">;
type Course = Schema<"Course">;
type Problem = Schema<"Problem">;

const FIXTURE = fileURLToPath(new URL("../fixtures/content-jump/", import.meta.url));

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ api, pool, close } = await bootApi());
  // Курс этого файла — «последний загруженный» на время файла (force обновляет момент импорта).
  await importCourse(pool, buildCourse(readContent(FIXTURE)[0]!), { force: true });
});

afterAll(async () => {
  await close?.();
});

const signup = async (): Promise<AuthSession & { accountId: string }> => {
  const res = await api.post<AuthSession>("/auth/self", { body: { device: newDevice(), nicknameId: "a03.n02", ageBand: "age_11_14" }, ip: randomIp() });
  expectStatus(res, 201);
  const me = await api.get<Schema<"Me">>("/me", { token: res.body.accessToken });
  expectStatus(me, 200);
  return { ...res.body, accountId: me.body.id };
};

/** Верные ответы синтетического курса: выбор — по башкирскому условию, ввод — по русскому. */
const CHOICE: Record<string, string> = { һөлөк: "Значение Б", пиҡол: "Значение К" };
const FREE: Record<string, string> = { "Синтетика Д": "ҡаҙым", "Синтетика Е": "сәлдерәм", "Синтетика З": "тумә", "Синтетика Ж": "ғарыҙ" };

function answerOf(e: Schema<"RunExercise">, right: boolean): Schema<"AttemptAnswer"> {
  if (e.type === "choice_ba_ru") {
    const option = e.options.find((o) => (o.textRu === CHOICE[e.prompt]) === right)!;
    return { type: "choice", optionId: option.id };
  }
  if (e.type === "free_ru_ba") return { type: "text", text: right ? FREE[e.promptRu]! : "ыыыы" };
  throw new Error(`в испытании нет заданий вида ${e.type}`);
}

const course = async (who: AuthSession): Promise<Course> => {
  const res = await api.get<Course>("/course", { token: who.accessToken });
  expectStatus(res, 200);
  return res.body;
};
const view = (c: Course) => c.units.flatMap((u) => u.nodes.map((n) => `${n.id}:${n.state}${n.passedByTest ? "*" : ""}`));
const startJump = (who: AuthSession, unitId: string, runId: string = uuidv7()) => api.post<Run>(`/units/${unitId}/jump-runs`, { token: who.accessToken, body: { runId } });
const attempt = (who: AuthSession, run: Run, e: Schema<"RunExercise">, right: boolean) =>
  api.post<Result>(`/lesson-runs/${run.runId}/attempts`, { token: who.accessToken, body: { attemptId: uuidv7(), exerciseId: e.id, answer: answerOf(e, right), latencyMs: 900 } });
const complete = (who: AuthSession, run: Run) => api.post<Summary>(`/lesson-runs/${run.runId}/complete`, { token: who.accessToken });

/** Испытание: ответы по порядку, `wrong` — какие задания (по номеру) ответить неверно. */
async function takeJump(who: AuthSession, unitId: string, wrong: ReadonlySet<number>): Promise<{ run: Run; results: Result[]; summary: Summary }> {
  const started = await startJump(who, unitId);
  expectStatus(started, 201);
  const run = started.body;
  const results: Result[] = [];
  for (const [i, e] of run.exercises.entries()) {
    const r = await attempt(who, run, e, !wrong.has(i));
    expectStatus(r, 200);
    results.push(r.body);
    if (r.body.runEnded) break;
  }
  const done = await complete(who, run);
  expectStatus(done, 200);
  return { run, results, summary: done.body };
}

/** Урок целиком верно. */
async function passLesson(who: AuthSession, lessonId: string): Promise<Summary> {
  const started = await api.post<Run>(`/lessons/${lessonId}/runs`, { token: who.accessToken, body: { runId: uuidv7() } });
  expectStatus(started, 201);
  for (const e of started.body.exercises) expectStatus(await attempt(who, started.body, e, true), 200);
  const done = await complete(who, started.body);
  expectStatus(done, 200);
  return done.body;
}

const dbState = async (accountId: string) => {
  const q = async (sql: string) => (await pool.query<{ n: number }>(sql, [accountId])).rows[0]!.n;
  return {
    skips: await q("SELECT count(*)::int AS n FROM lesson_skips WHERE account_id = $1"),
    cards: await q("SELECT count(*)::int AS n FROM srs_cards WHERE account_id = $1"),
    honey: await q("SELECT coalesce(sum(amount), 0)::int AS n FROM xp_ledger WHERE account_id = $1"),
    days: await q("SELECT count(*)::int AS n FROM activity_days WHERE account_id = $1"),
    lessons: await q("SELECT count(*)::int AS n FROM lesson_progress WHERE account_id = $1"),
  };
};

const FRESH = ["j-l1:current", "j-help:locked", "j-t1:locked", "j-l2:locked", "j-t2:locked", "j-l3:locked"];

describe("испытание для перехода — места на тропе", () => {
  it("новичку: закрытые места с испытанием, первое — без; размер — по «Испытаниям» мест перед ним", async () => {
    const who = await signup();
    const c = await course(who);
    expect(view(c)).toEqual(FRESH);
    expect(c.units.map((u) => u.jump ?? null)).toEqual([null, { exerciseCount: 3, mistakesAllowed: 2 }, { exerciseCount: 6, mistakesAllowed: 2 }]);
  });

  it("открытое место — 409 jump_unavailable; нет такого места — 404; runId чужого вида — 409 run_conflict", async () => {
    const who = await signup();
    const open = await api.post<Problem>("/units/j-u1/jump-runs", { token: who.accessToken, body: { runId: uuidv7() } });
    expect(open.status).toBe(409);
    expect(open.body.code).toBe("jump_unavailable");
    expect((await api.post("/units/no-such-unit/jump-runs", { token: who.accessToken, body: { runId: uuidv7() } })).status).toBe(404);
    const lessonRun = uuidv7();
    expectStatus(await api.post(`/lessons/j-l1/runs`, { token: who.accessToken, body: { runId: lessonRun } }), 201);
    const clash = await api.post<Problem>("/units/j-u3/jump-runs", { token: who.accessToken, body: { runId: lessonRun } });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("run_conflict");
  });

  it("забег: задания «Испытаний» мест перед целью без дуэлей и подсказок; повтор runId — тот же забег", async () => {
    const who = await signup();
    const runId = uuidv7();
    const first = await startJump(who, "j-u3", runId);
    expectStatus(first, 201);
    expect(first.body).toMatchObject({ kind: "jump", lessonId: "j-u3", titleRu: "Испытание", status: "active" });
    expect(first.body.exercises).toHaveLength(6);
    expect(first.body.exercises.some((e) => e.type === "duel" || e.type === "word_intro")).toBe(false);
    expect(first.body.exercises.some((e) => "hints" in e && e.hints?.length)).toBe(false);
    const again = await startJump(who, "j-u3", runId);
    expectStatus(again, 201);
    expect(again.body).toEqual(first.body);
  });
});

describe("испытание для перехода — не сдал", () => {
  it("третья ошибка заканчивает испытание; итог «не сдано» — ничего не изменилось", async () => {
    const who = await signup();
    const before = await course(who);
    const { results, summary } = await takeJump(who, "j-u3", new Set([0, 1, 2, 3, 4, 5]));
    // Ошибки не повторяются; после третьей — конец.
    expect(results.map((r) => [r.verdict, r.retry, r.runEnded ?? false])).toEqual([
      ["wrong", false, false],
      ["wrong", false, false],
      ["wrong", false, true],
    ]);
    expect(summary.jump).toEqual({ unitId: "j-u3", passed: false, mistakes: 3, mistakesAllowed: 2 });
    expect(summary.honey).toMatchObject({ total: 0 });
    expect(summary.dailyGoalReached).toBe(false);
    expect(summary.streak).toMatchObject({ current: 0, extendedToday: false });
    // Тропа, мёд, дни занятий, отметки и карточки слов — как были.
    const after = await course(who);
    expect(view(after)).toEqual(view(before));
    expect(after.units.map((u) => u.jump?.exerciseCount ?? null)).toEqual([null, 3, 6]);
    expect(await dbState(who.accountId)).toEqual({ skips: 0, cards: 0, honey: 0, days: 0, lessons: 0 });
    const progress = await api.get<Schema<"MyProgress">>("/me/progress", { token: who.accessToken });
    expect(progress.body).toMatchObject({ lessonsCompleted: 0, honey: { total: 0 }, dailyGoal: { done: 0 } });
  });

  it("досрочно завершить можно только проваленное; повтор итога — тот же итог", async () => {
    const who = await signup();
    const started = await startJump(who, "j-u2");
    expectStatus(started, 201);
    const run = started.body;
    expectStatus(await attempt(who, run, run.exercises[0]!, false), 200);
    const early = await api.post<Problem>(`/lesson-runs/${run.runId}/complete`, { token: who.accessToken });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("run_incomplete");
    expectStatus(await attempt(who, run, run.exercises[1]!, false), 200);
    const third = await attempt(who, run, run.exercises[2]!, false);
    expect(third.body.runEnded).toBe(true);
    const done = await complete(who, run);
    expectStatus(done, 200);
    expect(done.body.jump?.passed).toBe(false);
    const replay = await complete(who, run);
    expect(replay.body).toEqual(done.body);
  });
});

describe("испытание для перехода — сдал", () => {
  it("места открыты, уроки отмечены, слова — в повторении, мёд как за «Испытание места», счётчик уроков не растёт", async () => {
    const who = await signup();
    // Ошибки в 1-м и 3-м заданиях: две ошибки — можно.
    const { run, results, summary } = await takeJump(who, "j-u3", new Set([0, 2]));
    expect(results).toHaveLength(6);
    expect(results.every((r) => r.retry === false && !r.runEnded)).toBe(true);
    expect(summary.jump).toEqual({ unitId: "j-u3", passed: true, mistakes: 2, mistakesAllowed: 2 });
    expect(summary.honey).toEqual({ total: 14, base: 10, firstTry: 4, multiplier: 1, pendingFromVotes: 0 });
    expect(summary.streak.extendedToday).toBe(true);
    expect(summary.dailyGoal).toMatchObject({ done: 1 });

    const c = await course(who);
    expect(view(c)).toEqual(["j-l1:done*", "j-help:open", "j-t1:done*", "j-l2:done*", "j-t2:done*", "j-l3:current"]);
    expect(c.units.every((u) => !u.jump)).toBe(true);
    expect(c.units[0]!.nodes[0]).toMatchObject({ completions: 0, passedByTest: true });

    // Слова пропущенных уроков — Good (у «Испытания места» нет своих new_words, его задания слов не размечают). Слово
    // места 3 — нет: его урок впереди.
    const cards = await pool.query<{ word_id: string; rating: number; run_id: string }>(
      "SELECT r.word_id, r.rating, r.run_id FROM srs_reviews r WHERE r.account_id = $1",
      [who.accountId],
    );
    expect(Object.fromEntries(cards.rows.map((r) => [r.word_id, [r.rating, r.run_id === run.runId]]))).toEqual({ пиҡол: [3, true], һөлөк: [3, true] });
    const words = await api.get<Schema<"MyWords">>("/me/words", { token: who.accessToken });
    expect(words.body.summary.total).toBe(2);

    // Профиль: мёд и день занятий есть, пройденных уроков — ноль (их не проходили).
    const progress = await api.get<Schema<"MyProgress">>("/me/progress", { token: who.accessToken });
    expect(progress.body).toMatchObject({ lessonsCompleted: 0, wordsLearned: 0, honey: { total: 14 } });
    expect(await dbState(who.accountId)).toMatchObject({ skips: 4, lessons: 0, days: 1 });

    // Место открыто — второго испытания к нему нет.
    const again = await api.post<Problem>("/units/j-u3/jump-runs", { token: who.accessToken, body: { runId: uuidv7() } });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("jump_unavailable");
  });

  it("сначала не сдал, потом сдал в тот же день — мёд полный (несданные мёда не стоят)", async () => {
    const who = await signup();
    expect((await takeJump(who, "j-u2", new Set([0, 1, 2]))).summary.jump?.passed).toBe(false);
    const { summary } = await takeJump(who, "j-u2", new Set());
    expect(summary.jump?.passed).toBe(true);
    expect(summary.honey).toMatchObject({ multiplier: 1, total: 13 });
    expect(view(await course(who))).toEqual(["j-l1:done*", "j-help:open", "j-t1:done*", "j-l2:current", "j-t2:locked", "j-l3:locked"]);
  });
});

describe("испытание для перехода — повторно через открытое место", () => {
  it("настоящие прохождения остаются, отметки только у непройденных; второй сданный переход ничего не ломает", async () => {
    const who = await signup();
    await passLesson(who, "j-l1");
    // Два испытания к месту 3 начаты, пока оно закрыто; сдаются по очереди.
    const a = await startJump(who, "j-u3");
    const b = await startJump(who, "j-u3");
    expectStatus(a, 201);
    expectStatus(b, 201);
    // Место 1 почти пройдено: в испытание идёт и его «Испытание», и место 2.
    expect(a.body.exercises).toHaveLength(6);
    const finish = async (run: Run) => {
      for (const e of run.exercises) expectStatus(await attempt(who, run, e, true), 200);
      const done = await complete(who, run);
      expectStatus(done, 200);
      return done.body;
    };
    const first = await finish(a.body);
    const afterFirst = await course(who);
    expect(view(afterFirst)).toEqual(["j-l1:done", "j-help:open", "j-t1:done*", "j-l2:done*", "j-t2:done*", "j-l3:current"]);
    expect(afterFirst.units[0]!.nodes[0]).toMatchObject({ completions: 1 });
    const skipsAfterFirst = (await dbState(who.accountId)).skips;
    expect(skipsAfterFirst).toBe(3);

    const second = await finish(b.body);
    expect(first.jump?.passed).toBe(true);
    expect(second.jump?.passed).toBe(true);
    // Второй сданный переход к тому же месту за сутки — мёд с множителем повтора; тропа и отметки — те же.
    expect(second.honey.multiplier).toBe(0.5);
    expect(view(await course(who))).toEqual(view(afterFirst));
    expect((await dbState(who.accountId)).skips).toBe(skipsAfterFirst);

    // Урок, засчитанный испытанием, потом пройден по-настоящему: отметка уходит, счётчик уроков растёт.
    await passLesson(who, "j-l2");
    const c = await course(who);
    expect(c.units[1]!.nodes[0]).toMatchObject({ id: "j-l2", state: "done", completions: 1 });
    expect(c.units[1]!.nodes[0]).not.toHaveProperty("passedByTest");
    const progress = await api.get<Schema<"MyProgress">>("/me/progress", { token: who.accessToken });
    expect(progress.body.lessonsCompleted).toBe(2);
    // Перешедшему через место 1 — уже не новичок: следующий урок места 3 доступен.
    expect(view(c).at(-1)).toBe("j-l3:current");
  });
});
