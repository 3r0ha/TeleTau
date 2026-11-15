"use client";

// Язык интерфейса в клиентских компонентах: локаль приходит из серверного layout (провайдер), одинакова
// при SSR и гидратации — расхождений нет. Выбор языка (LanguageSwitcher) пишет cookie и обновляет
// страницу (router.refresh): сервер перерисует и layout (html lang), и все строки.
import { Fragment, createContext, useContext, type ReactNode } from "react";
import { LOCALE_LABELS, LOCALES, type Locale, type T } from "./core";
import { tFor } from "./registry";

const LocaleContext = createContext<Locale>("ru");

/** Провайдер ставит серверный layout (apps/web/app/layout.tsx) — локаль из cookie. */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** Текущий язык интерфейса («ru» по умолчанию). */
export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** Переводчик для клиентского компонента: const t = useT(); … t("Продолжить"). */
export function useT(): T {
  return tFor(useContext(LocaleContext));
}

/**
 * Переведённая строка с разметкой внутри: fillNodes(t("{done} из {total}"), { done: <b>3</b>, total: 24 }) — порядок
 * слов задаёт перевод, а не код. Неизвестные подстановки остаются как есть.
 */
export function fillNodes(template: string, vars: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{key !== undefined && key in vars ? vars[key] : part}</Fragment>;
  });
}

export { LOCALES, LOCALE_LABELS };
