"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowsClockwise, BookOpen, Plus, Trophy } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";
import { Button, Card, CardSub, CardTitle, Chip, Dialog, EmptyState, InlineAlert, LinkButton, ProgressBar, Skeleton, SkeletonGroup, useToast } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { serverNow } from "@teletau/session/clock";
import { ApiProblem, describeProblem, isNetworkError } from "@teletau/session/problem";
import { useResource } from "@teletau/session/react";
import { assignmentTitle, dueForTeacher, ufaDay, type SeatStatus } from "../../../../_components/assignments";
import { LoadError, isForbidden, isNotFound, useDocumentTitle } from "../../../../_components/screens";
import { TeacherShell } from "../../../TeacherShell";
import { useTeacherGate } from "../../../useTeacher";
import { BackToClasses, ClassHeader, ClassTabs, ClassUnavailable } from "../ClassFrame";
import { isUuid, seatLabel, type Seat } from "../format";
import { studentsWord } from "../progress/model";
import { GiveAssignmentDialog } from "./GiveAssignmentDialog";

type Assignment = Schema<"ClassAssignment">;

/** Выполнение меняется, пока дети занимаются: свежие цифры без перезагрузки. */
const POLL_MS = 15_000;

/**
 * Раздел «Задания» класса (ADR 0021): учитель даёт урок, «Испытание места» или повторение слов со сроком и видит
 * выполнение по номерам мест — сделали, ещё нет, просрочили. Ники — со страницы класса (GET /classes/{id}).
 * `?new=1` (кнопка «Дать задание» на обзоре класса) сразу открывает «Задание классу».
 */
