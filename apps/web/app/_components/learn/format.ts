import type { LeagueTier } from "./model";

/** Русское множественное число: plural(5, ["день", "дня", "дней"]) → «дней». */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** «2:41» — время урока. */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Лиги медоносов: именительный («Новая лига — Кипрей!») и родительный («Лига Донника») падежи. */
export const TIER_NAMES: Record<LeagueTier, { nom: string; gen: string }> = {
  clover: { nom: "Клевер", gen: "Клевера" },
  buckwheat: { nom: "Гречиха", gen: "Гречихи" },
  sweetclover: { nom: "Донник", gen: "Донника" },
  fireweed: { nom: "Кипрей", gen: "Кипрея" },
  linden: { nom: "Липа", gen: "Липы" },
};

/**
 * Квест недели улья класса: что сделать всем классом. Сервер считает «соты» — уроки учеников класса за неделю
 * (competition/quest.ts), поэтому ученику — просто «уроки», без правил подсчёта.
 */
export function questTask(goal: number): string {
  return `Пройдите всем классом ${goal} ${plural(goal, ["урок", "урока", "уроков"])}`;
}

const DAY_MS = 86_400_000;

/** «через 3 дня» / «сегодня» до конца недели лиги. */
export function weekEndsIn(weekEndsAt: string, now: number = Date.now()): string {
  const days = Math.ceil((Date.parse(weekEndsAt) - now) / DAY_MS);
  if (!Number.isFinite(days) || days <= 1) return "сегодня";
  return `через ${days} ${plural(days, ["день", "дня", "дней"])}`;
}

const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

/** «Пн» для даты учебных суток YYYY-MM-DD (сутки уже посчитаны сервером по Уфе — здесь только день недели). */
export function weekdayShort(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return WEEKDAYS[d.getUTCDay()] ?? "";
}
