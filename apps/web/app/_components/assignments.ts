// Задания учителя (ADR 0021): подписи для ученика (карточка на тропе) и учителя (раздел «Задания», отчёт). Типы — из
// контракта (CLAUDE.md, правило 1). Сроки — даты по Уфе (YYYY-MM-DD), «сегодня» — учебные сутки по часам сервера.
import type { Schema } from "@teletau/contracts";

export type AssignmentKind = Schema<"AssignmentKind">;
export type SeatStatus = Schema<"AssignmentSeatStatus">;

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
const noon = (date: string) => new Date(`${date}T12:00:00Z`);
const weekdayShort = new Intl.DateTimeFormat("ru-RU", { weekday: "short", timeZone: "UTC" });
const weekdayLong = new Intl.DateTimeFormat("ru-RU", { weekday: "long", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
const ddmm = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** «пт», «вс» — без точки. */
const shortDay = (date: string) => weekdayShort.format(noon(date)).replace(".", "");

/** Что задано: «Привет!», «Испытание места «Уфа»» или «Повторить слова». */
export function assignmentTitle(a: { kind: AssignmentKind; titleRu: string; placeRu?: string }): string {
  if (a.kind === "review") return a.titleRu;
  if (a.kind === "place_test") return a.placeRu ? `Испытание места «${a.placeRu}»` : a.titleRu;
  return `«${a.titleRu}»`;
}

/** Срок для ученика: «до пт», «до завтра», «сегодня последний день», «до 12 ноября». */
export function dueForStudent(dueOn: string, today: string): string {
  const days = dayNumber(dueOn) - dayNumber(today);
  if (days <= 0) return "сегодня последний день";
  if (days === 1) return "до завтра";
  if (days < 7) return `до ${shortDay(dueOn)}`;
  return `до ${dayMonth.format(noon(dueOn))}`;
}

/** Срок для учителя: «до пт, 7 ноября», «до сегодня, 5 ноября»; прошёл — «срок был 7 ноября». */
export function dueForTeacher(dueOn: string, today: string): string {
  const days = dayNumber(dueOn) - dayNumber(today);
  const date = dayMonth.format(noon(dueOn));
  if (days < 0) return `срок был ${date}`;
  if (days === 0) return `до сегодня, ${date}`;
  if (days === 1) return `до завтра, ${date}`;
  return `до ${shortDay(dueOn)}, ${date}`;
}

/** Срок полностью: «пятница, 7 ноября» — для выбора срока. */
export function dueLong(dueOn: string): string {
  return `${weekdayLong.format(noon(dueOn))}, ${dayMonth.format(noon(dueOn))}`;
}

/** «07.11» — в заголовке столбца отчёта. */
export const dueShort = (dueOn: string) => ddmm.format(noon(dueOn));

export const STATUS_LABEL: Record<SeatStatus, string> = {
  done: "сделано",
  done_late: "сделано после срока",
  todo: "ещё нет",
  overdue: "просрочено",
};

/** Дата через `n` дней от `date` (YYYY-MM-DD). */
export function addDays(date: string, n: number): string {
  return new Date((dayNumber(date) + n) * DAY_MS).toISOString().slice(0, 10);
}

/** Ближайшая пятница после `today` (1–7 дней): срок «до пятницы». */
export function nextFriday(today: string): string {
  const weekday = (noon(today).getUTCDay() + 6) % 7; // пн = 0
  return addDays(today, (4 - weekday + 7) % 7 || 7);
}

const ufaFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yekaterinburg", year: "numeric", month: "2-digit", day: "2-digit" });

/** Учебные сутки по Уфе для момента `nowMs` (часы сервера — @teletau/session/clock). */
export function ufaDay(nowMs: number): string {
  return ufaFormat.format(new Date(nowMs));
}
