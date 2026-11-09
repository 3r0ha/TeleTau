// Награды (GET /me/achievements и newAchievements в итоге забега). Настоящее приложение против Docker-стека.
// Курсы — синтетические (test/fixtures/content-jump: три места; test/fixtures/content: «Помоги языку» с дуэлями),
// строки — сочетания букв (правило 6). Прошлые дни — через LearningService с подменёнными часами, «сегодня» — по HTTP.
//
// Поток: новичок — ничего → урок с ошибкой (два дня назад): «Первый урок» → тот же урок без ошибок (вчера): «Без ошибок»
// → «Испытание места» сегодня: «3 дня подряд» и «Место пройдено» → повтор complete — тот же список → GET: дни
// получения и прогресс. Испытание для перехода: места, открытые им, пройдены; урок последнего места — «Вся тропа».
// Голоса в «Помоги языку» записаны до итога, но «Первый голос» приходит в итоге этого забега.
import { fileURLToPath } from "node:url";
import type { Schema } from "@teletau/contracts";
import { ufaDate } from "@teletau/domain-rules";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "../../src/common/auth.js";
import { uuidv7 } from "../../src/common/uuidv7.js";
import { buildCourse, importCourse, readContent } from "../../src/modules/content/content-import.js";
import { importDuels } from "../../src/modules/corpus/duels-import.js";
import { LearningService } from "../../src/modules/learning/index.js";
import { bootApi, expectStatus, newDevice, randomIp, type AuthSession, type TestApi } from "./harness.js";

type Run = Schema<"LessonRun">;
type Summary = Schema<"LessonRunSummary">;
type Achievements = Schema<"MyAchievements">;

const JUMP = fileURLToPath(new URL("../fixtures/content-jump/", import.meta.url));
const CONTENT = fileURLToPath(new URL("../fixtures/content/", import.meta.url));
const DAY = 86_400_000;

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;
let learning: LearningService;

beforeAll(async () => {
  ({ api, pool, close } = await bootApi());
  learning = api.app.get(LearningService);
  await importCourse(pool, buildCourse(readContent(JUMP)[0]!), { force: true });
});

afterAll(async () => {
  await close?.();
});

type Learner = AuthSession & { principal: Principal };

const signup = async (): Promise<Learner> => {
  const res = await api.post<AuthSession>("/auth/self", { body: { device: newDevice(), nicknameId: "a03.n02", ageBand: "age_11_14" }, ip: randomIp() });
  expectStatus(res, 201);
  const me = await api.get<Schema<"Me">>("/me", { token: res.body.accessToken });
  expectStatus(me, 200);
  return { ...res.body, principal: { accountId: me.body.id, kind: me.body.kind, roles: me.body.roles, sessionId: "", deviceId: "" } };
};

/** Верные ответы синтетических курсов: выбор — по башкирскому условию, ввод — по русскому. */
const CHOICE: Record<string, string> = { һөлөк: "Значение Б", пиҡол: "Значение К" };
const FREE: Record<string, string> = { "Синтетика Д": "ҡаҙым", "Синтетика Е": "сәлдерәм", "Синтетика З": "тумә", "Синтетика Ж": "ғарыҙ" };

function answerOf(e: Schema<"RunExercise">, right: boolean): Schema<"AttemptAnswer"> {
  switch (e.type) {
    case "choice_ba_ru":
      return { type: "choice", optionId: e.options.find((o) => (o.textRu === CHOICE[e.prompt]) === right)!.id };
    case "free_ru_ba":
      return { type: "text", text: right ? FREE[e.promptRu]! : "ыыыы" };
    case "tiles_ru_ba":
      return { type: "tiles", tileIds: [e.tiles[0]!.id] };
    case "duel":
      return { type: "duel", choice: "a" };
    default:
      throw new Error(`нет ответа для ${e.type}`);
  }
}

/** Забег через сервис с часами `at`: ответы по порядку, `wrong` — номера заданий, отвеченных неверно. */
async function passAt(who: Learner, lessonId: string, at: Date, wrong: ReadonlySet<number> = new Set()): Promise<Summary> {
  const run = await learning.startRun(who.principal, lessonId, { runId: uuidv7() }, at);
  for (const [i, e] of run.exercises.entries())
    await learning.submitAttempt(who.principal, run.runId, { attemptId: uuidv7(), exerciseId: e.id, answer: answerOf(e, !wrong.has(i)) }, at);
  return learning.complete(who.principal, run.runId, at);
}

/** Забег по HTTP «сегодня»: все ответы верно. */
async function passNow(who: Learner, start: string): Promise<{ run: Run; summary: Summary }> {
  const started = await api.post<Run>(start, { token: who.accessToken, body: { runId: uuidv7() } });
  expectStatus(started, 201);
  for (const e of started.body.exercises) {
    const r = await api.post(`/lesson-runs/${started.body.runId}/attempts`, {
      token: who.accessToken,
      body: { attemptId: uuidv7(), exerciseId: e.id, answer: answerOf(e, true), latencyMs: 900 },
    });
    expectStatus(r, 200);
  }
  const done = await api.post<Summary>(`/lesson-runs/${started.body.runId}/complete`, { token: who.accessToken });
  expectStatus(done, 200);
  return { run: started.body, summary: done.body };
}

const mine = async (who: Learner): Promise<Achievements> => {
  const res = await api.get<Achievements>("/me/achievements", { token: who.accessToken });
  expectStatus(res, 200);
  return res.body;
};
const byId = (a: Achievements) => new Map(a.achievements.map((x) => [x.id, x]));
const fresh = (s: Summary) => (s.newAchievements ?? []).map((a) => a.id);

