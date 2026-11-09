// «Что в уроке» для учителя (getLessonPreview). Настоящее приложение против Docker-стека, своя база `teletau_it`;
// курс — синтетический (test/fixtures/content: сочетания букв, а не слова языка — правило 6).
//
// Учитель видит слова, фразы и виды заданий урока, «Испытания места», «Помоги языку» и урока закрытого места; варианты
// дуэлей в ответ не попадают. Ученик и взрослый без роли учителя — 403, аноним — 401, нет узла — 404, кривой id — 422.
import { fileURLToPath } from "node:url";
import type { Schema } from "@teletau/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCourse, importCourse, readContent } from "../../src/modules/content/content-import.js";
import { importDuels } from "../../src/modules/corpus/duels-import.js";
import { scanPdf } from "../support/pdf-qr.js";
import { bootApi, email, expectStatus, newDevice, type AuthSession, type TestApi } from "./harness.js";

type Preview = Schema<"LessonPreview">;

const FIXTURE = fileURLToPath(new URL("../fixtures/content/", import.meta.url));

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;
let teacher: AuthSession;
let student: AuthSession;
let adult: AuthSession;

beforeAll(async () => {
  ({ api, pool, close } = await bootApi());
  const moderator = await api.loginStaff("moderator");
  teacher = await api.verifiedTeacher("preview-t", moderator.accessToken, 1);
  adult = await api.loginAdult(email("preview-adult"));
  await api.acceptRequiredConsents(adult.accessToken);
  const c = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher.accessToken, body: { grade: 5, letter: "П", program: "native" } });
  expectStatus(c, 201);
  const seats = await api.post<Schema<"SeatIssueResult">>(`/classes/${c.body.id}/seats`, { token: teacher.accessToken, body: { count: 1 } });
  expectStatus(seats, 201);
  const [payload] = (await scanPdf((await api.get(seats.body.printJob.pdfPath, { token: teacher.accessToken })).raw)).qr[0]!;
  const s = await api.post<AuthSession>("/auth/qr", { body: { payload, device: newDevice() } });
  expectStatus(s, 200);
  student = s.body;
  await importCourse(pool, buildCourse(readContent(FIXTURE)[0]!), { force: true });
  await importDuels(pool, { dir: `${FIXTURE}corpus/duels`, sourcesFile: `${FIXTURE}sources.yaml` });
});

afterAll(async () => {
  await close?.();
});

const preview = async (lessonId: string, token: string | null = teacher.accessToken) => api.get<Preview>(`/lessons/${lessonId}/preview`, token ? { token } : {});
const shown = (list: Schema<"LessonPreviewWord">[]) => list.map((w) => [w.word.text, w.translationRu]);

describe("getLessonPreview — what is inside a lesson, for the teacher", () => {
  it("lesson: title, place, new words with translation, phrases and task kinds", async () => {
    const res = await preview("t-l1");
    expectStatus(res, 200);
    expect(res.body).toEqual({
      lessonId: "t-l1",
      kind: "lesson",
      titleRu: "Урок один",
      unitId: "t-u1",
      place: { slug: "ufa", titleRu: "Место один", titleBa: { text: "Ҡывап", review: "needs_native_review" } },
      topicRu: "Синтетика",
      exerciseCount: 5,
      words: [{ id: "һөлөк", word: { text: "һөлөк", review: "needs_native_review" }, translationRu: "Значение Б" }],
      phrases: [{ id: "пиҡол тумә", word: { text: "Пиҡол тумә!", review: "needs_native_review" }, translationRu: "Синтетика А" }],
      tasks: [
        { type: "tiles_ru_ba", count: 1 },
        { type: "choice_ba_ru", count: 1 },
        { type: "free_ru_ba", count: 2 },
        { type: "duel", count: 1 },
      ],
    });
  });

  it("duels: only the kind and the count — no variants of «Помоги языку»", async () => {
    const lesson = await preview("t-l2");
    expectStatus(lesson, 200);
    expect(lesson.body.tasks).toContainEqual({ type: "duel", count: 1 });
    const help = await preview("t-help");
    expectStatus(help, 200);
    expect(help.body).toMatchObject({ kind: "help_language", exerciseCount: 2, words: [], phrases: [], tasks: [{ type: "duel", count: 2 }] });
    const variants = (
      await pool.query<{ text: string; ru: string }>("SELECT v.text, s.text AS ru FROM variants v JOIN source_items s ON s.id = v.source_item_id WHERE s.unit_id = 't-u1'")
    ).rows.flatMap((r) => [r.text, r.ru]);
    expect(variants.length).toBeGreaterThan(0);
    for (const body of [lesson.raw, help.raw].map((b) => b.toString("utf8"))) for (const v of variants) expect(body).not.toContain(v);
  });

  it("place test and a lesson of a locked place can be previewed too", async () => {
    const test = await preview("t-test");
    expectStatus(test, 200);
    expect(test.body.kind).toBe("place_test");
    expect(shown(test.body.words)).toEqual([
      ["тумә", "Синтетика З"],
      ["пиҡол", "Значение К"],
    ]);
    expect(shown(test.body.phrases)).toEqual([["ғарыҙ һөлөк", "Синтетика Л"]]);
    const locked = await preview("t-u2-l1");
    expectStatus(locked, 200);
    expect(locked.body).toMatchObject({ unitId: "t-u2", place: { titleRu: "Место два" } });
  });

  it("only a verified teacher: student 403, adult without the teacher role 403, anonymous 401", async () => {
    expectStatus(await preview("t-l1", student.accessToken), 403);
    expectStatus(await preview("t-l1", adult.accessToken), 403);
    expectStatus(await preview("t-l1", null), 401);
  });

  it("unknown node — 404, malformed id — 422", async () => {
    expectStatus(await preview("t-nope"), 404);
    expectStatus(await preview("Not_A_Slug"), 422);
  });
});
