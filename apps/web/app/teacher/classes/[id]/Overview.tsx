"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Cards, Check, CheckCircle, ClipboardText, DownloadSimple, ProjectorScreen, Sun, Warning } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";
import { Button, ButtonLink, Chip, Illustration, LinkButton, Skeleton } from "@teletau/ui";
import { cardsWord, seatRange, time, type PrintJob } from "./format";
import { IDLE_SHOWN, behindHref, classToday, studentsWord, type StudentRow } from "./progress/model";
import { IdleChips, PulseRetry, TaskList, TodayAvatars, ofStudents, singleTaskDone } from "../../ClassPulse";
import { fillNodes, useT } from "../../../../i18n/client";

export { RequestsBanner } from "../../ClassPulse";

type Assignment = Schema<"ClassAssignment">;

const AVATARS_SHOWN = 8;

/** Счётчик заявок на кнопке: число для глаз, «новых: N» — для читалки. */
export function RequestsBadge({ count }: { count: number }) {
  const t = useT();
  return count ? (
    <Chip tone="solid" aria-label={t("новых: {n}", { n: count })}>
      {count}
    </Chip>
  ) : null;
}

/**
 * Первый урок нового класса (пока в нём нет учеников): три шага с действием у каждого — класс создан, карточки,
 * код на доске. Шаг сделан — галочка и что получилось; следующий шаг — главная кнопка. Заявки на вход — баннером
 * над шагами (RequestsBanner), когда они есть.
 */
export function SetupSteps({
  seatsCount,
  seatNumbers,
  job,
  downloading,
  onIssue,
  onDownload,
  onBoard,
}: {
  seatsCount: number;
  seatNumbers: number[];
  job: PrintJob | null;
  downloading: boolean;
  onIssue: () => void;
  onDownload: () => void;
  onBoard: () => void;
}) {
  const t = useT();
  const cardsDone = seatsCount > 0 || Boolean(job);
  const issued = job?.seatNumbers ?? seatNumbers;
  return (
    <section className="tt-card setup" aria-labelledby="setup-title">
      <div className="setup__main">
        <h2 id="setup-title" className="tt-title2">
          {t("Первый урок")}
        </h2>
        <ol className="steps">
          <Step n={1} state="done" title={t("Класс создан")} />
          <Step
            n={2}
            state={cardsDone ? "done" : "current"}
            title={cardsDone ? t("Выпущено {n} {word}", { n: issued.length, word: cardsWord(issued.length, t) }) : t("Выпустите карточки")}
            actions={
              cardsDone ? (
                <>
                  {job ? (
                    <Button small icon={<DownloadSimple weight="bold" />} loading={downloading} onClick={onDownload}>
                      {t("Скачать PDF")}
                    </Button>
                  ) : null}
                  <LinkButton icon={<Cards weight="fill" aria-hidden />} onClick={onIssue}>
                    {t("Выпустить ещё")}
                  </LinkButton>
                </>
              ) : (
                <Button icon={<Cards weight="fill" />} onClick={onIssue}>
                  {t("Выпустить карточки")}
                </Button>
              )
            }
          >
            {job
              ? t("{seats}. PDF доступен до {time}.", { seats: seatRange(job.seatNumbers), time: time(job.expiresAt) })
              : cardsDone
                ? t("{seats}. Раздайте их на уроке.", { seats: seatRange(issued) })
                : t("По одной на ученика. Распечатайте и подпишите имена.")}
          </Step>
          <Step
            n={3}
            state={cardsDone ? "current" : "todo"}
            title={t("Покажите код на доске")}
            actions={
              <Button variant={cardsDone ? "primary" : "secondary"} icon={<ProjectorScreen weight="fill" />} onClick={onBoard}>
                {t("Показать код класса")}
              </Button>
            }
          >
            {t("Ученики войдут по карточке или по коду с доски.")}
          </Step>
        </ol>
      </div>
      <Illustration name="beeTeacher" width={240} className="setup__art" />
    </section>
  );
}

