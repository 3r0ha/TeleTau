// Повторение слов (FSRS-6), «Мой словарь», цель дня, «Пары» и записи. Настоящее приложение против Docker-стека.
// Курс — синтетический (test/fixtures/content-srs: сочетания букв, а не слова языка — правило 6), загружается тем же
// content:import. Урок «три дня назад» проходится через LearningService с подменёнными часами — так у слов наступает
// срок, а повторение и словарь проверяются по HTTP «сегодня».
//
// Поток: импорт → урок (три дня назад): карточки слов с оценкой по первым попыткам → тропа: «пора повторить 6» →
// словарь: 6 слов «повторить» → забег повторения: выбор и «Пары» → ответы обновляют карточки (повтор attemptId — без
// второго обновления) → итог: мёд и сота цели дня → второй урок сегодня: цель дня выполнена → словарь: «выучено».
import { fileURLToPath } from "node:url";
import type { Schema } from "@teletau/contracts";
import { dateToDay, dayToDate, fsrsReplay, ufaDate } from "@teletau/domain-rules";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "../../src/common/auth.js";
import { uuidv7 } from "../../src/common/uuidv7.js";
import { buildCourse, importCourse, readContent } from "../../src/modules/content/content-import.js";
import { LearningService } from "../../src/modules/learning/index.js";
import { scanPdf } from "../support/pdf-qr.js";
import { bootApi, expectStatus, newDevice, type AuthSession, type TestApi } from "./harness.js";

type Problem = Schema<"Problem">;
type Run = Schema<"LessonRun">;
type Result = Schema<"AttemptResult">;
type Summary = Schema<"LessonRunSummary">;

const FIXTURE = fileURLToPath(new URL("../fixtures/content-srs/", import.meta.url));
/** Переводы синтетических слов (как в фикстуре). */
const MEANING: Record<string, string> = {
  ҡалым: "Значение 1",
  һөрөк: "Значение 2",
  "Пәләк тумә!": "Значение 6",
  ғүзә: "Значение 3",
  сәңер: "Значение 4",
  ҙыйыр: "Значение 5",
  лөкөм: "Значение 9",
};

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;
let student: AuthSession;
let student2: AuthSession;
let learning: LearningService;

const DAY = 86_400_000;
const threeDaysAgo = () => new Date(Date.now() - 3 * DAY);
const principal = (s: AuthSession): Principal => ({ accountId: s.account.id, kind: "child", roles: ["student"], sessionId: "", deviceId: "" });

beforeAll(async () => {
  ({ api, pool, close } = await bootApi());
  learning = api.app.get(LearningService);
  const moderator = await api.loginStaff("moderator");
  const teacher = await api.verifiedTeacher("m2b-srs", moderator.accessToken, 1);
  const c = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher.accessToken, body: { grade: 6, letter: "Д", program: "native" } });
  expectStatus(c, 201);
  const seats = await api.post<Schema<"SeatIssueResult">>(`/classes/${c.body.id}/seats`, { token: teacher.accessToken, body: { count: 2 } });
  expectStatus(seats, 201);
  const links = (await scanPdf((await api.get(seats.body.printJob.pdfPath, { token: teacher.accessToken })).raw)).qr[0]!;
  const login = async (payload: string) => {
    const s = await api.post<AuthSession>("/auth/qr", { body: { payload, device: newDevice() } });
    expectStatus(s, 200);
    return s.body;
  };
  student = await login(links[0]!);
  student2 = await login(links[1]!);
  await importCourse(pool, buildCourse(readContent(FIXTURE)[0]!), { force: true });
});

afterAll(async () => {
  await close?.();
});

const cards = async (accountId: string) =>
  (
    await pool.query<{ word_id: string; stability: number; difficulty: number; reps: number; lapses: number; last_review_on: string; due_on: string }>(
      "SELECT word_id, stability, difficulty, reps, lapses, last_review_on::text, due_on::text FROM srs_cards WHERE account_id = $1 ORDER BY word_id",
      [accountId],
    )
  ).rows;
const card = async (accountId: string, wordId: string) => (await cards(accountId)).find((c) => c.word_id === wordId)!;
const addDays = (date: string, n: number) => dayToDate(dateToDay(date) + n);

/** Верный ответ на упражнение синтетического курса (тексты и переводы знает тест, клиент — нет). */
function rightAnswer(e: Schema<"RunExercise">, tilesText?: string[]): Schema<"AttemptAnswer"> {
  switch (e.type) {
    case "choice_ba_ru":
      return { type: "choice", optionId: e.options.find((o) => o.textRu === MEANING[e.prompt])!.id };
    case "match_pairs":
      return { type: "pairs", pairs: e.left.map((w) => ({ left: w.id, right: e.right.find((r) => r.textRu === MEANING[w.text])!.id })) };
    case "tiles_ru_ba":
      return { type: "tiles", tileIds: (tilesText ?? []).map((t) => e.tiles.find((x) => x.text === t)!.id) };
    case "free_ru_ba": {
      const word = Object.entries(MEANING).find(([, ru]) => ru === e.promptRu)?.[0] ?? "ҡалым";
      return { type: "text", text: word };
    }
    default:
      throw new Error(`нет ответа для ${e.type}`);
  }
}

