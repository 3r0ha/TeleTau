"use client";

import { useEffect } from "react";
import { useReducedMotion } from "@teletau/ui";

/**
 * Появление разделов при прокрутке: блоки с атрибутом data-reveal, которые ещё ниже экрана, прячутся
 * (data-reveal="wait") и проявляются, когда их верх поднимается в экран (data-reveal="in", landing.css). Проверка — по
 * прокрутке, а не IntersectionObserver: при быстром переходе вниз блок, ни разу не попавший в экран, тоже проявляется.
 * Без JS и при «Уменьшении движения» ничего не прячется.
 */
export function Reveal() {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const waiting = new Set(Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]")).filter((el) => el.getBoundingClientRect().top > window.innerHeight));
    if (!waiting.size) return;
    for (const el of waiting) el.dataset.reveal = "wait";

    let frame = 0;
    const stop = () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
    const check = () => {
      frame = 0;
      const edge = window.innerHeight * 0.92;
      for (const el of waiting) {
        if (el.getBoundingClientRect().top >= edge) continue;
        el.dataset.reveal = "in";
        waiting.delete(el);
      }
      if (!waiting.size) stop();
    };
    function schedule() {
      if (!frame) frame = requestAnimationFrame(check);
    }
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    schedule();
    return stop;
  }, [reduced]);
  return null;
}
