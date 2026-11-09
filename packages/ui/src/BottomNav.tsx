import Link from "next/link";
import type { ReactNode } from "react";

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
export function BottomNav({ items, label = "Разделы", mobileOnly }: { items: NavItem[]; label?: string; mobileOnly?: boolean }) {
  return (
    <nav className={["tt-tabbar", mobileOnly && "tt-tabbar--mobile-only"].filter(Boolean).join(" ")} aria-label={label}>
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
export function TopNav({ items, label = "Разделы" }: { items: NavItem[]; label?: string }) {
  return (
    <nav className="tt-topnav" aria-label={label}>
      {items.map((item) => (
        <Link key={item.href} href={item.href} aria-current={item.current ? "page" : undefined}>
          {item.icon}
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