describe("M2b · words enter review after the lesson where they were", () => {
  let lessonRun: Run;

  it("lesson three days ago: pairs exercise with opaque sides and the choice prompt with its recording", async () => {
    const at = threeDaysAgo();
    lessonRun = await learning.startRun(principal(student), "s-l1", { runId: uuidv7() }, at);
    expect(lessonRun.exercises.map((e) => e.type)).toEqual(["choice_ba_ru", "free_ru_ba", "tiles_ru_ba", "match_pairs"]);
    const choice = lessonRun.exercises[0] as Schema<"ChoiceExercise">;
    // promptAudio — копия на нашем сайте в AAC (играют все платформы); источник — страница файла Commons с лицензией.
    expect(choice.promptAudio).toMatchObject({ url: expect.stringMatching(/^\/audio\/[0-9a-f]{16}\.m4a$/), source: { license: "CC BY-SA 4.0" } });
    const pairs = lessonRun.exercises[3] as Schema<"MatchPairsExercise">;
    expect(pairs.left.map((w) => w.text).sort()).toEqual(["ғүзә", "ҙыйыр", "сәңер"].sort());
    expect(JSON.stringify(pairs)).not.toContain("отклонено");

    // Выбор и «Пары» — верно; ввод — неверно, потом верно; плитки — верно.
    for (const e of lessonRun.exercises) {
      const answer = e.type === "free_ru_ba" ? { type: "text" as const, text: "ыыы" } : rightAnswer(e, ["Пәләк", "тумә"]);
      const r = await learning.submitAttempt(principal(student), lessonRun.runId, { attemptId: uuidv7(), exerciseId: e.id, answer }, at);
      expect(r.verdict, e.type).toBe(e.type === "free_ru_ba" ? "wrong" : "correct");
      if (e.type === "match_pairs") expect(r.correctPairs).toHaveLength(3);
    }
    const free = lessonRun.exercises[1]!;
    await learning.submitAttempt(principal(student), lessonRun.runId, { attemptId: uuidv7(), exerciseId: free.id, answer: rightAnswer(free) }, at);
    const summary = await learning.complete(principal(student), lessonRun.runId, at);
    expect(summary.dailyGoal).toEqual({ target: 2, done: 1, met: false });
    expect(summary.dailyGoalReached).toBe(false);
    // Запись — копия на нашем сайте в AAC (её играют iOS, Android и все браузеры), не ссылка на Commons.
    expect(summary.newWords[0]).toMatchObject({ text: "ҡалым", audio: { url: expect.stringMatching(/^\/audio\/[0-9a-f]{16}\.m4a$/) } });
  });

  it("each word got a card: introduction rated by the first attempt (wrong — Again, correct — Good), FSRS-6 like the vectors", async () => {
    const day = ufaDate(threeDaysAgo());
    const rows = await cards(student.account.id);
    expect(rows.map((c) => c.word_id).sort()).toEqual(["ғүзә", "пәләк тумә", "сәңер", "ҙыйыр", "ҡалым", "һөрөк"].sort());
    const good = fsrsReplay({ reviews: [{ on: day, rating: 3 }] }).steps[0]!;
    const again = fsrsReplay({ reviews: [{ on: day, rating: 1 }] }).steps[0]!;
    for (const c of rows) {
      const want = c.word_id === "һөрөк" ? again : good;
      expect(c, c.word_id).toMatchObject({ reps: 1, lapses: 0, last_review_on: day, due_on: want.dueOn });
      expect(c.stability).toBeCloseTo(want.stability, 9);
      expect(c.difficulty).toBeCloseTo(want.difficulty, 9);
    }
    const log = await pool.query("SELECT word_id FROM srs_reviews WHERE run_id = $1", [lessonRun.runId]);
    expect(log.rowCount).toBe(6);
  });

  it("completing the same run again does not touch the cards", async () => {
    const before = await cards(student.account.id);
    await learning.complete(principal(student), lessonRun.runId, threeDaysAgo());
    expect(await cards(student.account.id)).toEqual(before);
  });

  it("GET /course: review.due counts words whose due date came; another student has none", async () => {
    const res = await api.get<Schema<"Course">>("/course", { token: student.accessToken });
    expectStatus(res, 200);
    expect(res.body.review).toEqual({ due: 6 });
    const other = await api.get<Schema<"Course">>("/course", { token: student2.accessToken });
    expect(other.body.review).toEqual({ due: 0 });
  });

  it("GET /me/words: the words with translations, the recording and «повторить»", async () => {
    const res = await api.get<Schema<"MyWords">>("/me/words", { token: student.accessToken });
    expectStatus(res, 200);
    expect(res.body.summary).toEqual({ total: 6, learned: 0, review: 6 });
    expect(res.body.words.map((w) => [w.word.text, w.translationRu, w.status])).toEqual([
      ["ҡалым", "Значение 1", "review"],
      ["һөрөк", "Значение 2", "review"],
      ["Пәләк тумә!", "Значение 6", "review"],
      ["ғүзә", "Значение 3", "review"],
      ["сәңер", "Значение 4", "review"],
      ["ҙыйыр", "Значение 5", "review"],
    ]);
    const audio = res.body.words[0]!.word.audio!;
    expect(res.body.words[0]!.word.review).toBe("needs_native_review");
    expect(audio.url).toMatch(/^\/audio\/[0-9a-f]{16}\.m4a$/);
    expect(audio.files?.map((f) => f.url)).toEqual([audio.url, audio.url.replace(/\.m4a$/, ".ogg")]);
    expect(JSON.stringify(audio)).not.toContain("upload.wikimedia.org");
    expect(res.body.words[1]!.word).not.toHaveProperty("audio");
    const empty = await api.get<Schema<"MyWords">>("/me/words", { token: student2.accessToken });
    expect(empty.body).toEqual({ summary: { total: 0, learned: 0, review: 0 }, words: [] });
  });
});

