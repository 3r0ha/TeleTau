"use client";

import { Fragment } from "react";
import { ArrowRight } from "@phosphor-icons/react/ssr";
import { ButtonLink, EmptyState, GlintBadge, Illustration, LEAGUE_TIERS, LeagueBoard, LeagueRow, LeagueZone, TextLink, leagueBadges } from "@teletau/ui";
import { useResource } from "@teletau/session/react";
import { useT } from "../../../i18n/client";
import type { T } from "../../../i18n/core";
import { LoadError, LoadingBlock } from "../screens";
import { learnApi } from "./api";
import { plural, TIER_NAMES } from "./format";
import type { LeagueStanding } from "./model";
import { useStudentPaths } from "./paths";
import { StudentShell, useStudent } from "./StudentShell";

/** Вкладка «Лига» (prototype 16-league): лиги медоносов, таблица недели с зонами повышения и понижения. */
export function LeagueScreen() {
  const t = useT();
  const account = useStudent();
  const league = useResource(() => learnApi.league(), [account?.id], { enabled: Boolean(account) });
  return (
    <StudentShell tab="league" className="league" rail={{ league: league.data }}>
      {league.data ? (
        <LeagueView league={league.data} />
      ) : league.error ? (
        <LoadError error={league.error} onRetry={league.reload} audience="child" />
      ) : (
        <LoadingBlock rows={5} label={t("Загружаем лигу")} />
      )}
    </StudentShell>
  );
}

const ZONE = { promote: "up", demote: "down", stay: null } as const;

const DAY_MS = 86_400_000;

/** «через 3 дня» / «сегодня» до конца недели лиги (format.weekEndsIn остаётся русским — здесь переводимая версия). */
function weekEndText(weekEndsAt: string, t: T): string {
  const days = Math.ceil((Date.parse(weekEndsAt) - Date.now()) / DAY_MS);
  if (!Number.isFinite(days) || days <= 1) return t("сегодня");
  return t("через {n} {word}", { n: days, word: plural(days, [t("день"), t("дня"), t("дней")]) });
}

function LeagueView({ league }: { league: LeagueStanding }) {
  const t = useT();
  const paths = useStudentPaths();
  const tierIndex = LEAGUE_TIERS.indexOf(league.tier);
  const next = LEAGUE_TIERS[tierIndex + 1];
  const name = TIER_NAMES[league.tier];
  const members = league.members;
  const lastUp = members.reduce((acc, m, i) => (m.zone === "promote" ? i : acc), -1);
  const firstDown = members.findIndex((m) => m.zone === "demote");
  const climbing = Boolean(next) && members.some((m) => m.me && m.zone === "promote");
  return (
    <>
      <div className="league__badges" aria-hidden>
        {LEAGUE_TIERS.map((t, i) =>
          i === tierIndex ? (
            <GlintBadge key={t} name={leagueBadges[t]} width={104} className="league__badge league__badge--current" />
          ) : (
            <Illustration key={t} name={leagueBadges[t]} width={54} className={i < tierIndex ? "league__badge" : "league__badge league__badge--future"} />
          ),
        )}
      </div>
      <header className="league__head">
        <h1 className="page-title">{t("Лига {name}", { name: t(name.gen) })}</h1>
        <p className="page-lead">
          {next && league.zones.promote > 0
            ? t("Первые {n} перейдут в Лигу {league}.", { n: league.zones.promote, league: t(TIER_NAMES[next].gen) })
            : t("Это высшая лига.")}
          <br />
          {t("Итоги {when}.", { when: weekEndText(league.endsAt, t) })}
        </p>
      </header>
      {climbing && next ? (
        <section className="league__cheer" aria-labelledby="league-cheer-title">
          <Illustration name="beeProud" width={58} className="league__cheer-bee" />
          <div>
            <h2 className="league__cheer-title" id="league-cheer-title">
              {t("Ты в зоне повышения")}
            </h2>
            <p className="league__cheer-text">{t("Удержи место до конца недели.")}</p>
          </div>
        </section>
      ) : null}
      {members.length ? (
        <LeagueBoard label={t("Лига {name}: участники недели", { name: t(name.gen) })}>
          {members.map((m, i) => (
            <Fragment key={`${m.rank}-${m.nickname ?? i}`}>
              {i === firstDown && firstDown > 0 ? <LeagueZone kind="down" /> : null}
              <LeagueRow rank={m.rank} nickname={m.nickname ?? t("Участник")} points={m.points} me={m.me} zone={ZONE[m.zone]} />
              {i === lastUp && lastUp < members.length - 1 ? <LeagueZone kind="up" /> : null}
            </Fragment>
          ))}
        </LeagueBoard>
      ) : (
        <EmptyState
          art="beeIdle"
          title={t("Лига ждёт тебя")}
          headingAs="h2"
          compact
          actions={
            <ButtonLink href={paths.learn} block>
              {t("На тропу")}
            </ButtonLink>
          }
        >
          {t("Пройди урок, чтобы попасть в таблицу.")}
        </EmptyState>
      )}
      {/* Доска почёта школ и классов — отдельный раздел; на телефоне это основной вход к ней (в нижних вкладках её нет). */}
      <p className="league__board-link">
        <TextLink href={paths.board}>
          {t("Доска почёта школ")}
          <ArrowRight weight="bold" aria-hidden />
        </TextLink>
      </p>
    </>
  );
}
