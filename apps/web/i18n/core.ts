/**
 * Язык интерфейса приложения: русский (по умолчанию), башкирский, казахский. Значение живёт в cookie —
 * её читает корневой layout на сервере (без вспышки другого языка), а клиент (client.tsx) — пишет и
 * обновляет страницу. Каталоги (registry.ts) — словари «русская строка → перевод»; непереведённые
 * строки остаются русскими, поэтому приложение целиком работает на любом этапе перевода.
 */

export const LOCALES = ["ru", "ba", "kk"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_COOKIE = "tt_locale";

/** Подписи для переключателя — на самом языке (пользователь узнаёт свой, даже не зная остальных). */
export const LOCALE_LABELS: Record<Locale, string> = {
  ru: "Русский",
  ba: "Башҡортса",
  kk: "Қазақша",
};

export function parseLocale(value: string | null | undefined): Locale | null {
  return (LOCALES as readonly string[]).includes(value ?? "") ? (value as Locale) : null;
}

/** Подстановки в переводах: t("Урок {n} из {total}", { n, total }) — порядок слов в языках разный. */
export type TVars = Record<string, string | number>;

export type T = (ru: string, vars?: TVars) => string;

function applyVars(text: string, vars: TVars): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

/** Переводчик: каталог «русская строка → перевод»; без перевода — русская строка (прозрачный фолбэк). */
export function makeT(locale: Locale, catalog: Record<string, string> | null): T {
  if (locale === "ru" || !catalog) {
    return (ru, vars) => (vars ? applyVars(ru, vars) : ru);
  }
  return (ru, vars) => {
    const text = catalog[ru] ?? ru;
    return vars ? applyVars(text, vars) : text;
  };
}
