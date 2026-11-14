"use client";

// Переключатель языка интерфейса: cookie tt_locale (год, SameSite=Lax — как тема) + router.refresh() —
// сервер перерисовывает layout (html lang) и все строки. В настройках — строка-«row» как «Тёмная тема»,
// в шапке лендинга — компактный сегмент.
import { useRouter } from "next/navigation";
import { Globe } from "@phosphor-icons/react/ssr";
import { LOCALES, LOCALE_LABELS, useLocale } from "../../i18n/client";
import "./LanguageSwitcher.css";

const YEAR_S = 365 * 24 * 60 * 60;

/** Общий выбор: пишет cookie и обновляет страницу с новым языком. */
function usePick(): (locale: (typeof LOCALES)[number]) => void {
  const router = useRouter();
  const current = useLocale();
  return (locale) => {
    if (locale === current) return;
    try {
      document.cookie = `tt_locale=${locale}; Path=/; Max-Age=${YEAR_S}; SameSite=Lax`;
    } catch {
      return; // cookie недоступны — остаёмся на текущем языке до перезагрузки
    }
    router.refresh();
  };
}

/** Сегмент языков: подпись «Язык» (aria-label группы), активный — aria-pressed. */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const current = useLocale();
  const pick = usePick();
  return (
    <span className={`tt-row lang-switch${compact ? " lang-switch--compact" : ""}`} role="group" aria-label="Язык интерфейса">
      {LOCALES.map((locale) => (
        <button key={locale} type="button" aria-pressed={locale === current} onClick={() => pick(locale)}>
          {LOCALE_LABELS[locale]}
        </button>
      ))}
    </span>
  );
}

/** Строка настроек профиля: глобус, название «Язык», сегмент справа. */
export function LanguageRow() {
  return (
    <div className="settings__row">
      <Globe weight="fill" aria-hidden />
      <span className="settings__name" id="lang-label">
        Язык
      </span>
      <LanguageSwitcher />
    </div>
  );
}
