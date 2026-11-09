"use client";

import { useSyncExternalStore } from "react";
import { THEME_COOKIE, parseTheme, type Theme } from "./theme-cookie";

/**
 * Переключение темы в браузере: выбор переопределяет токены атрибутом `data-theme` на <html> (packages/design-tokens)
 * и сохраняется в cookie, а не в localStorage — её читает корневой layout на сервере (без вспышки другой темы и без
 * встроенного скрипта при строгой CSP). Без выбора тема светлая, системная тема не учитывается.
 */

const YEAR_S = 365 * 24 * 60 * 60;

const listeners = new Set<() => void>();

function current(): Theme {
  return parseTheme(document.documentElement.dataset.theme) ?? "light";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Включить тему на всём сайте сейчас и запомнить выбор на этом устройстве. */
export function setTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  try {
    document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${YEAR_S}; SameSite=Lax`;
  } catch {
    // cookie недоступны — тема держится до перезагрузки
  }
  // Цвет панели браузера на телефоне — в цвет нового фона.
  const bg = getComputedStyle(root).getPropertyValue("--tt-color-bg").trim();
  if (bg) {
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute("content", bg));
  }
  listeners.forEach((l) => l());
}

/** Тема, которая сейчас на экране: выбранная, без выбора — светлая. На сервере — «light» (до гидратации). */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, current, () => "light");
}
