"use client";

import type { ReactNode, Ref } from "react";
import { Check, HourglassMedium, SealCheck, SealQuestion, Student, UsersThree, ChalkboardTeacher } from "@phosphor-icons/react/ssr";
import { Chip, Illustration } from "@teletau/ui";
import { GROUPS, STATUS_LABEL, barPieces, choiceLabel, letterOf, segmentsOf, statusText, votesWord, type CorpusItemVotes, type ItemStatus, type SegmentKey } from "./votes";

const STATUS_ICON: Record<ItemStatus, ReactNode> = {
  voting: <HourglassMedium weight="fill" aria-hidden />,
  accepted: <SealCheck weight="fill" aria-hidden />,
  escalated: <SealQuestion weight="fill" aria-hidden />,
};

const GROUP_ICON = {
  child: <Student weight="fill" aria-hidden />,
  adult: <UsersThree weight="fill" aria-hidden />,
  teacher: <ChalkboardTeacher weight="fill" aria-hidden />,
};

/**
 * Голоса по группам после своего голоса (docs/03 §4a): статус словами продукта, варианты с метками «В словаре» и «Так говорят дети»
 * и по каждой группе — полоса долей и счёт текстом (счёт и есть таблица: цвет не единственный носитель смысла).
 */
export function VoteResults({ votes, shown, headingRef }: { votes: CorpusItemVotes; shown: readonly [string, string]; headingRef?: Ref<HTMLHeadingElement> }) {
  const byId = new Map(votes.variants.map((v) => [v.variantId, v]));
  const ordered = shown.map((id) => byId.get(id)).filter((v): v is NonNullable<typeof v> => Boolean(v));
  const my = votes.myVote;
  return (
    <section className="tt-card votes" aria-labelledby="votes-title">
      <h2 id="votes-title" ref={headingRef} tabIndex={-1} className="votes__title tt-step-heading">
        Голоса по группам
      </h2>

      {/* Дуэль после голоса уходит — фраза остаётся перед глазами (те же стили, что в дуэли). */}
      <div className="duel__source votes__source">
        <small>По-русски</small>
        <p>{votes.sourceRu}</p>
      </div>

      <div className="votes__status" data-status={votes.status} role="status">
        {/* «Принят» — момент праздника: пчела запечатывает соту в книге словаря (scene-word-accepted). */}
        {votes.status === "accepted" ? (
          <Illustration name="sceneWordAccepted" width={88} className="votes__status-art" />
        ) : (
          <span className="votes__status-icon">{STATUS_ICON[votes.status]}</span>
        )}
        <div>
          <p className="votes__status-label">{STATUS_LABEL[votes.status]}</p>
          <p className="votes__status-text">{statusText(votes, shown)}</p>
        </div>
      </div>

      <ul className="votes__variants" aria-label="Варианты">
        {ordered.map((v) => {
          const letter = letterOf(v.variantId, shown)!;
          return (
            <li key={v.variantId} className="votes__variant" data-main={v.main || undefined}>
              <span className={`votes__mark votes__mark--${letter.toLowerCase()}`} aria-hidden>
                {letter}
              </span>
              <span className="tt-visually-hidden">Вариант {letter}: </span>
              <span className="votes__text" lang="ba">
                {v.text}
              </span>
              <span className="votes__tags">
                {v.accepted ? (
                  <Chip tone="green" icon={<Check weight="bold" aria-hidden />}>
                    В словаре
                  </Chip>
                ) : null}
                {v.tags.includes("children_prefer") ? <Chip tone="violet">Так говорят дети</Chip> : null}
                {my?.variantId === v.variantId ? <Chip tone="neutral">Ваш голос</Chip> : null}
              </span>
            </li>
          );
        })}
      </ul>
      {my && !my.variantId ? <p className="votes__mine">Ваш голос: {choiceLabel(my.choice)}</p> : null}

      <ul className="vgroups" aria-label="Голоса по группам">
        {GROUPS.map((g) => {
          const tally = votes.groups[g.key];
          const segments = segmentsOf(tally, shown);
          const pieces = barPieces(segments);
          return (
            <li key={g.key} className="vgroup">
              <p className="vgroup__head">
                <span className="vgroup__icon">{GROUP_ICON[g.key]}</span>
                <span className="vgroup__name">{g.label}</span>
                <span className="vgroup__total">
                  {tally.total} {votesWord(tally.total)}
                </span>
              </p>
              <svg className="vgroup__bar" width="100%" height={14} aria-hidden focusable="false">
                <rect className="vgroup__track" x={0} y={0} width="100%" height={14} rx={7} />
                {pieces.map((p) => (
                  <rect key={p.key} className={`vgroup__seg vgroup__seg--${p.key}`} x={`${p.x}%`} y={0} width={`${p.width}%`} height={14} rx={4}>
                    <title>{`${segments.find((s) => s.key === p.key)!.long}: ${p.count}`}</title>
                  </rect>
                ))}
              </svg>
              {tally.total ? (
                <p className="vgroup__counts">
                  {segments.map((s) => (
                    <span key={s.key} className="vgroup__count">
                      <Swatch k={s.key} />
                      <span className="tt-visually-hidden">{s.long}: </span>
                      <span aria-hidden>{s.label}</span> <b>{s.count}</b>
                    </span>
                  ))}
                </p>
              ) : (
                <p className="vgroup__counts vgroup__counts--empty">Пока никто не голосовал</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Swatch({ k }: { k: SegmentKey }) {
  return <span className={`vgroup__swatch vgroup__swatch--${k}`} aria-hidden />;
}
