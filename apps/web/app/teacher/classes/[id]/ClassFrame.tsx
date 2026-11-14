"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ChartBar, ClipboardText, House } from "@phosphor-icons/react/ssr";
import { ButtonLink, EmptyState, HexAvatar, toneFor } from "@teletau/ui";
import { ClassTitle } from "../../../_components/screens";
import { useT } from "../../../../i18n/client";
import { programLabels } from "../../CreateClassDialog";
import { placesWord, studentsWord } from "./progress/model";
import type { ClassDetail } from "./format";

/** «← Мои классы» над заголовком класса. */
export function BackToClasses() {
  const t = useT();
  return (
    <Link href="/teacher" className="tt-link-btn tt-link-btn--neutral class-page__back no-print">
      <ArrowLeft weight="bold" aria-hidden /> {t("Мои классы")}
    </Link>
  );
}

/**
 * Заголовок страницы класса: сота с номером класса, название, школа, программа и сколько учеников.
 * Справа — действия раздела (код на доску, отчёт, «Дать задание»): рядом с тем, к чему они относятся.
 */
export function ClassHeader({ c, actions }: { c: ClassDetail; actions?: ReactNode }) {
  const t = useT();
  const seats = c.seats ?? [];
  const students = seats.filter((s) => s.student).length;
  return (
    <header className="class-head">
      <HexAvatar size={64} tone={toneFor(c.id)} lip>
        {c.grade}
      </HexAvatar>
      <div className="class-head__titles">
        <h1 className="tt-title1">
          <ClassTitle title={c.title} />
        </h1>
        <p className="class-head__meta">
          <span>{c.school.shortNameRu}</span>
          <span>{programLabels(t)[c.program]}</span>
          {/* Новый класс без мест — без «0 учеников · 0 мест»: что делать дальше, говорят шаги ниже. */}
          {seats.length ? (
            <span className="class-head__count">
              {students} {studentsWord(students, t)} · {seats.length} {placesWord(seats.length, t)}
            </span>
          ) : null}
        </p>
      </div>
      {actions ? <div className="class-head__actions no-print">{actions}</div> : null}
    </header>
  );
}

export type ClassTab = "seats" | "progress" | "assignments";

/** Разделы класса: «Обзор» (сегодня, места, карточки, код), «Прогресс» и «Задания». У каждого раздела свой адрес. */
export function ClassTabs({ id, current }: { id: string; current: ClassTab }) {
  const t = useT();
  const tabs: { key: ClassTab; href: string; label: string; icon: ReactNode }[] = [
    { key: "seats", href: `/teacher/classes/${id}`, label: t("Обзор"), icon: <House weight="fill" aria-hidden /> },
    { key: "progress", href: `/teacher/classes/${id}/progress`, label: t("Прогресс"), icon: <ChartBar weight="fill" aria-hidden /> },
    { key: "assignments", href: `/teacher/classes/${id}/assignments`, label: t("Задания"), icon: <ClipboardText weight="fill" aria-hidden /> },
  ];
  return (
    <nav aria-label={t("Разделы класса")} className="no-print">
      <ul className="class-tabs">
        {tabs.map((tab) => (
          <li key={tab.key}>
            <Link href={tab.href} className="class-tabs__tab" aria-current={tab.key === current ? "page" : undefined}>
              {tab.icon}
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Класс не найден (битая ссылка, удалён) или чужой (403) — ведём к своим классам. */
export function ClassUnavailable({ forbidden }: { forbidden: boolean }) {
  const t = useT();
  return (
    <EmptyState
      art="beeSympathy"
      title={forbidden ? t("Нет доступа") : t("Класс не найден")}
      role="alert"
      actions={
        <ButtonLink href="/teacher" block>
          {t("К моим классам")}
        </ButtonLink>
      }
    >
      {forbidden ? t("Этот класс ведёт другой учитель.") : t("Ссылка устарела или класс удалён.")}
    </EmptyState>
  );
}
