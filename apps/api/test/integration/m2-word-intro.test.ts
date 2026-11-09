// «Новое слово» перед упражнениями и подсказки к условию — настоящее приложение против Docker-стека, по HTTP.
// Курс — синтетический (test/fixtures/content-srs: сочетания букв, а не слова языка — правило 6), загружается тем же
// content:import.
//
// Поток: клиент просит карточки (accepts: [word_intro]) → в уроке карточки перед упражнениями со словами → ответить на
// карточку нельзя (422) → урок завершается без ответов на карточки, мёд и точность — только по упражнениям → слова
// урока стали «встреченными» → во втором уроке карточка только у нового слова, подсказка — к слову внутри фразы, а не на
// всё условие → ответ с открытой подсказкой: мёд тот же, слово идёт в повторение как Hard → клиент без accepts получает
// прежний урок → повторение карточек не показывает.
import { fileURLToPath } from "node:url";
import type { Schema } from "@teletau/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "../../src/common/uuidv7.js";
import { buildCourse, importCourse, readContent } from "../../src/modules/content/content-import.js";
import { scanPdf } from "../support/pdf-qr.js";
import { bootApi, expectStatus, newDevice, type AuthSession, type TestApi } from "./harness.js";

type Problem = Schema<"Problem">;
type Run = Schema<"LessonRun">;
type Result = Schema<"AttemptResult">;
type Summary = Schema<"LessonRunSummary">;

const FIXTURE = fileURLToPath(new URL("../fixtures/content-srs/", import.meta.url));
/** Переводы синтетических слов (как в фикстуре). */
const MEANING: Record<string, string> = { ҡалым: "Значение 1", һөрөк: "Значение 2", лөкөм: "Значение 9" };

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;
let student: AuthSession;
let student2: AuthSession;

beforeAll(async () => {
  ({ api, pool, close } = await bootApi());
  const moderator = await api.loginStaff("moderator");
  const teacher = await api.verifiedTeacher("m2-word-intro", moderator.accessToken, 1);
  const c = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher.accessToken, body: { grade: 3, letter: "Ж", program: "native" } });
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

const start = (s: AuthSession, lessonId: string, body: Record<string, unknown>) => api.post<Run>(`/lessons/${lessonId}/runs`, { token: s.accessToken, body: { runId: uuidv7(), ...body } });
const attempt = (s: AuthSession, run: Run, exerciseId: string, answer: Schema<"AttemptAnswer">, extra: { hintsUsed?: number } = {}) =>
  api.post<Result>(`/lesson-runs/${run.runId}/attempts`, { token: s.accessToken, body: { attemptId: uuidv7(), exerciseId, answer, ...extra } });
const shape = (run: Run) => run.exercises.map((e) => (e.type === "word_intro" ? `[${e.word.text}]` : e.type));

/** Верный ответ на упражнение синтетического курса (тексты и переводы знает тест, клиент — нет). */
function rightAnswer(e: Schema<"RunExercise">, tiles = ["Пәләк", "тумә"]): Schema<"AttemptAnswer"> {
  switch (e.type) {
    case "choice_ba_ru":
      return { type: "choice", optionId: e.options.find((o) => o.textRu === MEANING[e.prompt])!.id };
    case "match_pairs": {
      const ru: Record<string, string> = { ғүзә: "Значение 3", сәңер: "Значение 4", ҙыйыр: "Значение 5" };
      return { type: "pairs", pairs: e.left.map((w) => ({ left: w.id, right: e.right.find((r) => r.textRu === ru[w.text])!.id })) };
    }
    case "tiles_ru_ba":
      return { type: "tiles", tileIds: tiles.map((t) => e.tiles.find((x) => x.text === t)!.id) };
    case "free_ru_ba":
      return { type: "text", text: Object.entries(MEANING).find(([, ru]) => ru === e.promptRu)![0] };
    default:
      throw new Error(`нет ответа для ${e.type}`);
  }
}

