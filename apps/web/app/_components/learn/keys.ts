"use client";

import { useEffect, useRef } from "react";

/**
 * Клавиши 1…count выбирают вариант (docs/plans/M2.md §3 «Ч4»: клавиатура 1–4 и Enter). Не срабатывает, пока фокус
 * в поле ввода или открыт модальный диалог, и с модификаторами (Ctrl+1 — переключение вкладок браузера).
 */
export function useDigitKeys(count: number, onPick: (index: number) => void, enabled: boolean) {
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (document.querySelector("dialog[open]")) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > count) return;
      e.preventDefault();
      pick.current(n - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [count, enabled]);
}
