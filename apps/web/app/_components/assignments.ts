// Задания учителя (ADR 0021): подписи для ученика (карточка на тропе) и учителя (раздел «Задания», отчёт). Типы — из
// контракта (CLAUDE.md, правило 1). Сроки — даты по Уфе (YYYY-MM-DD), «сегодня» — учебные сутки по часам сервера.
// Подписи зависят от языка интерфейса: функции берут переводчик t (T из i18n/core); без него — русский (фолбэк).
import type { Schema } from "@teletau/contracts";
import { makeT, type T } from "../../i18n/core";

export type AssignmentKind = Schema<"AssignmentKind">;
export type SeatStatus = Schema<"AssignmentSeatStatus">;

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
const noon = (date: string) => new Date(`${date}T12:00:00Z`);
const weekdayShort = new Intl.DateTimeFormat("ru-RU", { weekday: "short", timeZone: "UTC" });
const weekdayLong = new Intl.DateTimeFormat("ru-RU", { weekday: "long", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
const ddmm = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** Русская строка без перевода — значение t по умолчанию (фолбэк core.ts, подстановки работают). */
const ru = makeT("ru", null);

/** «пт», «вс» — без точки. */
const shortDay = (date: string) => weekdayShort.format(noon(date)).replace(".", "");

/** Что задано: «Привет!», «Испытание места «Уфа»» или «Повторить слова». */
export function assignmentTitle(a: { kind: AssignmentKind; titleRu: string; placeRu?: string }, t: T = ru): string {
  if (a.kind === "review") return a.titleRu;
  if (a.kind === "place_test") return a.placeRu ? t("Испытание места «{place}»", { place: a.placeRu }) : a.titleRu;
  return `«${a.titleRu}»`;
}

/** Срок для ученика: «до пт», «до завтра», «сегодня последний день», «до 12 ноября». */
export function dueForStudent(dueOn: string, today: string, t: T = ru): string {
  const days = dayNumber(dueOn) - dayNumber(today);
  if (days <= 0) return t("сегодня последний день");
  if (days === 1) return t("до завтра");
  if (days < 7) return t("до {day}", { day: shortDay(dueOn) });
  return t("до {date}", { date: dayMonth.format(noon(dueOn)) });
}

/** Срок для учителя: «до пт, 7 ноября», «до сегодня, 5 ноября»; прошёл — «срок был 7 ноября». */
export function dueForTeacher(dueOn: string, today: string, t: T = ru): string {
  const days = dayNumber(dueOn) - dayNumber(today);
  const date = dayMonth.format(noon(dueOn));
  if (days < 0) return t("срок был {date}", { date });
  if (days === 0) return t("до сегодня, {date}", { date });
  if (days === 1) return t("до завтра, {date}", { date });
  return t("до {day}, {date}", { day: shortDay(dueOn), date });
}

/** Срок полностью: «пятница, 7 ноября» — для выбора срока. */
export function dueLong(dueOn: string): string {
  return `${weekdayLong.format(noon(dueOn))}, ${dayMonth.format(noon(dueOn))}`;
}

/** «07.11» — в заголовке столбца отчёта. */
export const dueShort = (dueOn: string) => ddmm.format(noon(dueOn));

/** Статус места в задании — фабрика от переводчика (строки зависят от языка интерфейса). */
export function statusLabels(t: T): Record<SeatStatus, string> {
  return {
    done: t("сделано"),
    done_late: t("сделано после срока"),
    todo: t("ещё нет"),
    overdue: t("просрочено"),
  };
}

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
