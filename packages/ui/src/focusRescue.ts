"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'button:not([disabled]):not([aria-disabled="true"]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Фокус не теряется, когда нажатая кнопка исчезает: строка заявки решена, подтверждение сменилось итогом, форма —
 * «Карточки готовы», «Более ранние» на последней странице стала недоступной. Если элемент в контейнере, где был фокус,
 * убран из DOM или стал disabled и фокус упал на body, после перерисовки он переходит на первый доступный элемент
 * контейнера (кнопку следующей строки или нового шага).
 */
export function useFocusRescue(container: RefObject<HTMLElement | null>, selector: string = FOCUSABLE): void {
  const last = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const root = container.current;
      if (root && e.target instanceof HTMLElement && root.contains(e.target)) last.current = e.target;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [container]);
  useEffect(() => {
    const was = last.current;
    if (!was || (was.isConnected && !was.matches(":disabled"))) return;
    // Chrome оставляет фокус на кнопке, ставшей disabled (activeElement не меняется), удалённая отдаёт его body.
    const active = document.activeElement;
    if (active && active !== document.body && active !== was) return;
    last.current = null;
    container.current?.querySelector<HTMLElement>(selector)?.focus();
  });
}
