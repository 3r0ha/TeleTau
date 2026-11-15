// Разделы консоли по ролям сотрудника (ADR 0017, 0023). Роли ministry и fund приходят только в
// `Me.staffRoles` — набор `Role` в контракте закрыт базовой версией, поэтому смотрим сначала туда.
import type { Me } from "@teletau/session/types";

export type SectionKey = "republic" | "fund" | "verifications" | "audit";

interface Section {
  key: SectionKey;
  href: string;
  label: string;
  /** Роли, которым раздел открыт (как x-access его операций в контракте). */
  roles: readonly string[];
}

/** Порядок — порядок в меню и выбор «домашнего» раздела. */
export const SECTIONS: readonly Section[] = [
  { key: "republic", href: "/republic", label: "Республика", roles: ["ministry"] },
  { key: "fund", href: "/fund", label: "Словарь для Фонда", roles: ["fund"] },
  { key: "verifications", href: "/verifications", label: "Заявки учителей", roles: ["moderator", "admin"] },
  { key: "audit", href: "/audit", label: "Журнал аудита", roles: ["moderator", "admin"] },
];

/** Роли сотрудника: `staffRoles` (все роли, в том числе новые) или, у старого ответа, `roles`. */
function staffRolesOf(me: Me): string[] {
  if (me.kind !== "staff") return [];
  return me.staffRoles ?? me.roles;
}

export function sectionsFor(me: Me): Section[] {
  const roles = staffRolesOf(me);
  return SECTIONS.filter((s) => s.roles.some((r) => roles.includes(r)));
}

/** Есть ли у учётной записи хотя бы один раздел консоли. */
export function isStaff(me: Me): boolean {
  return sectionsFor(me).length > 0;
}

/** Куда вести после входа: первый доступный раздел. */
export function homeOf(me: Me): string {
  return sectionsFor(me)[0]?.href ?? "/login";
}
