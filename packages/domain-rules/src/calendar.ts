// Учебные сутки и недели по Уфе (Asia/Yekaterinburg). С 2014 года там постоянно UTC+5 без перехода на летнее время,
// поэтому смещение фиксировано: результат не зависит от базы часовых поясов платформы (TS, Swift, Kotlin — одни векторы).

export const UFA_OFFSET_MINUTES = 5 * 60;
const DAY_MS = 86_400_000;
const OFFSET_MS = UFA_OFFSET_MINUTES * 60_000;

/** Номер суток по Уфе (дни от 1970-01-01 по Уфе). */
export function ufaDayNumber(instant: Date | string): number {
  const ms = (typeof instant === "string" ? new Date(instant) : instant).getTime();
  if (Number.isNaN(ms)) throw new RangeError(`calendar: неверный момент времени ${String(instant)}`);
  return Math.floor((ms + OFFSET_MS) / DAY_MS);
}

/** Дата ГГГГ-ММ-ДД по номеру суток. */
export function dayToDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Номер суток по дате ГГГГ-ММ-ДД. */
export function dateToDay(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`calendar: неверная дата ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
}

/** Дата момента по Уфе, ГГГГ-ММ-ДД. */
export const ufaDate = (instant: Date | string): string => dayToDate(ufaDayNumber(instant));

/** Понедельник недели, в которую попадают сутки `day` (номер суток). */
export function mondayOf(day: number): number {
  const weekday = (new Date(day * DAY_MS).getUTCDay() + 6) % 7; // пн = 0
  return day - weekday;
}

/** Начало суток `day` по Уфе как момент UTC. */
export function ufaMidnight(day: number): Date {
  return new Date(day * DAY_MS - OFFSET_MS);
}

/** Неделя пн–вс по Уфе, в которую попадает момент: даты и конец недели (понедельник 00:00 по Уфе). */
export function ufaWeek(instant: Date | string): { start: string; end: string; endsAt: Date } {
  const monday = mondayOf(ufaDayNumber(instant));
  return { start: dayToDate(monday), end: dayToDate(monday + 6), endsAt: ufaMidnight(monday + 7) };
}
