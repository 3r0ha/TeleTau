"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, DownloadSimple, Drop, Fire, Printer, Scales } from "@phosphor-icons/react/ssr";
import { Button, ButtonLink, Card, CardSub, CardTitle, EmptyState, HexAvatar, HoneyComb, InlineAlert, Skeleton, SkeletonGroup, StatTile, StatTiles, avatarFor, toneFor, useToast } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { serverNow } from "@teletau/session/clock";
import { ApiProblem, describeProblem, isNetworkError } from "@teletau/session/problem";
import { useResource } from "@teletau/session/react";
import { LoadError, isForbidden, isNotFound, useDocumentTitle } from "../../../../_components/screens";
import { TeacherShell } from "../../../TeacherShell";
import { useTeacherGate } from "../../../useTeacher";
import { BackToClasses, ClassHeader, ClassTabs, ClassUnavailable } from "../ClassFrame";
import { isUuid, seatLabel, seatNo } from "../format";
import {
  activityOf,
  daysWord,
  lastActiveLabel,
  lessonsWord,
  percent,
  studentRows,
  studentSummary,
  ufaToday,
  weekLabel,
  weekSummary,
  type Activity,
  type ClassProgress,
  type StudentRow,
} from "./model";
import { PlacesCard } from "./PlacesCard";
import { usePrintInLight } from "./print";
import { classReportCsv, reportFileName, saveTextFile } from "./report";

/** Прогресс меняется, пока дети занимаются на уроке: свежие цифры без перезагрузки. */
const POLL_MS = 10_000;
const COMB_PER_ROW = 12;

type Sort = "seat" | "attention";
/** «Сначала кому нужна помощь»: ещё не начинали, неделя без уроков, занимались на неделе, сегодня. */
const ATTENTION: Record<Activity, number> = { never: 0, idle: 1, week: 2, today: 3 };

/**
 * Раздел «Прогресс» класса: неделя и прохождение уроков по местам тропы, ниже — таблица учеников по номерам мест (на телефоне —
 * строки).
 * Прогресс приходит по номерам мест без ников (getClassProgress), ники — со страницы класса (GET /classes/{id}).
 * «Скачать отчёт» и «Распечатать» — в заголовке: это действия с прогрессом класса.
 */
