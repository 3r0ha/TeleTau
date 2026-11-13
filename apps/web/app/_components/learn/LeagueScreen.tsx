"use client";

import { Fragment } from "react";
import { ArrowRight } from "@phosphor-icons/react/ssr";
import { ButtonLink, EmptyState, GlintBadge, Illustration, LEAGUE_TIERS, LeagueBoard, LeagueRow, LeagueZone, TextLink, leagueBadges } from "@teletau/ui";
import { useResource } from "@teletau/session/react";
import { LoadError, LoadingBlock } from "../screens";
import { learnApi } from "./api";
import { TIER_NAMES, weekEndsIn } from "./format";
import type { LeagueStanding } from "./model";
import { useStudentPaths } from "./paths";
import { StudentShell, useStudent } from "./StudentShell";

/** Вкладка «Лига» (prototype 16-league): лиги медоносов, таблица недели с зонами повышения и понижения. */
export function LeagueScreen() {
  const account = useStudent();
  const league = useResource(() => learnApi.league(), [account?.id], { enabled: Boolean(account) });
  return (
    <StudentShell tab="league" className="league" rail={{ league: league.data }}>
      {league.data ? (
        <LeagueView league={league.data} />
      ) : league.error ? (
        <LoadError error={league.error} onRetry={league.reload} audience="child" />
      ) : (
        <LoadingBlock rows={5} label="Загружаем лигу" />
      )}
    </StudentShell>
  );
}

const ZONE = { promote: "up", demote: "down", stay: null } as const;

function LeagueView({ league }: { league: LeagueStanding }) {
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
        <h1 className="page-title">Лига {name.gen}</h1>
        <p className="page-lead">
          {next && league.zones.promote > 0 ? `Первые ${league.zones.promote} перейдут в Лигу ${TIER_NAMES[next].gen}.` : "Это высшая лига."}
          <br />
          Итоги {weekEndsIn(league.endsAt)}.
        </p>
      </header>
      {climbing && next ? (
        <section className="league__cheer" aria-labelledby="league-cheer-title">
          <Illustration name="beeProud" width={58} className="league__cheer-bee" />
          <div>
            <h2 className="league__cheer-title" id="league-cheer-title">
              Ты в зоне повышения
            </h2>
            <p className="league__cheer-text">Удержи место до конца недели.</p>
          </div>
        </section>
      ) : null}
      {members.length ? (
        <LeagueBoard label={`Лига ${name.gen}: участники недели`}>
          {members.map((m, i) => (
            <Fragment key={`${m.rank}-${m.nickname ?? i}`}>
              {i === firstDown && firstDown > 0 ? <LeagueZone kind="down" /> : null}
              <LeagueRow rank={m.rank} nickname={m.nickname ?? "Участник"} points={m.points} me={m.me} zone={ZONE[m.zone]} />
              {i === lastUp && lastUp < members.length - 1 ? <LeagueZone kind="up" /> : null}
            </Fragment>
          ))}
        </LeagueBoard>
      ) : (
        <EmptyState
          art="beeIdle"
          title="Лига ждёт тебя"
          headingAs="h2"
          compact
          actions={
            <ButtonLink href={paths.learn} block>
              На тропу
            </ButtonLink>
          }
        >
          Пройди урок, чтобы попасть в таблицу.
        </EmptyState>
      )}
      {/* Доска почёта школ и классов — отдельный раздел; на телефоне это основной вход к ней (в нижних вкладках её нет). */}
      <p className="league__board-link">
        <TextLink href={paths.board}>
          Доска почёта школ
          <ArrowRight weight="bold" aria-hidden />
        </TextLink>
      </p>
    </>
  );
}
