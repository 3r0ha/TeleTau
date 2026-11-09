"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { CaretDown, EnvelopeSimple, QrCode } from "@phosphor-icons/react/ssr";
import { Brand, ThemeToggleButton, buttonClass } from "@teletau/ui";

/** «Войти»: раскрывающийся список из двух ссылок. Закрывается по Esc, щелчку мимо и уходу фокуса. */
function SignInMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menuId = useId();

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

  return (
    <div
      ref={box}
      className="lp-signin"
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={toggle}
        type="button"
        className={buttonClass({ variant: "secondary", small: true }, "lp-signin__toggle")}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        Войти
        <CaretDown weight="bold" aria-hidden />
      </button>
      <div id={menuId} className="lp-signin__menu" hidden={!open}>
        <Link href="/student" className="lp-signin__item">
          <QrCode weight="bold" aria-hidden />
          По карточке
        </Link>
        <Link href="/teacher/login" className="lp-signin__item">
          <EnvelopeSimple weight="bold" aria-hidden />
          По почте
        </Link>
      </div>
    </div>
  );
}

/** Шапка стартовой страницы: логотип, тема, «Войти». Липкая; после прокрутки — тоньше и с границей снизу. */
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
          <ThemeToggleButton />
          <SignInMenu />
        </div>
      </div>
    </header>
  );
}
