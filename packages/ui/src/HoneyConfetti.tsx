"use client";

import { useEffect, useRef, useState } from "react";
import { hexPath } from "./hex";
import { motionEasing, motionMs, useReducedMotion } from "./motion";

const PIECES = 22;
const TONES = ["honey", "lip", "green", "water", "violet", "coral"] as const;
const SIZES = [10, 14, 18] as const;

/**
 * Конфетти из маленьких сот (итог урока, новая лига): сверху падают шестиугольники цветов палитры. Слой декоративный
 * (aria-hidden, не перехватывает нажатия) и исчезает сам. Движение — Web Animations API с токенами confetti, stagger и
 * fall; при «Уменьшении движения» слоя нет вовсе.
 */
export function HoneyConfetti() {
  const reduced = useReducedMotion();
  const layer = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const el = layer.current;
    if (reduced || !el || typeof el.animate !== "function") return;
    const duration = motionMs("confetti");
    const step = motionMs("stagger");
    if (!duration) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const easing = motionEasing("fall");
    const animations = [...el.children].map((piece, i) => {
      const x = (w * (i + 0.5 + (Math.random() - 0.5) * 0.8)) / PIECES;
      const drift = (Math.random() - 0.5) * 120;
      const turn = (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 360);
      return piece.animate(
        [
          { transform: `translate(${x}px, -24px) rotate(0deg)`, opacity: 1 },
          { transform: `translate(${x + drift * 0.6}px, ${h * 0.6}px) rotate(${turn * 0.6}deg)`, opacity: 1, offset: 0.7 },
          { transform: `translate(${x + drift}px, ${h + 24}px) rotate(${turn}deg)`, opacity: 0 },
        ],
        { duration: duration * (0.75 + Math.random() * 0.5), delay: step * Math.random() * 6, easing, fill: "both" },
      );
    });
    let alive = true;
    void Promise.all(animations.map((a) => a.finished)).then(
      () => alive && setDone(true),
      () => undefined,
    );
    return () => {
      alive = false;
      animations.forEach((a) => a.cancel());
    };
  }, [reduced]);

  if (reduced || done) return null;
  return (
    <div ref={layer} className="tt-confetti" aria-hidden="true">
      {Array.from({ length: PIECES }, (_, i) => {
        const s = SIZES[i % SIZES.length]!;
        const h = Math.round(s * 0.875);
        return (
          <svg key={i} className={`tt-confetti__piece tt-confetti__piece--${TONES[i % TONES.length]}`} width={s} height={h} viewBox={`0 0 ${s} ${h}`} focusable="false">
            <path d={hexPath(s, h, Math.max(2, s * 0.18))} />
          </svg>
        );
      })}
    </div>
  );
}
