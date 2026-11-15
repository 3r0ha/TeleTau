"use client";

// Переключатель языка интерфейса: cookie LOCALE_COOKIE (год, SameSite=Lax — как тема) + router.refresh() —
// сервер перерисовывает layout (html lang) и все строки. В профиле — строка настроек (подпись, под ней сегмент),
// в шапке лендинга — сегмент в ряду действий, в меню шапки на телефоне — список.
import { useId } from "react";
import { useRouter } from "next/navigation";
import { Globe } from "@phosphor-icons/react/ssr";
import { LOCALES, LOCALE_LABELS, useLocale, useT } from "../../i18n/client";
import { LOCALE_COOKIE, type Locale } from "../../i18n/core";
import "./LanguageSwitcher.css";

const YEAR_S = 365 * 24 * 60 * 60;

/** Общий выбор: пишет cookie и обновляет страницу с новым языком. */
function usePick(): (locale: Locale) => void {
  const router = useRouter();
  const current = useLocale();
  return (locale) => {
    if (locale === current) return;
    try {
      document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${YEAR_S}; SameSite=Lax`;
    } catch {
      return; // cookie недоступны — остаёмся на текущем языке до перезагрузки
    }
    router.refresh();
  };
}

type Variant = "row" | "fill" | "list";

/**
 * Сегмент языков, активный — aria-pressed. Название каждого языка — на нём самом (lang): читалка произносит
 * «Башҡортса» по-башкирски. Подпись группы — labelledBy (видимое «Язык») или aria-label.
 */
export function LanguageSwitcher({ variant = "row", labelledBy }: { variant?: Variant; labelledBy?: string }) {
  const current = useLocale();
  const pick = usePick();
  const t = useT();
  return (
    <span
      className={`lang-switch lang-switch--${variant}`}
      role="group"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : t("Язык интерфейса")}
    >
      {LOCALES.map((locale) => (
        <button key={locale} type="button" lang={locale} aria-pressed={locale === current} onClick={() => pick(locale)}>
          {LOCALE_LABELS[locale]}
        </button>
      ))}
    </span>
  );
}

/** Строка настроек профиля: глобус и «Язык», под ними сегмент на всю ширину строки. */
export function LanguageRow() {
  const t = useT();
  const labelId = useId();
  return (
    <div className="settings__row settings__row--stack">
      <Globe weight="fill" aria-hidden />
      <span className="settings__name" id={labelId}>
        {t("Язык")}
      </span>
      <LanguageSwitcher variant="fill" labelledBy={labelId} />
    </div>
  );
}
