// Один автомат состояний тропы, урока и потока после урока (docs/plans/M2.md §3 «Ч4»):
//
//   trail ─start→ starting ─runReady→ lesson ⟲ (check → verdict → next) ─последнее упражнение→ completing
//     ↑              └─runFailed→ trail                                                         │ completed
//     └─ leagueUp ←continue─ achievement ←continue─ streak ←continue─ result ←────────────────────┘
//
// После итога — только нужные шаги по порядку: серия (урок продлил её), новые награды (newAchievements), новая лига.
//
// Карточка «Новое слово» (word_intro) ответа не ждёт: «Дальше» (next) без вердикта, не повторяется.
// Вернётся ли ошибочное упражнение в конец урока («Повторим в конце урока»), решает сервер: retry: true — только после
// первой ошибки, после второй — retry: false, верный ответ и дальше (docs/02 §3; так же ведут себя iOS и Android). Своего
// счёта веб не ведёт, кроме страховки MAX_RETRIES на случай сбоя сервера. Дуэль не повторяется: в ней нет неверного ответа.
// Испытание для перехода (узел — место, kind «jump», docs/02 §2): ошибки не повторяются (retry: false), а когда сервер
// ответил runEnded — после «Дальше» сразу итог, оставшиеся задания не показываются.
// Побочные эффекты (запросы) выполняет LearnFlow по состоянию; сам автомат — чистая функция, её проверяют юнит-тесты
// (test/learn-machine.test.ts).
import type { AttemptResult, Exercise, LessonRun, LessonSummary, RunKind } from "./model";

/** Страховка от бесконечного урока, если сервер ошибочно просит повторять снова и снова; обычно сервер даёт один повтор. */
export const MAX_RETRIES = 3;

/** Что начинаем: узел тропы или повторение слов (id «review», kind «review»). */
export interface NodeRef {
  id: string;
  kind: RunKind;
}

/** Забег повторения слов — не узел тропы. */
export const REVIEW_NODE: NodeRef = { id: "review", kind: "review" };

/** Испытание для перехода к закрытому месту: id — место (CourseUnit.id). */
export const jumpNode = (unitId: string): NodeRef => ({ id: unitId, kind: "jump" });

/** Узел тропы, который «запечатывается» после забега: у повторения и испытания для перехода его нет. */
const sealedOf = (node: NodeRef): { sealed?: string } => (node.kind === "review" || node.kind === "jump" ? {} : { sealed: node.id });

export interface LessonState {
  run: LessonRun;
  node: NodeRef;
  /** Очередь показа: id упражнений; текущее — первое. */
  queue: string[];
  /** Упражнения, которые больше не покажем (решены или исчерпали повторы). */
  finished: string[];
  /** Сколько раз упражнение уже вернулось в конец. */
  retries: Record<string, number>;
  /** Сколько показов текущего упражнения было до этого (0 — первый показ). */
  shownBefore: Record<string, number>;
  feedback: AttemptResult | null;
  checking: boolean;
  quit: boolean;
  /** attemptId текущего ответа: повтор после сбоя сети уходит с тем же id (сервер не засчитает дважды). */
  attemptId: string | null;
  startedAt: number;
}

export type FlowState =
  | { screen: "trail"; sealed?: string }
  | { screen: "starting"; node: NodeRef; runId: string }
  /** Забег пришёл без упражнений: у «Помоги языку» закончились дуэли для этого аккаунта. */
  | { screen: "empty"; node: NodeRef }
  | { screen: "lesson"; lesson: LessonState }
  | { screen: "completing"; lesson: LessonState; failed?: boolean }
  | ({ screen: "result" } & AfterLesson)
  | ({ screen: "streak" } & AfterLesson)
  | ({ screen: "achievement" } & AfterLesson)
  | ({ screen: "leagueUp" } & AfterLesson);

export interface AfterLesson {
  node: NodeRef;
  run: LessonRun;
  summary: LessonSummary;
  /** Этот урок продлил серию (первый урок суток) — показать экран серии. */
  showStreak: boolean;
}

export type FlowEvent =
  | { type: "start"; node: NodeRef; runId: string }
  | { type: "runReady"; run: LessonRun; now: number }
  | { type: "runFailed" }
  | { type: "check"; attemptId: string }
  | { type: "verdict"; result: AttemptResult }
  | { type: "attemptFailed" }
  | { type: "next" }
  | { type: "quit" }
  | { type: "stay" }
  | { type: "leave" }
  | { type: "completed"; summary: LessonSummary; showStreak: boolean }
  | { type: "completeFailed" }
  | { type: "retryComplete" }
  | { type: "continue" };

export const initialFlow: FlowState = { screen: "trail" };

export function currentExercise(l: LessonState): Exercise | undefined {
  const id = l.queue[0];
  return id ? l.run.exercises.find((e) => e.id === id) : undefined;
}

/** Сейчас — карточка «Новое слово»: ответа нет, «Дальше» ведёт к следующему упражнению. */
export function isIntro(l: LessonState): boolean {
  return currentExercise(l)?.type === "word_intro";
}

