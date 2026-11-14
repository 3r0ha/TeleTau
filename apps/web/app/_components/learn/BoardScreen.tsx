"use client";

import { useState } from "react";
import { EmptyState } from "@teletau/ui";
import { useResource } from "@teletau/session/react";
import { useT } from "../../../i18n/client";
import type { T } from "../../../i18n/core";
import { ClassTitle, LoadError, LoadingBlock } from "../screens";
import { learnApi } from "./api";
import type { PublicLeaderboard, PublicLeaderboardClass, PublicLeaderboardSchool } from "./model";
import { StudentShell, useStudent } from "./StudentShell";

/** Периоды доски почёта (ТЗ §4.5): учебные сутки, неделя (по умолчанию), месяц, год — по Уфе. */
type BoardPeriod = PublicLeaderboard["period"];

/** Подписи периодов — ключи перевода (t), рендерятся только через t(). */
const PERIODS: { value: BoardPeriod; label: string }[] = [
  { value: "day", label: "День" },
  { value: "week", label: "Неделя" },
  { value: "month", label: "Месяц" },
  { value: "year", label: "Год" },
];

/** Месяцы в родительном — ключи перевода: ru «9 ноября», ba «9 ноябрь», kk «9 қараша». */
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** «9 ноября» — начало периода доски почёта, дата YYYY-MM-DD по Уфе; год — у периода «год» (format.boardSince остаётся русским). */
function periodStart(date: string, t: T, withYear = false): string {
  const d = new Date(`${date}T12:00:00Z`);
  const text = `${d.getUTCDate()} ${t(MONTHS[d.getUTCMonth()] ?? "")}`;
  return withYear ? `${text} ${d.getUTCFullYear()}` : text;
}

/**
 * Раздел «Доска» (ТЗ §4.5): публичный топ-10 школ и классов за период — место, уроки, активные ученики, слова.
 * Только агрегаты школ и классов, без имён и ников (правило 13); малые группы сервер в доску не пускает.
 */
export function BoardScreen() {
  const t = useT();
  const account = useStudent();
  // Период — состояние экрана (на лендинге он в адресе, в приложении переключение — сегментами без переходов).
  const [period, setPeriod] = useState<BoardPeriod>("week");
  const board = useResource(() => learnApi.leaderboard(period), [period, account?.id], { enabled: Boolean(account) });
  return (
    <StudentShell tab="board" className="board">
      {board.data ? (
        <BoardView board={board.data} period={period} onPeriod={setPeriod} />
      ) : board.error ? (
        <LoadError error={board.error} onRetry={board.reload} audience="child" />
      ) : (
        <LoadingBlock rows={5} label={t("Открываем доску")} />
      )}
    </StudentShell>
  );
}

function BoardView({ board, period, onPeriod }: { board: PublicLeaderboard; period: BoardPeriod; onPeriod: (p: BoardPeriod) => void }) {
  const t = useT();
  const empty = board.schools.length === 0 && board.classes.length === 0;
  return (
    <>
      <header className="board__head">
        <h1 className="page-title">{t("Доска почёта")}</h1>
        <p className="page-lead">{t("с {date}", { date: periodStart(board.periodStart, t, board.period === "year") })}</p>
      </header>
      <div className="board__periods" role="group" aria-label={t("Период доски почёта")}>
        {PERIODS.map((p) => (
          <button key={p.value} type="button" className="board__period" aria-pressed={p.value === period} onClick={() => onPeriod(p.value)}>
            {t(p.label)}
          </button>
        ))}
      </div>
      {empty ? (
        <EmptyState art="beeIdle" title={t("Данных ещё нет")} headingAs="h2" compact>
          {t("Как только школы и классы начнут заниматься, они появятся здесь.")}
        </EmptyState>
      ) : (
        <div className="board__groups">
          {board.schools.length > 0 ? <BoardTable id="board-schools" title={t("Школы")} nameHeader={t("Школа")} rows={board.schools.map(schoolRow)} /> : null}
          {board.classes.length > 0 ? <BoardTable id="board-classes" title={t("Классы")} nameHeader={t("Класс")} rows={board.classes.map(classRow)} /> : null}
        </div>
      )}
    </>
  );
}

/** Строка доски: место, группа (школа или класс) и три счётчика — без имён и ников (правило 13). */
type BoardRow = { rank: number; name: string; sub: string; lessons: number; activeStudents: number; wordsLearned: number };

/** Школа на доске: короткое название, район — подписью. */
const schoolRow = (s: PublicLeaderboardSchool): BoardRow => ({
  rank: s.rank,
  name: s.school,
  sub: s.district,
  lessons: s.lessons,
  activeStudents: s.activeStudents,
  wordsLearned: s.wordsLearned,
});

/** Класс на доске: литера («5 «Б»»), школа и район — подписью. */
const classRow = (c: PublicLeaderboardClass): BoardRow => ({
  rank: c.rank,
  name: c.classLabel,
  sub: `${c.school} · ${c.district}`,
  lessons: c.lessons,
  activeStudents: c.activeStudents,
  wordsLearned: c.wordsLearned,
});

/** Группа доски («Школы» или «Классы») — компактная таблица, как лига: место, группа, уроки, ученики, слова. */
function BoardTable({ id, title, nameHeader, rows }: { id: string; title: string; nameHeader: string; rows: BoardRow[] }) {
  const t = useT();
  return (
    <section className="board__group" aria-labelledby={id}>
      <h2 className="board__group-title" id={id}>
        {title}
      </h2>
      <div className="board__sheet">
        <table className="board__table">
          <thead>
            <tr>
              <th className="board__th" scope="col">
                №
              </th>
              <th className="board__th board__th--name" scope="col">
                {nameHeader}
              </th>
              <th className="board__th board__th--num" scope="col">
                {t("Уроки")}
              </th>
              <th className="board__th board__th--num" scope="col">
                {t("Ученики")}
              </th>
              <th className="board__th board__th--num" scope="col">
                {t("Слова")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rank} className="board__row">
                <td className="board__td board__td--rank">{r.rank}</td>
                <td className="board__td board__td--name">
                  <b className="board__who">
                    <ClassTitle title={r.name} />
                  </b>
                  <span className="board__sub">{r.sub}</span>
                </td>
                <td className="board__td board__td--num">{fmt(r.lessons)}</td>
                <td className="board__td board__td--num">{fmt(r.activeStudents)}</td>
                <td className="board__td board__td--num">{fmt(r.wordsLearned)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Число с разрядами по-русски: 1234 → «1 234». */
const fmt = (n: number) => n.toLocaleString("ru-RU");
