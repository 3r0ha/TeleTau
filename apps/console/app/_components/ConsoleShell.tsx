"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { BookOpenText, ClipboardText, ListChecks, MapTrifold, SignOut } from "@phosphor-icons/react/ssr";
import { BottomNav, Brand, Button, ButtonLink, EmptyState, IconButton, Skeleton, SkeletonGroup, ThemeToggleButton, TopBar, TopNav, type NavItem } from "@teletau/ui";
import { session } from "@teletau/session/client";
import { useSession } from "@teletau/session/react";
import type { Me } from "@teletau/session/types";
import { homeOf, isStaff, sectionsFor, type SectionKey } from "./sections";

export { isStaff } from "./sections";

const ICONS: Record<SectionKey, ReactNode> = {
  republic: <MapTrifold weight="fill" />,
  fund: <BookOpenText weight="fill" />,
  verifications: <ListChecks weight="fill" />,
  audit: <ClipboardText weight="fill" />,
};

/**
 * Каркас консоли: вход сотрудника обязателен, разделы — по ролям (sections.ts). `section` — раздел страницы:
 * без его роли страница не рисуется, а показывает «Раздел недоступен» со ссылкой на свой раздел.
 */
export function ConsoleShell({ section, children }: { section?: SectionKey; children: (me: Me) => ReactNode }) {
  const state = useSession();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    void session.restore();
  }, []);
  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
  }, [state.status, router]);

  const me = state.status === "authenticated" ? state.account : null;
  const sections = me ? sectionsFor(me) : [];
  const items: NavItem[] = sections.map((s) => ({ href: s.href, label: s.label, icon: ICONS[s.key], current: path.startsWith(s.href) }));
  const allowed = !section || sections.some((s) => s.key === section);
  const logout = async () => {
    await session.logout();
    router.replace("/login");
  };
  // Одно меню из одного пункта не нужно: у министерства и Фонда — по одному разделу.
  const nav = items.length > 1;

  return (
    <div className="tt-page console">
      <TopBar
        wide
        start={<Brand href={me ? homeOf(me) : "/login"} subtitle="Консоль" />}
        nav={me && nav ? <TopNav items={items} label="Разделы консоли" /> : undefined}
        end={
          <span className="tt-row console__top-actions">
            <ThemeToggleButton />
            {me ? <IconButton label="Выйти" icon={<SignOut weight="bold" />} onClick={() => void logout()} /> : null}
          </span>
        }
      />
      <main id="main" className="tt-main">
        <div className="tt-column tt-column--wide console__body">
          {!me ? (
            <SkeletonGroup label="Проверяем вход" className="tt-stack">
              <Skeleton width="30%" height={28} />
              <Skeleton height={240} radius="panel" />
            </SkeletonGroup>
          ) : !isStaff(me) ? (
            <EmptyState
              art="beeSympathy"
              title="Нет доступа к консоли"
              role="alert"
              actions={
                <Button block onClick={() => void logout()}>
                  Войти другой учётной записью
                </Button>
              }
            >
              Консоль — только для сотрудников.
            </EmptyState>
          ) : !allowed ? (
            <EmptyState
              art="beeThink"
              title="Раздел недоступен"
              role="alert"
              actions={
                <ButtonLink href={homeOf(me)} block>
                  К своему разделу
                </ButtonLink>
              }
            >
              Нужна другая роль. Обратитесь к администратору.
            </EmptyState>
          ) : (
            children(me)
          )}
        </div>
      </main>
      {me && nav ? <BottomNav items={items} label="Разделы консоли" mobileOnly /> : null}
    </div>
  );
}
