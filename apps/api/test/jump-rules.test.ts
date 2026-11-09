// Юнит-тесты испытания для перехода (docs/02 §2, learning/jump.ts и trail.ts): сколько и каких заданий, когда сдано,
// какие места предлагают испытание и что на тропе после сдачи. Строки — синтетические.
import { describe, expect, it } from "vitest";
import type { CourseContent, ExerciseContent } from "../src/modules/content/index.js";
import { jumpAllocation, jumpExercises, jumpOutcome, JUMP_EXERCISES, JUMP_MISTAKES_ALLOWED } from "../src/modules/learning/jump.js";
import { buildTrail, jumpScope, lessonsPassed } from "../src/modules/learning/trail.js";

describe("jumpAllocation — сколько заданий из «Испытания» каждого места", () => {
  it("одно место — все его задания до предела", () => {
    expect(jumpAllocation([8])).toEqual([8]);
    expect(jumpAllocation([14])).toEqual([JUMP_EXERCISES]);
  });

  it("по кругу от ближайшего к цели места", () => {
    expect(jumpAllocation([8, 8])).toEqual([5, 5]);
    expect(jumpAllocation([8, 8, 8])).toEqual([3, 3, 4]);
    expect(jumpAllocation([8, 8, 8, 8, 8])).toEqual([2, 2, 2, 2, 2]);
  });

  it("мало заданий у места — добирается из остальных; без «Испытаний» — пусто", () => {
    expect(jumpAllocation([8, 1])).toEqual([8, 1]);
    expect(jumpAllocation([2, 0, 3])).toEqual([2, 0, 3]);
    expect(jumpAllocation([])).toEqual([]);
    expect(jumpAllocation([0, 0])).toEqual([0, 0]);
  });
});

const exercise = (id: string, type: ExerciseContent["type"] = "choice_ba_ru", position = 1): ExerciseContent => ({
  id,
  position,
  type,
  payload: {},
  answerKey: { kind: "none" },
  review: "needs_native_review",
  sources: [],
});

describe("jumpExercises — задания испытания", () => {
  const first = Array.from({ length: 8 }, (_, i) => exercise(`a${i}`, "choice_ba_ru", i));
  const second = [...Array.from({ length: 7 }, (_, i) => exercise(`b${i}`, "free_ru_ba", i)), exercise("b-duel", "duel", 9)];

  it("дуэли не берутся; места — по порядку тропы, задания места — в порядке контента", () => {
    const picked = jumpExercises([first, second], () => 0);
    expect(picked).toHaveLength(JUMP_EXERCISES);
    expect(picked.some((e) => e.type === "duel")).toBe(false);
    const ids = picked.map((e) => e.id);
    expect(ids.filter((id) => id.startsWith("a"))).toHaveLength(5);
    expect(ids.findIndex((id) => id.startsWith("b"))).toBe(5);
    const order = (prefix: string) => ids.filter((id) => id.startsWith(prefix)).map((id) => Number(id.slice(1)));
    expect(order("a")).toEqual([...order("a")].sort((x, y) => x - y));
    expect(order("b")).toEqual([...order("b")].sort((x, y) => x - y));
  });

  it("набор случаен: другой генератор — другие задания", () => {
    const a = jumpExercises([first], () => 0, 4).map((e) => e.id);
    let k = 0;
    const b = jumpExercises([first], (n) => (k++ * 3) % n, 4).map((e) => e.id);
    expect(a).toHaveLength(4);
    expect(b).toHaveLength(4);
    expect(a).not.toEqual(b);
  });
});

describe("jumpOutcome — сдано или нет", () => {
  it(`до ${JUMP_MISTAKES_ALLOWED} ошибок на всех заданиях — сдано; «почти» и опечатка — не ошибки`, () => {
    expect(jumpOutcome(["correct", "wrong", "almost", "typo", "wrong"], 5)).toEqual({ mistakes: 2, over: false, passed: true });
  });

  it("не на все задания ответ — ещё не сдано", () => {
    expect(jumpOutcome(["correct", "wrong"], 5)).toEqual({ mistakes: 1, over: false, passed: false });
  });

  it("ошибок больше, чем можно, — конец испытания, не сдано", () => {
    expect(jumpOutcome(["wrong", "wrong", "wrong"], 10)).toEqual({ mistakes: 3, over: true, passed: false });
  });
});

