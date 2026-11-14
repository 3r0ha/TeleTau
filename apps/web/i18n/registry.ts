// Каталоги переводов: области приложения (строки раздаются по файлам, чтобы правки не конфликтовали).
// Ключ каждого словаря — точная русская строка из кода; непереведённое остаётся русским (фолбэк в core.ts).
import { makeT, type Locale, type T } from "./core";
import { landingba } from "./areas/landing.ba";
import { landingkk } from "./areas/landing.kk";
import { entryba } from "./areas/entry.ba";
import { entrykk } from "./areas/entry.kk";
import { learnba } from "./areas/learn.ba";
import { learnkk } from "./areas/learn.kk";
import { studentba } from "./areas/student.ba";
import { studentkk } from "./areas/student.kk";
import { socialba } from "./areas/social.ba";
import { socialkk } from "./areas/social.kk";
import { teacherba } from "./areas/teacher.ba";
import { teacherkk } from "./areas/teacher.kk";
import { miniappba } from "./areas/miniapp.ba";
import { miniappkk } from "./areas/miniapp.kk";

export const CATALOGS: Record<Exclude<Locale, "ru">, Record<string, string>> = {
  ba: {
    ...landingba,
    ...entryba,
    ...learnba,
    ...studentba,
    ...socialba,
    ...teacherba,
    ...miniappba,
  },
  kk: {
    ...landingkk,
    ...entrykk,
    ...learnkk,
    ...studentkk,
    ...socialkk,
    ...teacherkk,
    ...miniappkk,
  },
};

/** Переводчик для известного языка; «ru» — тождественный (строка как есть). */
export function tFor(locale: Locale): T {
  return makeT(locale, locale === "ru" ? null : CATALOGS[locale]);
}
