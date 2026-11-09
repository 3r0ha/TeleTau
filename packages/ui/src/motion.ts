"use client";

// Движение на JS (Web Animations API): длительности и кривые — те же токены, что у CSS (--tt-duration-…, --tt-easing-…),
// читаются из tokens.css во время работы, копий значений в коде нет. «Уменьшение движения» выключает всё декоративное:
// на сервере и при prefers-reduced-motion: reduce анимаций нет вовсе (так же их выключают тесты на моках).
import { useEffect, useState, useSyncExternalStore } from "react";

const REDUCE = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia?.(REDUCE);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

/** Включено ли «Уменьшение движения». На сервере — да: разметка без анимации, клиент включит её сам. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(REDUCE).matches ?? false,
    () => true,
  );
}

const token = (name: string) => (typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(name).trim());

/** Длительность из токена `--tt-duration-<name>` в миллисекундах (0 — токена нет: анимация не запускается). */
export function motionMs(name: string): number {
  const m = /^(\d*\.?\d+)(ms|s)$/.exec(token(`--tt-duration-${name}`));
  return m ? Number(m[1]) * (m[2] === "s" ? 1000 : 1) : 0;
}

/** Кривая из токена `--tt-easing-<name>` для Web Animations API («cubic-bezier(…)»). */
export function motionEasing(name: string): string {
  return token(`--tt-easing-${name}`) || "linear";
}

/**
 * Число «набегает» от 0 до `target` (счётчик мёда на итоге урока). Ход — по токенам `count` и `out` через Web Animations
 * API: пустая анимация отдаёт прогресс уже с учётом кривой. При «Уменьшении движения» — сразу итог.
 */
export function useCountUp(target: number): number {
  const reduced = useReducedMotion();
  // Первый кадр — уже с нуля (без вспышки итога); при «Уменьшении движения» и на сервере — сразу итог.
  const [shown, setShown] = useState(() => (reduced ? target : 0));
  useEffect(() => {
    const duration = motionMs("count");
    if (reduced || target <= 0 || !duration || typeof document.documentElement.animate !== "function") {
      setShown(target);
      return;
    }
    const clock = document.documentElement.animate([], { duration, easing: motionEasing("out"), fill: "forwards" });
    let frame = 0;
    const tick = () => {
      const progress = clock.effect?.getComputedTiming().progress;
      const done = clock.playState === "finished" || progress === null || progress === undefined;
      setShown(done ? target : Math.round(target * Math.min(1, Math.max(0, progress))));
      if (!done) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      clock.cancel();
    };
  }, [target, reduced]);
  return shown;
}
