"use client";

import { useState } from "react";
import { CaretDown, ListBullets, MapPin, Trophy } from "@phosphor-icons/react/ssr";
import { Card, CardTitle, Chip, Illustration, ProgressBar } from "@teletau/ui";
import { placeArt } from "../../../../_components/learn/places";
import { LessonPreviewDialog, type PreviewTarget } from "../../../LessonPreview";
import { currentPlaceIndex, lessonsWord, placeGroups, type ClassProgress, type LessonCompletion, type PlaceGroup } from "./model";


/**
 * «Прохождение уроков» по местам тропы (Өфө, Шүлгәнташ, …): у места — картинка, название, сколько пройдено классом.
 * Место, где класс сейчас, развёрнуто; остальные свёрнуты и открываются по нажатию. На печати развёрнуты все (teacher.css).
 * «Что в уроке» у урока открывает лист со словами, фразами и заданиями (LessonPreview.tsx).
 */
export function PlacesCard({ progress, students }: { progress: ClassProgress; students: number }) {
  const groups = placeGroups(progress, students);
  const current = currentPlaceIndex(groups, students);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(groups[current] ? [groups[current].key] : []));
  const [peek, setPeek] = useState<PreviewTarget | null>(null);
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Card as="section" className="tab-card places-card" aria-labelledby="lessons-title">
      <CardTitle id="lessons-title">Прохождение уроков</CardTitle>
      {groups.length ? (
        <ul className="places">
          {groups.map((g, i) => (
            <Place
              key={g.key}
              group={g}
              students={students}
              current={i === current}
              open={open.has(g.key) || groups.length === 1}
              onToggle={groups.length > 1 ? () => toggle(g.key) : undefined}
              onPeek={setPeek}
            />
          ))}
        </ul>
      ) : (
        <p className="tt-muted">Уроков пока нет.</p>
      )}
      <LessonPreviewDialog lesson={peek} onClose={() => setPeek(null)} />
    </Card>
  );
}

function Place({
  group,
  students,
  current,
  open,
  onToggle,
  onPeek,
}: {
  group: PlaceGroup;
  students: number;
  current: boolean;
  open: boolean;
  onToggle?: () => void;
  onPeek: (p: PreviewTarget) => void;
}) {
  const { unit, lessons } = group;
  const pct = Math.round(group.share * 100);
  const listId = `place-${group.key}`;
  const lessonList = (
    <ol className="lesson-done place__lessons" id={listId} hidden={!open}>
      {lessons.map((l) => (
        <LessonRow key={l.lessonId} lesson={l} students={students} placeRu={unit?.place.titleRu} onPeek={onPeek} />
      ))}
    </ol>
  );
  // Уроки без места (старый ответ API) — просто список.
  if (!unit) return <li className="place place--plain">{lessonList}</li>;

  const hero = placeArt(unit.place.slug).hero;
  const sub = [unit.place.titleBa ? unit.place.titleRu : null, unit.topicRu, `${lessons.length} ${lessonsWord(lessons.length)}`].filter(Boolean).join(" · ");
  const head = (
    <>
      <span className="place__thumb" aria-hidden>
        {hero ? <Illustration name={hero} width={88} /> : <MapPin weight="fill" />}
      </span>
      <span className="place__names">
        <span className="place__title">
          {unit.place.titleBa ? <span lang="ba">{unit.place.titleBa.text}</span> : unit.place.titleRu}
          {current ? (
            <Chip tone="green" className="place__now">
              Класс здесь
            </Chip>
          ) : null}
        </span>
        <span className="place__sub">{sub}</span>
        <span className="tt-progress place__bar" aria-hidden>
          <span className="tt-progress__track">
            <svg className="tt-progress__fill" width={`${pct}%`} height="100%" focusable="false">
              <rect className="tt-progress__shine" x={8} y={3} width="100%" height={3} rx={1.5} />
            </svg>
          </span>
        </span>
      </span>
      <span className="place__share">
        {pct}%<span className="tt-visually-hidden"> пройдено классом</span>
      </span>
      {onToggle ? <CaretDown weight="bold" className="place__caret" aria-hidden /> : null}
    </>
  );

  return (
    <li className="place" data-open={open || undefined} data-current={current || undefined}>
      <h3 className="place__heading">
        {onToggle ? (
          <button type="button" className="place__head" aria-expanded={open} aria-controls={listId} onClick={onToggle}>
            {head}
          </button>
        ) : (
          <span className="place__head">{head}</span>
        )}
      </h3>
      {lessonList}
    </li>
  );
}

function LessonRow({ lesson: l, students, placeRu, onPeek }: { lesson: LessonCompletion; students: number; placeRu?: string; onPeek: (p: PreviewTarget) => void }) {
  const test = l.kind === "place_test";
  const name = test && placeRu ? `Испытание места «${placeRu}»` : `Урок «${l.titleRu}»`;
  const peek = test ? "Что внутри" : "Что в уроке";
  const done = `Прошли ${l.completedSeats} из ${students}`;
  return (
    <li className="lesson-done__item" data-kind={l.kind}>
      <span className="lesson-done__head">
        <span className="lesson-done__title">
          {test ? <Trophy weight="fill" aria-hidden className="lesson-done__icon" /> : null}
          {l.titleRu}
        </span>
        <button
          type="button"
          className="lesson-done__peek no-print"
          aria-haspopup="dialog"
          aria-label={test && placeRu ? `Что внутри: испытание места «${placeRu}»` : `${peek} «${l.titleRu}»`}
          onClick={() => onPeek({ lessonId: l.lessonId, titleRu: test && placeRu ? `Испытание места «${placeRu}»` : l.titleRu, sub: [placeRu, done].filter(Boolean).join(" · ") })}
        >
          <ListBullets weight="bold" aria-hidden />
          <span aria-hidden>{peek}</span>
        </button>
      </span>
      <ProgressBar
        value={Math.min(l.completedSeats, students)}
        max={students}
        label={name}
        valueText={`${l.completedSeats} из ${students}`}
        showValue
      />
    </li>
  );
}
