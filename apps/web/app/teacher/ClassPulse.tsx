"use client";

// Части сводки класса, общие для главной кабинета (ClassBoard) и страницы класса (Overview): кто занимался сегодня,
// задания с выполнением, кто не занимался на неделе, заявки на вход. Строки учеников — номер места и ник, без ПДн.
import Link from "next/link";
import { BellRinging } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";
import { Button, ButtonLink, HexAvatar, LinkButton, ProgressBar, avatarFor, toneFor } from "@teletau/ui";
import { useT } from "../../i18n/client";
import type { T } from "../../i18n/core";
import { assignmentTitle, dueForTeacher } from "../_components/assignments";
import { seatLabel } from "./classes/[id]/format";
import { studentsWord, type StudentRow } from "./classes/[id]/progress/model";

type Assignment = Schema<"ClassAssignment">;

/** «из 1 ученика», «из 21 ученика», «из 22 учеников». */
export const ofStudents = (n: number, t: T) => (n % 10 === 1 && n % 100 !== 11 ? t("ученика") : t("учеников"));

const nick = (r: StudentRow, t: T) => r.nickname ?? t("ник не выбран");
const seatHref = (classId: string, n: number) => `/teacher/classes/${classId}/seats/${n}`;

/** Блок сводки не загрузился — строка с повтором. */
export function PulseRetry({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <p className="tt-muted">
      {t("Не получилось загрузить.")} <LinkButton onClick={onRetry}>{t("Попробовать ещё раз")}</LinkButton>
    </p>
  );
}

/** Занимались сегодня: соты с номерами мест, лишние — «+N». */
export function TodayAvatars({ classId, rows, shown }: { classId: string; rows: StudentRow[]; shown: number }) {
  const t = useT();
  if (!rows.length) return <p className="tt-muted">{t("Пока никто.")}</p>;
  return (
    <ul className="avatars" aria-label={t("Занимались сегодня")}>
      {rows.slice(0, shown).map((r) => {
        const label = t("{seat} · {nick}", { seat: seatLabel(r.seatNumber), nick: nick(r, t) });
        return (
          <li key={r.seatNumber}>
            <Link href={seatHref(classId, r.seatNumber)} className="avatars__item" title={label}>
              <HexAvatar size={40} tone={toneFor(r.toneKey)} art={avatarFor(r.nickname)} lip label={label}>
                {String(r.seatNumber).padStart(2, "0")}
              </HexAvatar>
            </Link>
          </li>
        );
      })}
      {rows.length > shown ? <li className="avatars__more">+{rows.length - shown}</li> : null}
    </ul>
  );
}

/** Активные задания: название, срок и полоса «сделали»; число на полосе — когда заданий несколько. */
export function TaskList({ classId, active, today, linked }: { classId: string; active: Assignment[]; today: string; linked?: boolean }) {
  const t = useT();
  return (
    <ul className="today-tasks">
      {active.map((a) => {
        const done = a.summary.done + a.summary.late;
        const title = assignmentTitle(a, t);
        return (
          <li key={a.id} className="today-task">
            <p className="today-task__title">
              {linked ? (
                <Link href={`/teacher/classes/${classId}/assignments`} className="pulse__link">
                  {title}
                </Link>
              ) : (
                <b>{title}</b>
              )}
              <span className="tt-muted">{dueForTeacher(a.dueOn, today, t)}</span>
            </p>
            <ProgressBar value={done} max={a.summary.total} label={t("Сделали: {title}", { title })} valueText={t("{done} из {total}", { done, total: a.summary.total })} showValue={active.length > 1} />
          </li>
        );
      })}
    </ul>
  );
}

/** Сделали единственное задание: «9 из 22 сделали» — крупно, как «Занимались сегодня». */
export function singleTaskDone(active: Assignment[] | null): { done: number; total: number } | null {
  const single = active?.length === 1 ? active[0]! : null;
  return single ? { done: single.summary.done + single.summary.late, total: single.summary.total } : null;
}

/** Не занимались на неделе: чипы мест; в узкой карточке — ещё чип «ещё N» (moreHref). */
export function IdleChips({ classId, rows, shown, moreHref }: { classId: string; rows: StudentRow[]; shown: number; moreHref?: string }) {
  const t = useT();
  const rest = rows.length - shown;
  return (
    <ul className="seat-chips seat-chips--compact" aria-label={t("Не занимались на этой неделе: {n}", { n: rows.length })}>
      {rows.slice(0, shown).map((r) => (
        <li key={r.seatNumber}>
          <Link href={seatHref(classId, r.seatNumber)} className="seat-chip seat-chip--overdue">
            <b>{seatLabel(r.seatNumber)}</b> {nick(r, t)}
          </Link>
        </li>
      ))}
      {moreHref && rest > 0 ? (
        <li>
          <Link href={moreHref} className="seat-chip seat-chip--more">
            {t("ещё")} {rest}
          </Link>
        </li>
      ) : null}
    </ul>
  );
}

/**
 * Новые заявки на вход по коду класса — с никами: кого подтвердить. «Посмотреть» открывает лист заявок: на странице
 * класса — сразу (onOpen), с главной — переходом на класс (href).
 */
export function RequestsBanner({ count, names, onOpen, href, className }: { count: number; names: string[]; onOpen?: () => void; href?: string; className?: string }) {
  const t = useT();
  if (!count) return null;
  return (
    <div className={["requests-banner", className].filter(Boolean).join(" ")} role="status">
      <span className="requests-banner__icon" aria-hidden>
        <BellRinging weight="fill" />
      </span>
      <p className="requests-banner__text">
        <b>
          {count === 1
            ? t("{count} {word} ждёт подтверждения", { count, word: studentsWord(count, t) })
            : t("{count} {word} ждут подтверждения", { count, word: studentsWord(count, t) })}
        </b>
        {names.length ? <span className="requests-banner__names">{names.join(", ")}</span> : null}
      </p>
      {href ? (
        <ButtonLink href={href} small>
          {t("Посмотреть")}
        </ButtonLink>
      ) : (
        <Button small onClick={onOpen}>
          {t("Посмотреть")}
        </Button>
      )}
    </div>
  );
}
