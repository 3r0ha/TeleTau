"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useUiStrings } from "./UiStrings";

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  current?: boolean;
}

/**
 * Нижняя навигация (prototype .tabbar): значок 28 px и подпись, текущий раздел — медовая подложка и aria-current.
 * mobileOnly — на широком экране скрыта (там те же пункты показывает TopNav в верхней панели).
 */
export function BottomNav({ items, label, mobileOnly }: { items: NavItem[]; label?: string; mobileOnly?: boolean }) {
  const s = useUiStrings();
  return (
    <nav className={["tt-tabbar", mobileOnly && "tt-tabbar--mobile-only"].filter(Boolean).join(" ")} aria-label={label ?? s.navLabel}>
      <ul>
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="tt-tab" aria-current={item.current ? "page" : undefined}>
              {item.icon}
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Те же разделы в верхней панели на широком экране (≥ 900 px). */
export function TopNav({ items, label }: { items: NavItem[]; label?: string }) {
  const s = useUiStrings();
  return (
    <nav className="tt-topnav" aria-label={label ?? s.navLabel}>
      {items.map((item) => (
        <Link key={item.href} href={item.href} aria-current={item.current ? "page" : undefined}>
          {item.icon}
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
