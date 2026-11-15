"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CaretRight, Cards, Check, CheckCircle, ClipboardText, ProjectorScreen, Sun, Warning } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";
import { ButtonLink, HexAvatar, Illustration, Skeleton, toneFor } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { serverNow } from "@teletau/session/clock";
import { useResource } from "@teletau/session/react";
import { fillNodes, useT } from "../../i18n/client";
import { ClassTitle } from "../_components/screens";
import { IDLE_SHOWN, behindHref, classToday, studentRows, studentsWord, ufaToday, type StudentRow } from "./classes/[id]/progress/model";
import { IdleChips, PulseRetry, RequestsBanner, TaskList, TodayAvatars, ofStudents, singleTaskDone } from "./ClassPulse";
import { programLabels } from "./CreateClassDialog";

type ClassSummary = Schema<"ClassSummary">;
type Assignment = Schema<"ClassAssignment">;

/** Заявки и новые ученики — чаще, прогресс и задания — раз в полминуты: главная висит открытой весь урок. */
const CLASS_POLL_MS = 15_000;
const PROGRESS_POLL_MS = 30_000;

/**
 * Класс на главной кабинета: кто занимался сегодня, активное задание с выполнением, кто не занимался на неделе и заявки
 * на вход. Данные — те же операции, что у страницы класса (getClass, getClassProgress, listClassAssignments,
 * listJoinRequests); ники — только со страницы класса, прогресс — по номерам мест (ADR 0009). Один класс — карточка на
 * всю ширину, блоки в ряд; несколько — сетка, блоки друг под другом (container query в teacher.css).
 */
export function ClassBoardCard({ c, solo }: { c: ClassSummary; solo: boolean }) {
  const t = useT();
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
    { enabled: pending > 0, keepPrevious: true },
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
            <span>{programLabels(t)[c.program]}</span>
          </p>
        </div>
        {/* В узкой карточке — только стрелка (текст скрыт в teacher.css), имя ссылки — то же; какой класс — из карточки (WCAG 2.4.4). */}
        <ButtonLink href={href} variant="secondary" small className="klass__open" aria-label={t("Открыть класс")}>
          <span className="klass__open-text">{t("Открыть класс")}</span>
          <CaretRight weight="bold" aria-hidden className="klass__open-icon" />
        </ButtonLink>
      </header>

      <RequestsBanner className="klass__requests" href={`${href}?open=requests`} count={pending} names={(requests.data?.items ?? []).map((r) => r.nickname)} />

      {!working ? (
        <SetupHint href={href} hasCards={seatCount > 0} />
      ) : (
        <div className="pulse-grid" role="group" aria-label={t("Сводка {title}", { title: c.title })}>
          <TodayTile id={titleId} classId={c.id} rows={rows} today={today} failed={failed} onRetry={reload} shown={solo ? 6 : 7} />
          <TaskTile id={titleId} classId={c.id} active={tasks.data?.active ?? null} today={today} failed={Boolean(tasks.error) && !tasks.data} onRetry={tasks.reload} />
          <IdleTile id={titleId} classId={c.id} rows={rows} today={today} failed={failed} onRetry={reload} />
        </div>
      )}
    </article>
  );
}

