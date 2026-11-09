// Автомат «тропа → урок → итог → серия → лига → тропа» (app/_components/learn/machine.ts) — чистая функция.
import { describe, expect, it } from "vitest";
import type { Schema } from "@teletau/contracts";
import { flowReducer, initialFlow, isRetry, jumpNode, lessonProgress, MAX_RETRIES, REVIEW_NODE, type FlowEvent, type FlowState } from "../app/_components/learn/machine";

const node = { id: "u01-moya-shkola", kind: "lesson" as const };
const run: Schema<"LessonRun"> = {
  runId: "0193f7a4-0000-7000-8000-0000000000r1",
  lessonId: node.id,
  kind: "lesson",
  titleRu: "Моя школа",
  status: "active",
  startedAt: "2026-11-14T06:00:00Z",
  exercises: [
    { id: "e1", type: "free_ru_ba", review: "needs_native_review", promptRu: "Спасибо!", letters: [] },
    { id: "e2", type: "duel", review: "needs_native_review", itemId: "0193f7a4-0000-7000-8000-0000000d0001", sourceRu: "Добрый день", a: "A", b: "B" },
  ],
};

const verdict = (v: Schema<"Verdict">, retry = false): Schema<"AttemptResult"> => ({ attemptId: "a", exerciseId: "e", verdict: v, firstAttempt: true, retry });

const summary = (extended: boolean, promoted: boolean): Schema<"LessonRunSummary"> => ({
  runId: run.runId,
  lessonId: node.id,
  honey: { total: 12, base: 10, firstTry: 2, multiplier: 1, pendingFromVotes: 3 },
  accuracy: 1,
  durationSeconds: 90,
  newWords: [],
  votes: 1,
  streak: { current: 6, longest: 6, freezes: 2, extendedToday: extended, today: "2026-11-14", week: [] },
  ...(promoted ? { leagueResult: { weekStart: "2026-11-02", tierBefore: "sweetclover", tierAfter: "fireweed", outcome: "promoted", rank: 5, points: 318 } } : {}),
});

const play = (events: FlowEvent[], from: FlowState = initialFlow) => events.reduce(flowReducer, from);
const started = () => play([{ type: "start", node, runId: run.runId }, { type: "runReady", run, now: 0 }]);
const answer = (result: Schema<"AttemptResult">): FlowEvent[] => [{ type: "check", attemptId: "att" }, { type: "verdict", result }, { type: "next" }];