export default function ClassProgressPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useTeacherGate("verified");
  const toast = useToast();
  const validId = isUuid(id);
  const enabled = Boolean(me) && validId;
  const klass = useResource(() => unwrap(api.GET("/api/v1/classes/{id}", { params: { path: { id } } })), [id], { enabled });
  const progress = useResource(() => unwrap(api.GET("/api/v1/classes/{id}/progress", { params: { path: { id } } })), [id], { enabled, pollMs: POLL_MS });
  useDocumentTitle(klass.data ? `Прогресс · ${klass.data.title}` : undefined);
  usePrintInLight();
  const [saving, setSaving] = useState(false);

  const c = klass.data;
  const p = progress.data;
  const rows = useMemo(() => (c && p ? studentRows(c.seats ?? [], p.seats) : null), [c, p]);

  const classError = klass.error && !klass.data ? klass.error : null;
  const missing = !validId || (classError && (isNotFound(classError) || (classError instanceof ApiProblem && classError.status === 422)));
  if (missing || classError) {
    return (
      <TeacherShell>
        {missing || isForbidden(classError) ? <ClassUnavailable forbidden={!missing} /> : <LoadError error={classError} onRetry={klass.reload} home="/teacher" />}
      </TeacherShell>
    );
  }

  // Отчёт — по свежим заданиям класса: столбец на каждое активное и завершённое задание.
  const download = async () => {
    if (!c || !p || !rows) return;
    setSaving(true);
    try {
      const tasks = await unwrap(api.GET("/api/v1/classes/{id}/assignments", { params: { path: { id: c.id } } }));
      saveTextFile(reportFileName(c.title, p.week), classReportCsv({ classTitle: c.title, week: p.week, rows, assignments: [...tasks.active, ...tasks.past] }));
    } catch (e) {
      toast(describeProblem(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const reportActions =
    rows && rows.length ? (
      <>
        <Button variant="secondary" icon={<DownloadSimple weight="bold" />} loading={saving} onClick={() => void download()}>
          Скачать отчёт
        </Button>
        <Button variant="secondary" icon={<Printer weight="fill" />} onClick={() => window.print()} className="print-action">
          Распечатать
        </Button>
      </>
    ) : undefined;

  return (
    <TeacherShell>
      <div className="tt-stack tt-stack--loose class-page">
        <BackToClasses />
        {!c ? (
          <SkeletonGroup label="Загружаем класс" className="tt-stack">
            <Skeleton width="40%" height={34} />
            <Skeleton width="70%" height={18} />
          </SkeletonGroup>
        ) : (
          <>
            <ClassHeader c={c} actions={reportActions} />
            <ClassTabs id={c.id} current="progress" />
          </>
        )}

        {progress.error && !p ? (
          isForbidden(progress.error) ? (
            <ClassUnavailable forbidden />
          ) : (
            <LoadError error={progress.error} onRetry={progress.reload} />
          )
        ) : !c || !p || !rows ? (
          <SkeletonGroup label="Загружаем прогресс" className="tt-stack">
            <div className="progress-top">
              <Skeleton height={240} radius="card" />
              <Skeleton height={240} radius="card" />
            </div>
            <Skeleton height={420} radius="card" />
          </SkeletonGroup>
        ) : (
          <ProgressView progress={p} rows={rows} classId={c.id} classTitle={c.title} staleError={progress.error} />
        )}
      </div>
    </TeacherShell>
  );
}

function ProgressView({ progress, rows, classId, classTitle, staleError }: { progress: ClassProgress; rows: StudentRow[]; classId: string; classTitle: string; staleError: unknown }) {
  const today = ufaToday(serverNow());
  if (rows.length === 0) {
    return (
      <EmptyState
        art="emptyNoStudents"
        headingAs="h2"
        compact
        title="Учеников пока нет"
        actions={
          <ButtonLink href={`/teacher/classes/${classId}`} block>
            К обзору класса
          </ButtonLink>
        }
      >
        Раздайте карточки или покажите код на доске.
      </EmptyState>
    );
  }
  return (
    <>
      {staleError ? (
        <div aria-live="polite">
          <InlineAlert tone={isNetworkError(staleError) ? "honey" : "danger"}>
            {isNetworkError(staleError) ? "Нет связи. Цифры обновятся, когда сеть вернётся." : describeProblem(staleError)}
          </InlineAlert>
        </div>
      ) : null}
      <p className="print-only print-note">
        Отчёт по классу {classTitle} · неделя {weekLabel(progress.week)} · {printDate(today)}
      </p>
      <div className="progress-top">
        <WeekCard progress={progress} />
        <PlacesCard progress={progress} students={rows.length} />
      </div>
      <StudentsCard rows={rows} today={today} classId={classId} />
    </>
  );
}

function WeekCard({ progress }: { progress: ClassProgress }) {
  // «Занимались N из M»: M — ученики с аккаунтом (studentsTotal), как во вкладке «Класс» у ученика, а не все места.
  const { studentsTotal, activeSeats, lessonsCompleted, honeyEarned, votes } = progress.summary;
  return (
    <Card as="section" className="tab-card week-card" aria-labelledby="week-title">
      <CardTitle id="week-title">Неделя {weekLabel(progress.week)}</CardTitle>
      <CardSub>
        Занимались {activeSeats} из {studentsTotal}
      </CardSub>
      <div className="tab-card__comb">
        <HoneyComb total={studentsTotal} filled={Math.min(activeSeats, studentsTotal)} perRow={COMB_PER_ROW} label={`Занимались ${activeSeats} из ${studentsTotal}`} />
      </div>
      <StatTiles label="Итоги недели">
        <StatTile label="Уроков" value={lessonsCompleted} icon={<BookOpen weight="fill" />} />
        <StatTile label="Мёда" value={honeyEarned} icon={<Drop weight="fill" />} />
        <StatTile label="Голосов" value={votes} icon={<Scales weight="fill" />} />
      </StatTiles>
    </Card>
  );
}

function StudentsCard({ rows, today, classId }: { rows: StudentRow[]; today: string; classId: string }) {
  // `?order=attention` — пришли из «Не занимались на неделе» («Ещё N», «Кто отстаёт»): сразу этот порядок и список на виду.
  const params = useSearchParams();
  const behind = params.get("order") === "attention";
  const [sort, setSort] = useState<Sort>(behind ? "attention" : "seat");
  useEffect(() => {
    if (behind) document.getElementById("pupils-title")?.scrollIntoView({ block: "start" });
    // Только при первом показе списка.
  }, []);
  const sorted = useMemo(() => {
    if (sort === "seat") return rows;
    return [...rows].sort(
      (a, b) =>
        ATTENTION[activityOf(a.progress, today)] - ATTENTION[activityOf(b.progress, today)] ||
        (a.progress?.lastActiveOn ?? "").localeCompare(b.progress?.lastActiveOn ?? "") ||
        a.seatNumber - b.seatNumber,
    );
  }, [rows, sort, today]);
  return (
    <Card as="section" className="tab-card pupils-card" aria-labelledby="pupils-title">
      <header className="section-head pupils-card__head">
        <CardTitle id="pupils-title">
          Ученики <span className="pupils-card__count">{rows.length}</span>
        </CardTitle>
        <div className="segmented no-print" role="group" aria-label="Порядок учеников">
          <button type="button" className="segmented__item" aria-pressed={sort === "seat"} onClick={() => setSort("seat")}>
            По номеру
          </button>
          <button type="button" className="segmented__item" aria-pressed={sort === "attention"} onClick={() => setSort("attention")}>
            Кто отстаёт
          </button>
        </div>
      </header>
      {/* Роли заданы явно: на телефоне строки таблицы — карточки (CSS), а читалка видит таблицу. */}
      <div className="pupils-scroll">
      <table className="pupils-table" role="table" aria-label="Прогресс учеников">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">
              Ученик
            </th>
            <th role="columnheader" scope="col" className="pupils-table__sum">
              Прогресс
            </th>
            <th role="columnheader" scope="col">
              Последнее занятие
            </th>
            <th role="columnheader" scope="col" className="pupils-table__num">
              Уроков всего
            </th>
            <th role="columnheader" scope="col" className="pupils-table__num">
              За неделю
            </th>
            <th role="columnheader" scope="col" className="pupils-table__num">
              Мёд за неделю
            </th>
            <th role="columnheader" scope="col" className="pupils-table__num">
              Точность
            </th>
            <th role="columnheader" scope="col" className="pupils-table__num">
              Серия
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {sorted.map((r) => (
            <PupilRow key={r.seatNumber} row={r} today={today} href={`/teacher/classes/${classId}/seats/${r.seatNumber}`} />
          ))}
        </tbody>
      </table>
      </div>
    </Card>
  );
}

/** Строка ученика; вся строка — ссылка на карточку ученика (ссылка — ник, растянутая на строку CSS). */
function PupilRow({ row, today, href }: { row: StudentRow; today: string; href: string }) {
  const p = row.progress;
  const streak = p?.streak ?? 0;
  const activity = activityOf(p, today);
  const week = p?.lessonsThisWeek ?? 0;
  return (
    <tr role="row" className="pupil-row" data-activity={activity}>
      <td role="cell" className="pupil-row__who">
        <HexAvatar size={40} tone={toneFor(row.toneKey)} art={avatarFor(row.nickname)} lip>
          {seatNo(row.seatNumber)}
        </HexAvatar>
        <Link href={href} className="pupil__link">
          {seatLabel(row.seatNumber)} · {row.nickname ?? "Ник ещё не выбран"}
        </Link>
      </td>
      <td role="cell" className="pupils-table__sum">
        <span className="pupil__meta">{studentSummary(p, today)}</span>
        <span className="pupil__week">{weekSummary(p)}</span>
      </td>
      <td role="cell" className="pupil-row__last">
        <span className="pupil-row__dot" aria-hidden />
        {activity === "never" ? "пока без уроков" : lastActiveLabel(p?.lastActiveOn, today)}
      </td>
      <td role="cell" className="pupils-table__num">
        {p?.lessonsCompleted ?? 0}
      </td>
      <td role="cell" className="pupils-table__num">
        {week ? `${week} ${lessonsWord(week)}` : <span className="pupil-row__none">нет</span>}
      </td>
      <td role="cell" className="pupils-table__num">
        {p?.honeyThisWeek ?? 0}
      </td>
      <td role="cell" className="pupils-table__num">
        {p?.accuracy !== undefined ? percent(p.accuracy) : "—"}
      </td>
      <td role="cell" className="pupils-table__num">
        <span className="pupil__streak" data-on={streak > 0 || undefined}>
          <Fire weight="fill" aria-hidden />
          <span aria-hidden>{streak}</span>
          <span className="tt-visually-hidden">
            Серия: {streak} {daysWord(streak)}
          </span>
        </span>
      </td>
    </tr>
  );
}

const printDay = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
/** «5 ноября 2026 г.» — дата отчёта на печати. */
const printDate = (date: string) => printDay.format(new Date(`${date}T12:00:00Z`));