/** Класс без учеников: три шага к первому уроку и кнопка следующего шага (на странице класса — то же с действиями). */
function SetupHint({ href, hasCards }: { href: string; hasCards: boolean }) {
  const t = useT();
  const steps: { title: string; state: "done" | "current" | "todo" }[] = [
    { title: t("Класс создан"), state: "done" },
    { title: hasCards ? t("Карточки выпущены") : t("Выпустите карточки"), state: hasCards ? "done" : "current" },
    { title: t("Покажите код на доске"), state: hasCards ? "current" : "todo" },
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
                  <span className="tt-visually-hidden">{st.state === "done" ? t("Готово:") : t("Шаг {n}:", { n: i + 1 })}{" "}</span>
                  {st.title}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <ButtonLink href={`${href}?open=${hasCards ? "board" : "cards"}`} icon={hasCards ? <ProjectorScreen weight="fill" /> : <Cards weight="fill" />}>
          {hasCards ? t("Показать код класса") : t("Выпустить карточки")}
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

function TodayTile({ id, classId, rows, today, failed, onRetry, shown }: { id: string; classId: string; rows: StudentRow[] | null; today: string; failed: boolean; onRetry: () => void; shown: number }) {
  const t = useT();
  const split = rows ? classToday(rows, today) : null;
  return (
    <Tile
      id={id}
      kind="today"
      icon={<Sun weight="fill" />}
      title={t("Занимались сегодня")}
      more={{ href: `/teacher/classes/${classId}/progress`, label: t("Прогресс класса") }}
      big={
        split ? (
          <>
            {fillNodes(t("{done} из {total}"), { done: <b>{split.today.length}</b>, total: rows!.length })}
            <span className="pulse__unit"> {ofStudents(rows!.length, t)}</span>
          </>
        ) : undefined
      }
    >
      {!split ? (
        failed ? (
          <PulseRetry onRetry={onRetry} />
        ) : (
          <Skeleton height={44} />
        )
      ) : (
        <TodayAvatars classId={classId} rows={split.today} shown={shown} />
      )}
    </Tile>
  );
}

function TaskTile({ id, classId, active, today, failed, onRetry }: { id: string; classId: string; active: Assignment[] | null; today: string; failed: boolean; onRetry: () => void }) {
  const t = useT();
  // Одно задание — «9 из 22 сделали» крупно, как «Занимались сегодня»; два — по полосе на каждое.
  const single = singleTaskDone(active);
  return (
    <Tile
      id={id}
      kind="task"
      icon={<ClipboardText weight="fill" />}
      title={active && active.length > 1 ? t("Задания") : t("Задание")}
      more={active?.length ? { href: `/teacher/classes/${classId}/assignments`, label: t("Все задания") } : undefined}
      big={
        single ? (
          <>
            {fillNodes(t("{done} из {total}"), { done: <b>{single.done}</b>, total: single.total })}
            <span className="pulse__unit"> {t("сделали")}</span>
          </>
        ) : undefined
      }
    >
      {!active ? (
        failed ? (
          <PulseRetry onRetry={onRetry} />
        ) : (
          <Skeleton height={44} />
        )
      ) : active.length === 0 ? (
        <div className="pulse__empty">
          <span className="tt-muted">{t("Заданий нет.")}</span>
          <ButtonLink href={`/teacher/classes/${classId}/assignments?new=1`} variant="secondary" small>
            {t("Дать задание")}
          </ButtonLink>
        </div>
      ) : (
        <TaskList classId={classId} active={active} today={today} linked />
      )}
    </Tile>
  );
}

function IdleTile({ id, classId, rows, today, failed, onRetry }: { id: string; classId: string; rows: StudentRow[] | null; today: string; failed: boolean; onRetry: () => void }) {
  const t = useT();
  const idle = rows ? classToday(rows, today).idle : null;
  const shown = IDLE_SHOWN;
  const rest = idle ? idle.length - shown : 0;
  return (
    <Tile
      id={id}
      kind="idle"
      icon={idle && !idle.length ? <CheckCircle weight="fill" /> : <Warning weight="fill" />}
      title={t("Не занимались на неделе")}
      attention={Boolean(idle?.length)}
      more={idle?.length ? { href: behindHref(classId), label: rest > 0 ? `${t("Ещё")} ${rest} ${studentsWord(rest, t)}` : t("Кто отстаёт") } : undefined}
      big={
        idle?.length ? (
          <>
            <b>{idle.length}</b>
            <span className="pulse__unit"> {studentsWord(idle.length, t)}</span>
          </>
        ) : undefined
      }
    >
      {!idle ? (
        failed ? (
          <PulseRetry onRetry={onRetry} />
        ) : (
          <Skeleton height={44} />
        )
      ) : idle.length ? (
        // В узкой карточке ссылки внизу блока нет — «ещё N» чипом (в широкой он скрыт, teacher.css).
        <IdleChips classId={classId} rows={idle} shown={shown} moreHref={behindHref(classId)} />
      ) : (
        <p className="today-card__ok">{t("Все занимались.")}</p>
      )}
    </Tile>
  );
}
