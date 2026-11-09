import { describe, expect, it } from "vitest";
import { computeStreak, computeStreakFromDays, streakTimeline } from "../src/index.js";

describe("streak from activity days", () => {
  it("matches computeStreak on the same days", () => {
    const byInstants = computeStreak({ completions: ["2026-11-01T07:00:00Z", "2026-11-02T07:00:00Z"], now: "2026-11-04T07:00:00Z" });
    expect(computeStreakFromDays({ days: ["2026-11-01", "2026-11-02"], today: "2026-11-04" })).toEqual(byInstants);
  });
});

describe("streak timeline", () => {
  it("gives the streak length on every active day, with freezes and a reset", () => {
    // 1, 2 · заморозка 3-го · 3, 4 · последняя заморозка 6-го, обнуление 7-го · 1
    const days = ["2026-11-01", "2026-11-02", "2026-11-04", "2026-11-05", "2026-11-09", "2026-11-02"];
    expect(streakTimeline(days)).toEqual([
      { day: "2026-11-01", current: 1 },
      { day: "2026-11-02", current: 2 },
      { day: "2026-11-04", current: 3 },
      { day: "2026-11-05", current: 4 },
      { day: "2026-11-09", current: 1 },
    ]);
  });

  it("ends with the same streak as computeStreakFromDays on the last active day", () => {
    const days = ["2026-10-01", "2026-10-02", "2026-10-06", "2026-10-07", "2026-10-08"];
    expect(streakTimeline(days).at(-1)?.current).toBe(computeStreakFromDays({ days, today: "2026-10-08" }).current);
  });

  it("is empty without activity", () => {
    expect(streakTimeline([])).toEqual([]);
  });
});
