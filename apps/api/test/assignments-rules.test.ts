// Юнит-тесты заданий учителя (ADR 0021): статус места по сроку (сутки по Уфе), проверка срока, совпадение забега
// с заданием, сводка; открытый заданный узел на тропе (trail.ts).
import { describe, expect, it } from "vitest";
import { dueOnProblem, isActive, MAX_DUE_DAYS, runMatches, seatStatus, summarize } from "../src/modules/assignments/rules.js";
import type { CourseContent } from "../src/modules/content/index.js";
import { buildTrail } from "../src/modules/learning/trail.js";

describe("assignments — правила (rules.ts)", () => {
  it("статус места: в срок, после срока (по суткам Уфы), ещё нет, просрочено", () => {
    // 2026-11-13 18:59Z — 23:59 пятницы по Уфе; 19:00Z — уже суббота.
    expect(seatStatus({ dueOn: "2026-11-13", today: "2026-11-14", completedAt: new Date("2026-11-13T18:59:00Z") })).toBe("done");
    expect(seatStatus({ dueOn: "2026-11-13", today: "2026-11-14", completedAt: new Date("2026-11-13T19:00:00Z") })).toBe("done_late");
    expect(seatStatus({ dueOn: "2026-11-13", today: "2026-11-13" })).toBe("todo");
    expect(seatStatus({ dueOn: "2026-11-13", today: "2026-11-14" })).toBe("overdue");
  });

  it("активно до конца дня срока включительно", () => {
    expect(isActive("2026-11-13", "2026-11-13")).toBe(true);
    expect(isActive("2026-11-13", "2026-11-14")).toBe(false);
  });

  it("срок: от сегодня до 28 дней вперёд", () => {
    expect(dueOnProblem("2026-11-12", "2026-11-13")).toMatch(/прошлом/);
    expect(dueOnProblem("2026-11-13", "2026-11-13")).toBeUndefined();
    expect(dueOnProblem("2026-12-11", "2026-11-13")).toBeUndefined();
    expect(MAX_DUE_DAYS).toBe(28);
    expect(dueOnProblem("2026-12-12", "2026-11-13")).toMatch(/28/);
  });

  it("забег засчитывает: тот же узел (урок или испытание) или повторение — задание review", () => {
    expect(runMatches({ kind: "lesson", lessonId: "a1" }, { kind: "lesson", lessonId: "a1" })).toBe(true);
    expect(runMatches({ kind: "lesson", lessonId: "a1" }, { kind: "lesson", lessonId: "a2" })).toBe(false);
    expect(runMatches({ kind: "place_test", lessonId: "t1" }, { kind: "place_test", lessonId: "t1" })).toBe(true);
    expect(runMatches({ kind: "review", lessonId: null }, { kind: "review", lessonId: "review" })).toBe(true);
    expect(runMatches({ kind: "review", lessonId: null }, { kind: "lesson", lessonId: "a1" })).toBe(false);
    expect(runMatches({ kind: "lesson", lessonId: "review" }, { kind: "review", lessonId: "review" })).toBe(false);
  });

  it("сводка по местам", () => {
    expect(summarize([{ status: "done" }, { status: "done_late" }, { status: "todo" }, { status: "overdue" }, { status: "done" }])).toEqual({ total: 5, done: 2, late: 1, todo: 1, overdue: 1 });
  });
});

const node = (id: string, kind: "lesson" | "help_language" | "place_test") => ({ id, unitId: "", position: 0, kind, titleRu: id, exerciseCount: 3, gradedCount: 3 });
const COURSE: CourseContent = {
  id: "c",
  contentVersion: 1,
  units: [
    { id: "u1", position: 1, status: "open", place: { slug: "a", titleRu: "А" }, topicRu: "Т", nodes: [node("a1", "lesson"), node("h1", "help_language"), node("a2", "lesson"), node("t1", "place_test")] },
    { id: "u2", position: 2, status: "locked", place: { slug: "b", titleRu: "Б" }, topicRu: "Т", nodes: [node("b1", "lesson")] },
  ],
};

describe("тропа — заданный учителем узел открыт (trail.ts)", () => {
  const states = (assigned: string[]) => buildTrail(COURSE, new Map(), new Set(assigned)).units.flatMap((u) => u.nodes.map((n) => `${n.id}:${n.state}`));

  it("закрытый урок и испытание открытого юнита — open; current не сдвигается; закрытый юнит — по-прежнему locked", () => {
    expect(states([])).toEqual(["a1:current", "h1:locked", "a2:locked", "t1:locked", "b1:locked"]);
    expect(states(["a2", "t1", "b1"])).toEqual(["a1:current", "h1:locked", "a2:open", "t1:open", "b1:locked"]);
  });
});
