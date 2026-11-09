// Правила напоминаний о серии (ADR 0020; docs/02 §8): не чаще раза в сутки по Уфе, только вне тихих часов детей
// 21:00–08:00, в выбранный час или позже в те же сутки. Чистые функции — без базы и часов процесса.
import { UFA_OFFSET_MINUTES } from "@teletau/domain-rules";

/** Начало тихих часов (по Уфе): с 21:00 напоминаний нет. */
export const QUIET_START_HOUR = 21;
/** Конец тихих часов (по Уфе): с 08:00 напоминать можно. */
export const QUIET_END_HOUR = 8;
/** Час по умолчанию, если пользователь включил напоминания, не выбрав час. */
export const DEFAULT_REMINDER_HOUR = 18;
/** Допустимые часы напоминания — как TelegramReminderHour в контракте (8–20). */
export const MIN_REMINDER_HOUR = QUIET_END_HOUR;
export const MAX_REMINDER_HOUR = QUIET_START_HOUR - 1;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Час суток по Уфе (UTC+5, без перехода на летнее время) — 0…23. */
export function ufaHour(now: Date): number {
  const ms = now.getTime() + UFA_OFFSET_MINUTES * 60_000;
  return Math.floor((((ms % DAY_MS) + DAY_MS) % DAY_MS) / HOUR_MS);
}

/** Можно ли сейчас напоминать вообще (вне тихих часов). */
export const outsideQuietHours = (hour: number): boolean => hour >= QUIET_END_HOUR && hour < QUIET_START_HOUR;

/** Пора ли напомнить чату с часом `reminderHour`, если сейчас по Уфе `hour` и сегодня ещё не напоминали. */
export const reminderDue = (reminderHour: number, hour: number): boolean => outsideQuietHours(hour) && hour >= reminderHour;
