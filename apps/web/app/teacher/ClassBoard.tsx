"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, BellRinging, CaretRight, Cards, Check, CheckCircle, ClipboardText, ProjectorScreen, Sun, Warning } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";
import { ButtonLink, HexAvatar, Illustration, LinkButton, ProgressBar, Skeleton, avatarFor, toneFor } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { serverNow } from "@teletau/session/clock";
import { useResource } from "@teletau/session/react";
import { assignmentTitle, dueForTeacher } from "../_components/assignments";
import { ClassTitle } from "../_components/screens";
import { seatLabel } from "./classes/[id]/format";
import { IDLE_SHOWN, behindHref, classToday, studentRows, studentsWord, ufaToday, type StudentRow } from "./classes/[id]/progress/model";
import { PROGRAM_LABEL } from "./CreateClassDialog";

type ClassSummary = Schema<"ClassSummary">;
type Assignment = Schema<"ClassAssignment">;

/** Заявки и новые ученики — чаще, прогресс и задания — раз в полминуты: главная висит открытой весь урок. */
const CLASS_POLL_MS = 15_000;
const PROGRESS_POLL_MS = 30_000;

/** «из 1 ученика», «из 22 учеников». */
const ofStudents = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "ученика" : "учеников");

/**
 * Класс на главной кабинета: кто занимался сегодня, активное задание с выполнением, кто не занимался на неделе и заявки
 * на вход. Данные — те же операции, что у страницы класса (getClass, getClassProgress, listClassAssignments,
 * listJoinRequests); ники — только со страницы класса, прогресс — по номерам мест (ADR 0009). Один класс — карточка на
 * всю ширину, блоки в ряд; несколько — сетка, блоки друг под другом (container query в teacher.css).
 */
export function ClassBoardCard({ c, solo }: { c: ClassSummary; solo: boolean }) {
  const path = { params: { path: { id: c.id } } };
  const detail = useResource(() => unwrap(api.GET("/api/v1/classes/{id}", path)), [c.id], { pollMs: CLASS_POLL_MS });
  const seats = detail.data?.seats;
  const students = seats ? seats.filter((s) => s.student).length : (c.studentCount ?? 0);
  const seatCount = seats ? seats.length : (c.seatCount ?? 0);
  const working = students > 0;
  const progress = useResource(() => unwrap(api.GET("/api/v1/classes/{id}/progress", path)), [c.id], { enabled: working, pollMs: PROGRESS_POLL_MS });
  const tasks = useResource(() => unwrap(api.GET("/api/v1/classes/{id}/assignments", path)), [c.id], { enabled: working, pollMs: PROGRESS_POLL_MS });
  const pending = detail.data?.pendingJoinRequestCount ?? 0;
  const requests = useResource(
    () => unwrap(api.GET("/api/v1/classes/{id}/join-requests", { params: { path: { id: c.id }, query: { status: "pending" } } })),
    [c.id, pending],
    { enabled: pending > 0 },
  );

  const href = `/teacher/classes/${c.id}`;
  const titleId = `klass-${c.id}`;
  const today = ufaToday(serverNow());
  const rows = seats && progress.data ? studentRows(seats, progress.data.seats) : null;
  const failed = (Boolean(progress.error) && !progress.data) || (Boolean(detail.error) && !detail.data);
  const reload = () => {
    detail.reload();
    progress.reload();
    tasks.reload();
  };

  return (
    <article className="tt-card class-card klass" data-solo={solo || undefined} aria-labelledby={titleId}>
      <header className="klass__head">
        <HexAvatar size={solo ? 64 : 56} tone={toneFor(c.id)} lip>
          {c.grade}
        </HexAvatar>
        <div className="klass__titles">
          <h2 className="klass__title" id={titleId}>
            <Link href={href} className="klass__link">
              <ClassTitle title={c.title} />
            </Link>
          </h2>
          <p className="klass__meta">
            <span>{c.school.shortNameRu}</span>
            <span>{PROGRAM_LABEL[c.program]}</span>
          </p>
        </div>
        {/* В узкой карточке — только стрелка (текст скрыт в teacher.css), имя ссылки — то же; какой класс — из карточки (WCAG 2.4.4). */}
        <ButtonLink href={href} variant="secondary" small className="klass__open" aria-label="Открыть класс">
          <span className="klass__open-text">Открыть класс</span>
          <CaretRight weight="bold" aria-hidden className="klass__open-icon" />
        </ButtonLink>
      </header>

      {pending > 0 ? <RequestsStrip href={`${href}?open=requests`} count={pending} names={(requests.data?.items ?? []).map((r) => r.nickname)} /> : null}

      {!working ? (
        <SetupHint href={href} hasCards={seatCount > 0} />
      ) : (
        <div className="pulse-grid" role="group" aria-label={`Сводка ${c.title}`}>
          <TodayTile id={titleId} classId={c.id} rows={rows} today={today} failed={failed} onRetry={reload} shown={solo ? 6 : 7} />
          <TaskTile id={titleId} classId={c.id} active={tasks.data?.active ?? null} today={today} failed={Boolean(tasks.error) && !tasks.data} onRetry={tasks.reload} />
          <IdleTile id={titleId} classId={c.id} rows={rows} today={today} failed={failed} onRetry={reload} />
        </div>
      )}
    </article>
  );
}

