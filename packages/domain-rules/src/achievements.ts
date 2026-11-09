// Награды (docs/02 §6). Пересчитываются из истории ученика: уроки, дни серии, цели дня, слова словаря, голоса,
// прохождение мест — отдельного изменяемого состояния нет. Правила и векторы — contracts/test-vectors/achievements/.
import { computeStreakFromDays, streakTimeline } from "./streak.js";
import type { Verdict } from "./xp.js";

/**
 * Что считает награда: lessons — пройденные уроки и «Испытания места»; perfect_lessons — из них без ошибок;
 * streak — дни подряд (серия); goal_days — дни с выполненной целью дня; words — слова словаря; votes — голоса
 * «Помоги языку»; places — пройденные места тропы.
 */
export type AchievementRule = "lessons" | "perfect_lessons" | "streak" | "goal_days" | "words" | "votes" | "places";

export interface AchievementDef {
  id: string;
  rule: AchievementRule;
  /** Сколько нужно; null — все места курса. */
  target: number | null;
}

/** Набор наград в порядке показа. Новая награда — новая версия векторов. */
export const ACHIEVEMENTS: readonly AchievementDef[] = Object.freeze([
  { id: "first-lesson", rule: "lessons", target: 1 },
  { id: "perfect-lesson", rule: "perfect_lessons", target: 1 },
  { id: "streak-3", rule: "streak", target: 3 },
  { id: "streak-7", rule: "streak", target: 7 },
  { id: "streak-30", rule: "streak", target: 30 },
  { id: "goal-7", rule: "goal_days", target: 7 },
  { id: "words-10", rule: "words", target: 10 },
  { id: "words-50", rule: "words", target: 50 },
  { id: "first-vote", rule: "votes", target: 1 },
  { id: "votes-10", rule: "votes", target: 10 },
  { id: "first-place", rule: "places", target: 1 },
  { id: "all-places", rule: "places", target: null },
]);

export interface AchievementsInput {
  /** Сегодня по Уфе (ГГГГ-ММ-ДД): от него — текущая серия у ещё не полученных наград серии. */
  today: string;
  /** Завершённые уроки и «Испытания места» (каждое прохождение): сутки по Уфе и вердикты первых попыток. */
  lessons: readonly { lessonId: string; on: string; firstAttempts: readonly Verdict[] }[];
  /** Уроки, засчитанные сданным испытанием для перехода. */
  skips: readonly { lessonId: string; on: string }[];
  /** Места курса: уроки и «Испытания места» каждого («Помоги языку» не нужен). */
  places: readonly { id: string; lessons: readonly string[] }[];
  /** Дни занятий (серия). */
  activeDays: readonly string[];
  /** Дни, когда цель дня выполнена (повторы дня не важны). */
  goalDays: readonly string[];
  /** День, когда слово попало в словарь, — по одному на слово. */
  words: readonly string[];
  /** День каждого голоса («Не знаю» не голос). */
  votes: readonly string[];
}

export interface AchievementState {
  id: string;
  /** День получения по Уфе; null — ещё не получена. */
  earnedOn: string | null;
  /** Сколько сделано, не больше target; у серии — текущая серия. */
  progress: number;
  target: number;
}

/** Урок без ошибок: есть задание с проверкой, и ни одна первая попытка не «неверно» («почти» и опечатка — не ошибка). */
export const isPerfectLesson = (firstAttempts: readonly Verdict[]): boolean =>
  firstAttempts.some((v) => v !== "recorded") && !firstAttempts.includes("wrong");

const sorted = (days: readonly string[]): string[] => [...days].sort();

/** День, когда набралось `target` событий (дни событий в любом порядке). */
const nthDay = (days: readonly string[], target: number): string | null => sorted(days)[target - 1] ?? null;

/** День прохождения каждого места: когда пройден последний его урок (уроком или испытанием для перехода). */
function placePasses(input: AchievementsInput): { total: number; passedOn: string[] } {
  const first = new Map<string, string>();
  for (const p of [...input.lessons, ...input.skips]) {
    const was = first.get(p.lessonId);
    if (was === undefined || p.on < was) first.set(p.lessonId, p.on);
  }
  const places = input.places.filter((p) => p.lessons.length > 0);
  const passedOn: string[] = [];
  for (const place of places) {
    const days = place.lessons.map((id) => first.get(id));
    if (days.every((d): d is string => d !== undefined)) passedOn.push(sorted(days).at(-1)!);
  }
  return { total: places.length, passedOn };
}

/** Все награды набора по истории ученика — в порядке ACHIEVEMENTS. */
export function computeAchievements(input: AchievementsInput): AchievementState[] {
  const timeline = streakTimeline(input.activeDays);
  const streakNow = computeStreakFromDays({ days: input.activeDays, today: input.today }).current;
  const places = placePasses(input);
  const perfect = input.lessons.filter((l) => isPerfectLesson(l.firstAttempts)).map((l) => l.on);
  const counted: Record<Exclude<AchievementRule, "streak">, readonly string[]> = {
    lessons: input.lessons.map((l) => l.on),
    perfect_lessons: perfect,
    goal_days: [...new Set(input.goalDays)],
    words: input.words,
    votes: input.votes,
    places: places.passedOn,
  };

  return ACHIEVEMENTS.map((a) => {
    const target = a.target ?? Math.max(1, places.total);
    if (a.rule === "streak") {
      const earnedOn = timeline.find((t) => t.current >= target)?.day ?? null;
      return { id: a.id, earnedOn, progress: earnedOn ? target : Math.min(target, streakNow), target };
    }
    const days = counted[a.rule];
    const earnedOn = nthDay(days, target);
    return { id: a.id, earnedOn, progress: Math.min(target, days.length), target };
  });
}