describe("achievements — lessons, streak, places", () => {
  let who: Learner;
  let todayRun: Run;
  let todaySummary: Summary;

  it("a newcomer: 12 achievements, none earned; texts and icons come from the server; «Вся тропа» — all 3 places", async () => {
    who = await signup();
    const a = await mine(who);
    expect(a).toMatchObject({ earned: 0, total: 12 });
    expect(a.achievements.map((x) => x.id)).toEqual([
      "first-lesson",
      "perfect-lesson",
      "streak-3",
      "streak-7",
      "streak-30",
      "goal-7",
      "words-10",
      "words-50",
      "first-vote",
      "votes-10",
      "first-place",
      "all-places",
    ]);
    expect(a.achievements[0]).toEqual({ id: "first-lesson", titleRu: "Первый урок", descriptionRu: "Пройди первый урок", icon: "footprints", progress: 0, target: 1 });
    expect(byId(a).get("all-places")).toMatchObject({ progress: 0, target: 3 });
    expect(a.achievements.some((x) => x.earnedOn)).toBe(false);
  });

  it("a lesson with a mistake two days ago: «Первый урок» comes with the summary, «Без ошибок» does not", async () => {
    const s = await passAt(who, "j-l1", new Date(Date.now() - 2 * DAY), new Set([1]));
    expect(fresh(s)).toEqual(["first-lesson"]);
    expect(s.newAchievements![0]).toMatchObject({ id: "first-lesson", titleRu: "Первый урок", earnedOn: ufaDate(new Date(Date.now() - 2 * DAY)), progress: 1, target: 1 });
  });

  it("the same lesson without mistakes yesterday: «Без ошибок»; nothing old comes again", async () => {
    const s = await passAt(who, "j-l1", new Date(Date.now() - DAY));
    expect(fresh(s)).toEqual(["perfect-lesson"]);
  });

  it("the place test today over HTTP: third day in a row and the first place is passed", async () => {
    ({ run: todayRun, summary: todaySummary } = await passNow(who, "/lessons/j-t1/runs"));
    expect(fresh(todaySummary)).toEqual(["streak-3", "first-place"]);
  });

  it("repeating complete returns the same new achievements", async () => {
    const again = await api.post<Summary>(`/lesson-runs/${todayRun.runId}/complete`, { token: who.accessToken });
    expectStatus(again, 200);
    expect(again.body.newAchievements).toEqual(todaySummary.newAchievements);
  });

  it("GET /me/achievements: earned days by Ufa, progress for the rest (streak — the current one)", async () => {
    const a = await mine(who);
    const m = byId(a);
    expect(a.earned).toBe(4);
    expect(m.get("first-lesson")?.earnedOn).toBe(ufaDate(new Date(Date.now() - 2 * DAY)));
    expect(m.get("perfect-lesson")?.earnedOn).toBe(ufaDate(new Date(Date.now() - DAY)));
    expect(m.get("streak-3")).toMatchObject({ earnedOn: ufaDate(new Date()), progress: 3, target: 3 });
    expect(m.get("first-place")?.earnedOn).toBe(ufaDate(new Date()));
    expect(m.get("streak-7")).toMatchObject({ progress: 3, target: 7 });
    expect(m.get("streak-7")).not.toHaveProperty("earnedOn");
    expect(m.get("all-places")).toMatchObject({ progress: 1, target: 3 });
    // Слова — как в «Моём словаре».
    const words = await api.get<Schema<"MyWords">>("/me/words", { token: who.accessToken });
    expect(m.get("words-10")?.progress).toBe(words.body.summary.total);
  });

  it("another learner does not see these achievements", async () => {
    const other = await signup();
    expect((await mine(other)).earned).toBe(0);
  });
});

describe("achievements — places opened by the jump test", () => {
  it("passing the jump to the last place passes the places before it; its lesson completes the whole trail", async () => {
    const who = await signup();
    const jump = await passNow(who, "/units/j-u3/jump-runs");
    expect(jump.summary.jump?.passed).toBe(true);
    // Испытание для перехода — не урок: «Первого урока» нет, а два места за ним пройдены.
    expect(fresh(jump.summary)).toEqual(["first-place"]);
    expect(byId(await mine(who)).get("all-places")).toMatchObject({ progress: 2, target: 3 });

    const last = await passNow(who, "/lessons/j-l3/runs");
    expect(fresh(last.summary)).toEqual(["first-lesson", "perfect-lesson", "all-places"]);
  });
});

describe("achievements — votes in «Помоги языку»", () => {
  it("votes are recorded by attempts, yet «Первый голос» comes with the summary of that run; GET counts every vote", async () => {
    await importCourse(pool, buildCourse(readContent(CONTENT)[0]!), { force: true });
    await importDuels(pool, { dir: `${CONTENT}corpus/duels`, sourcesFile: `${CONTENT}sources.yaml` });
    const who = await signup();
    await passNow(who, "/lessons/t-l1/runs");
    const help = await passNow(who, "/lessons/t-help/runs");
    expect(help.run.exercises.length).toBeGreaterThan(0);
    expect(help.summary.votes).toBe(help.run.exercises.length);
    expect(fresh(help.summary)).toContain("first-vote");
    expect(byId(await mine(who)).get("votes-10")).toMatchObject({ progress: help.summary.votes, target: 10 });
  });
});