/** Заявки на вход по коду класса — заметно, с никами: кого подтвердить. «Посмотреть» открывает лист заявок класса. */
function RequestsStrip({ href, count, names }: { href: string; count: number; names: string[] }) {
  return (
    <div className="requests-banner klass__requests" role="status">
      <span className="requests-banner__icon" aria-hidden>
        <BellRinging weight="fill" />
      </span>
      <p className="requests-banner__text">
        <b>
          {count} {studentsWord(count)} {count === 1 ? "ждёт" : "ждут"} подтверждения
        </b>
        {names.length ? <span className="requests-banner__names">{names.join(", ")}</span> : null}
      </p>
      <ButtonLink href={href} small>
        Посмотреть
      </ButtonLink>
    </div>
  );
}

/** Класс без учеников: три шага к первому уроку и кнопка следующего шага (на странице класса — то же с действиями). */
function SetupHint({ href, hasCards }: { href: string; hasCards: boolean }) {
  const steps: { title: string; state: "done" | "current" | "todo" }[] = [
    { title: "Класс создан", state: "done" },
    { title: hasCards ? "Карточки выпущены" : "Выпустите карточки", state: hasCards ? "done" : "current" },
    { title: "Покажите код на доске", state: hasCards ? "current" : "todo" },
  ];
  return (
    <div className="klass__setup">
      <Illustration name="emptyNoStudents" width={150} className="klass__setup-art" />
      <div className="klass__setup-main">
        <ol className="steps klass__steps">
          {steps.map((st, i) => (
            <li key={st.title} className="step" data-state={st.state}>
              <span className="step__mark" aria-hidden>
                {st.state === "done" ? <Check weight="bold" /> : i + 1}
              </span>
              <div className="step__body">
                <p className="step__title">
                  <span className="tt-visually-hidden">{st.state === "done" ? "Готово: " : `Шаг ${i + 1}: `}</span>
                  {st.title}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <ButtonLink href={`${href}?open=${hasCards ? "board" : "cards"}`} icon={hasCards ? <ProjectorScreen weight="fill" /> : <Cards weight="fill" />}>
          {hasCards ? "Показать код класса" : "Выпустить карточки"}
        </ButtonLink>
      </div>
    </div>
  );
}

function Tile({ id, kind, icon, title, big, children, attention, more }: { id: string; kind: string; icon: ReactNode; title: string; big?: ReactNode; children: ReactNode; attention?: boolean; more?: { href: string; label: string } }) {
  const headingId = `${id}-${kind}`;
  return (
    <section className="pulse" data-kind={kind} data-tone={attention ? "attention" : undefined} aria-labelledby={headingId}>
      <span className={`pulse__icon pulse__icon--${kind}`} aria-hidden>
        {icon}
      </span>
      <h3 className="pulse__title" id={headingId}>
        {title}
      </h3>
      {big !== undefined ? <p className="pulse__big">{big}</p> : null}
      <div className="pulse__body">{children}</div>
      {/* Ссылка внизу блока — только в широкой карточке (в узкой блок короткий, а класс открывается из заголовка). */}
      {more ? (
        <Link href={more.href} className="today-card__more pulse__more">
          {more.label} <ArrowRight weight="bold" aria-hidden />
        </Link>
      ) : null}
    </section>
  );
}

const nick = (r: StudentRow) => r.nickname ?? "ник не выбран";

function TodayTile({ id, classId, rows, today, failed, onRetry, shown }: { id: string; classId: string; rows: StudentRow[] | null; today: string; failed: boolean; onRetry: () => void; shown: number }) {
  const split = rows ? classToday(rows, today) : null;
  return (
    <Tile
      id={id}
      kind="today"
      icon={<Sun weight="fill" />}
      title="Занимались сегодня"
      more={{ href: `/teacher/classes/${classId}/progress`, label: "Прогресс класса" }}
      big={
        split ? (
          <>
            <b>{split.today.length}</b> из {rows!.length}
            <span className="pulse__unit"> {ofStudents(rows!.length)}</span>
          </>
        ) : undefined
      }
    >
      {!split ? (
        failed ? (
          <Retry onRetry={onRetry} />
        ) : (
          <Skeleton height={44} />
        )
      ) : split.today.length ? (
        <ul className="avatars" aria-label="Занимались сегодня">
          {split.today.slice(0, shown).map((r) => (
            <li key={r.seatNumber}>
              <Link href={`/teacher/classes/${classId}/seats/${r.seatNumber}`} className="avatars__item" title={`${seatLabel(r.seatNumber)} · ${nick(r)}`}>
                <HexAvatar size={40} tone={toneFor(r.toneKey)} art={avatarFor(r.nickname)} lip label={`${seatLabel(r.seatNumber)} · ${nick(r)}`}>
                  {String(r.seatNumber).padStart(2, "0")}
                </HexAvatar>
              </Link>
            </li>
          ))}
          {split.today.length > shown ? <li className="avatars__more">+{split.today.length - shown}</li> : null}
        </ul>
      ) : (
        <p className="tt-muted">Пока никто.</p>
      )}
    </Tile>
  );
}

function TaskTile({ id, classId, active, today, failed, onRetry }: { id: string; classId: string; active: Assignment[] | null; today: string; failed: boolean; onRetry: () => void }) {
  // Одно задание — «9 из 22 сделали» крупно, как «Занимались сегодня»; два — по полосе на каждое.
  const single = active?.length === 1 ? active[0]! : null;
  const singleDone = single ? single.summary.done + single.summary.late : 0;
  return (
    <Tile
      id={id}
      kind="task"
      icon={<ClipboardText weight="fill" />}
      title={active && active.length > 1 ? "Задания" : "Задание"}
      more={active?.length ? { href: `/teacher/classes/${classId}/assignments`, label: "Все задания" } : undefined}
      big={
        single ? (
          <>
            <b>{singleDone}</b> из {single.summary.total}
            <span className="pulse__unit"> сделали</span>
          </>
        ) : undefined
      }
    >
      {!active ? (
        failed ? (
          <Retry onRetry={onRetry} />
        ) : (
          <Skeleton height={44} />
        )
      ) : active.length === 0 ? (
        <div className="pulse__empty">
          <span className="tt-muted">Заданий нет.</span>
          <ButtonLink href={`/teacher/classes/${classId}/assignments?new=1`} variant="secondary" small>
            Дать задание
          </ButtonLink>
        </div>
      ) : (
        <ul className="today-tasks">
          {active.map((a) => {
            const done = a.summary.done + a.summary.late;
            return (
              <li key={a.id} className="today-task">
                <p className="today-task__title">
                  <Link href={`/teacher/classes/${classId}/assignments`} className="pulse__link">
                    {assignmentTitle(a)}
                  </Link>
                  <span className="tt-muted">{dueForTeacher(a.dueOn, today)}</span>
                </p>
                <ProgressBar value={done} max={a.summary.total} label={`Сделали: ${assignmentTitle(a)}`} valueText={`${done} из ${a.summary.total}`} showValue={!single} />
              </li>
            );
          })}
        </ul>
      )}
    </Tile>
  );
}

function IdleTile({ id, classId, rows, today, failed, onRetry }: { id: string; classId: string; rows: StudentRow[] | null; today: string; failed: boolean; onRetry: () => void }) {
  const idle = rows ? classToday(rows, today).idle : null;
  const shown = IDLE_SHOWN;
  const rest = idle ? idle.length - shown : 0;
  return (
    <Tile
      id={id}
      kind="idle"
      icon={idle && !idle.length ? <CheckCircle weight="fill" /> : <Warning weight="fill" />}
      title="Не занимались на неделе"
      attention={Boolean(idle?.length)}
      more={idle?.length ? { href: behindHref(classId), label: rest > 0 ? `Ещё ${rest} ${studentsWord(rest)}` : "Кто отстаёт" } : undefined}
      big={
        idle?.length ? (
          <>
            <b>{idle.length}</b>
            <span className="pulse__unit"> {studentsWord(idle.length)}</span>
          </>
        ) : undefined
      }
    >
      {!idle ? (
        failed ? (
          <Retry onRetry={onRetry} />
        ) : (
          <Skeleton height={44} />
        )
      ) : idle.length ? (
        <ul className="seat-chips seat-chips--compact" aria-label={`Не занимались на этой неделе: ${idle.length}`}>
          {idle.slice(0, shown).map((r) => (
            <li key={r.seatNumber}>
              <Link href={`/teacher/classes/${classId}/seats/${r.seatNumber}`} className="seat-chip seat-chip--overdue">
                <b>{seatLabel(r.seatNumber)}</b> {nick(r)}
              </Link>
            </li>
          ))}
          {rest > 0 ? (
            // В узкой карточке ссылки внизу блока нет — «ещё N» чипом (в широкой он скрыт, teacher.css).
            <li>
              <Link href={behindHref(classId)} className="seat-chip seat-chip--more">
                ещё {rest}
              </Link>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="today-card__ok">Все занимались.</p>
      )}
    </Tile>
  );
}

function Retry({ onRetry }: { onRetry: () => void }) {
  return (
    <p className="tt-muted">
      Не получилось загрузить. <LinkButton onClick={onRetry}>Обновить</LinkButton>
    </p>
  );
}
