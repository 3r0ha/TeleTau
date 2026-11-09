"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { hexPath } from "./hex";
import { illustrations } from "./illustrations";
import type { NavItem } from "./BottomNav";

/**
 * Точки раскладки оболочки (shell.css — те же числа): с 768 px нижние вкладки уступают боковой навигации, с 1024 px
 * справа появляется колонка карточек, с 1200 px боковая навигация — с подписями справа от значков.
 */
export const SHELL_SIDE_QUERY = "(min-width: 768px)";
export const SHELL_RAIL_QUERY = "(min-width: 1024px)";

/**
 * Совпадает ли медиазапрос. На сервере и в первом кадре — нет: то, что зависит от широкого экрана (данные правой
 * колонки), догружается после гидратации, а раскладку задаёт CSS.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener("change", onChange);
      return () => list?.removeEventListener("change", onChange);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}

const HEX_W = 46;
const HEX_H = 40;
const LIP = 4;

/**
 * Боковая навигация на компьютере и планшете (prototype .tabbar, развёрнутый вертикально): бренд и разделы; значок —
 * в соте с «губой», текущий раздел — медовая сота, подложка и граница accent.text (≥ 3:1, как у нижних вкладок).
 * На 768–1199 px — узкая колонка (подпись под значком), с 1200 px — подпись справа. На телефоне скрыта (shell.css).
 */
export function SideNav({ items, home, label = "Разделы" }: { items: NavItem[]; home: string; label?: string }) {
  const icon = illustrations.appIcon;
  return (
    <nav className="tt-sidenav" aria-label={label}>
      {/* «ТелеТау» — имя бренда, needs_native_review (docs/native-review-queue.md, №1) */}
      <Link href={home} className="tt-sidenav__brand" aria-label="ТелеТау — на главную">
        <img src={icon.src} width={44} height={44} alt="" />
        <span className="tt-sidenav__word" lang="ba">
          ТелеТау
        </span>
      </Link>
      <ul className="tt-sidenav__list">
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="tt-sidenav__link" aria-current={item.current ? "page" : undefined}>
              <span className="tt-sidenav__icon" aria-hidden>
                <svg className="tt-sidenav__hex" width={HEX_W} height={HEX_H + LIP} viewBox={`0 0 ${HEX_W} ${HEX_H + LIP}`} focusable="false">
                  <path className="tt-sidenav__hex-lip" d={hexPath(HEX_W, HEX_H, 5, 0, LIP)} />
                  <path className="tt-sidenav__hex-face" d={hexPath(HEX_W, HEX_H, 5)} />
                </svg>
                {item.icon}
              </span>
              <span className="tt-sidenav__label">{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
