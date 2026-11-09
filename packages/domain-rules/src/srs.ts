// Повторение слов по FSRS-6 (docs/02 §1, §5). Версия алгоритма и параметры зафиксированы на всех платформах
// (CLAUDE.md, правило 14): сервер — источник истины, порты Swift и Kotlin (офлайн) проходят те же векторы
// contracts/test-vectors/srs/. Формулы — страница «The Algorithm» вики open-spaced-repetition и эталон py-fsrs;
// правила расписания (сутки Уфы, без шагов в минутах и без fuzz) — srs/README.md. Чистые функции без ввода-вывода.
import { dateToDay, dayToDate } from "./calendar.js";
import type { Verdict } from "./xp.js";

export const FSRS_VERSION = "fsrs-6";

/** Параметры FSRS-6 по умолчанию (w₀…w₂₀). Изменение — новая версия векторов srs/fsrs6.json. */
export const FSRS6_PARAMETERS: readonly number[] = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425,
  0.0912, 0.0658, 0.1542,
]);

/** Желаемая извлекаемость: при 0,9 интервал равен устойчивости. */
export const SRS_DESIRED_RETENTION = 0.9;
export const SRS_MAX_INTERVAL_DAYS = 36_500;
export const SRS_STABILITY_MIN = 0.001;
export const SRS_STABILITY_MAX = 36_500;

/** Оценка повторения: 1 Again, 2 Hard, 3 Good, 4 Easy. */
export type SrsRating = 1 | 2 | 3 | 4;

/** Память о слове: устойчивость S (дни до R = 0,9) и трудность D ∈ [1; 10]. */
export interface SrsMemory {
  stability: number;
  difficulty: number;
}

/** Карточка слова: память, счётчики и даты по Уфе (ГГГГ-ММ-ДД). */
export interface SrsCard extends SrsMemory {
  reps: number;
  lapses: number;
  lastReviewOn: string;
  dueOn: string;
}

const w = FSRS6_PARAMETERS;
const DECAY = -w[20]!;
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const clampS = (s: number) => clamp(s, SRS_STABILITY_MIN, SRS_STABILITY_MAX);
const clampD = (d: number) => clamp(d, 1, 10);

/** Извлекаемость через t дней при устойчивости S: (1 + factor · t / S)^decay. */
export function fsrsRetrievability(elapsedDays: number, stability: number): number {
  return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stability, DECAY);
}

/** Начальная трудность без ограничения (для возврата к среднему нужна и отрицательная D₀(4)). */
const initDifficultyRaw = (g: SrsRating) => w[4]! - Math.exp(w[5]! * (g - 1)) + 1;

/** Новая память после повторения с оценкой g через t дней (memory — null при знакомстве). */
export function fsrsNext(memory: SrsMemory | null, rating: SrsRating, elapsedDays: number): SrsMemory {
  if (!memory) return { stability: clampS(w[rating - 1]!), difficulty: clampD(initDifficultyRaw(rating)) };
  const { stability: s, difficulty: d } = memory;
  let next: number;
  if (elapsedDays <= 0) {
    // Тот же день: SInc ≥ 1 при G ≥ 2 (wiki «The Algorithm», py-fsrs).
    const sinc = Math.exp(w[17]! * (rating - 3 + w[18]!)) * Math.pow(s, -w[19]!);
    next = s * (rating >= 2 ? Math.max(sinc, 1) : sinc);
  } else {
    const r = fsrsRetrievability(elapsedDays, s);
    if (rating === 1) {
      const longTerm = w[11]! * Math.pow(d, -w[12]!) * (Math.pow(s + 1, w[13]!) - 1) * Math.exp(w[14]! * (1 - r));
      next = Math.min(longTerm, s / Math.exp(w[17]! * w[18]!));
    } else {
      const hard = rating === 2 ? w[15]! : 1;
      const easy = rating === 4 ? w[16]! : 1;
      next = s * (Math.exp(w[8]!) * (11 - d) * Math.pow(s, -w[9]!) * (Math.exp(w[10]! * (1 - r)) - 1) * hard * easy + 1);
    }
  }
  const delta = -w[6]! * (rating - 3);
  const damped = d + (delta * (10 - d)) / 9;
  const reverted = w[7]! * initDifficultyRaw(4) + (1 - w[7]!) * damped;
  return { stability: clampS(next), difficulty: clampD(reverted) };
}

