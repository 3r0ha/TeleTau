"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, BookOpen, Drop, Fire, Printer, Scales, Target, Translate } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";
import { Button, ButtonLink, Card, CardTitle, Chip, EmptyState, HexAvatar, Skeleton, SkeletonGroup, StatTile, StatTiles, avatarFor, toneFor, type ChipTone } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { serverNow } from "@teletau/session/clock";
import { ApiProblem } from "@teletau/session/problem";
import { useResource } from "@teletau/session/react";
import { STATUS_LABEL, assignmentTitle, dueForTeacher, ufaDay, type SeatStatus } from "../../../../../_components/assignments";
import { LoadError, isForbidden, isNotFound, useDocumentTitle } from "../../../../../_components/screens";
import { TeacherShell } from "../../../../TeacherShell";
import { useTeacherGate } from "../../../../useTeacher";
import { ClassUnavailable } from "../../ClassFrame";
import { isUuid, seatLabel, seatNo } from "../../format";
import { lastActiveLabel, lessonsWord, percent, timesWord } from "../../progress/model";
import { usePrintInLight } from "../../progress/print";

type Card = Schema<"SeatProgressCard">;

const STATUS_TONE: Record<SeatStatus, ChipTone> = { done: "green", done_late: "honey", todo: "neutral", overdue: "coral" };

/**
 * Карточка ученика у учителя (по номеру места): пройденные уроки, точность, слова, серия, голоса, задания и последние
 * занятия. Прогресс — getSeatProgress (без ника и ПДн), ник — со страницы класса (GET /classes/{id}), ADR 0009.
 */
export default function SeatCardPage() {
  const { id, seat } = useParams<{ id: string; seat: string }>();
  const { me } = useTeacherGate("verified");
  const number = Number(seat);
  const validSeat = /^\d{1,2}$/.test(seat) && number >= 1 && number <= 99;
  const validId = isUuid(id);
  const enabled = Boolean(me) && validId && validSeat;
  const klass = useResource(() => unwrap(api.GET("/api/v1/classes/{id}", { params: { path: { id } } })), [id], { enabled });
  const card = useResource(() => unwrap(api.GET("/api/v1/classes/{id}/seats/{seat}/progress", { params: { path: { id, seat: number } } })), [id, number], { enabled });
  const tasks = useResource(() => unwrap(api.GET("/api/v1/classes/{id}/assignments", { params: { path: { id } } })), [id], { enabled });
  usePrintInLight();
  const nickname = klass.data?.seats?.find((s) => s.number === number)?.student?.nickname;
  useDocumentTitle(klass.data && validSeat ? `${seatLabel(number)}${nickname ? ` · ${nickname}` : ""} · ${klass.data.title}` : undefined);

  const classError = klass.error && !klass.data ? klass.error : null;
  const missingClass = !validId || (classError && (isNotFound(classError) || (classError instanceof ApiProblem && classError.status === 422)));
  if (missingClass || (classError && isForbidden(classError))) {
    return (
      <TeacherShell>
        <ClassUnavailable forbidden={!missingClass} />
      </TeacherShell>
    );
  }
  if (classError) {
    return (
      <TeacherShell>
        <LoadError error={classError} onRetry={klass.reload} home="/teacher" />
      </TeacherShell>
    );
  }

  const back = (
    <Link href={`/teacher/classes/${id}/progress`} className="tt-link-btn tt-link-btn--neutral class-page__back no-print">
      <ArrowLeft weight="bold" aria-hidden /> Прогресс класса
    </Link>
  );
  const emptySeat = !validSeat || (card.error && !card.data && (isNotFound(card.error) || (card.error instanceof ApiProblem && card.error.status === 422)));
  if (emptySeat) {
    return (
      <TeacherShell>
        <div className="tt-stack tt-stack--loose class-page">
          {back}
          <EmptyState
            art="emptyNoStudents"
            title="На этом месте нет ученика"
            actions={
              <ButtonLink href={`/teacher/classes/${id}/progress`} block>
                К прогрессу класса
              </ButtonLink>
            }
          >
            {validSeat ? `Место ${seatLabel(number)} ждёт ученика.` : "Такого места нет."}
          </EmptyState>
        </div>
      </TeacherShell>
    );
  }

  const c = card.data;
  const today = ufaDay(serverNow());
  return (
    <TeacherShell>
      <div className="tt-stack tt-stack--loose class-page seat-card">
        {back}
        {card.error && !c ? (
          isForbidden(card.error) ? (
            <ClassUnavailable forbidden />
          ) : (
            <LoadError error={card.error} onRetry={card.reload} />
          )
        ) : !c || !klass.data ? (
          <SkeletonGroup label="Загружаем ученика" className="tt-stack">
            <Skeleton width="50%" height={44} />
            <Skeleton height={120} radius="card" />
            <Skeleton height={300} radius="card" />
          </SkeletonGroup>
        ) : (
          <>
            <header className="page-head seat-card__head">
              <HexAvatar size={72} tone={toneFor(klass.data.seats?.find((s) => s.number === number)?.student?.accountId ?? number)} art={avatarFor(nickname ?? null)} lip>
                {seatNo(number)}
              </HexAvatar>
              <div className="tt-stack tt-stack--tight">
                <h1 className="tt-title1">
                  {seatLabel(number)} · {nickname ?? "Ник ещё не выбран"}
                </h1>
                <p className="tt-lead">
                  {klass.data.title} · {c.lastActiveOn ? `последнее занятие — ${lastActiveLabel(c.lastActiveOn, today)}` : "ещё не занимался"}
                </p>
              </div>
              <Button variant="secondary" icon={<Printer weight="fill" />} onClick={() => window.print()} className="no-print seat-card__print">
                Распечатать
              </Button>
            </header>

            <StatTiles label="Итоги ученика">
              <StatTile label="Уроков" value={c.lessonsCompleted} icon={<BookOpen weight="fill" />} />
              <StatTile label="Точность" value={c.accuracy !== undefined ? percent(c.accuracy) : "—"} icon={<Target weight="fill" />} />
              <StatTile label="Слов" value={c.wordsLearned} icon={<Translate weight="fill" />} />
              <StatTile label="Серия" value={c.streak.current} icon={<Fire weight="fill" />} />
              <StatTile label="Голосов" value={c.votes.total} icon={<Scales weight="fill" />} />
              <StatTile label="Мёда" value={c.honey} icon={<Drop weight="fill" />} />
            </StatTiles>

            <div className="seat-card__grid">
              <div className="tt-stack seat-card__side">
                <TasksCard number={number} tasks={tasks.data} today={today} />
                <DaysCard card={c} today={today} />
              </div>
              <LessonsDoneCard card={c} today={today} />
            </div>
          </>
        )}
      </div>
    </TeacherShell>
  );
}