describe("M2b · review run: answers update the word state on the server", () => {
  let run: Run;
  const today = ufaDate(new Date());

  it("POST /reviews/runs: a short lesson of due words — choice for the first review, the most stable four as «Пары»", async () => {
    const runId = uuidv7();
    const res = await api.post<Run>("/reviews/runs", { token: student.accessToken, body: { runId } });
    expectStatus(res, 201);
    run = res.body;
    expect(run).toMatchObject({ runId, lessonId: "review", kind: "review", titleRu: "Повторение", status: "active" });
    expect(run.exercises.map((e) => e.type)).toEqual(["choice_ba_ru", "choice_ba_ru", "match_pairs"]);
    const raw = JSON.stringify(run);
    for (const leak of ["accepted", "correct", "wordOf"]) expect(raw, leak).not.toContain(leak);

    const again = await api.post<Run>("/reviews/runs", { token: student.accessToken, body: { runId } });
    expect([again.status, again.body]).toEqual([201, run]);
    const foreign = await api.post<Problem>("/reviews/runs", { token: student2.accessToken, body: { runId } });
    expect([foreign.status, foreign.body.code]).toEqual([409, "run_conflict"]);
    const asLesson = await api.post<Problem>("/lessons/s-l1/runs", { token: student.accessToken, body: { runId } });
    expect([asLesson.status, asLesson.body.code]).toEqual([409, "run_conflict"]);
  });

  it("«Пары» with a missing pair — 422 pairs_incomplete, nothing recorded", async () => {
    const pairs = run.exercises.find((e) => e.type === "match_pairs") as Schema<"MatchPairsExercise">;
    const res = await api.post<Problem>(`/lesson-runs/${run.runId}/attempts`, {
      token: student.accessToken,
      body: { attemptId: uuidv7(), exerciseId: pairs.id, answer: { type: "pairs", pairs: [{ left: pairs.left[0]!.id, right: pairs.right[0]!.id }] } },
    });
    expect([res.status, res.body.code]).toEqual([422, "pairs_incomplete"]);
  });

  it("the first attempt updates the card (Good after 3 days); a repeated attemptId — the same answer, no second update", async () => {
    const choice = run.exercises[0] as Schema<"ChoiceExercise">;
    const before = await card(student.account.id, choice.prompt === "Пәләк тумә!" ? "пәләк тумә" : choice.prompt);
    const attemptId = uuidv7();
    const body = { attemptId, exerciseId: choice.id, answer: rightAnswer(choice) };
    const res = await api.post<Result>(`/lesson-runs/${run.runId}/attempts`, { token: student.accessToken, body });
    expectStatus(res, 200);
    expect(res.body.verdict).toBe("correct");
    const after = await card(student.account.id, before.word_id);
    const want = fsrsReplay({
      reviews: [
        { on: before.last_review_on, rating: before.reps === 1 && before.stability < 1 ? 1 : 3 },
        { on: today, rating: 3 },
      ],
    }).steps[1]!;
    expect(after).toMatchObject({ reps: 2, lapses: 0, last_review_on: today, due_on: want.dueOn });
    expect(after.stability).toBeCloseTo(want.stability, 9);
    expect(after.due_on > today).toBe(true);

    const replay = await api.post<Result>(`/lesson-runs/${run.runId}/attempts`, { token: student.accessToken, body });
    expect(replay.body).toEqual(res.body);
    expect(await card(student.account.id, before.word_id)).toEqual(after);
  });

  it("a wrong first answer — Again: a lapse, due tomorrow; the retry does not count", async () => {
    const choice = run.exercises[1] as Schema<"ChoiceExercise">;
    const wordId = choice.prompt === "Пәләк тумә!" ? "пәләк тумә" : choice.prompt;
    const wrong = choice.options.find((o) => o.textRu !== MEANING[choice.prompt])!;
    const res = await api.post<Result>(`/lesson-runs/${run.runId}/attempts`, {
      token: student.accessToken,
      body: { attemptId: uuidv7(), exerciseId: choice.id, answer: { type: "choice", optionId: wrong.id } },
    });
    expect(res.body).toMatchObject({ verdict: "wrong", retry: true });
    const after = await card(student.account.id, wordId);
    expect(after).toMatchObject({ reps: 2, lapses: 1, last_review_on: today, due_on: addDays(today, 1) });
    const retry = await api.post<Result>(`/lesson-runs/${run.runId}/attempts`, { token: student.accessToken, body: { attemptId: uuidv7(), exerciseId: choice.id, answer: rightAnswer(choice) } });
    expect(retry.body).toMatchObject({ verdict: "correct", firstAttempt: false });
    expect(await card(student.account.id, wordId)).toEqual(after);
  });

  it("«Пары» correct — every paired word reviewed; complete: honey like a lesson, one cell of the daily goal", async () => {
    const pairs = run.exercises[2] as Schema<"MatchPairsExercise">;
    const res = await api.post<Result>(`/lesson-runs/${run.runId}/attempts`, { token: student.accessToken, body: { attemptId: uuidv7(), exerciseId: pairs.id, answer: rightAnswer(pairs) } });
    expect(res.body).toMatchObject({ verdict: "correct" });
    expect(res.body.correctPairs).toHaveLength(4);
    const reviewed = (await cards(student.account.id)).filter((c) => c.last_review_on === today);
    expect(reviewed).toHaveLength(6);
    expect(reviewed.every((c) => c.reps === 2)).toBe(true);

    const done = await api.post<Summary>(`/lesson-runs/${run.runId}/complete`, { token: student.accessToken });
    expectStatus(done, 200);
    expect(done.body.honey).toMatchObject({ base: 10, firstTry: 2, multiplier: 1, total: 12 });
    expect(done.body.dailyGoal).toEqual({ target: 2, done: 1, met: false });
    expect(done.body.dailyGoalReached).toBe(false);
    expect(done.body.streak.extendedToday).toBe(true);
    const log = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM srs_reviews WHERE run_id = $1", [run.runId]);
    expect(log.rows[0]!.n).toBe(6);
  });

  it("nothing due any more: review.due = 0 and a review run without exercises; the dictionary says «выучено»", async () => {
    const course = await api.get<Schema<"Course">>("/course", { token: student.accessToken });
    expect(course.body.review).toEqual({ due: 0 });
    const empty = await api.post<Run>("/reviews/runs", { token: student.accessToken, body: { runId: uuidv7() } });
    expect([empty.status, empty.body.exercises]).toEqual([201, []]);
    const words = await api.get<Schema<"MyWords">>("/me/words", { token: student.accessToken });
    expect(words.body.summary).toEqual({ total: 6, learned: 6, review: 0 });
  });

  it("the second lesson today reaches the daily goal (2 of 2) — a small celebration; known words keep their cards", async () => {
    const before = await card(student.account.id, "ҡалым");
    const start = await api.post<Run>("/lessons/s-l2/runs", { token: student.accessToken, body: { runId: uuidv7() } });
    expectStatus(start, 201);
    for (const e of start.body.exercises) {
      const answer = rightAnswer(e, ["лөкөм", "ҡалым"]);
      expectStatus(await api.post(`/lesson-runs/${start.body.runId}/attempts`, { token: student.accessToken, body: { attemptId: uuidv7(), exerciseId: e.id, answer } }), 200);
    }
    const done = await api.post<Summary>(`/lesson-runs/${start.body.runId}/complete`, { token: student.accessToken });
    expect(done.body.dailyGoal).toEqual({ target: 2, done: 2, met: true });
    expect(done.body.dailyGoalReached).toBe(true);
    expect(await card(student.account.id, "ҡалым")).toEqual(before);
    expect((await card(student.account.id, "лөкөм")).reps).toBe(1);

    const progress = await api.get<Schema<"MyProgress">>("/me/progress", { token: student.accessToken });
    expect(progress.body.dailyGoal).toEqual({ target: 2, done: 2, met: true });
  });
});
