// Задания учителя классу и карточка ученика (ADR 0021). Настоящее приложение против Docker-стека, курс — синтетический
// (test/fixtures/content: сочетания букв, а не слова языка — правило 6).
//
// Поток: учитель видит, что можно задать → ошибки срока и урока (422) → задание «урок» → у ученика оно на тропе,
// а заданный закрытый урок открыт → ученик проходит урок → выполнено у ученика и у учителя по номеру места → дубль
// и лимит двух активных (409), Idempotency-Key → «Повторить слова», когда срок слов ещё не наступил → после срока:
// сделано позже и просрочено → снять задание → карточка ученика по номеру места (чужой класс — 403, пустое место — 404).
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Schema } from "@teletau/contracts";
import { dateToDay, dayToDate, ufaDate } from "@teletau/domain-rules";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "../../src/common/auth.js";
import { uuidv7 } from "../../src/common/uuidv7.js";
import { AssignmentsService } from "../../src/modules/assignments/index.js";
import { buildCourse, importCourse, readContent } from "../../src/modules/content/content-import.js";
import { importDuels } from "../../src/modules/corpus/duels-import.js";
import { LearningService } from "../../src/modules/learning/index.js";
import { scanPdf } from "../support/pdf-qr.js";
import { bootApi, expectStatus, newDevice, type AuthSession, type TestApi } from "./harness.js";

type Problem = Schema<"Problem">;
type Run = Schema<"LessonRun">;
type ClassAssignment = Schema<"ClassAssignment">;
type ClassAssignments = Schema<"ClassAssignments">;

const FIXTURE = fileURLToPath(new URL("../fixtures/content/", import.meta.url));
const DAY = 86_400_000;

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;
let teacher: AuthSession;
let teacherB: AuthSession;
let student: AuthSession;
let student2: AuthSession;
let classId: string;
const today = () => ufaDate(new Date());
const plusDays = (date: string, n: number) => dayToDate(dateToDay(date) + n);
const principalOf = (s: AuthSession): Principal => ({ accountId: s.account.id, kind: s.account.kind, roles: s.account.roles, sessionId: "", deviceId: "" });

beforeAll(async () => {
  ({ api, pool, close } = await bootApi());
  const moderator = await api.loginStaff("moderator");
  teacher = await api.verifiedTeacher("assign-a", moderator.accessToken, 1);
  teacherB = await api.verifiedTeacher("assign-b", moderator.accessToken, 2);
  const c = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher.accessToken, body: { grade: 7, letter: "З", program: "native" } });
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
  await importCourse(pool, buildCourse(readContent(FIXTURE)[0]!), { force: true });
  await importDuels(pool, { dir: `${FIXTURE}corpus/duels`, sourcesFile: `${FIXTURE}sources.yaml` });
});

afterAll(async () => {
  await close?.();
});

/** Любой ответ нужного вида: для засчитывания задания важна не точность, а пройденный урок. */
function anyAnswer(e: Schema<"RunExercise">): Schema<"AttemptAnswer"> {
  switch (e.type) {
    case "duel":
      return { type: "duel", choice: "skip" };
    case "choice_ba_ru":
      return { type: "choice", optionId: e.options[0]!.id };
    case "tiles_ru_ba":
      return { type: "tiles", tileIds: [e.tiles[0]!.id] };
    case "match_pairs":
      return { type: "pairs", pairs: e.left.map((l, i) => ({ left: l.id, right: e.right[i]!.id })) };
    default:
      return { type: "text", text: "x" };
  }
}

async function finish(who: AuthSession, run: Run): Promise<Schema<"LessonRunSummary">> {
  for (const e of run.exercises) expectStatus(await api.post(`/lesson-runs/${run.runId}/attempts`, { token: who.accessToken, body: { attemptId: uuidv7(), exerciseId: e.id, answer: anyAnswer(e) } }), 200);
  const done = await api.post<Schema<"LessonRunSummary">>(`/lesson-runs/${run.runId}/complete`, { token: who.accessToken });
  expectStatus(done, 200);
  return done.body;
}