const node = (id: string, kind: "lesson" | "help_language" | "place_test", gradedCount = 3) => ({ id, unitId: "", position: 0, kind, titleRu: id, exerciseCount: gradedCount, gradedCount });
const COURSE: CourseContent = {
  id: "c",
  contentVersion: 1,
  units: [
    { id: "u1", position: 1, status: "open", place: { slug: "a", titleRu: "А" }, topicRu: "Т", nodes: [node("a1", "lesson"), node("ha", "help_language"), node("a2", "lesson"), node("ta", "place_test", 8)] },
    { id: "u2", position: 2, status: "open", place: { slug: "b", titleRu: "Б" }, topicRu: "Т", nodes: [node("b1", "lesson"), node("tb", "place_test", 8)] },
    { id: "u3", position: 3, status: "open", place: { slug: "c", titleRu: "В" }, topicRu: "Т", nodes: [node("c1", "lesson"), node("tc", "place_test", 8)] },
    { id: "u4", position: 4, status: "locked", place: { slug: "d", titleRu: "Г" }, topicRu: "Т", nodes: [node("d1", "lesson")] },
    { id: "u5", position: 5, status: "open", place: { slug: "e", titleRu: "Д" }, topicRu: "Т", nodes: [node("e1", "lesson")] },
  ],
};
const trail = (completions: Record<string, number>, skipped: string[] = []) => buildTrail(COURSE, new Map(Object.entries(completions)), new Set(), new Set(skipped));
const jumps = (t: ReturnType<typeof trail>) => Object.fromEntries(t.units.map((u) => [u.id, u.jump?.exerciseCount ?? null]));

describe("тропа — какие места можно открыть испытанием (trail.ts)", () => {
  it("новичок: все открытые места после первого, до закрытого юнита; размер — по «Испытаниям» мест перед ним", () => {
    expect(jumps(trail({}))).toEqual({ u1: null, u2: 8, u3: 10, u4: null, u5: null });
    expect(trail({}).units[1]!.jump).toEqual({ exerciseCount: 8, mistakesAllowed: JUMP_MISTAKES_ALLOWED });
  });

  it("место, до которого дошёл, — без испытания; пройденные места в испытание не идут", () => {
    expect(jumps(trail({ a1: 1, a2: 1, ta: 1 }))).toEqual({ u1: null, u2: null, u3: 8, u4: null, u5: null });
    expect(jumpScope(trail({ a1: 1, a2: 1, ta: 1 }), "u3")).toEqual({ tests: ["tb"], skips: ["b1", "tb"] });
  });

  it("испытание к месту 3 засчитывает непройденные уроки мест 1–2 (пройденные — как есть)", () => {
    expect(jumpScope(trail({ a1: 2 }), "u3")).toEqual({ tests: ["ta", "tb"], skips: ["a2", "ta", "b1", "tb"] });
  });

  it("после сдачи: уроки — done с passedByTest, «Помоги языку» открыт, первый урок места — current", () => {
    const t = trail({ a1: 2 }, ["a2", "ta", "b1", "tb"]);
    const view = t.units.flatMap((u) => u.nodes.map((n) => `${n.id}:${n.state}${n.passedByTest ? "*" : ""}`));
    expect(view).toEqual(["a1:done", "ha:open", "a2:done*", "ta:done*", "b1:done*", "tb:done*", "c1:current", "tc:locked", "d1:locked", "e1:locked"]);
    expect(t.units[2]!.nodes[0]).toMatchObject({ completions: 0 });
    expect(jumps(t)).toEqual({ u1: null, u2: null, u3: null, u4: null, u5: null });
  });

  it("урок, пройденный потом по-настоящему, теряет отметку; повторный переход ничего не ломает", () => {
    const t = trail({ a1: 1, b1: 1 }, ["a2", "ta", "b1", "tb"]);
    expect(t.units[1]!.nodes[0]).toMatchObject({ state: "done", completions: 1 });
    expect(t.units[1]!.nodes[0]).not.toHaveProperty("passedByTest");
    expect(jumpScope(t, "u3")).toEqual({ tests: [], skips: [] });
  });

  it("засчитанные испытанием уроки считаются пройденными для дуэлей в уроке", () => {
    expect(lessonsPassed(trail({}))).toBe(0);
    expect(lessonsPassed(trail({ a1: 1 }, ["a2", "ta"]))).toBe(3);
  });

  it("отметка испытанием у закрытого юнита ничего не открывает", () => {
    const t = trail({}, ["d1"]);
    expect(t.units[3]!.nodes[0]).toMatchObject({ state: "locked" });
    expect(t.units[3]!.nodes[0]).not.toHaveProperty("passedByTest");
  });
});