/** Интервал до следующего повторения в днях: S / factor · (r^(1/decay) − 1), округление, [1; 36500]. */
export function fsrsInterval(stability: number): number {
  const raw = (stability / FACTOR) * (Math.pow(SRS_DESIRED_RETENTION, 1 / DECAY) - 1);
  return clamp(Math.round(raw), 1, SRS_MAX_INTERVAL_DAYS);
}

export interface SrsReview {
  card: SrsCard;
  /** Дней с прошлого повторения (нет — знакомство). */
  elapsedDays?: number;
  /** Извлекаемость перед повторением (нет — знакомство). */
  retrievability?: number;
  intervalDays: number;
}

/** Повторение карточки в сутки `on` (по Уфе); card — null при знакомстве со словом. */
export function reviewCard(card: SrsCard | null, rating: SrsRating, on: string): SrsReview {
  const day = dateToDay(on);
  if (!card) {
    const memory = fsrsNext(null, rating, 0);
    const intervalDays = fsrsInterval(memory.stability);
    return { card: { ...memory, reps: 1, lapses: 0, lastReviewOn: on, dueOn: dayToDate(day + intervalDays) }, intervalDays };
  }
  const elapsedDays = Math.max(0, day - dateToDay(card.lastReviewOn));
  const retrievability = fsrsRetrievability(elapsedDays, card.stability);
  const memory = fsrsNext(card, rating, elapsedDays);
  const intervalDays = fsrsInterval(memory.stability);
  return {
    card: { ...memory, reps: card.reps + 1, lapses: card.lapses + (rating === 1 ? 1 : 0), lastReviewOn: on, dueOn: dayToDate(day + intervalDays) },
    elapsedDays,
    retrievability,
    intervalDays,
  };
}

export interface SrsStep extends SrsMemory {
  elapsedDays?: number;
  retrievability?: number;
  intervalDays: number;
  dueOn: string;
  reps: number;
  lapses: number;
}

/** Повторения слова по порядку → состояние после каждого (векторы srs/fsrs6.json). */
export function fsrsReplay(input: { reviews: readonly { on: string; rating: SrsRating }[] }): { steps: SrsStep[] } {
  let card: SrsCard | null = null;
  const steps: SrsStep[] = [];
  for (const { on, rating } of input.reviews) {
    const r = reviewCard(card, rating, on);
    card = r.card;
    steps.push({
      ...(r.elapsedDays !== undefined ? { elapsedDays: r.elapsedDays, retrievability: r.retrievability! } : {}),
      stability: card.stability,
      difficulty: card.difficulty,
      intervalDays: r.intervalDays,
      dueOn: card.dueOn,
      reps: card.reps,
      lapses: card.lapses,
    });
  }
  return { steps };
}

export type GradedVerdict = Exclude<Verdict, "recorded">;

const RATING_OF: Record<GradedVerdict, SrsRating> = { correct: 3, typo: 3, almost: 2, wrong: 1 };

/** С подсказкой к условию засчитанный ответ — не выше Hard (векторы srs/rating.json v2). */
const HINTED_MAX: SrsRating = 2;

/**
 * Оценка по вердиктам первых попыток упражнений со словом: худшая; без упражнений — Good. `hinted[i]` — к упражнению
 * `verdicts[i]` открывали подсказку: оценка не выше Hard (векторы srs/rating.json).
 */
export function ratingFromVerdicts(input: { verdicts: readonly GradedVerdict[]; hinted?: readonly boolean[] }): SrsRating {
  return input.verdicts.reduce<SrsRating>((worst, v, i) => {
    const rating = input.hinted?.[i] ? (Math.min(RATING_OF[v], HINTED_MAX) as SrsRating) : RATING_OF[v];
    return Math.min(worst, rating) as SrsRating;
  }, 3);
}

export type SrsStatus = "learned" | "review";

/** «Пора повторить», если сегодня не раньше срока (векторы srs/status.json). */
export function srsStatus(input: { dueOn: string; today: string }): SrsStatus {
  return dateToDay(input.today) >= dateToDay(input.dueOn) ? "review" : "learned";
}

/** Цель дня — соты (пройденные уроки и повторения) за сутки по Уфе. Серия считается по урокам: 1 урок в день. */
export const DAILY_GOAL_LESSONS = 2;

export interface DailyGoal {
  target: number;
  done: number;
  met: boolean;
}

export function dailyGoal(lessonsToday: number, target: number = DAILY_GOAL_LESSONS): DailyGoal {
  const done = Math.max(0, Math.floor(lessonsToday));
  return { target, done, met: done >= target };
}
