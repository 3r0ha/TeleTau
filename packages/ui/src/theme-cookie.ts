/**
 * Тема интерфейса: значение cookie, которое читает и сервер (корневой layout ставит `data-theme` сразу в HTML), и клиент
 * (theme.ts). Без cookie — светлая тема, системная не учитывается.
 */
export type Theme = "light" | "dark";

export const THEME_COOKIE = "tt_theme";

export function parseTheme(value: string | null | undefined): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}
