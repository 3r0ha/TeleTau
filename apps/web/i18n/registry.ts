// Каталоги переводов: области приложения (строки раздаются по файлам, чтобы правки не конфликтовали) и общий файл
// для строк нескольких областей. Ключ — точная русская строка из кода; каждый ключ живёт ровно в одном файле
// языка (test/i18n-catalogs.test.ts); непереведённое остаётся русским (фолбэк в core.ts).
import { makeT, type Locale, type T } from "./core";
import { commonba } from "./areas/common.ba";
import { commonkk } from "./areas/common.kk";
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
import { errorsba } from "./areas/errors.ba";
import { errorskk } from "./areas/errors.kk";

type Catalog = Record<string, string>;

/** Файлы каталога по языкам: тест проверяет, что ключ не повторяется между файлами. */
export const CATALOG_PARTS: Record<Exclude<Locale, "ru">, Record<string, Catalog>> = {
  ba: { common: commonba, landing: landingba, entry: entryba, learn: learnba, student: studentba, social: socialba, teacher: teacherba, miniapp: miniappba, errors: errorsba },
  kk: { common: commonkk, landing: landingkk, entry: entrykk, learn: learnkk, student: studentkk, social: socialkk, teacher: teacherkk, miniapp: miniappkk, errors: errorskk },
};

export const CATALOGS: Record<Exclude<Locale, "ru">, Catalog> = {
  ba: Object.assign({}, ...Object.values(CATALOG_PARTS.ba)) as Catalog,
  kk: Object.assign({}, ...Object.values(CATALOG_PARTS.kk)) as Catalog,
};

const translators = new Map<Locale, T>();

/**
 * Переводчик для известного языка; «ru» — тождественный (строка как есть). Один и тот же объект на язык: его можно
 * класть в зависимости эффектов и useCallback, смена рендера не перезапускает их.
 */
export function tFor(locale: Locale): T {
  let t = translators.get(locale);
  if (!t) {
    t = makeT(locale, locale === "ru" ? null : CATALOGS[locale]);
    translators.set(locale, t);
  }
  return t;
}
