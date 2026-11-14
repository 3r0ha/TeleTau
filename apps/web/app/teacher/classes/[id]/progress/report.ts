// «Скачать отчёт» на вкладке «Прогресс» (ADR 0021): CSV по номерам мест для учителя, которому нужно отчитаться.
// Только ник и номер места (ПДн детей нет, правило 5). Excel в русской локали открывает CSV с разделителем «;»
// и BOM UTF-8 без мастера импорта. Чистая функция — без запросов (данные — getClassProgress, getClass, listClassAssignments).
import type { Schema } from "@teletau/contracts";
import { csvCell } from "@teletau/ui/files";
import { statusLabels, assignmentTitle, dueShort } from "../../../../_components/assignments";
import type { T } from "../../../../../i18n/core";
import type { StudentRow } from "./model";

// Ячейка CSV и сохранение файла — общие с консолью (@teletau/ui, files.ts).
export { csvCell, saveTextFile } from "@teletau/ui/files";

type Assignment = Schema<"ClassAssignment">;

const pct = (x: number | undefined) => (x === undefined ? "" : String(Math.round(x * 100)));

export interface ClassReportInput {
  classTitle: string;
  week: Schema<"Week">;
  rows: readonly StudentRow[];
  /** Задания: сначала активные, затем завершённые — по столбцу на задание. */
  assignments: readonly Assignment[];
}

/** Таблица отчёта: строка на место с учеником, столбцы — прогресс и задания; итог заданий — «сделано из всех». */
export function classReportCsv({ rows, assignments }: ClassReportInput, t: T): string {
  const head = [
    t("Место"),
    t("Ник"),
    t("Уроков пройдено"),
    t("Точность, %"),
    t("Слов выучено"),
    t("Серия, дней"),
    t("Уроков за неделю"),
    t("Мёд за неделю"),
    t("Последнее занятие"),
    ...assignments.map((a) => t("Задание: {title} до {due}", { title: assignmentTitle(a, t), due: dueShort(a.dueOn) })),
    ...(assignments.length ? [t("Заданий сделано")] : []),
  ];
  const lines = [head.map(csvCell).join(";")];
  for (const r of rows) {
    const p = r.progress;
    const statuses = assignments.map((a) => a.seats.find((s) => s.seatNumber === r.seatNumber)?.status);
    const done = statuses.filter((s) => s === "done" || s === "done_late").length;
    const cells = [
      r.seatNumber,
      r.nickname ?? "",
      p?.lessonsCompleted ?? 0,
      pct(p?.accuracy),
      p?.wordsLearned ?? 0,
      p?.streak ?? 0,
      p?.lessonsThisWeek ?? 0,
      p?.honeyThisWeek ?? 0,
      p?.lastActiveOn ?? "",
      ...statuses.map((s) => (s ? statusLabels(t)[s] : "")),
      ...(assignments.length ? [t("{done} из {total}", { done, total: assignments.length })] : []),
    ];
    lines.push(cells.map(csvCell).join(";"));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** Имя файла: «teletau-otchet-5B-2026-11-09.csv» (неделя — понедельник). */
export function reportFileName(classTitle: string, week: Schema<"Week">): string {
  const slug = classTitle.replace(/[«»"'\s]/g, "") || "class";
  return `teletau-otchet-${slug}-${week.start}.csv`;
}

