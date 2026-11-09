// Правила заданий учителя (ADR 0021) — чистые функции без базы: статус места, срок, совпадение забега с заданием.
// Сутки — по Уфе (строки YYYY-MM-DD сравниваются лексикографически).
import type { Schema } from "@teletau/contracts";
import { dateToDay, dayToDate, ufaDate } from "@teletau/domain-rules";

export type AssignmentKind = Schema<"AssignmentKind">;
export type SeatStatus = Schema<"AssignmentSeatStatus">;

/** Одновременно у класса — не больше двух активных заданий. */
export const MAX_ACTIVE_ASSIGNMENTS = 2;
/** Срок — не дальше четырёх недель. */
export const MAX_DUE_DAYS = 28;
/** Сколько завершённых заданий показывать учителю. */
export const PAST_ASSIGNMENTS = 5;
export const REVIEW_TITLE_RU = "Повторить слова";

/** Активно: срок не прошёл (сегодня — последний день). */
export const isActive = (dueOn: string, today: string): boolean => dueOn >= today;

/** Статус места: выполнено в срок, после срока, ещё нет или просрочено. */
export function seatStatus(input: { dueOn: string; today: string; completedAt?: Date | undefined }): SeatStatus {
  if (input.completedAt) return ufaDate(input.completedAt) <= input.dueOn ? "done" : "done_late";
  return input.today > input.dueOn ? "overdue" : "todo";
}

/** Что не так со сроком (текст для 422) или undefined. */
export function dueOnProblem(dueOn: string, today: string): string | undefined {
  if (dueOn < today) return "Срок не может быть в прошлом";
  if (dueOn > dayToDate(dateToDay(today) + MAX_DUE_DAYS)) return `Срок — не дальше чем через ${MAX_DUE_DAYS} дней`;
  return undefined;
}

/** Забег засчитывает задание: повторение — задание review; урок или «Испытание» — тот же узел тропы. */
export function runMatches(a: { kind: AssignmentKind; lessonId: string | null }, run: { kind: string; lessonId: string }): boolean {
  if (a.kind === "review") return run.kind === "review";
  return run.kind !== "review" && a.lessonId === run.lessonId;
}

/** Сводка по местам. */
export function summarize(seats: readonly { status: SeatStatus }[]): Schema<"AssignmentSummary"> {
  const s = { total: seats.length, done: 0, late: 0, todo: 0, overdue: 0 };
  for (const x of seats) {
    if (x.status === "done") s.done++;
    else if (x.status === "done_late") s.late++;
    else if (x.status === "todo") s.todo++;
    else s.overdue++;
  }
  return s;
}
