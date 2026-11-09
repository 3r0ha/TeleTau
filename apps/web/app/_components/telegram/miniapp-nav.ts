// Системная кнопка «Назад» Telegram в Mini App: когда её показывать и что она делает. Чистая функция — без React и окна.
import type { StudentPaths } from "../learn/paths";

/**
 * - `none` — кнопки нет (тропа, вход, выбор ника, «Ты в классе»): «Назад» Android и жест iOS закрывают Mini App;
 * - `history` — шаг назад по истории: открыт лист (урок, «Уже уходишь?», диалог — у них своя запись истории,
 *   packages/ui sheetHistory.ts), шаг входа по коду класса или «Мой словарь» (открыт из профиля — назад в профиль);
 * - `trail` — с вкладок «Лига», «Класс», «Профиль» — на тропу (как в нижней навигации, без петель по вкладкам).
 */
export type BackAction = "none" | "history" | "trail";

export function backAction(pathname: string, paths: StudentPaths, sheetOpen: boolean): BackAction {
  if (sheetOpen) return "history";
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === paths.league || path === paths.hive || path === paths.me) return "trail";
  if (path === paths.code || path === paths.wait || path === paths.words) return "history";
  return "none";
}

/** Метка записи истории открытого листа — та же, что ставит packages/ui/src/sheetHistory.ts (MARK). */
const SHEET_MARK = "ttSheet";

/** Открыт ли сейчас лист (запись истории листа на вершине). */
export function isSheetEntry(state: unknown): boolean {
  return Boolean(state && typeof state === "object" && SHEET_MARK in (state as Record<string, unknown>));
}
