"use client";

import { Moon, Sun } from "@phosphor-icons/react/ssr";
import { IconButton } from "./Button";
import { setTheme, useTheme } from "./theme";

/** Выключатель «Тёмная тема» для строки настроек: подпись — элемент с id `labelledBy`. */
export function ThemeSwitch({ labelledBy }: { labelledBy: string }) {
  const dark = useTheme() === "dark";
  return (
    <button type="button" role="switch" aria-checked={dark} aria-labelledby={labelledBy} className="tt-switch" onClick={() => setTheme(dark ? "light" : "dark")}>
      <span className="tt-switch__knob" aria-hidden />
    </button>
  );
}

/** Значок в шапке (консоль): луна — включить тёмную тему, солнце — светлую. */
export function ThemeToggleButton() {
  const dark = useTheme() === "dark";
  return (
    <IconButton
      label={dark ? "Светлая тема" : "Тёмная тема"}
      icon={dark ? <Sun weight="bold" /> : <Moon weight="bold" />}
      onClick={() => setTheme(dark ? "light" : "dark")}
    />
  );
}
