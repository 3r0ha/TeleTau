/**
 * Строки, которые компоненты пакета показывают сами (подписи вкладок, тексты для читалок). По умолчанию — русские;
 * приложение с выбором языка оборачивает дерево в UiStringsProvider и передаёт переводы тех же русских строк
 * (`uiStringsFrom(t)`). Подстановки — `{name}`, их заполняет fillUi.
 */
export const RU_UI_STRINGS = {
  navLabel: "Разделы",
  tabPath: "Путь",
  tabLeague: "Лига",
  tabHive: "Класс",
  tabMe: "Профиль",
  tabBoard: "Доска",
  tabWords: "Словарь",
  brandHome: "ТелеТау — на главную",
  goalUnit: "сот",
  goalOf: "{done} из {target}",
  goalLabel: "Цель дня: {done} из {target}",
  goalLabelMet: "Цель дня: {done} из {target}, выполнена",
  zoneUp: "Зона повышения",
  zoneDown: "Зона понижения",
  leaguePlace: "Место {rank}",
  leagueMe: "ты",
  leagueHoney: "{points} мёда",
  answerOk: "верный ответ",
  answerNo: "не так",
  codeCell: "{label}: символ {n} из {length}",
  toasts: "Уведомления",
  toastHide: "Скрыть уведомление",
  close: "Закрыть",
  speak: "Послушать",
  letters: "Башкирские буквы",
  themeLight: "Светлая тема",
  themeDark: "Тёмная тема",
  loading: "Загрузка",
} as const;

export type UiStringKey = keyof typeof RU_UI_STRINGS;
export type UiStrings = Record<UiStringKey, string>;

/** Все строки пакета через переводчик приложения: ключ перевода — русская строка из RU_UI_STRINGS. */
export function uiStringsFrom(t: (ru: string) => string): UiStrings {
  const out = {} as UiStrings;
  for (const key of Object.keys(RU_UI_STRINGS) as UiStringKey[]) out[key] = t(RU_UI_STRINGS[key]);
  return out;
}

/** Подстановка `{name}` в строку пакета. */
export function fillUi(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}
