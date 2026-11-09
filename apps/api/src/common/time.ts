// Учебные сутки и учебный год — по Уфе (Asia/Yekaterinburg, UTC+5; CLAUDE.md, соглашения). Хранение — UTC.
export const SCHOOL_TIME_ZONE = "Asia/Yekaterinburg";

function ufaParts(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Сегодняшняя дата по Уфе в формате YYYY-MM-DD. */
export function ufaToday(now = new Date()): string {
  const { year, month, day } = ufaParts(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Год начала текущего учебного года: с 1 августа по Уфе — новый (классы на сентябрь создают летом). */
export function currentAcademicYear(now = new Date()): number {
  const { year, month } = ufaParts(now);
  return month >= 8 ? year : year - 1;
}
