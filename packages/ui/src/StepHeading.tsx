"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Заголовок экрана или шага (h1). При смене шага (`focusKey`) на него переносится фокус: читалка экрана объявляет
 * новый шаг, а следующий Tab продолжается отсюда, а не с начала страницы (WCAG 2.4.3). При первом показе фокус
 * не трогается — у новой страницы его ведёт браузер и объявлялка маршрутов Next.js.
 */
export function StepHeading({ focusKey, className = "tt-title2", children, id }: { focusKey: string | number; className?: string; children: ReactNode; id?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const shown = useRef(focusKey);
  useEffect(() => {
    if (shown.current === focusKey) return;
    shown.current = focusKey;
    ref.current?.focus();
  }, [focusKey]);
  return (
    <h1 ref={ref} tabIndex={-1} id={id} className={`${className} tt-step-heading`}>
      {children}
    </h1>
  );
}