describe("автомат урока", () => {
  it("неверный ответ с retry возвращается в конец урока и помечается как повтор", () => {
    const s = play(answer(verdict("wrong", true)), started());
    expect(s.screen).toBe("lesson");
    if (s.screen !== "lesson") return;
    expect(s.lesson.queue).toEqual(["e2", "e1"]);
    expect(lessonProgress(s.lesson)).toBe(0);
    const atRetry = play(answer(verdict("recorded")), s);
    if (atRetry.screen !== "lesson") throw new Error(atRetry.screen);
    expect(isRetry(atRetry.lesson)).toBe(true);
    expect(lessonProgress(atRetry.lesson)).toBe(0.5);
  });

  it("«почти» не возвращается; ошибка возвращается не больше MAX_RETRIES раз", () => {
    expect(play([...answer(verdict("almost")), ...answer(verdict("recorded"))], started()).screen).toBe("completing");
    const single = { ...run, exercises: run.exercises.slice(0, 1) };
    let s = play([{ type: "start", node, runId: run.runId }, { type: "runReady", run: single, now: 0 }]);
    for (let i = 0; i < MAX_RETRIES; i++) {
      s = play(answer(verdict("wrong", true)), s);
      expect(s.screen).toBe("lesson");
    }
    expect(play(answer(verdict("wrong", true)), s).screen).toBe("completing");
  });

  it("сервер ответил retry: false (вторая ошибка) — упражнение не возвращается, урок идёт дальше", () => {
    const single = { ...run, exercises: run.exercises.slice(0, 1) };
    let s = play([{ type: "start", node, runId: run.runId }, { type: "runReady", run: single, now: 0 }]);
    s = play(answer(verdict("wrong", true)), s);
    if (s.screen !== "lesson") throw new Error(s.screen);
    expect(isRetry(s.lesson)).toBe(true);
    const last = play(answer(verdict("wrong", false)), s);
    expect(last.screen).toBe("completing");
    if (last.screen !== "completing") return;
    expect(last.lesson.finished).toEqual(["e1"]);
    expect(lessonProgress(last.lesson)).toBe(1);
  });

  it("после сбоя сети повторная проверка уходит с тем же attemptId", () => {
    const s = play([{ type: "check", attemptId: "first" }, { type: "attemptFailed" }, { type: "check", attemptId: "second" }], started());
    if (s.screen !== "lesson") throw new Error(s.screen);
    expect(s.lesson.attemptId).toBe("first");
    expect(s.lesson.checking).toBe(true);
  });

  it("забег без упражнений (дуэли закончились) — экран «Все пары уже оценены», затем тропа", () => {
    const s = play([{ type: "start", node: { id: "u01-help-1", kind: "help_language" }, runId: "r" }, { type: "runReady", run: { ...run, exercises: [] }, now: 0 }]);
    expect(s).toEqual({ screen: "empty", node: { id: "u01-help-1", kind: "help_language" } });
    expect(play([{ type: "continue" }], s)).toEqual({ screen: "trail" });
  });

  it("после урока: итог → серия (первый урок суток) → новая лига → тропа с запечатанным узлом", () => {
    const done = play([...answer(verdict("correct")), ...answer(verdict("recorded")), { type: "completed", summary: summary(true, true), showStreak: true }], started());
    expect(done.screen).toBe("result");
    const steps = [done, ...[1, 2, 3].map((n) => play(Array.from({ length: n }, () => ({ type: "continue" }) as FlowEvent), done))].map((s) => s.screen);
    expect(steps).toEqual(["result", "streak", "leagueUp", "trail"]);
    expect(play([{ type: "continue" }, { type: "continue" }, { type: "continue" }], done)).toEqual({ screen: "trail", sealed: node.id });
  });

  it("новая награда — свой шаг после серии и перед новой лигой; без серии — сразу после итога", () => {
    const award: Schema<"Achievement"> = { id: "streak-7", titleRu: "7 дней подряд", descriptionRu: "Занимайся 7 дней подряд", icon: "fire", earnedOn: "2026-11-14", progress: 7, target: 7 };
    const withAward = { ...summary(true, true), newAchievements: [award] };
    const done = play([...answer(verdict("correct")), ...answer(verdict("recorded")), { type: "completed", summary: withAward, showStreak: true }], started());
    const steps = [done, ...[1, 2, 3, 4].map((n) => play(Array.from({ length: n }, () => ({ type: "continue" }) as FlowEvent), done))].map((s) => s.screen);
    expect(steps).toEqual(["result", "streak", "achievement", "leagueUp", "trail"]);

    const quiet = { ...summary(true, false), newAchievements: [award] };
    const second = play([...answer(verdict("correct")), ...answer(verdict("recorded")), { type: "completed", summary: quiet, showStreak: false }], started());
    expect(play([{ type: "continue" }], second).screen).toBe("achievement");
    expect(play([{ type: "continue" }, { type: "continue" }], second)).toEqual({ screen: "trail", sealed: node.id });
  });

  it("второй урок за сутки без повышения — сразу с итога на тропу", () => {
    const done = play([...answer(verdict("correct")), ...answer(verdict("recorded")), { type: "completed", summary: summary(true, false), showStreak: false }], started());
    expect(play([{ type: "continue" }], done)).toEqual({ screen: "trail", sealed: node.id });
  });

  it("крестик и «Назад»: «Уже уходишь?» — остаться или выйти на тропу", () => {
    const quit = play([{ type: "quit" }], started());
    if (quit.screen !== "lesson") throw new Error(quit.screen);
    expect(quit.lesson.quit).toBe(true);
    expect(play([{ type: "stay" }], quit).screen).toBe("lesson");
    expect(play([{ type: "leave" }], quit)).toEqual({ screen: "trail" });
  });
});

