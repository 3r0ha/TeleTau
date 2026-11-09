// Награды: сборка входа правил из истории ученика, тексты набора и «новые» награды итога забега (learning/achievements.ts).
// Сами правила — векторы contracts/test-vectors/achievements (packages/domain-rules).
import { ACHIEVEMENTS, computeAchievements } from "@teletau/domain-rules";
import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_TEXTS, achievementsInput, achievementView, coursePlaces, myAchievements, newlyEarned, type CompletedRun } from "../src/modules/learning/achievements.js";
import type { CourseContent } from "../src/modules/content/index.js";

const node = (id: string, unitId: string, kind: "lesson" | "help_language" | "place_test", position: number) => ({
  id,
  unitId,
  position,
  kind,
  titleRu: id,
  exerciseCount: 3,
  gradedCount: kind === "help_language" ? 0 : 3,
});

const course: CourseContent = {
  id: "ba-ru",
  contentVersion: 1,
  units: [
    {
      id: "u1",
      position: 1,
      status: "open",
      place: { slug: "ufa", titleRu: "Уфа", titleBa: { text: "Өфө", review: "needs_native_review" } },
      topicRu: "Знакомство",
      nodes: [node("l1", "u1", "lesson", 1), node("h1", "u1", "help_language", 2), node("t1", "u1", "place_test", 3)],
    },
  ],
};

const run = (over: Partial<CompletedRun>): CompletedRun => ({ kind: "lesson", lessonId: "l1", on: "2026-11-02", goalReached: false, firstAttempts: ["correct"], ...over });

describe("achievements · input from the learner's history", () => {
  it("places are trail lessons and place tests without «Помоги языку»", () => {
    expect(coursePlaces(course)).toEqual([{ id: "u1", lessons: ["l1", "t1"] }]);
  });

  it("only lessons and place tests are lessons; goal days come from any run; unknown words and skipped votes are left out", () => {
    const input = achievementsInput({
      today: "2026-11-05",
      places: coursePlaces(course),
      runs: [
        run({}),
        run({ kind: "help_language", lessonId: "h1", on: "2026-11-03", firstAttempts: ["recorded"] }),
        run({ kind: "review", lessonId: "review", on: "2026-11-04", goalReached: true }),
        run({ kind: "jump", lessonId: "u2", on: "2026-11-04", goalReached: true }),
        run({ kind: "place_test", lessonId: "t1", on: "2026-11-05" }),
      ],
      words: [
        { wordId: "сәләм", on: "2026-11-02" },
        { wordId: "removed", on: "2026-11-02" },
      ],
      known: new Set(["сәләм"]),
      facts: { activeDays: ["2026-11-02"], skips: [{ lessonId: "l9", on: "2026-11-04" }], votes: [{ judgmentId: "v1", on: "2026-11-03" }, { judgmentId: "v2", on: "2026-11-03" }] },
      skipVotes: new Set(["v2"]),
    });
    expect(input.lessons.map((l) => l.lessonId)).toEqual(["l1", "t1"]);
    expect(input.goalDays).toEqual(["2026-11-04", "2026-11-04"]);
    expect(input.words).toEqual(["2026-11-02"]);
    expect(input.votes).toEqual(["2026-11-03"]);
    expect(input.skips).toEqual([{ lessonId: "l9", on: "2026-11-04" }]);
  });
});

describe("achievements · texts and views", () => {
  it("every achievement of the set has a title, a description and an icon", () => {
    for (const a of ACHIEVEMENTS) {
      const t = ACHIEVEMENT_TEXTS[a.id];
      expect(t, a.id).toBeDefined();
      expect(t!.titleRu.length, a.id).toBeGreaterThan(0);
      expect(t!.descriptionRu.length, a.id).toBeGreaterThan(0);
    }
    expect(Object.keys(ACHIEVEMENT_TEXTS).sort()).toEqual(ACHIEVEMENTS.map((a) => a.id).sort());
  });

  it("earnedOn only when earned; progress and target as computed", () => {
    expect(achievementView({ id: "streak-7", earnedOn: null, progress: 3, target: 7 })).toEqual({
      id: "streak-7",
      titleRu: "7 дней подряд",
      descriptionRu: "Занимайся 7 дней подряд",
      icon: "fire",
      progress: 3,
      target: 7,
    });
    expect(achievementView({ id: "first-lesson", earnedOn: "2026-11-02", progress: 1, target: 1 })).toMatchObject({ earnedOn: "2026-11-02", progress: 1 });
  });

  it("new achievements are those earned after the run and not before, in set order", () => {
    const empty = { today: "2026-11-02", lessons: [], skips: [], places: coursePlaces(course), activeDays: [], goalDays: [], words: [], votes: [] };
    const before = computeAchievements(empty);
    const after = computeAchievements({
      ...empty,
      lessons: [{ lessonId: "l1", on: "2026-11-02", firstAttempts: ["correct"] }],
      votes: ["2026-11-02"],
      activeDays: ["2026-11-02"],
    });
    expect(newlyEarned(before, after).map((a) => a.id)).toEqual(["first-lesson", "perfect-lesson", "first-vote"]);
    expect(newlyEarned(after, after)).toEqual([]);
    expect(myAchievements(after)).toMatchObject({ earned: 3, total: ACHIEVEMENTS.length });
  });
});
