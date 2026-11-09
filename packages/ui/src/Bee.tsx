"use client";

import { useEffect, useRef } from "react";
import { beeFrames, illustrations, type IllustrationName } from "./illustrations";
import { motionMs, useReducedMotion } from "./motion";

/**
 * Кадры пчелы: основной и необязательные «моргание» (`blink`) и «крылья» (`wings`) — design/prompts/batch-3-animation.md.
 * Не переданы явно — берутся из реестра beeFrames (illustrations.ts).
 */
interface BeeFrameProps {
  /** Основной кадр (как обычная иллюстрация). */
  frame: IllustrationName;
  /** Кадр с закрытыми глазами: пчела моргает раз в 3–6 с (токены blink, blinkGap). */
  blink?: IllustrationName;
  /** Кадр с крыльями в другом положении: пчела трепещет крыльями сменой кадров (токен flap). */
  wings?: IllustrationName;
  /** Плавает вверх-вниз (токен float). */
  float?: boolean;
  className?: string;
}

function framesOf({ frame, blink, wings }: BeeFrameProps) {
  const registered = beeFrames[frame];
  const b = blink ?? registered?.blink;
  const w = wings ?? registered?.wings;
  return { base: illustrations[frame], blink: b ? illustrations[b] : undefined, wings: w ? illustrations[w] : undefined };
}

/**
 * Смена кадров без перерисовки React: атрибуты data-blink и data-wings на обёртке, CSS показывает нужный кадр
 * (основной на это время прячется — кадры полные, не «заплатки»). При «Уменьшении движения» кадры не меняются.
 */
function useFrames<T extends Element>(hasBlink: boolean, hasWings: boolean) {
  const ref = useRef<T>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || (!hasBlink && !hasWings)) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let flap: ReturnType<typeof setInterval> | undefined;
    if (hasBlink) {
      const blinkMs = motionMs("blink");
      const gapMs = motionMs("blink-gap");
      const next = () => {
        // Пауза — от одной до двух blinkGap (3–6 с), чтобы моргание не было механическим.
        timers.push(
          setTimeout(() => {
            el.setAttribute("data-blink", "");
            timers.push(
              setTimeout(() => {
                el.removeAttribute("data-blink");
                next();
              }, blinkMs),
            );
          }, gapMs * (1 + Math.random())),
        );
      };
      if (blinkMs && gapMs) next();
    }
    if (hasWings) {
      const flapMs = motionMs("flap");
      if (flapMs) flap = setInterval(() => el.toggleAttribute("data-wings"), flapMs);
    }
    return () => {
      timers.forEach(clearTimeout);
      if (flap) clearInterval(flap);
      el.removeAttribute("data-blink");
      el.removeAttribute("data-wings");
    };
  }, [reduced, hasBlink, hasWings]);
  return ref;
}

const cls = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

export interface BeeProps extends BeeFrameProps {
  width: number;
  /** Альтернативный текст; по умолчанию пчела декоративная. */
  alt?: string;
}

/** Пчела Бал (HTML): основной кадр с явными размерами и, если есть, кадры моргания и крыльев поверх него. */
export function Bee({ width, alt = "", className, float, ...frames }: BeeProps) {
  const { base, blink, wings } = framesOf(frames);
  const ref = useFrames<HTMLSpanElement>(Boolean(blink), Boolean(wings));
  const height = Math.round((base.height / base.width) * width);
  return (
    <span ref={ref} className={cls("tt-bee", float && "tt-bee--float", className)}>
      <img className="tt-bee__base" src={base.src} width={width} height={height} alt={alt} />
      {wings ? <img className="tt-bee__frame tt-bee__frame--wings" src={wings.src} width={width} height={height} alt="" aria-hidden /> : null}
      {blink ? <img className="tt-bee__frame tt-bee__frame--blink" src={blink.src} width={width} height={height} alt="" aria-hidden /> : null}
    </span>
  );
}

export interface SvgBeeProps extends BeeFrameProps {
  x: number;
  y: number;
  width: number;
}

/** Та же пчела внутри SVG (тропа): позиция и размер — атрибутами, без style (строгая CSP). */
export function SvgBee({ x, y, width, className, float, ...frames }: SvgBeeProps) {
  const { base, blink, wings } = framesOf(frames);
  const ref = useFrames<SVGGElement>(Boolean(blink), Boolean(wings));
  const height = Math.round((base.height / base.width) * width);
  const at = { x, y, width, height };
  return (
    <g ref={ref} className={cls("tt-bee", float && "tt-bee--float", className)}>
      <image className="tt-bee__base" href={base.src} {...at} />
      {wings ? <image className="tt-bee__frame tt-bee__frame--wings" href={wings.src} {...at} /> : null}
      {blink ? <image className="tt-bee__frame tt-bee__frame--blink" href={blink.src} {...at} /> : null}
    </g>
  );
}