describe("M2 · новое слово сначала показывают, потом проверяют", () => {
  let run: Run;

  it("accepts: [word_intro] — по две карточки перед упражнениями со словами; слово с записью и переводом из словаря", async () => {
    const res = await start(student, "s-l1", { accepts: ["word_intro"] });
    expectStatus(res, 201);
    run = res.body;
    expect(shape(run)).toEqual(["[ҡалым]", "[һөрөк]", "choice_ba_ru", "free_ru_ba", "[Пәләк тумә!]", "[ғүзә]", "tiles_ru_ba", "[сәңер]", "[ҙыйыр]", "match_pairs"]);
    expect(run.exercises.map((e) => e.id)).toEqual(run.exercises.map((_, i) => `e${i + 1}`));
    const card = run.exercises[0] as Schema<"WordIntroExercise">;
    expect(card).toMatchObject({ type: "word_intro", review: "needs_native_review", translationRu: "Значение 1", word: { text: "ҡалым", review: "needs_native_review" } });
    expect(card.word.audio?.url).toMatch(/^\/audio\/[0-9a-f]{16}\.m4a$/);
    expect(card.sources?.[0]?.title).toBeTruthy();
    // Число упражнений на тропе — по-прежнему только упражнения.
    const course = await api.get<Schema<"Course">>("/course", { token: student.accessToken });
    expect(course.body.units[0]!.nodes.find((n) => n.id === "s-l1")?.exerciseCount).toBe(4);
  });

  it("повтор с тем же runId — тот же забег, как бы ни было заполнено accepts", async () => {
    const again = await api.post<Run>("/lessons/s-l1/runs", { token: student.accessToken, body: { runId: run.runId } });
    expect([again.status, again.body]).toEqual([201, run]);
  });

  it("на карточку ответить нельзя — 422 answer_type_mismatch, попытка не записана; неизвестное в accepts — 422", async () => {
    const res = await api.post<Problem>(`/lesson-runs/${run.runId}/attempts`, {
      token: student.accessToken,
      body: { attemptId: uuidv7(), exerciseId: "e1", answer: { type: "text", text: "ҡалым" } },
    });
    expect([res.status, res.body.code]).toEqual([422, "answer_type_mismatch"]);
    const rows = await pool.query("SELECT 1 FROM attempts WHERE run_id = $1", [run.runId]);
    expect(rows.rowCount).toBe(0);
    const bad = await start(student, "s-l1", { accepts: ["flashcards"] });
    expect([bad.status, (bad.body as unknown as Problem).code]).toEqual([422, "validation_failed"]);
  });

  it("урок завершается без ответов на карточки: мёд «с первой попытки» и точность — только по упражнениям; слова — в повторении", async () => {
    for (const e of run.exercises) {
      if (e.type === "word_intro") continue;
      const r = await attempt(student, run, e.id, rightAnswer(e));
      expectStatus(r, 200);
      expect(r.body.verdict, e.type).toBe("correct");
    }
    const done = await api.post<Summary>(`/lesson-runs/${run.runId}/complete`, { token: student.accessToken });
    expectStatus(done, 200);
    expect(done.body.honey.firstTry).toBe(4);
    expect(done.body.accuracy).toBe(1);
    const cards = await pool.query<{ word_id: string }>("SELECT word_id FROM srs_cards WHERE account_id = $1 ORDER BY word_id", [student.account.id]);
    expect(cards.rows.map((c) => c.word_id).sort()).toEqual(["ғүзә", "пәләк тумә", "сәңер", "ҙыйыр", "ҡалым", "һөрөк"].sort());
  });

  let run2: Run;

  it("встреченное слово второй раз не показывается: во втором уроке — карточка только у «лөкөм»; подсказка — к слову внутри фразы", async () => {
    const res = await start(student, "s-l2", { accepts: ["word_intro"] });
    expectStatus(res, 201);
    run2 = res.body;
    expect(shape(run2)).toEqual(["free_ru_ba", "[лөкөм]", "choice_ba_ru", "tiles_ru_ba"]);
    // «Значение 1» — всё условие: подсказка выдала бы ответ — её нет.
    expect((run2.exercises[0] as Schema<"FreeInputExercise">).hints).toBeUndefined();
    // «Значение 9, затем Значение 10»: подсказка к «Значение 9»; «Значение 10» переводом «Значение 1» не подсказывается.
    const tiles = run2.exercises[3] as Schema<"TilesExercise">;
    expect(tiles.hints).toEqual([{ text: "Значение 9", translation: expect.objectContaining({ text: "лөкөм", review: "needs_native_review" }) }]);
  });

  it("hintsUsed хранится в попытке, не больше подсказок упражнения; мёд и точность — как без подсказки", async () => {
    const [free, , choice, tiles] = run2.exercises;
    // У ввода подсказок нет — hintsUsed не учитывается; у плиток одна — 5 превращается в 1.
    expectStatus(await attempt(student, run2, free!.id, rightAnswer(free!), { hintsUsed: 3 }), 200);
    expectStatus(await attempt(student, run2, choice!.id, rightAnswer(choice!)), 200);
    const hinted = await attempt(student, run2, tiles!.id, rightAnswer(tiles!, ["лөкөм", "ҡалым"]), { hintsUsed: 5 });
    expect([hinted.status, hinted.body.verdict]).toEqual([200, "correct"]);
    const stored = await pool.query<{ run_exercise_id: string; hints_used: number }>(
      "SELECT run_exercise_id, hints_used FROM attempts WHERE run_id = $1 ORDER BY run_exercise_id",
      [run2.runId],
    );
    expect(stored.rows.map((r) => [r.run_exercise_id, r.hints_used])).toEqual([
      [free!.id, 0],
      [choice!.id, 0],
      [tiles!.id, 1],
    ]);
    const done = await api.post<Summary>(`/lesson-runs/${run2.runId}/complete`, { token: student.accessToken });
    expectStatus(done, 200);
    expect(done.body.honey.firstTry).toBe(3);
    expect(done.body.accuracy).toBe(1);
  });

  it("клиент без accepts получает прежний урок — без карточек; подсказка — только к слову внутри фразы", async () => {
    const res = await start(student2, "s-l1", {});
    expectStatus(res, 201);
    const run = res.body;
    expect(shape(run)).toEqual(["choice_ba_ru", "free_ru_ba", "tiles_ru_ba", "match_pairs"]);
    // «Значение 2» — всё условие: без подсказки; «Значение 6, как Значение 2» — подсказки к обеим частям.
    expect((run.exercises[1] as Schema<"FreeInputExercise">).hints).toBeUndefined();
    expect((run.exercises[2] as Schema<"TilesExercise">).hints?.map((h) => [h.text, h.translation.text])).toEqual([
      ["Значение 6", "Пәләк тумә!"],
      ["Значение 2", "һөрөк"],
    ]);

    // Всё верно, к плиткам открыли подсказку: мёд за все четыре, а «Пәләк тумә!» идёт в повторение как Hard
    // (векторы srs/rating.json v2), остальные слова — Good.
    for (const e of run.exercises) {
      const r = await attempt(student2, run, e.id, rightAnswer(e), e.type === "tiles_ru_ba" ? { hintsUsed: 1 } : {});
      expect([r.status, r.body.verdict], e.type).toEqual([200, "correct"]);
    }
    const done = await api.post<Summary>(`/lesson-runs/${run.runId}/complete`, { token: student2.accessToken });
    expectStatus(done, 200);
    expect(done.body.honey.firstTry).toBe(4);
    const log = await pool.query<{ word_id: string; rating: number }>("SELECT word_id, rating FROM srs_reviews WHERE run_id = $1 ORDER BY word_id", [run.runId]);
    expect(Object.fromEntries(log.rows.map((r) => [r.word_id, r.rating]))).toEqual({ "пәләк тумә": 2, ҡалым: 3, һөрөк: 3, ғүзә: 3, сәңер: 3, ҙыйыр: 3 });
  });

  it("повторение карточек не показывает, даже если клиент их умеет", async () => {
    const res = await api.post<Run>("/reviews/runs", { token: student.accessToken, body: { runId: uuidv7(), accepts: ["word_intro"] } });
    expectStatus(res, 201);
    expect(res.body.exercises.some((e) => e.type === "word_intro")).toBe(false);
  });
});
