"use client";

import { Moon, Sun } from "@phosphor-icons/react/ssr";
import { IconButton } from "./Button";
import { Switch } from "./Switch";
import { setTheme, useTheme } from "./theme";
import { useUiStrings } from "./UiStrings";

/** Выключатель «Тёмная тема» для строки настроек: подпись — элемент с id `labelledBy`. */
export function ThemeSwitch({ labelledBy }: { labelledBy: string }) {
  const dark = useTheme() === "dark";
  return <Switch checked={dark} labelledBy={labelledBy} onChange={(on) => setTheme(on ? "dark" : "light")} />;
}

/** Значок в шапке (консоль): луна — включить тёмную тему, солнце — светлую. */
export function ThemeToggleButton() {
  const dark = useTheme() === "dark";
  const s = useUiStrings();
  return (
    <IconButton
      label={dark ? s.themeLight : s.themeDark}
      icon={dark ? <Sun weight="bold" /> : <Moon weight="bold" />}
      onClick={() => setTheme(dark ? "light" : "dark")}
    />
  );
}