describe("карточка «Новое слово»", () => {
  const card: Schema<"RunExercise"> = { id: "e0", type: "word_intro", review: "needs_native_review", word: { text: "ҡалым", review: "needs_native_review" }, translationRu: "Значение 1" };
  const withCard = () => play([{ type: "start", node, runId: run.runId }, { type: "runReady", run: { ...run, exercises: [card, ...run.exercises] }, now: 0 }]);

  it("«Дальше» без проверки: карточка пройдена, следующее — упражнение; прогресс считает её шагом", () => {
    const s = play([{ type: "next" }], withCard());
    if (s.screen !== "lesson") throw new Error(s.screen);
    expect(s.lesson.queue).toEqual(["e1", "e2"]);
    expect(s.lesson.finished).toEqual(["e0"]);
    expect(lessonProgress(s.lesson)).toBeCloseTo(1 / 3);
  });

  it("на карточке нечего проверять: check не меняет состояние; карточка не возвращается в конец", () => {
    const at = withCard();
    expect(play([{ type: "check", attemptId: "att" }], at)).toEqual(at);
    const s = play([{ type: "next" }, ...answer(verdict("correct")), ...answer(verdict("recorded"))], at);
    expect(s.screen).toBe("completing");
  });

  it("на упражнении «Дальше» без вердикта по-прежнему ничего не делает", () => {
    const s = play([{ type: "next" }], started());
    if (s.screen !== "lesson") throw new Error(s.screen);
    expect(s.lesson.queue).toEqual(["e1", "e2"]);
  });
});

describe("повторение слов", () => {
  const reviewRun: Schema<"LessonRun"> = { ...run, lessonId: "review", kind: "review", titleRu: "Повторение", exercises: run.exercises.slice(0, 1) };

  it("«Повторить» — тот же урок; после итога — тропа без «запечатывания» узла", () => {
    const s = play([{ type: "start", node: REVIEW_NODE, runId: reviewRun.runId }, { type: "runReady", run: reviewRun, now: 0 }, ...answer(verdict("correct"))]);
    expect(s.screen).toBe("completing");
    const done = play([{ type: "completed", summary: summary(false, false), showStreak: false }, { type: "continue" }], s);
    expect(done).toEqual({ screen: "trail" });
  });

  it("повторять нечего — экран «Пока нечего повторять», затем тропа", () => {
    const s = play([{ type: "start", node: REVIEW_NODE, runId: reviewRun.runId }, { type: "runReady", run: { ...reviewRun, exercises: [] }, now: 0 }]);
    expect(s).toEqual({ screen: "empty", node: REVIEW_NODE });
    expect(play([{ type: "continue" }], s)).toEqual({ screen: "trail" });
  });
});

describe("испытание для перехода (docs/02 §2)", () => {
  const jumpRun: Schema<"LessonRun"> = { ...run, lessonId: "02-shulgantash", kind: "jump", titleRu: "Испытание", exercises: [run.exercises[0]!, { ...run.exercises[0]!, id: "e3" }, { ...run.exercises[0]!, id: "e4" }] };
  const jumpStarted = () => play([{ type: "start", node: jumpNode("02-shulgantash"), runId: run.runId }, { type: "runReady", run: jumpRun, now: 0 }]);
  const jumpSummary = (passed: boolean): Schema<"LessonRunSummary"> => ({ ...summary(false, false), lessonId: "02-shulgantash", jump: { unitId: "02-shulgantash", passed, mistakes: passed ? 0 : 3, mistakesAllowed: 2 } });

  it("ошибка без runEnded — дальше по порядку, без повтора; runEnded — после «Дальше» сразу итог", () => {
    const s = play(answer(verdict("wrong")), jumpStarted());
    if (s.screen !== "lesson") throw new Error(s.screen);
    expect(s.lesson.queue).toEqual(["e3", "e4"]);
    const ended = play(answer({ ...verdict("wrong"), runEnded: true }), s);
    expect(ended.screen).toBe("completing");
  });

  it("после итога испытания тропа ничего не «запечатывает»", () => {
    for (const passed of [true, false]) {
      const done = play([...answer(verdict("correct")), ...answer(verdict("correct")), ...answer(verdict("correct"))], jumpStarted());
      expect(done.screen).toBe("completing");
      const after = play([{ type: "completed", summary: jumpSummary(passed), showStreak: false }, { type: "continue" }], done);
      expect(after).toEqual({ screen: "trail" });
    }
  });
});
