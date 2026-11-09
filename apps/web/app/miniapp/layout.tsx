import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MiniAppFrame } from "../_components/telegram/MiniAppFrame";
import "./miniapp.css";

// Telegram Mini App (docs/plans/M2.md §3 «Ч5»): те же экраны ученика под /miniapp — кнопка меню бота открывает /miniapp.
// Встраивать эти страницы может только Telegram Web (frame-ancestors, @teletau/session/security); из Telegram ничего не
// сохраняется, кроме привязки чата с ботом: initData после входа один раз уходит в POST /telegram/link (ADR 0020).
// Объект, а не строка: строковый title обрывает шаблон «… · ТелеТау» для вложенных страниц (Next.js resolveTitle).
export const metadata: Metadata = { title: { default: "Тропа", template: "%s · ТелеТау" }, robots: { index: false, follow: false } };

export default function Layout({ children }: { children: ReactNode }) {
  return <MiniAppFrame>{children}</MiniAppFrame>;
}
