// Испытание для перехода на «сервере» мока (docs/02 §2, операция startJumpRun): закрытые места 2 и 3 предлагают
// испытание; задания — те же строки прототипа, что у урока (mock-learn.ts, без новых башкирских слов), без подсказок.
// Ошибки не повторяются (retry: false), больше JUMP_MISTAKES_ALLOWED ошибок — runEnded; итог — summary.jump. Сдано —
// уроки мест перед целью пройдены испытанием (passedByTest), первый урок места — текущий. Не сдано — ничего не меняется.
import type { Schema } from "@teletau/contracts";
import { demoLesson, type LearnWorld, type MockLesson } from "./mock-learn";

type Summary = Schema<"LessonRunSummary">;
type AttemptResult = Schema<"AttemptResult">;

export const JUMP_MISTAKES_ALLOWED = 2;
/** Места, которые предлагают испытание, и сколько в нём заданий (как сказал бы API). */
const OFFERS: [unitIndex: number, size: number][] = [
  [1, 8],
  [2, 10],
];

/** Итоги испытаний для повтора complete с тем же runId. */
const finished = new WeakMap<LearnWorld, Map<string, Summary>>();

/** Испытание к месту: задания урока прототипа (плитки, выбор, ввод) без подсказок и карточек. */
export function jumpLesson(unitId: string): MockLesson {
  const lesson = demoLesson();
  const exercises = lesson.run.exercises
    .filter((e) => e.type === "tiles_ru_ba" || e.type === "choice_ba_ru" || e.type === "free_ru_ba")
    .map((e) => (e.type === "tiles_ru_ba" ? { ...e, hints: undefined } : e));
  return { run: { lessonId: unitId, kind: "jump", titleRu: "Испытание", exercises }, keys: lesson.keys };
}

/** Мир, где места 2 и 3 опубликованы, но ученик до них не дошёл: у них — испытание для перехода. */
export function withJump(w: LearnWorld): LearnWorld {
  for (const [i, size] of OFFERS) {
    const unit = w.course.units[i]!;
    unit.state = "open";
    unit.jump = { exerciseCount: size, mistakesAllowed: JUMP_MISTAKES_ALLOWED };
    w.lessons[unit.id] = jumpLesson(unit.id);
  }
  return w;
}

const wrongFirsts = (w: LearnWorld, runId: string) => w.attempts.filter((a) => a.runId === runId && a.result.firstAttempt && a.result.verdict === "wrong").length;

/** Ответ в испытании: без повтора ошибок; ошибок больше, чем можно, — конец испытания. */
export function jumpAttempt(w: LearnWorld, runId: string, result: AttemptResult): AttemptResult {
  const wrong = wrongFirsts(w, runId) + (result.firstAttempt && result.verdict === "wrong" ? 1 : 0);
  return { ...result, retry: false, ...(wrong > JUMP_MISTAKES_ALLOWED ? { runEnded: true } : {}) };
}

/** Итог испытания (и тропа после него). */
export function completeJump(w: LearnWorld, run: { lessonId: string; runId: string }, total: number): Summary {
  const seen = finished.get(w) ?? finished.set(w, new Map()).get(w)!;
  const replay = seen.get(run.runId);
  if (replay) return replay;
  const firsts = w.attempts.filter((a) => a.runId === run.runId && a.result.firstAttempt);
  const mistakes = wrongFirsts(w, run.runId);
  const passed = mistakes <= JUMP_MISTAKES_ALLOWED && firsts.length >= total;
  const credited = firsts.length - mistakes;
  const honey = passed ? { total: 10 + credited, base: 10, firstTry: credited, multiplier: 1, pendingFromVotes: 0 } : { total: 0, base: 0, firstTry: 0, multiplier: 0, pendingFromVotes: 0 };
  const summary: Summary = {
    runId: run.runId,
    lessonId: run.lessonId,
    honey,
    accuracy: total ? credited / total : 1,
    durationSeconds: 95,
    newWords: [],
    votes: 0,
    streak: passed ? w.summary.streak : w.progress.streak,
    ...(w.progress.dailyGoal ? { dailyGoal: passed ? { ...w.progress.dailyGoal, done: w.progress.dailyGoal.done + 1 } : w.progress.dailyGoal } : {}),
    dailyGoalReached: false,
    jump: { unitId: run.lessonId, passed, mistakes, mistakesAllowed: JUMP_MISTAKES_ALLOWED },
  };
  seen.set(run.runId, summary);
  if (passed) openUpTo(w, run.lessonId, honey.total, summary);
  return summary;
}

/** Сдано: уроки мест перед целью — пройдены испытанием, «Помоги языку» открыты, первый урок места — текущий. */
function openUpTo(w: LearnWorld, unitId: string, honey: number, summary: Summary): void {
  const target = w.course.units.findIndex((u) => u.id === unitId);
  w.course.units.forEach((u, i) => {
    if (i > target) return;
    if (i === target) {
      delete u.jump;
      u.nodes.forEach((n, k) => {
        if (n.state === "current") n.state = "locked";
        if (k === 0) n.state = "current";
      });
      return;
    }
    delete u.jump;
    for (const n of u.nodes) {
      if (n.kind === "help_language") {
        if (n.state === "locked") n.state = "open";
      } else if (n.state !== "done") {
        n.state = "done";
        n.passedByTest = true;
      }
    }
  });
  w.progress = { ...w.progress, streak: summary.streak, honey: { ...w.progress.honey, total: w.progress.honey.total + honey }, ...(summary.dailyGoal ? { dailyGoal: summary.dailyGoal } : {}) };
}
