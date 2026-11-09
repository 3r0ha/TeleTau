"use client";

import { useState } from "react";
import { CaretDown, CaretUp, FileText } from "@phosphor-icons/react/ssr";
import { Chip, HexAvatar, LinkButton, avatarFor, toneFor } from "@teletau/ui";
import { seatLabel, seatNo, seatRanges, type Seat } from "./format";
import { activityOf, studentSummary, type SeatProgress } from "./progress/model";

/** Действующая карточка — обычное состояние: без метки (для читалок — текстом); отклонения — метками. */
const CARD: Record<Seat["cardStatus"], { text: string; tone?: "neutral" | "coral" }> = {
  active: { text: "карточка действует" },
  none: { text: "Без карточки", tone: "neutral" },
  revoked: { text: "Карточка отозвана", tone: "coral" },
};

/** Столько свободных мест ещё показываем плитками; больше — одной строкой номеров («Показать все» — плитками). */
const FEW_FREE = 4;

/**
 * Места класса плитками-сотами: аватар ника с номером места, ник и чем ученик занят — «3 урока · сегодня»; кто на этой
 * неделе не открывал уроки — отмечен. Отклонения (карточка отозвана, вход по коду, согласие отозвано) — метками текстом;
 * бумажное согласие родителя — значком документа (для читалок — текстом), без метки на каждой плитке.
 * Свободные места (карточка выпущена, ученика ещё нет) — одной строкой маленьких номеров: каждый номер открывает лист места.
 */
export function SeatGrid({
  seats,
  fresh,
  onOpen,
  progress,
  today,
}: {
  seats: Seat[];
  fresh: Set<number>;
  onOpen: (n: number) => void;
  /** Прогресс по номерам мест (getClassProgress); пока не загружен — только ники. */
  progress?: ReadonlyMap<number, SeatProgress>;
  today: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const free = seats.filter((s) => !s.student);
  const collapsible = free.length > FEW_FREE;
  const tiles = collapsible && !showAll ? seats.filter((s) => s.student) : seats;
  return (
    <div className="tt-stack">
      {tiles.length ? (
        <ul className="seat-grid" aria-label="Места класса">
      {tiles.map((s) => {
        const card = CARD[s.cardStatus];
        const nick = s.student ? (s.student.nickname ?? "Ник ещё не выбран") : null;
        const p = progress?.get(s.number) ?? null;
        const activity = s.student && progress ? activityOf(p, today) : null;
        const consent = s.consent?.status;
        return (
          <li key={s.number}>
            <button
              type="button"
              className="seat"
              data-fresh={fresh.has(s.number) || undefined}
              data-empty={!s.student || undefined}
              data-activity={activity ?? undefined}
              onClick={() => onOpen(s.number)}
            >
              <HexAvatar size={48} tone={s.student ? toneFor(s.student.accountId) : "empty"} lip={Boolean(s.student)} art={avatarFor(s.student?.nickname)}>
                {seatNo(s.number)}
              </HexAvatar>
              <span className="seat__body">
                <span className="seat__name">
                  <span className="tt-visually-hidden">Место {seatLabel(s.number)}: </span>
                  {nick ?? "Ждёт ученика"}
                  {fresh.has(s.number) ? (
                    <>
                      {" "}
                      <Chip tone="solid">новый</Chip>
                    </>
                  ) : null}
                </span>
                {activity ? (
                  <span className="seat__activity">
                    <span className="seat__dot" aria-hidden />
                    {activity === "idle" ? "нет уроков на неделе" : studentSummary(p, today)}
                  </span>
                ) : null}
                {card.tone || consent === "revoked" ? (
                  <span className="seat__chips">
                    {card.tone ? <Chip tone={card.tone}>{card.text}</Chip> : null}
                    {consent === "revoked" ? <Chip tone="coral">Согласие отозвано</Chip> : null}
                  </span>
                ) : null}
                <span className="tt-visually-hidden">
                  {card.tone ? "" : `, ${card.text}`}
                  {consent === "given" ? ", Согласие есть" : consent === "revoked" ? "" : ", Нет согласия"}
                </span>
              </span>
              {consent === "given" ? (
                <span className="seat__consent" aria-hidden title="Согласие родителя есть">
                  <FileText weight="fill" />
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
        </ul>
      ) : null}
      {collapsible && !showAll ? (
        <div className="free-seats">
          <p className="free-seats__title">
            <b>Свободные места: {seatRanges(free.map((s) => s.number))}</b>
          </p>
          <ul className="free-seats__list" aria-label="Свободные места">
            {free.map((s) => (
              <li key={s.number}>
                <button type="button" className="seat-mini" data-alert={s.cardStatus === "revoked" || s.consent?.status === "revoked" || undefined} onClick={() => onOpen(s.number)}>
                  <span className="tt-visually-hidden">
                    Место {seatLabel(s.number)}: Ждёт ученика, {CARD[s.cardStatus].text}
                    {s.consent?.status === "given" ? ", Согласие есть" : s.consent?.status === "revoked" ? ", Согласие отозвано" : ", Нет согласия"}
                  </span>
                  <span aria-hidden>{seatNo(s.number)}</span>
                </button>
              </li>
            ))}
          </ul>
          <LinkButton icon={<CaretDown weight="bold" aria-hidden />} onClick={() => setShowAll(true)} className="free-seats__toggle">
            Показать все
          </LinkButton>
        </div>
      ) : collapsible ? (
        <LinkButton icon={<CaretUp weight="bold" aria-hidden />} onClick={() => setShowAll(false)} className="free-seats__toggle">
          Свернуть
        </LinkButton>
      ) : null}
    </div>
  );
}