/** Урок от начала до итога через сервис с подменёнными часами (как демо-сид). */
async function passAt(who: AuthSession, lessonId: string, at: Date): Promise<void> {
  const learning = api.app.get(LearningService);
  const p = principalOf(who);
  const run = await learning.startRun(p, lessonId, { runId: uuidv7(at.getTime()) }, at);
  let t = at.getTime();
  for (const e of run.exercises) await learning.submitAttempt(p, run.runId, { attemptId: uuidv7((t += 1000)), exerciseId: e.id, answer: anyAnswer(e) }, new Date(t));
  await learning.complete(p, run.runId, new Date(t + 1000));
}

const list = async (who: AuthSession = teacher) => {
  const res = await api.get<ClassAssignments>(`/classes/${classId}/assignments`, { token: who.accessToken });
  expectStatus(res, 200);
  return res.body;
};
const course = async (who: AuthSession = student) => (await api.get<Schema<"Course">>("/course", { token: who.accessToken })).body;
const nodeState = (c: Schema<"Course">, id: string) => c.units.flatMap((u) => u.nodes).find((n) => n.id === id)?.state;

describe("assignments — the teacher gives a lesson, students see and do it (ADR 0021)", () => {
  let lessonTask: ClassAssignment;
  let reviewTask: ClassAssignment;

  it("empty class: what can be assigned — lessons and the place test of open units, in trail order; limit 2", async () => {
    const body = await list();
    expect(body).toMatchObject({ classId, maxActive: 2, active: [], past: [] });
    expect(body.options.map((o) => [o.kind, o.lessonId, o.placeRu, o.unitOrder])).toEqual([
      ["lesson", "t-l1", "Место один", 1],
      ["lesson", "t-l2", "Место один", 1],
      ["place_test", "t-test", "Место один", 1],
    ]);
  });

  it("422: due date in the past or too far, «Помоги языку», a lesson of a locked unit, kind mismatch, review with a lesson", async () => {
    const bad = async (body: unknown) => {
      const res = await api.post<Problem>(`/classes/${classId}/assignments`, { token: teacher.accessToken, body });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      return res.body.errors?.[0]?.pointer;
    };
    expect(await bad({ kind: "lesson", lessonId: "t-l1", dueOn: plusDays(today(), -1) })).toBe("/dueOn");
    expect(await bad({ kind: "lesson", lessonId: "t-l1", dueOn: plusDays(today(), 29) })).toBe("/dueOn");
    expect(await bad({ kind: "lesson", lessonId: "t-help", dueOn: today() })).toBe("/lessonId");
    expect(await bad({ kind: "lesson", lessonId: "t-u2-l1", dueOn: today() })).toBe("/lessonId");
    expect(await bad({ kind: "place_test", lessonId: "t-l1", dueOn: today() })).toBe("/lessonId");
    expect(await bad({ kind: "review", lessonId: "t-l1", dueOn: today() })).toBe("/lessonId");
    expect(await bad({ kind: "lesson", dueOn: today() })).toBe("/lessonId");
    expect((await list()).active).toEqual([]);
  });

  it("201: lesson t-l2 till +3 days; the same Idempotency-Key — the same task; seats with students only, all «todo»", async () => {
    const key = randomUUID();
    const body = { kind: "lesson", lessonId: "t-l2", dueOn: plusDays(today(), 3) };
    const res = await api.post<ClassAssignment>(`/classes/${classId}/assignments`, { token: teacher.accessToken, body, headers: { "idempotency-key": key } });
    expectStatus(res, 201);
    lessonTask = res.body;
    expect(lessonTask).toMatchObject({ kind: "lesson", lessonId: "t-l2", titleRu: "Урок t-l2", placeRu: "Место один", dueOn: body.dueOn, active: true });
    expect(lessonTask.seats).toEqual([
      { seatNumber: 1, status: "todo" },
      { seatNumber: 2, status: "todo" },
    ]);
    expect(lessonTask.summary).toEqual({ total: 2, done: 0, late: 0, todo: 2, overdue: 0 });
    const again = await api.post<ClassAssignment>(`/classes/${classId}/assignments`, { token: teacher.accessToken, body, headers: { "idempotency-key": key } });
    expect([again.status, again.body.id]).toEqual([201, lessonTask.id]);
    const dup = await api.post<Problem>(`/classes/${classId}/assignments`, { token: teacher.accessToken, body });
    expect([dup.status, dup.body.code]).toEqual([409, "assignment_exists"]);
  });

  it("the student sees the task on the trail; the assigned lesson is open although the previous one is not passed", async () => {
    const c = await course();
    expect(c.assignments).toEqual([{ id: lessonTask.id, kind: "lesson", lessonId: "t-l2", titleRu: "Урок t-l2", placeRu: "Место один", dueOn: lessonTask.dueOn, done: false }]);
    expect(nodeState(c, "t-l1")).toBe("current");
    expect(nodeState(c, "t-l2")).toBe("open");
    expect(nodeState(c, "t-test")).toBe("locked");
    // Учитель — не ученик: заданий на его тропе нет.
    expect((await course(teacher)).assignments).toBeUndefined();
  });

  it("the student passes the assigned lesson → done for him (trail) and for the teacher by seat number", async () => {
    const run = await api.post<Run>("/lessons/t-l2/runs", { token: student.accessToken, body: { runId: uuidv7() } });
    expectStatus(run, 201);
    await finish(student, run.body);
    expect((await course()).assignments?.[0]?.done).toBe(true);
    expect((await course(student2)).assignments?.[0]?.done).toBe(false);
    const task = (await list()).active.find((t) => t.id === lessonTask.id)!;
    expect(task.seats.map((s) => [s.seatNumber, s.status])).toEqual([
      [1, "done"],
      [2, "todo"],
    ]);
    expect(task.seats[0]!.completedAt).toEqual(expect.any(String));
    expect(task.summary).toMatchObject({ done: 1, todo: 1 });
    // Повтор урока не перезаписывает момент выполнения.
    const before = task.seats[0]!.completedAt;
    await finish(student, (await api.post<Run>("/lessons/t-l2/runs", { token: student.accessToken, body: { runId: uuidv7() } })).body);
    expect((await list()).active.find((t) => t.id === lessonTask.id)!.seats[0]!.completedAt).toBe(before);
  });

  it("«Повторить слова»: the second task; the third — 409 assignment_limit; review counts even before words are due", async () => {
    const res = await api.post<ClassAssignment>(`/classes/${classId}/assignments`, { token: teacher.accessToken, body: { kind: "review", dueOn: today() } });
    expectStatus(res, 201);
    reviewTask = res.body;
    expect(reviewTask).toMatchObject({ kind: "review", titleRu: "Повторить слова", active: true });
    expect(reviewTask).not.toHaveProperty("lessonId");
    const third = await api.post<Problem>(`/classes/${classId}/assignments`, { token: teacher.accessToken, body: { kind: "place_test", lessonId: "t-test", dueOn: today() } });
    expect([third.status, third.body.code]).toEqual([409, "assignment_limit"]);

    // Слова урока только что узнаны: срок повторения ещё не наступил, но задание выполнимо сегодня.
    expect((await course()).review?.due).toBe(0);
    const run = await api.post<Run>("/reviews/runs", { token: student.accessToken, body: { runId: uuidv7() } });
    expectStatus(run, 201);
    expect(run.body.exercises.length).toBeGreaterThan(0);
    await finish(student, run.body);
    const c = await course();
    expect(c.assignments?.map((a) => [a.kind, a.done])).toEqual([
      ["review", true],
      ["lesson", true],
    ]);
    // У второго ученика слов нет — повторять нечего, задание не выполнено.
    const empty = await api.post<Run>("/reviews/runs", { token: student2.accessToken, body: { runId: uuidv7() } });
    expect(empty.body.exercises).toEqual([]);
  });

  it("after the due date: «done late» and «overdue»; the task moves to past and frees a slot", async () => {
    const service = api.app.get(AssignmentsService);
    const due = dateToDay(lessonTask.dueOn);
    // Через день после срока (12:00 по Уфе = 07:00 UTC) второй ученик проходит t-l1 и заданный t-l2 — уже поздно.
    const late = new Date(`${dayToDate(due + 1)}T07:00:00Z`);
    await passAt(student2, "t-l1", late);
    await passAt(student2, "t-l2", new Date(late.getTime() + 10 * 60_000));
    const after = await service.list(principalOf(teacher), classId, new Date(late.getTime() + DAY / 2));
    expect(after.active).toEqual([]);
    const lesson = after.past.find((t) => t.id === lessonTask.id)!;
    expect(lesson).toMatchObject({ active: false, summary: { total: 2, done: 1, late: 1, todo: 0, overdue: 0 } });
    expect(lesson.seats.map((s) => s.status)).toEqual(["done", "done_late"]);
    const review = after.past.find((t) => t.id === reviewTask.id)!;
    expect(review.seats.map((s) => s.status)).toEqual(["done", "overdue"]);
    // Сроки прошли — слоты свободны: новое задание выдаётся.
    const fresh = await service.create(principalOf(teacher), classId, { kind: "place_test", lessonId: "t-test", dueOn: dayToDate(due + 2) }, undefined, new Date(late.getTime() + DAY / 2));
    expect(fresh).toMatchObject({ kind: "place_test", titleRu: "Урок t-test", active: true });
    await service.cancel(principalOf(teacher), classId, fresh.id);
    // Урок, пройденный ещё до выдачи задания, — уже сделано (у ученика на тропе тоже).
    const passed = await service.create(principalOf(teacher), classId, { kind: "lesson", lessonId: "t-l1", dueOn: dayToDate(due + 2) }, undefined, new Date(late.getTime() + DAY / 2));
    expect(passed.seats.map((s) => s.status)).toEqual(["todo", "done"]);
    expect(passed.seats[1]!.completedAt).toEqual(expect.any(String));
    expect((await service.forStudent(principalOf(student2), new Date(late.getTime() + DAY / 2))).find((a) => a.id === passed.id)?.done).toBe(true);
    await service.cancel(principalOf(teacher), classId, passed.id);
  });

  it("cancel: 204 (twice too), the task disappears for the teacher and the students; unknown — 404, foreign teacher — 403", async () => {
    const del = (id: string, who: AuthSession = teacher) => api.call<Problem>("DELETE", `/classes/${classId}/assignments/${id}`, { token: who.accessToken });
    expect((await del(lessonTask.id, teacherB)).status).toBe(403);
    expect((await del(lessonTask.id)).status).toBe(204);
    expect((await del(lessonTask.id)).status).toBe(204);
    expect((await del(randomUUID())).status).toBe(404);
    expect((await list()).active.map((t) => t.id)).toEqual([reviewTask.id]);
    expect((await course()).assignments?.map((a) => a.id)).toEqual([reviewTask.id]);
    // Снятый урок у ученика снова закрыт по обычным правилам тропы.
    expect(nodeState(await course(), "t-l2")).toBe("done");
  });
});

