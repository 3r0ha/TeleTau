"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Drop, Fire } from "@phosphor-icons/react/ssr";
import { Bee, GoalMeter, Illustration, StudentSideNav, StudentTabBar, leagueBadges, type StudentSection } from "@teletau/ui";
import { useRequireAccount } from "@teletau/session/react";
import type { Me } from "@teletau/session/types";
import { useT } from "../../../i18n/client";
import { plural, TIER_NAMES } from "./format";
import type { MyProgress } from "./model";
import { useStudentPaths } from "./paths";
import { StudentRail, type RailData } from "./StudentRail";

/**
 * Экраны ученика — только для вошедшего ученика с ником: ребёнка или взрослого, который выбрал «Учиться» (ADR 0022).
 * Без сессии — вход по карточке; ребёнок без ника — выбор ника; взрослый без ника — выбор «Учиться / Я учитель».
 * Возвращает аккаунт или null, пока сессия восстанавливается.
 */
export function useStudent(): Me | null {
  const paths = useStudentPaths();
  const account = useRequireAccount(["child", "adult"], paths.login);
  const router = useRouter();
  useEffect(() => {
    if (account && !account.nickname) router.replace(account.kind === "adult" ? paths.welcome : paths.nickname);
  }, [account, router, paths.nickname, paths.welcome]);
  return account?.nickname ? account : null;
}

/** Класс ученика (первый, где он ученик). */
export function studentClass(me: Me | null) {
  return me?.classes.find((c) => c.role === "student") ?? me?.classes[0];
}

/**
 * Каркас вкладки ученика (shell.css). Телефон: верхняя панель (по желанию), колонка и нижняя навигация на 4 вкладки.
 * Компьютер и планшет: слева — боковая навигация на 6 разделов (с «Доской» и «Словарём»), в центре — содержимое вкладки,
 * с 1024 px справа — колонка карточек (StudentRail). Telegram Mini App — всегда как телефон: он открывается в окне
 * клиента Telegram, а не на весь экран.
 */
export function StudentShell({
  tab,
  top,
  children,
  className,
  rail,
}: {
  tab: StudentSection;
  top?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Данные, которые вкладка уже загрузила, и действия тропы — правой колонке (иначе она загрузит их сама). */
  rail?: RailData;
}) {
  const paths = useStudentPaths();
  const phone = paths.prefix !== "";
  return (
    <div className={["tt-page", "student", !phone && "tt-shell"].filter(Boolean).join(" ")} data-tab={tab}>
      {phone ? null : (
        <StudentSideNav
          current={tab}
          home={paths.learn}
          hrefs={{ path: paths.learn, league: paths.league, board: paths.board, hive: paths.hive, words: paths.words, me: paths.me }}
        />
      )}
      <div className="tt-shell__body">
        <div className="tt-shell__center">
          {top}
          <main id="main" className={["tt-main", "student__main", className].filter(Boolean).join(" ")}>
            <div className="tt-column student__column">{children}</div>
          </main>
        </div>
        {phone ? null : <StudentRail tab={tab} {...rail} />}
      </div>
      {/* «Доска» — раздел бокового меню; на телефоне вход с «Лиги», поэтому в нижней навигации подсвечена она. */}
      <StudentTabBar current={tab === "words" ? "me" : tab === "board" ? "league" : tab} hrefs={{ path: paths.learn, league: paths.league, hive: paths.hive, me: paths.me }} />
    </div>
  );
}

/**
 * Верхняя панель тропы (prototype .topbar): цель дня в сотах («1 из 2 сот»), серия, мёд и значок лиги. Граница
 * появляется при прокрутке.
 */
export function LearnTopBar({ progress }: { progress: MyProgress | undefined }) {
  const paths = useStudentPaths();
  const t = useT();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 4);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  const streak = progress?.streak.current ?? 0;
  const honey = progress?.honey.total ?? 0;
  const tier = progress?.league?.tier;
  return (
    <header className="tt-topbar learn-top" data-scrolled={scrolled}>
      <div className="tt-column learn-top__inner">
        {progress?.dailyGoal ? <GoalMeter done={progress.dailyGoal.done} target={progress.dailyGoal.target} className="learn-goal" /> : null}
        <p className={["learn-stat", "learn-stat--streak", streak > 0 && "learn-stat--lit"].filter(Boolean).join(" ")}>
          <Fire weight="fill" aria-hidden />
          <span aria-hidden>{progress ? streak : "–"}</span>
          <span className="tt-visually-hidden">
            {t("Серия: {n} {word} подряд", { n: streak, word: plural(streak, [t("день"), t("дня"), t("дней")]) })}
          </span>
        </p>
        <p className="learn-stat learn-stat--honey">
          <Drop weight="fill" aria-hidden />
          <span aria-hidden>{progress ? honey : "–"}</span>
          <span className="tt-visually-hidden">{t("Мёд: {n}", { n: honey })}</span>
        </p>
        {tier ? (
          <Link href={paths.league} className="learn-stat learn-stat--league" aria-label={t("Лига {name}", { name: t(TIER_NAMES[tier].gen) })}>
            <Illustration name={leagueBadges[tier]} width={30} />
          </Link>
        ) : (
          <span className="learn-stat learn-stat--league" aria-hidden />
        )}
      </div>
    </header>
  );
}

/** Заставка (prototype 22-splash): медовый экран с летящей пчелой — пока открывается тропа. */
export function Splash() {
  const t = useT();
  return (
    <div className="learn-splash" role="status" aria-label={t("Открываем тропу")}>
      <Bee frame="beeFly" width={200} className="learn-splash__bee" />
      {/* «ТелеТау» — имя бренда, needs_native_review (docs/native-review-queue.md, №1) */}
      <p className="learn-splash__brand" lang="ba">
        ТелеТау
      </p>
      <p className="learn-splash__tagline">{t("башкирский язык каждый день")}</p>
    </div>
  );
}
