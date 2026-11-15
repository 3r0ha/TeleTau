import Link from "next/link";
import type { ReactNode, Ref } from "react";
import { hexPath } from "./hex";

export type HexNodeState = "done" | "current" | "open" | "locked";
/** honey — урок и испытание, violet — «Помоги языку» (закрытые узлы — воск при любом тоне). */
export type HexNodeTone = "honey" | "violet";

// Геометрия узла тропы прототипа v2 (nodeHtml): ячейка 78×68 с «губой» 7 px, кольцо текущего узла — на 13/12 px шире.
const W = 78;
const H = 68;
const LIP = 7;
const FACE = hexPath(W, H, 13);
const LIP_PATH = hexPath(W, H, 13, 0, LIP);
const SHINE = hexPath(W - 26, H - 26, 8, 13, 9);
const RING_W = W + 26;
const RING_H = H + 24;
const RING = hexPath(W + 20, H + 18, 14, 3, 3);

export interface HexNodeProps {
  state: HexNodeState;
  tone?: HexNodeTone;
  /** Значок Phosphor (у пройденного урока — галочка). */
  icon: ReactNode;
  /** Подпись для читалок: «Урок «Привет!», пройден». */
  label: string;
  /** Доля пройденного у текущего узла (0–1) — кольцо вокруг ячейки. */
  progress?: number;
  /**
   * Переход (ссылка) или действие (кнопка). Закрытый узел с onClick — кнопка aria-disabled: урок не начинается, но экран
   * может объяснить, почему он закрыт («Сначала пройди…»). Без onClick закрытый узел — картинка.
   */
  href?: string;
  onClick?: () => void;
  /** Ячейка только что запечатана — «штамп» воска (docs/05 §9). */
  sealed?: boolean;
  ref?: Ref<HTMLElement>;
}

/**
 * Узел тропы — шестиугольная ячейка с «губой» (docs/05 §0): пройденный — мёд с галочкой, текущий — с кольцом
 * прогресса, «Помоги языку» — фиолетовый, закрытый — воск. Нажатие «утапливает» ячейку на высоту губы.
 * Всё нарисовано SVG с размерами в атрибутах — без атрибутов style (строгая CSP).
 */
export function HexNode({ state, tone = "honey", icon, label, progress = 0, href, onClick, sealed, ref }: HexNodeProps) {
  const locked = state === "locked";
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const cls = [
    "tt-node",
    `tt-node--${locked ? "locked" : tone}`,
    state === "current" && "tt-node--current",
    sealed && "tt-node--sealed",
  ]
    .filter(Boolean)
    .join(" ");
  const art = (
    <>
      {state === "current" ? (
        <svg className="tt-node__ring" width={RING_W} height={RING_H} viewBox={`0 0 ${RING_W} ${RING_H}`} aria-hidden focusable="false">
          <path className="tt-node__ring-track" d={RING} />
          {pct > 0 ? <path className="tt-node__ring-fill" d={RING} pathLength={100} strokeDasharray={`${pct} 100`} /> : null}
        </svg>
      ) : null}
      <svg className="tt-node__hex" width={W} height={H + LIP} viewBox={`0 0 ${W} ${H + LIP}`} aria-hidden focusable="false">
        <path className="tt-node__lip" d={LIP_PATH} />
        <g className="tt-node__face">
          <path className="tt-node__fill" d={FACE} />
          {locked ? null : <path className="tt-node__shine" d={SHINE} />}
        </g>
      </svg>
      <span className="tt-node__icon" aria-hidden>
        {icon}
      </span>
    </>
  );
  if (locked && onClick) {
    return (
      <button ref={ref as Ref<HTMLButtonElement>} type="button" className={cls} aria-label={label} aria-disabled="true" onClick={onClick}>
        {art}
      </button>
    );
  }
  if (locked) {
    return (
      <span ref={ref as Ref<HTMLSpanElement>} className={cls} role="img" aria-label={label}>
        {art}
      </span>
    );
  }
  if (href) {
    return (
      <Link ref={ref as Ref<HTMLAnchorElement>} href={href} className={cls} aria-label={label}>
        {art}
      </Link>
    );
  }
  return (
    <button ref={ref as Ref<HTMLButtonElement>} type="button" className={cls} aria-label={label} onClick={onClick}>
      {art}
    </button>
  );
}
