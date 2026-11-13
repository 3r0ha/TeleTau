"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Префикс адресов экранов ученика: "" — обычный веб, "/miniapp" — Telegram Mini App (docs/plans/M2.md §3 «Ч4»/«Ч5»).
 * Mini App переиспользует страницы ученика реэкспортом и оборачивает их в <RoutePrefix prefix="/miniapp">, поэтому
 * все ссылки и переходы экранов ученика строятся только через useStudentPaths().
 */
const PrefixContext = createContext("");

export function RoutePrefix({ prefix, children }: { prefix: string; children: ReactNode }) {
  return <PrefixContext.Provider value={prefix.replace(/\/+$/, "")}>{children}</PrefixContext.Provider>;
}

export interface StudentPaths {
  prefix: string;
  /** Тропа (вкладка «Путь»). */
  learn: string;
  league: string;
  /** «Доска почёта» школ и классов (ТЗ §4.5): раздел бокового меню, на телефоне — вход с «Лиги». */
  board: string;
  hive: string;
  me: string;
  /** «Мой словарь» (вход из профиля). */
  words: string;
  /** Тропа, на которой сразу начинается повторение слов (кнопка «Повторить» в словаре). */
  review: string;
  /** Вход ученика (сессии нет). */
  login: string;
  /** Выбор ника (первый вход по карточке). */
  nickname: string;
  /** Вход по коду класса (без карточки). */
  code: string;
  /** Ожидание, пока учитель подтвердит заявку по коду класса. */
  wait: string;
  /** «Ты в классе» — только при первом входе. */
  joined: string;
  /** Старт приложения (после выхода). */
  start: string;
}

/** Экраны самостоятельного ученика (ADR 0022) — сверх экранов ученика класса. */
export interface LearnerPaths extends StudentPaths {
  /** «Учусь сам» — онбординг без школы. */
  self: string;
  /** Взрослый после входа по почте выбирает «Учиться» или «Я учитель» (ADR 0022). */
  welcome: string;
  /** «Моя карточка входа» самостоятельного ученика. */
  card: string;
  /** «Сохранить прогресс по почте» (взрослый «Учусь сам»). */
  email: string;
  /** «Вступить в класс» по коду — ученик без класса. */
  joinClass: string;
}

export function useStudentPaths(): LearnerPaths {
  const prefix = useContext(PrefixContext);
  return useMemo(
    () => ({
      prefix,
      learn: `${prefix}/learn`,
      league: `${prefix}/league`,
      board: `${prefix}/board`,
      hive: `${prefix}/hive`,
      me: `${prefix}/me`,
      words: `${prefix}/me/words`,
      review: `${prefix}/learn?review=1`,
      login: `${prefix}/student`,
      nickname: `${prefix}/student/nickname`,
      code: `${prefix}/student/code`,
      wait: `${prefix}/student/wait`,
      joined: `${prefix}/student/class`,
      start: prefix || "/",
      self: `${prefix}/self`,
      welcome: `${prefix}/welcome`,
      card: `${prefix}/me/card`,
      email: `${prefix}/me/email`,
      joinClass: `${prefix}/hive/join`,
    }),
    [prefix],
  );
}