function TasksCard({ number, tasks, today }: { number: number; tasks: Schema<"ClassAssignments"> | undefined; today: string }) {
  const list = tasks ? [...tasks.active, ...tasks.past] : [];
  const mine = list.flatMap((a) => {
    const s = a.seats.find((x) => x.seatNumber === number);
    return s ? [{ a, status: s.status }] : [];
  });
  return (
    <Card as="section" className="tab-card" aria-labelledby="seat-tasks-title">
      <CardTitle id="seat-tasks-title">Задания</CardTitle>
      {!tasks ? (
        <Skeleton height={48} />
      ) : mine.length === 0 ? (
        <p className="tt-muted">Заданий не было.</p>
      ) : (
        <ul className="seat-rows">
          {mine.map(({ a, status }) => (
            <li key={a.id} className="seat-rows__item">
              <span className="seat-rows__main">
                <b>{assignmentTitle(a)}</b>
                <span className="seat-rows__sub">{dueForTeacher(a.dueOn, today)}</span>
              </span>
              <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DaysCard({ card, today }: { card: Card; today: string }) {
  return (
    <Card as="section" className="tab-card" aria-labelledby="seat-days-title">
      <CardTitle id="seat-days-title">Последние занятия</CardTitle>
      {card.recentDays.length === 0 ? (
        <p className="tt-muted">Ещё не занимался.</p>
      ) : (
        <ul className="seat-rows">
          {card.recentDays.map((d) => (
            <li key={d.date} className="seat-rows__item">
              <span className="seat-rows__main">
                <b>{lastActiveLabel(d.date, today)}</b>
              </span>
              <span className="seat-rows__value">
                {d.lessons} {lessonsWord(d.lessons)} · {d.honey} мёда
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function LessonsDoneCard({ card, today }: { card: Card; today: string }) {
  return (
    <Card as="section" className="tab-card" aria-labelledby="seat-lessons-title">
      <CardTitle id="seat-lessons-title">Пройденные уроки</CardTitle>
      {card.lessons.length === 0 ? (
        <p className="tt-muted">Пока нет.</p>
      ) : (
        <ol className="seat-rows">
          {card.lessons.map((l) => (
            <li key={l.lessonId} className="seat-rows__item">
              <span className="seat-rows__main">
                <b>{l.kind === "place_test" ? `Испытание места${l.placeRu ? ` «${l.placeRu}»` : ""}` : l.titleRu}</b>
                <span className="seat-rows__sub">
                  {[l.kind === "lesson" ? l.placeRu : undefined, `${l.completions} ${timesWord(l.completions)}`, lastActiveLabel(l.lastCompletedOn, today)].filter(Boolean).join(" · ")}
                </span>
              </span>
              {l.bestAccuracy !== undefined ? <span className="seat-rows__value">{percent(l.bestAccuracy)}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
