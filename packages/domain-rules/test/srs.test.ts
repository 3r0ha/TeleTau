import { describe, expect, it } from "vitest";
import { dailyGoal, DAILY_GOAL_LESSONS, fsrsInterval, fsrsRetrievability, reviewCard } from "../src/index.js";

describe("srs — свойства FSRS-6 вне векторов", () => {
  it("R(S, S) = 0,9 и интервал при r = 0,9 равен устойчивости", () => {
    for (const s of [0.5, 2.3065, 17, 400]) {
      expect(fsrsRetrievability(s, s)).toBeCloseTo(0.9, 12);
      expect(fsrsInterval(s)).toBe(Math.max(1, Math.round(s)));
    }
  });

  it("повторение раньше прошлого повторения (часы сдвинуты назад) считается как тот же день", () => {
    const first = reviewCard(null, 3, "2026-11-04").card;
    const back = reviewCard(first, 3, "2026-11-01");
    expect(back.elapsedDays).toBe(0);
    expect(back.card.stability).toBeGreaterThanOrEqual(first.stability);
  });
});

describe("цель дня", () => {
  it("по умолчанию 2 соты; выполнена с двух", () => {
    expect(DAILY_GOAL_LESSONS).toBe(2);
    expect(dailyGoal(0)).toEqual({ target: 2, done: 0, met: false });
    expect(dailyGoal(1)).toEqual({ target: 2, done: 1, met: false });
    expect(dailyGoal(2)).toEqual({ target: 2, done: 2, met: true });
    expect(dailyGoal(5)).toEqual({ target: 2, done: 5, met: true });
  });
});
