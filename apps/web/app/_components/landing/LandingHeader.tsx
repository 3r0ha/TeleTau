"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { CaretDown, EnvelopeSimple, GearSix, Moon, QrCode } from "@phosphor-icons/react/ssr";
import { Brand, ThemeSwitch, ThemeToggleButton, buttonClass } from "@teletau/ui";
import { useT } from "../../../i18n/client";
import { LanguageSwitcher } from "../LanguageSwitcher";

/** Раскрывающееся меню шапки: закрывается по Esc (фокус — на кнопку), щелчку мимо и уходу фокуса из меню. */
function useMenu(): { open: boolean; setOpen: (v: boolean | ((v: boolean) => boolean)) => void; box: RefObject<HTMLDivElement | null>; toggle: RefObject<HTMLButtonElement | null> } {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, box, toggle };
}

function Menu({ className, button, children }: { className: string; button: (props: { open: boolean; menuId: string; onClick: () => void; ref: RefObject<HTMLButtonElement | null> }) => ReactNode; children: ReactNode }) {
  const { open, setOpen, box, toggle } = useMenu();
  const menuId = useId();
  return (
    <div
      ref={box}
      className={`lp-menu ${className}`}
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {button({ open, menuId, onClick: () => setOpen((v) => !v), ref: toggle })}
      <div id={menuId} className="lp-menu__panel" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

/** «Войти»: две ссылки — по карточке и по почте. */
function SignInMenu() {
  const t = useT();
  return (
    <Menu
      className="lp-signin"
      button={({ open, menuId, onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          className={buttonClass({ variant: "secondary", small: true }, "lp-signin__toggle")}
          aria-expanded={open}
          aria-controls={menuId}
          onClick={onClick}
        >
          {t("Войти")}
          <CaretDown weight="bold" aria-hidden />
        </button>
      )}
    >
      <Link href="/student" className="lp-menu__item">
        <QrCode weight="bold" aria-hidden />
        {t("По карточке")}
      </Link>
      <Link href="/teacher/login" className="lp-menu__item">
        <EnvelopeSimple weight="bold" aria-hidden />
        {t("По почте")}
      </Link>
    </Menu>
  );
}

/** Телефон: язык и тема — в меню за значком, чтобы шапка оставалась одним рядом «логотип + Войти». */
function PrefsMenu() {
  const t = useT();
  const themeId = useId();
  return (
    <Menu
      className="lp-prefs"
      button={({ open, menuId, onClick, ref }) => (
        <button ref={ref} type="button" className="tt-icon-btn lp-prefs__toggle" aria-label={t("Настройки")} aria-expanded={open} aria-controls={menuId} onClick={onClick}>
          <GearSix weight="bold" aria-hidden />
        </button>
      )}
    >
      <LanguageSwitcher variant="list" />
      <div className="lp-menu__row">
        <Moon weight="fill" aria-hidden />
        <span id={themeId} className="lp-menu__label">
          {t("Тёмная тема")}
        </span>
        <ThemeSwitch labelledBy={themeId} />
      </div>
    </Menu>
  );
}

/** Шапка стартовой страницы: логотип, тема, языки, «Войти». Липкая; после прокрутки — тоньше и с границей снизу. */
export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <header className="lp-head" data-scrolled={scrolled}>
      <div className="lp-wrap lp-head__in">
        <Brand />
        <div className="lp-head__end">
          <div className="lp-head__prefs">
            <ThemeToggleButton />
            <LanguageSwitcher />
          </div>
          <PrefsMenu />
          <SignInMenu />
        </div>
      </div>
    </header>
  );
}
