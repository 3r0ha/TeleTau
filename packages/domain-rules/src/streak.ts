// Серия по суткам Уфы с заморозками (docs/02 §6). Пересчитывается из моментов завершения уроков — отдельного
// изменяемого состояния нет. Правила и векторы — contracts/test-vectors/streak/.
import { dateToDay, dayToDate, mondayOf, ufaDayNumber } from "./calendar.js";

export const STREAK_START_FREEZES = 2;
export const STREAK_MAX_FREEZES = 2;
/** Сколько дней подряд дают +1 заморозку. */
export const STREAK_FREEZE_EVERY = 7;

export type StreakDayStatus = "done" | "frozen" | "missed" | "today" | "future";

export interface StreakResult {
  /** Сегодня по Уфе. */
  today: string;
  current: number;
  longest: number;
  freezes: number;
  /** Цель дня (1 урок) сегодня выполнена. */
  extendedToday: boolean;
  /** Дни, закрытые заморозкой, по возрастанию. */
  frozenDays: string[];
  /** Понедельник текущей недели. */
  weekStart: string;
  /** Статусы дней пн–вс. */
  week: StreakDayStatus[];
}

/** Серия по моментам завершения уроков (UTC): дни занятий — даты этих моментов по Уфе. */
export function computeStreak(input: { completions: readonly (string | Date)[]; now: string | Date }): StreakResult {
  return streakFromDays(input.completions.map((c) => ufaDayNumber(c)), ufaDayNumber(input.now));
}

/** Серия по датам занятий по Уфе (ГГГГ-ММ-ДД) — для таблицы activity_days. */
export function computeStreakFromDays(input: { days: readonly string[]; today: string }): StreakResult {
  return streakFromDays(input.days.map(dateToDay), dateToDay(input.today));
}

/**
 * Длина серии в каждый день занятий (по возрастанию): те же правила заморозок, что у computeStreak. Для наград
 * «N дней подряд»: день, когда серия впервые дошла до N.
 */
export function streakTimeline(days: readonly string[]): { day: string; current: number }[] {
  const nums = days.map(dateToDay);
  if (nums.length === 0) return [];
  const out: { day: string; current: number }[] = [];
  streakFromDays(nums, Math.max(...nums), (day, current) => out.push({ day: dayToDate(day), current }));
  return out;
}

function streakFromDays(days: readonly number[], today: number, onActive?: (day: number, current: number) => void): StreakResult {
  const active = new Set(days.filter((d) => d <= today));
  let freezes = STREAK_START_FREEZES;
  let current = 0;
  let longest = 0;
  let run = 0;
  const frozen = new Set<number>();

  const activeDay = (day: number) => {
    current += 1;
    run += 1;
    if (run === STREAK_FREEZE_EVERY) {
      freezes = Math.min(STREAK_MAX_FREEZES, freezes + 1);
      run = 0;
    }
    onActive?.(day, current);
  };

  if (active.size > 0) {
    for (let d = Math.min(...active); d < today; d++) {
      if (active.has(d)) activeDay(d);
      else if (current > 0) {
        run = 0;
        if (freezes > 0) {
          freezes -= 1;
          frozen.add(d);
        } else {
          current = 0;
        }
      }
      longest = Math.max(longest, current);
    }
  }
  const extendedToday = active.has(today);
  if (extendedToday) {
    activeDay(today);
    longest = Math.max(longest, current);
  }

  const monday = mondayOf(today);
  const week: StreakDayStatus[] = [];
  for (let d = monday; d < monday + 7; d++) {
    if (d > today) week.push("future");
    else if (active.has(d)) week.push("done");
    else if (d === today) week.push("today");
    else if (frozen.has(d)) week.push("frozen");
    else week.push("missed");
  }

  return {
    today: dayToDate(today),
    current,
    longest,
    freezes,
    extendedToday,
    frozenDays: [...frozen].sort((a, b) => a - b).map(dayToDate),
    weekStart: dayToDate(monday),
    week,
  };
}
