// Мёд («бал») за уроки и голоса (docs/02 §6). Числа — стартовые, калибруются на пилоте; любое изменение —
// новая версия наборов contracts/test-vectors/xp/ (правило 2: ожидания — из правил, а не из кода).

/** Вердикт первой попытки упражнения (`recorded` — голос в дуэли, не оценивается). */
export type Verdict = "correct" | "almost" | "typo" | "wrong" | "recorded";
/** Вид узла тропы. */
export type NodeKind = "lesson" | "help_language" | "place_test";
/** Голос в дуэли: вариант, «Оба подходят» или «Не знаю». */
export type DuelChoice = "a" | "b" | "both" | "skip";
export type DuelSide = "a" | "b";

export const LESSON_BASE_HONEY = 10;
/** Мёд за голос: созревающий до решения и начисленный после. */
export const VOTE_HONEY = { pending: 3, agree: 3, disagree: 1 } as const;

const FIRST_TRY_CREDIT: ReadonlySet<Verdict> = new Set<Verdict>(["correct", "almost", "typo"]);

export type RepeatMultiplier = 1 | 0.5 | 0;

/** Множитель повтора урока: 1 — первое завершение за сутки по Уфе, 0,5 — второе, 0 — с третьего. */
export function repeatMultiplier(completionToday: number): RepeatMultiplier {
  if (completionToday <= 1) return 1;
  return completionToday === 2 ? 0.5 : 0;
}

export interface LessonHoney {
  base: number;
  firstTry: number;
  multiplier: RepeatMultiplier;
  total: number;
}

/** Мёд за завершённый урок: ⌊(10 + верные с первой попытки) × множитель повтора⌋; «Помоги языку» — 0 (мёд за голоса отдельно). */
export function lessonHoney(input: { kind: NodeKind; firstAttempts: readonly Verdict[]; completionToday: number }): LessonHoney {
  const graded = input.kind !== "help_language";
  const base = graded ? LESSON_BASE_HONEY : 0;
  const firstTry = graded ? input.firstAttempts.filter((v) => FIRST_TRY_CREDIT.has(v)).length : 0;
  const multiplier = repeatMultiplier(input.completionToday);
  return { base, firstTry, multiplier, total: Math.floor((base + firstTry) * multiplier) };
}

export type VoteHoneyStatus = "pending" | "final" | "none";

/** Решение по дуэли: принятые варианты (duel-v0, поле `accepted`). */
export interface DuelDecision {
  accepted: readonly DuelSide[];
}

/** Согласен ли голос с решением: выбранный вариант принят; «оба» — только если приняты оба. */
export function agreesWith(choice: DuelChoice, decision: DuelDecision): boolean {
  if (choice === "skip") return false;
  if (choice === "both") return decision.accepted.includes("a") && decision.accepted.includes("b");
  return decision.accepted.includes(choice);
}

/** Мёд за голос: до решения — pending 3; после — final 3 при согласии, 1 при несогласии; «Не знаю» — 0. */
export function voteHoney(input: { choice: DuelChoice; decision: DuelDecision | null }): { status: VoteHoneyStatus; amount: number } {
  if (input.choice === "skip") return { status: "none", amount: 0 };
  if (!input.decision) return { status: "pending", amount: VOTE_HONEY.pending };
  return { status: "final", amount: agreesWith(input.choice, input.decision) ? VOTE_HONEY.agree : VOTE_HONEY.disagree };
}