export default function ClassAssignmentsPage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const { me } = useTeacherGate("verified");
  const toast = useToast();
  const validId = isUuid(id);
  const enabled = Boolean(me) && validId;
  const klass = useResource(() => unwrap(api.GET("/api/v1/classes/{id}", { params: { path: { id } } })), [id], { enabled });
  const tasks = useResource(() => unwrap(api.GET("/api/v1/classes/{id}/assignments", { params: { path: { id } } })), [id], { enabled, pollMs: POLL_MS });
  useDocumentTitle(klass.data ? `Задания · ${klass.data.title}` : undefined);
  const [giving, setGiving] = useState(false);
  const [cancelling, setCancelling] = useState<Assignment | null>(null);
  const [busy, setBusy] = useState(false);
  // Только что выданное задание: страница прокручивается к нему и ненадолго подсвечивает карточку.
  const [freshId, setFreshId] = useState<string | null>(null);
  const asked = useRef(params.get("new") === "1");

  useEffect(() => {
    if (!freshId) return;
    const behavior: ScrollBehavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    const reveal = () => document.getElementById(`task-${freshId}`)?.closest("section")?.scrollIntoView({ block: "center", behavior });
    // Лист закрывается через history.back() (sheetHistory): прокручиваем после его popstate, иначе Next вернёт прокрутку.
    const onPop = () => requestAnimationFrame(reveal);
    window.addEventListener("popstate", onPop, { once: true });
    const late = setTimeout(reveal, 400);
    const t = setTimeout(() => setFreshId(null), 6000);
    return () => {
      window.removeEventListener("popstate", onPop);
      clearTimeout(late);
      clearTimeout(t);
    };
  }, [freshId]);

  const t = tasks.data;
  const full = t ? t.active.length >= t.maxActive : false;

  // Пришли с «Дать задание» на обзоре — лист открывается, как только известны уроки (один раз).
  useEffect(() => {
    if (!asked.current || !t || !klass.data) return;
    asked.current = false;
    if (!full && t.options.length > 0) setGiving(true);
  }, [t, klass.data, full]);

  const classError = klass.error && !klass.data ? klass.error : null;
  const missing = !validId || (classError && (isNotFound(classError) || (classError instanceof ApiProblem && classError.status === 422)));
  if (missing || classError) {
    return (
      <TeacherShell>
        {missing || isForbidden(classError) ? <ClassUnavailable forbidden={!missing} /> : <LoadError error={classError} onRetry={klass.reload} home="/teacher" />}
      </TeacherShell>
    );
  }

  const c = klass.data;
  const today = ufaDay(serverNow());
  const nicknames = new Map((c?.seats ?? []).flatMap((s: Seat) => (s.student ? [[s.number, s.student.nickname ?? null] as const] : [])));

  const cancel = async () => {
    if (!cancelling || !c) return;
    setBusy(true);
    try {
      await unwrap(api.DELETE("/api/v1/classes/{id}/assignments/{assignmentId}", { params: { path: { id: c.id, assignmentId: cancelling.id } } }));
      toast(`${cancelling.active ? "Задание снято" : "Задание убрано"}: ${assignmentTitle(cancelling)}`);
      setCancelling(null);
      tasks.reload();
    } catch (e) {
      toast(describeProblem(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const give =
    t && t.active.length > 0 ? (
      <Button icon={<Plus weight="bold" />} onClick={() => setGiving(true)} disabled={full} aria-describedby={full ? "tasks-full" : undefined}>
        Дать задание
      </Button>
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
            <ClassHeader c={c} actions={give} />
            <ClassTabs id={c.id} current="assignments" />
          </>
        )}

        {tasks.error && !t ? (
          isForbidden(tasks.error) ? (
            <ClassUnavailable forbidden />
          ) : (
            <LoadError error={tasks.error} onRetry={tasks.reload} />
          )
        ) : !c || !t ? (
          <SkeletonGroup label="Загружаем задания" className="tt-stack">
            <Skeleton height={56} radius="button" width="40%" />
            <Skeleton height={280} radius="card" />
          </SkeletonGroup>
        ) : (
          <>
            {tasks.error ? (
              <div aria-live="polite">
                <InlineAlert tone={isNetworkError(tasks.error) ? "honey" : "danger"}>
                  {isNetworkError(tasks.error) ? "Нет связи. Цифры обновятся, когда сеть вернётся." : describeProblem(tasks.error)}
                </InlineAlert>
              </div>
            ) : null}
            {t.active.length === 0 ? (
              <EmptyState
                art="beeTeacher"
                headingAs="h2"
                compact
                title={t.past.length ? "Сейчас заданий нет" : "Заданий пока нет"}
                actions={
                  <Button block icon={<Plus weight="bold" />} onClick={() => setGiving(true)} disabled={t.options.length === 0}>
                    Дать задание
                  </Button>
                }
              >
                Ученики увидят задание на своей тропе.
              </EmptyState>
            ) : (
              <section className="tt-stack" aria-labelledby="active-title">
                <header className="section-head">
                  <div className="tt-stack tt-stack--tight">
                    <h2 id="active-title" className="tt-title3">
                      Сейчас
                    </h2>
                    {full ? (
                      <p className="tt-muted" id="tasks-full">
                        Не больше {t.maxActive} заданий сразу. Снимите одно, чтобы дать новое.
                      </p>
                    ) : null}
                  </div>
                </header>
                <div className="tasks-list">
                  {t.active.map((a) => (
                    <AssignmentCard key={a.id} a={a} today={today} classId={c.id} nicknames={nicknames} fresh={a.id === freshId} onCancel={() => setCancelling(a)} />
                  ))}
                </div>
              </section>
            )}
            {t.past.length > 0 ? (
              <section className="tt-stack" aria-labelledby="past-title">
                <h2 id="past-title" className="tt-title3">
                  Завершённые
                </h2>
                <div className="tasks-list">
                  {t.past.map((a) => (
                    <AssignmentCard key={a.id} a={a} today={today} classId={c.id} nicknames={nicknames} onCancel={() => setCancelling(a)} />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>

      {c && t ? (
        <GiveAssignmentDialog
          open={giving}
          onClose={() => setGiving(false)}
          classId={c.id}
          options={t.options}
          today={today}
          onGiven={(a) => {
            tasks.setData((prev) => (prev ? { ...prev, active: [...prev.active, a].sort((x, y) => (x.dueOn < y.dueOn ? -1 : 1)) } : prev));
            setFreshId(a.id);
          }}
        />
      ) : null}
      <Dialog
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        title={cancelling ? `${cancelling.active ? "Снять" : "Убрать"} задание ${assignmentTitle(cancelling)}?` : ""}
        description="Пройденное останется в прогрессе учеников."
        actions={
          <>
            <Button variant="danger" block loading={busy} onClick={() => void cancel()}>
              {cancelling?.active === false ? "Убрать задание" : "Снять задание"}
            </Button>
            <Button variant="secondary" block onClick={() => setCancelling(null)}>
              Оставить
            </Button>
          </>
        }
      />
    </TeacherShell>
  );
}

const ICON = { lesson: BookOpen, place_test: Trophy, review: ArrowsClockwise } as const;

/** Группы мест: активное задание — «Сделали» и «Ещё нет»; завершённое — «Сделали», «Сделали после срока», «Просрочили». */
const GROUPS: { key: string; title: string; statuses: SeatStatus[]; tone: "done" | "late" | "todo" | "overdue" }[] = [
  { key: "done", title: "Сделали", statuses: ["done"], tone: "done" },
  { key: "late", title: "Сделали после срока", statuses: ["done_late"], tone: "late" },
  { key: "todo", title: "Ещё нет", statuses: ["todo"], tone: "todo" },
  { key: "overdue", title: "Просрочили", statuses: ["overdue"], tone: "overdue" },
];

function AssignmentCard({
  a,
  today,
  classId,
  nicknames,
  fresh,
  onCancel,
}: {
  a: Assignment;
  today: string;
  classId: string;
  nicknames: ReadonlyMap<number, string | null>;
  fresh?: boolean;
  onCancel: () => void;
}) {
  const Icon = ICON[a.kind];
  const done = a.summary.done + a.summary.late;
  const titleId = `task-${a.id}`;
  const where = a.kind === "lesson" && a.placeRu ? `Урок · ${a.placeRu}` : a.kind === "place_test" ? "Испытание места" : "Слова из пройденных уроков";
  return (
    <Card as="section" className="tab-card task" aria-labelledby={titleId} data-active={a.active || undefined} data-fresh={fresh || undefined}>
      <div className="task__head">
        <span className={`task__icon task__icon--${a.kind}`} aria-hidden>
          <Icon weight="fill" />
        </span>
        <div className="task__titles">
          <CardTitle id={titleId}>{assignmentTitle(a)}</CardTitle>
          <CardSub>{where}</CardSub>
        </div>
        <Chip tone={a.active ? "water" : "neutral"}>{dueForTeacher(a.dueOn, today)}</Chip>
        <LinkButton tone="neutral" onClick={onCancel} className="task__cancel">
          {a.active ? "Снять задание" : "Убрать"}
        </LinkButton>
      </div>
      <div className="task__progress">
        <ProgressBar value={done} max={a.summary.total} label="Сделали" valueText={`${done} из ${a.summary.total}`} showValue />
      </div>
      {a.summary.total === 0 ? (
        <p className="tt-muted">В классе пока нет учеников.</p>
      ) : (
        <div className={GROUPS.filter((g) => a.seats.some((s) => g.statuses.includes(s.status))).length > 2 ? "task__groups task__groups--many" : "task__groups"}>
          {GROUPS.map((g) => {
            const seats = a.seats.filter((s) => g.statuses.includes(s.status));
            if (seats.length === 0) return null;
            return (
              <div key={g.key} className="task__group" data-tone={g.tone}>
                <h3 className="task__group-title">
                  {g.title} · {seats.length}
                </h3>
                <ul className="seat-chips" aria-label={`${g.title}: ${seats.length} ${studentsWord(seats.length)}`}>
                  {seats.map((s) => (
                    <li key={s.seatNumber}>
                      <Link href={`/teacher/classes/${classId}/seats/${s.seatNumber}`} className={`seat-chip seat-chip--${g.tone}`}>
                        <b>{seatLabel(s.seatNumber)}</b> {nicknames.get(s.seatNumber) ?? "ник не выбран"}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
