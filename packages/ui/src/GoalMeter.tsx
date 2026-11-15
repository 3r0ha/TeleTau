"use client";

import { useId } from "react";
import { hexPath } from "./hex";
import { fillUi } from "./strings";
import { useUiStrings } from "./UiStrings";

export interface GoalMeterProps {
  done: number;
  target: number;
  /** Цель только что выполнена — сота «запечатывается» с коротким прыжком. */
  celebrate?: boolean;
  /** Подпись под числом (по умолчанию — «сот»). */
  unit?: string;
  className?: string;
}

const W = 30;
const H = 26;

/**
 * Цель дня (prototype .goal): сота наполняется мёдом по доле выполненного, рядом — «1 из 2 сот». Выполнено —
 * сота полная и с галочкой-штампом. Для читалки — одна фраза «Цель дня: 1 из 2».
 */
export function GoalMeter({ done, target, celebrate, unit, className }: GoalMeterProps) {
  const s = useUiStrings();
  const clip = `goal-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const shown = Math.min(done, target);
  const share = target > 0 ? shown / target : 0;
  const met = target > 0 && done >= target;
  const fillH = H * share;
  return (
    <p className={["tt-goal", met && "tt-goal--met", celebrate && "tt-goal--celebrate", className].filter(Boolean).join(" ")}>
      <span className="tt-visually-hidden">{fillUi(met ? s.goalLabelMet : s.goalLabel, { done: shown, target })}</span>
      <svg className="tt-goal__hex" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden focusable="false">
        <defs>
          <clipPath id={clip}>
            <path d={hexPath(W, H, 5)} />
          </clipPath>
        </defs>
        <path className="tt-goal__empty" d={hexPath(W, H, 5)} />
        {fillH > 0 ? <rect className="tt-goal__fill" x={0} y={H - fillH} width={W} height={fillH} clipPath={`url(#${clip})`} /> : null}
        <path className="tt-goal__rim" d={hexPath(W - 4, H - 4, 4, 2, 2)} />
        {met ? <path className="tt-goal__check" d="M9.5 13.5l4 4 7-8" /> : null}
      </svg>
      <span className="tt-goal__text" aria-hidden>
        {fillUi(s.goalOf, { done: shown, target })}
        <br />
        {unit ?? s.goalUnit}
      </span>
    </p>
  );
}
