"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { illustrations } from "./illustrations";

export interface TopBarProps {
  /** Слева: кнопка «назад» или бренд. */
  start?: ReactNode;
  title?: ReactNode;
  /** Справа: действия, счётчики, меню аккаунта. */
  end?: ReactNode;
  /** Навигация в панели на широком экране (TopNav). */
  nav?: ReactNode;
  wide?: boolean;
}

/** Верхняя панель (prototype .topbar): липкая, граница появляется при прокрутке. */
export function TopBar({ start, title, end, nav, wide }: TopBarProps) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 4);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <header className="tt-topbar" data-scrolled={scrolled}>
      <div className={["tt-column", wide && "tt-column--wide", "tt-topbar__inner"].filter(Boolean).join(" ")}>
        {start}
        {title ? <div className="tt-topbar__title">{title}</div> : <div className="tt-spacer" />}
        {nav}
        {end}
      </div>
    </header>
  );
}

/** Бренд: иконка приложения и «ТелеТау» (needs_native_review: docs/native-review-queue.md, №1). */
export function Brand({ href = "/", subtitle }: { href?: string; subtitle?: ReactNode }) {
  const icon = illustrations.appIcon;
  return (
    <Link href={href} className="tt-brand" aria-label={subtitle ? undefined : "ТелеТау — на главную"}>
      <img src={icon.src} width={36} height={36} alt="" />
      <span>
        <span lang="ba">ТелеТау</span>
        {subtitle ? <small>{subtitle}</small> : null}
      </span>
    </Link>
  );
}