/** Текущее упражнение показывается повторно (после ошибки). */
export function isRetry(l: LessonState): boolean {
  const id = l.queue[0];
  return id ? (l.shownBefore[id] ?? 0) > 0 : false;
}

/** Прогресс урока 0–1: решённые упражнения, включая текущее, если его вердикт засчитан. */
export function lessonProgress(l: LessonState): number {
  const total = l.run.exercises.length;
  if (!total) return 0;
  const counted = l.feedback && l.feedback.verdict !== "wrong" ? 1 : 0;
  return Math.min(1, (l.finished.length + counted) / total);
}

/** Неверный ответ вернётся в конец урока: так ответил сервер (retry), страховка MAX_RETRIES не исчерпана. */
export function willRetry(l: LessonState): boolean {
  const id = l.queue[0];
  return Boolean(id && l.feedback?.verdict === "wrong" && l.feedback.retry && (l.retries[id] ?? 0) < MAX_RETRIES);
}

type AfterScreen = "result" | "streak" | "achievement" | "leagueUp";
const AFTER_STEPS: readonly AfterScreen[] = ["result", "streak", "achievement", "leagueUp"];

/** Нужен ли шаг после итога этому уроку. */
function wants(step: AfterScreen, after: AfterLesson): boolean {
  if (step === "streak") return after.showStreak;
  if (step === "achievement") return (after.summary.newAchievements?.length ?? 0) > 0;
  if (step === "leagueUp") return after.summary.leagueResult?.outcome === "promoted";
  return false;
}

function afterStep(s: Extract<FlowState, { screen: AfterScreen }>): FlowState {
  const { screen, ...after } = s;
  const next = AFTER_STEPS.slice(AFTER_STEPS.indexOf(screen) + 1).find((step) => wants(step, after));
  return next ? { screen: next, ...after } : { screen: "trail", ...sealedOf(after.node) };
}

export function flowReducer(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case "start":
      return state.screen === "trail" ? { screen: "starting", node: event.node, runId: event.runId } : state;
    case "runReady": {
      if (state.screen !== "starting") return state;
      const ids = event.run.exercises.map((e) => e.id);
      if (!ids.length) return { screen: "empty", node: state.node };
      return {
        screen: "lesson",
        lesson: {
          run: event.run,
          node: state.node,
          queue: ids,
          finished: [],
          retries: {},
          shownBefore: {},
          feedback: null,
          checking: false,
          quit: false,
          attemptId: null,
          startedAt: event.now,
        },
      };
    }
    case "runFailed":
      return state.screen === "starting" ? { screen: "trail" } : state;
  }

  if (state.screen === "lesson") {
    const l = state.lesson;
    switch (event.type) {
      case "check":
        if (l.feedback || l.checking || isIntro(l)) return state;
        return { screen: "lesson", lesson: { ...l, checking: true, attemptId: l.attemptId ?? event.attemptId } };
      case "verdict":
        if (!l.checking) return state;
        return { screen: "lesson", lesson: { ...l, checking: false, feedback: event.result } };
      case "attemptFailed":
        return { screen: "lesson", lesson: { ...l, checking: false } };
      case "next": {
        if (!l.feedback && !isIntro(l)) return state;
        const [id, ...rest] = l.queue;
        if (!id) return state;
        const retry = willRetry(l);
        // Испытание закончено досрочно (runEnded) — к итогу, оставшиеся задания не нужны.
        const ended = Boolean(l.feedback?.runEnded);
        const lesson: LessonState = {
          ...l,
          queue: ended ? [] : retry ? [...rest, id] : rest,
          finished: retry ? l.finished : [...l.finished, id],
          retries: retry ? { ...l.retries, [id]: (l.retries[id] ?? 0) + 1 } : l.retries,
          shownBefore: { ...l.shownBefore, [id]: (l.shownBefore[id] ?? 0) + 1 },
          feedback: null,
          attemptId: null,
        };
        return lesson.queue.length ? { screen: "lesson", lesson } : { screen: "completing", lesson };
      }
      case "quit":
        return { screen: "lesson", lesson: { ...l, quit: true } };
      case "stay":
        return { screen: "lesson", lesson: { ...l, quit: false } };
      case "leave":
        return { screen: "trail" };
      default:
        return state;
    }
  }

  if (state.screen === "completing") {
    switch (event.type) {
      case "completed":
        return { screen: "result", node: state.lesson.node, run: state.lesson.run, summary: event.summary, showStreak: event.showStreak };
      case "completeFailed":
        return { ...state, failed: true };
      case "retryComplete":
        return { screen: "completing", lesson: state.lesson };
      case "leave":
        return { screen: "trail" };
      default:
        return state;
    }
  }

  if (event.type === "continue") {
    if (state.screen === "empty") return { screen: "trail" };
    if (state.screen === "result" || state.screen === "streak" || state.screen === "achievement" || state.screen === "leagueUp") return afterStep(state);
  }
  return state;
}