function Step({ n, state, title, children, actions }: { n: number; state: "done" | "current" | "todo"; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  const t = useT();
  return (
    <li className="step" data-state={state}>
      <span className="step__mark" aria-hidden>
        {state === "done" ? <Check weight="bold" /> : n}
      </span>
      <div className="step__body">
        <h3 className="step__title">
          <span className="tt-visually-hidden">{state === "done" ? t("Готово:") : t("Шаг {n}:", { n })}{" "}</span>
          {title}
        </h3>
        {children ? <p className="step__text">{children}</p> : null}
        {actions ? <div className="step__actions">{actions}</div> : null}
      </div>
    </li>
  );
}

/**
 * Главное о классе сверху: кто занимался сегодня, кто на этой неделе ещё не открывал уроки и как идёт задание.
 * Числа вместо фраз: «6 из 12», «2 ученика», полоса «7 из 12».
 * Строки учеников — без ПДн: номер места и ник (правило 5).
 */
export function TodayCards({
  classId,
  rows,
  today,
  tasks,
  progressError,
  tasksError,
  onRetry,
}: {
  classId: string;
  rows: StudentRow[] | null;
  today: string;
  tasks: { active: Assignment[] } | null;
  progressError: boolean;
  /** Задания не загрузились: вместо вечного скелетона — повтор. */
  tasksError: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  const split = rows ? classToday(rows, today) : null;
  const single = singleTaskDone(tasks?.active ?? null);
  return (
    <div className="today" role="group" aria-label={t("Сводка класса")}>
      <section className="tt-card today-card" aria-labelledby="today-title">
        <header className="today-card__head">
          <span className="today-card__icon today-card__icon--today" aria-hidden>
            <Sun weight="fill" />
          </span>
          <h2 id="today-title" className="today-card__title">
            {t("Занимались сегодня")}
          </h2>
        </header>
        {!split ? (
          progressError ? (
            <PulseRetry onRetry={onRetry} />
          ) : (
            <Skeleton height={72} />
          )
        ) : (
          <>
            <p className="today-card__big">
              {fillNodes(t("{done} из {total}"), { done: <b>{split.today.length}</b>, total: rows!.length })}
              <span className="today-card__unit"> {ofStudents(rows!.length, t)}</span>
            </p>
            <TodayAvatars classId={classId} rows={split.today} shown={AVATARS_SHOWN} />
          </>
        )}
        <Link href={`/teacher/classes/${classId}/progress`} className="today-card__more">
          {t("Прогресс класса")} <ArrowRight weight="bold" aria-hidden />
        </Link>
      </section>

      <section className="tt-card today-card" aria-labelledby="task-title">
        <header className="today-card__head">
          <span className="today-card__icon today-card__icon--task" aria-hidden>
            <ClipboardText weight="fill" />
          </span>
          <h2 id="task-title" className="today-card__title">
            {tasks && tasks.active.length > 1 ? t("Задания") : t("Задание")}
          </h2>
        </header>
        {!tasks ? (
          tasksError ? (
            <PulseRetry onRetry={onRetry} />
          ) : (
            <Skeleton height={72} />
          )
        ) : tasks.active.length === 0 ? (
          <div className="tt-stack tt-stack--tight today-card__fill">
            <p className="tt-muted">{t("Заданий нет.")}</p>
            <ButtonLink href={`/teacher/classes/${classId}/assignments?new=1`} variant="secondary" small>
              {t("Дать задание")}
            </ButtonLink>
          </div>
        ) : (
          <>
            {single ? (
              <p className="today-card__big">
                {fillNodes(t("{done} из {total}"), { done: <b>{single.done}</b>, total: single.total })}
                <span className="today-card__unit"> {t("сделали")}</span>
              </p>
            ) : null}
            <TaskList classId={classId} active={tasks.active} today={today} />
          </>
        )}
        <Link href={`/teacher/classes/${classId}/assignments`} className="today-card__more">
          {t("Все задания")} <ArrowRight weight="bold" aria-hidden />
        </Link>
      </section>

      <section className="tt-card today-card" aria-labelledby="idle-title" data-tone={split?.idle.length ? "attention" : undefined}>
        <header className="today-card__head">
          <span className={`today-card__icon today-card__icon--${split?.idle.length ? "idle" : "ok"}`} aria-hidden>
            {split && !split.idle.length ? <CheckCircle weight="fill" /> : <Warning weight="fill" />}
          </span>
          <h2 id="idle-title" className="today-card__title">
            {t("Не занимались на неделе")}
          </h2>
        </header>
        {!split ? (
          progressError ? (
            <PulseRetry onRetry={onRetry} />
          ) : (
            <Skeleton height={72} />
          )
        ) : split.idle.length ? (
          <>
            <p className="today-card__big">
              <b>{split.idle.length}</b>
              <span className="today-card__unit"> {studentsWord(split.idle.length, t)}</span>
            </p>
            <IdleChips classId={classId} rows={split.idle} shown={IDLE_SHOWN} />
            <Link href={behindHref(classId)} className="today-card__more">
              {split.idle.length > IDLE_SHOWN
                ? t("Ещё {n} {word}", { n: split.idle.length - IDLE_SHOWN, word: studentsWord(split.idle.length - IDLE_SHOWN, t) })
                : t("Кто отстаёт")}{" "}
              <ArrowRight weight="bold" aria-hidden />
            </Link>
          </>
        ) : (
          <p className="today-card__ok">{t("Все занимались.")}</p>
        )}
      </section>
    </div>
  );
}
