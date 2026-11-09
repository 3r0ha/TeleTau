"use client";

import { useEffect } from "react";

/**
 * Печать — всегда в светлой теме: тёмные токены на белой бумаге нечитаемы. На время печати у <html> ставится
 * data-theme="light" (токены, packages/design-tokens), после — возвращается как было (тема Telegram и т. п.).
 */
export function usePrintInLight(): void {
  useEffect(() => {
    const root = document.documentElement;
    let before: string | undefined;
    const enter = () => {
      before = root.dataset.theme;
      root.dataset.theme = "light";
    };
    const leave = () => {
      if (before === undefined) delete root.dataset.theme;
      else root.dataset.theme = before;
    };
    window.addEventListener("beforeprint", enter);
    window.addEventListener("afterprint", leave);
    return () => {
      window.removeEventListener("beforeprint", enter);
      window.removeEventListener("afterprint", leave);
    };
  }, []);
}
