import { useId } from "react";
import type { StaticImageData } from "next/image";
import { hexPath } from "./hex";

export type HexTone = "honey" | "green" | "water" | "coral" | "violet" | "locked" | "empty";

/** Цвета аватаров по кругу (prototype AVA): соседние места различаются. */
export const HEX_TONES: readonly HexTone[] = ["honey", "green", "water", "violet", "coral"];

const hash = (key: string | number) => {
  const s = String(key);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

/** Стабильный цвет по строке (ник, номер места) — один и тот же ученик всегда одного цвета. */
export function toneFor(key: string | number): HexTone {
  return HEX_TONES[hash(key) % HEX_TONES.length]!;
}


export interface HexAvatarProps {
  /** Ширина шестиугольника в px; высота — 7/8 ширины. */
  size?: number;
  tone?: HexTone;
  /** «Губа» снизу (для крупных аватаров и узлов). */
  lip?: boolean;
  /** Кольцо мёда вокруг (текущий, выбранный). */
  ring?: boolean;
  /** Глубокий оттенок тона (цвет «губы») — второй ряд палитры аватаров. */
  deep?: boolean;
  /** Подпись для читалок. Без неё аватар декоративный (aria-hidden). */
  label?: string;
  /** Номер места или инициал — текст по центру ячейки (без аватара). */
  children?: string | number;
  /**
   * Аватар ника (avatarFor): персонаж в шестиугольной рамке тона — светлая подложка тона, рамка и «губа».
   * Номер места при этом переходит в плашку снизу (badge).
   */
  art?: StaticImageData;
  /** Плашка снизу по центру — номер места поверх аватара. */
  badge?: string | number;
}

/**
 * Шестиугольный аватар-ячейка (prototype avaHex / узлы тропы): скруглённый шестиугольник с плоским верхом.
 * На ярких заливках — тёмный текст (text.onFill), на фиолетовой — белый. Всё — внутри SVG (размеры — атрибутами, без style:
 * строгая CSP не пропускает атрибуты style).
 */
export function HexAvatar({ size = 44, tone = "honey", lip, ring, deep, label, children, art, badge }: HexAvatarProps) {
  const raw = useId();
  if (art) return <ArtAvatar size={size} tone={tone} lip={lip} label={label} art={art} badge={badge ?? children} clip={`hexava-${raw.replace(/[^a-zA-Z0-9]/g, "")}`} />;
  const w = size;
  const h = Math.round(size * 0.875);
  const r = Math.max(3, size * 0.12);
  const lipH = lip ? Math.max(3, Math.round(size * 0.08)) : 0;
  const ringW = ring ? Math.max(3, Math.round(size * 0.06)) : 0;
  const pad = ringW ? ringW + 2 : 0;
  const vw = w + pad * 2;
  const vh = h + lipH + pad * 2;
  return (
    <span className={`tt-hex tt-hex--${tone}${deep ? " tt-hex--deep" : ""}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg width={vw} height={vh} viewBox={`0 0 ${vw} ${vh}`} aria-hidden focusable="false">
        {ring ? (
          <path className="tt-hex__ring" d={hexPath(w + pad * 2 - ringW, h + pad * 2 - ringW, r + 3, ringW / 2, ringW / 2)} strokeWidth={ringW} />
        ) : null}
        {lipH ? <path className="tt-hex__lip" d={hexPath(w, h, r, pad, pad + lipH)} /> : null}
        <path className="tt-hex__face" d={hexPath(w, h, r, pad, pad)} />
        {tone !== "empty" && tone !== "locked" && size >= 56 ? (
          <path
            className="tt-hex__shine"
            d={hexPath(w * 0.66, h * 0.62, r * 0.6, pad + w * 0.17, pad + h * 0.13)}
            strokeWidth={3}
            strokeDasharray={`${Math.round(w * 0.24)} 400`}
            strokeLinecap="round"
          />
        ) : null}
        {children !== undefined && children !== "" ? (
          <text className="tt-hex__text" x={pad + w / 2} y={pad + h / 2} textAnchor="middle" dominantBaseline="central" fontSize={Math.round(size * 0.36)}>
            {children}
          </text>
        ) : null}
      </svg>
    </span>
  );
}

/**
 * Аватар-персонаж в шестиугольной рамке: подложка — мягкий оттенок тона, картинка обрезана по шестиугольнику и стоит
 * «плечами» на нижней грани, сверху — рамка тона; номер места — плашкой снизу, чтобы учитель по-прежнему видел номер.
 */
function ArtAvatar({ size, tone, lip, label, art, badge, clip }: { size: number; tone: HexTone; lip?: boolean; label?: string; art: StaticImageData; badge?: string | number; clip: string }) {
  const w = size;
  const h = Math.round(size * 0.875);
  const r = Math.max(3, size * 0.12);
  const frame = Math.max(2, Math.round(size * 0.05));
  const lipH = lip ? Math.max(3, Math.round(size * 0.08)) : 0;
  const face = hexPath(w, h, r);
  const hasBadge = badge !== undefined && badge !== "";
  const bh = Math.max(15, Math.round(size * 0.36));
  const bw = Math.max(24, Math.round(size * 0.58));
  const by = h + lipH - Math.round(bh * 0.55);
  const vh = Math.max(h + lipH, hasBadge ? by + bh : 0);
  return (
    <span className={`tt-hex tt-hex--art tt-hex--${tone}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg width={w} height={vh} viewBox={`0 0 ${w} ${vh}`} aria-hidden focusable="false">
        <defs>
          <clipPath id={clip}>
            <path d={face} />
          </clipPath>
        </defs>
        {lipH ? <path className="tt-hex__lip" d={hexPath(w, h, r, 0, lipH)} /> : null}
        <path className="tt-hex__bg" d={face} />
        <image href={art.src} x={w * 0.06} y={h * 0.06} width={w * 0.88} height={h * 1.0} preserveAspectRatio="xMidYMax meet" clipPath={`url(#${clip})`} />
        <path className="tt-hex__frame" d={hexPath(w - frame, h - frame, r, frame / 2, frame / 2)} strokeWidth={frame} />
        {hasBadge ? (
          <g className="tt-hex__badge">
            <rect x={(w - bw) / 2} y={by} width={bw} height={bh} rx={bh / 2} />
            <text x={w / 2} y={by + bh / 2} textAnchor="middle" dominantBaseline="central" fontSize={Math.round(bh * 0.72)}>
              {badge}
            </text>
          </g>
        ) : null}
      </svg>
    </span>
  );
}
