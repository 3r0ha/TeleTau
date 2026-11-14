// Отчёт по классу (CSV, ADR 0021) и подписи сроков заданий — чистые функции без браузера.
import { describe, expect, it } from "vitest";
import { addDays, assignmentTitle, dueForStudent, dueForTeacher, nextFriday } from "../app/_components/assignments";
import { classReportCsv, csvCell, reportFileName } from "../app/teacher/classes/[id]/progress/report";
import { tFor } from "../i18n/registry";

const t = tFor("ru");

describe("отчёт по классу (CSV)", () => {
  it("ячейки: «;», кавычки и переводы строк — в кавычках; формулы Excel не исполняются", () => {
    expect(csvCell("Смелая пчела")).toBe("Смелая пчела");
    expect(csvCell("а;б")).toBe('"а;б"');
    expect(csvCell('5 "Б"')).toBe('"5 ""Б"""');
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell(undefined)).toBe("");
  });

  it("строка на место: прогресс, статусы заданий и итог «сделано из всех»; BOM и CRLF", () => {
    const csv = classReportCsv({
      classTitle: "5 «Б»",
      week: { start: "2026-11-02", end: "2026-11-08" },
      rows: [
        { seatNumber: 7, nickname: "Смелая пчела", toneKey: 7, progress: { seatNumber: 7, lessonsCompleted: 3, wordsLearned: 21, lessonsThisWeek: 2, honeyThisWeek: 24, streak: 6, lastActiveOn: "2026-11-05", accuracy: 0.857 } },
        { seatNumber: 8, nickname: null, toneKey: 8, progress: null },
      ],
      assignments: [
        { id: "a", kind: "lesson", lessonId: "x", titleRu: "Моя школа", placeRu: "Уфа", dueOn: "2026-11-06", createdAt: "", active: true, summary: { total: 2, done: 1, late: 0, todo: 1, overdue: 0 }, seats: [{ seatNumber: 7, status: "done" }, { seatNumber: 8, status: "todo" }] },
        { id: "b", kind: "review", titleRu: "Повторить слова", dueOn: "2026-11-03", createdAt: "", active: false, summary: { total: 2, done: 0, late: 1, todo: 0, overdue: 1 }, seats: [{ seatNumber: 7, status: "done_late" }, { seatNumber: 8, status: "overdue" }] },
      ],
    }, t);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(
      "Место;Ник;Уроков пройдено;Точность, %;Слов выучено;Серия, дней;Уроков за неделю;Мёд за неделю;Последнее занятие;Задание: «Моя школа» до 06.11;Задание: Повторить слова до 03.11;Заданий сделано",
    );
    expect(lines[1]).toBe("7;Смелая пчела;3;86;21;6;2;24;2026-11-05;сделано;сделано после срока;2 из 2");
    expect(lines[2]).toBe("8;;0;;0;0;0;0;;ещё нет;просрочено;0 из 2");
    expect(reportFileName("5 «Б»", { start: "2026-11-02", end: "2026-11-08" })).toBe("teletau-otchet-5Б-2026-11-02.csv");
  });
});

describe("сроки заданий", () => {
  it("ученику: «сегодня последний день», «до завтра», «до пт», дальше недели — дата", () => {
    expect(dueForStudent("2026-11-05", "2026-11-05")).toBe("сегодня последний день");
    expect(dueForStudent("2026-11-06", "2026-11-05")).toBe("до завтра");
    expect(dueForStudent("2026-11-07", "2026-11-04")).toBe("до сб");
    expect(dueForStudent("2026-11-20", "2026-11-05")).toBe("до 20 ноября");
  });

  it("учителю: день недели и дата; прошёл — «срок был»", () => {
    expect(dueForTeacher("2026-11-06", "2026-11-03")).toBe("до пт, 6 ноября");
    expect(dueForTeacher("2026-11-02", "2026-11-05")).toBe("срок был 2 ноября");
  });

  it("ближайшая пятница — от 1 до 7 дней; что задано", () => {
    expect(nextFriday("2026-11-05")).toBe("2026-11-06"); // чт → пт
    expect(nextFriday("2026-11-06")).toBe("2026-11-13"); // пт → следующая пт
    expect(addDays("2026-11-30", 2)).toBe("2026-12-02");
    expect(assignmentTitle({ kind: "place_test", titleRu: "Испытание места", placeRu: "Уфа" })).toBe("Испытание места «Уфа»");
    expect(assignmentTitle({ kind: "lesson", titleRu: "Привет!" })).toBe("«Привет!»");
  });
});
