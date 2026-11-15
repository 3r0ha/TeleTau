// Учебные сутки и учебный год — по Уфе (Asia/Yekaterinburg, UTC+5; CLAUDE.md, соглашения). Хранение — UTC.
// Одна реализация суток — @teletau/domain-rules (calendar.ts, фиксированное смещение): здесь только обёртки.
import { ufaDate } from "@teletau/domain-rules";

/** Сегодняшняя дата по Уфе в формате YYYY-MM-DD. */
export function ufaToday(now = new Date()): string {
  return ufaDate(now);
}

/** Год начала текущего учебного года: с 1 августа по Уфе — новый (классы на сентябрь создают летом). */
export function currentAcademicYear(now = new Date()): number {
  const [year, month] = ufaDate(now).split("-").map(Number) as [number, number];
  return month >= 8 ? year : year - 1;
}
