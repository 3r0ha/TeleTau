import { BookOpenText, Path, ShieldStar, UserCircle, UsersThree } from "@phosphor-icons/react/ssr";
import { BottomNav } from "./BottomNav";
import { SideNav } from "./SideNav";

export type StudentTab = "path" | "league" | "hive" | "me";
/** Разделы боковой навигации: на компьютере «Словарь» — отдельный раздел, на телефоне он внутри «Профиля». */
export type StudentSection = StudentTab | "words";

const TABS: { key: StudentTab; label: string; icon: React.ReactNode }[] = [
  { key: "path", label: "Путь", icon: <Path weight="fill" aria-hidden /> },
  { key: "league", label: "Лига", icon: <ShieldStar weight="fill" aria-hidden /> },
  { key: "hive", label: "Класс", icon: <UsersThree weight="fill" aria-hidden /> },
  { key: "me", label: "Профиль", icon: <UserCircle weight="fill" aria-hidden /> },
];

const SECTIONS: { key: StudentSection; label: string; icon: React.ReactNode }[] = [
  ...TABS.slice(0, 3),
  { key: "words", label: "Словарь", icon: <BookOpenText weight="fill" aria-hidden /> },
  TABS[3]!,
];

/**
 * Нижняя навигация ученика на 4 вкладки (prototype .tabbar): «Путь», «Лига», «Класс», «Профиль». Адреса задаёт
 * приложение — веб и Telegram Mini App строят их от своего префикса.
 */
export function StudentTabBar({ current, hrefs }: { current?: StudentTab; hrefs: Record<StudentTab, string> }) {
  return <BottomNav items={TABS.map((t) => ({ href: hrefs[t.key], label: t.label, icon: t.icon, current: t.key === current }))} />;
}

/** Боковая навигация ученика на компьютере и планшете: «Путь», «Лига», «Класс», «Словарь», «Профиль». */
export function StudentSideNav({ current, hrefs, home }: { current?: StudentSection; hrefs: Record<StudentSection, string>; home: string }) {
  return <SideNav home={home} items={SECTIONS.map((s) => ({ href: hrefs[s.key], label: s.label, icon: s.icon, current: s.key === current }))} />;
}