describe("seat card — the teacher opens a student by seat number (getSeatProgress)", () => {
  it("lessons in trail order with best accuracy, words, streak, votes, honey, recent days — no nickname", async () => {
    const res = await api.get<Schema<"SeatProgressCard">>(`/classes/${classId}/seats/1/progress`, { token: teacher.accessToken });
    expectStatus(res, 200);
    const card = res.body;
    expect(card).toMatchObject({ classId, seatNumber: 1, lessonsCompleted: 1, streak: { current: 1, longest: 1 }, votes: { total: 0, matured: 0 }, lastActiveOn: today() });
    expect(card.lessons.map((l) => [l.lessonId, l.kind, l.titleRu, l.placeRu, l.completions, l.lastCompletedOn])).toEqual([["t-l2", "lesson", "Урок t-l2", "Место один", 2, today()]]);
    expect(card.wordsLearned).toBeGreaterThan(0);
    expect(card.honey).toBeGreaterThan(0);
    expect(card.recentDays).toEqual([{ date: today(), lessons: 3, honey: expect.any(Number) }]);
    expect(JSON.stringify(card)).not.toMatch(/nickname|accountId/);

    const progress = await api.get<Schema<"ClassProgress">>(`/classes/${classId}/progress`, { token: teacher.accessToken });
    expect(progress.body.seats.find((s) => s.seatNumber === 1)?.wordsLearned).toBe(card.wordsLearned);
  });

  it("empty seat and no such seat — 404; a teacher of another class — 403; a student — 403", async () => {
    expect((await api.get(`/classes/${classId}/seats/3/progress`, { token: teacher.accessToken })).status).toBe(404);
    expect((await api.get(`/classes/${classId}/seats/42/progress`, { token: teacher.accessToken })).status).toBe(404);
    expect((await api.get(`/classes/${classId}/seats/1/progress`, { token: teacherB.accessToken })).status).toBe(403);
    expect((await api.get(`/classes/${classId}/seats/2/progress`, { token: student.accessToken })).status).toBe(403);
  });
});
