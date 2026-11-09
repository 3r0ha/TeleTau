"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Scales, UserCircle, UsersThree } from "@phosphor-icons/react/ssr";
import { BottomNav, Brand, TopBar, TopNav, type NavItem } from "@teletau/ui";

/** Кабинет учителя: верхняя панель (на компьютере — с разделами), нижняя навигация на телефоне. Разделы: классы, дуэли «Помогите языку», профиль. */
export function TeacherShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const items: NavItem[] = [
    { href: "/teacher", label: "Классы", icon: <UsersThree weight="fill" />, current: path === "/teacher" || path.startsWith("/teacher/classes") },
    { href: "/teacher/duels", label: "Помогите языку", icon: <Scales weight="fill" />, current: path.startsWith("/teacher/duels") },
    { href: "/teacher/profile", label: "Профиль", icon: <UserCircle weight="fill" />, current: path === "/teacher/profile" },
  ];
  return (
    <div className="tt-page teacher-shell">
      <TopBar wide start={<Brand href="/teacher" subtitle="Кабинет учителя" />} nav={<TopNav items={items} label="Разделы кабинета" />} />
      <main id="main" className="tt-main">
        <div className="tt-column tt-column--wide screen-body">{children}</div>
      </main>
      <BottomNav items={items} label="Разделы кабинета" mobileOnly />
    </div>
  );
}
