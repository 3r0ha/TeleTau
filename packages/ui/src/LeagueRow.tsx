import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Drop } from "@phosphor-icons/react/ssr";
import { HEX_TONES, HexAvatar } from "./HexAvatar";
import { avatarFor } from "./illustrations";

export type LeagueZoneKind = "up" | "down";

/** Таблица лиги (prototype .board): нумерованный список строк и разделителей зон. */
export function LeagueBoard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ol className="tt-board" aria-label={label}>
      {children}
    </ol>
  );
}

export interface LeagueRowProps {
  rank: number;
  nickname: string;
  points: number;
  /** Это я — медовая подложка, чип «ты» и aria-current. */
  me?: boolean;
  /** Строка в зоне повышения или понижения (для читалок; зелёный номер — у зоны повышения). */
  zone?: LeagueZoneKind | null;
}

const ZONE_TEXT: Record<LeagueZoneKind, string> = { up: "Зона повышения", down: "Зона понижения" };

/**
 * Строка лиги: место, шестиугольный аватар (персонаж по существительному ника в рамке; ник не из словаря — заливка;
 * цвет — по месту, как в прототипе: 5 тонов, затем их глубокие оттенки), придуманный ник, мёд за неделю.
 * В лиге только ники из словаря — никаких имён (CLAUDE.md, правило 5).
 */
export function LeagueRow({ rank, nickname, points, me, zone }: LeagueRowProps) {
  const i = Math.max(0, rank - 1) % (HEX_TONES.length * 2);
  const ava = { tone: HEX_TONES[i % HEX_TONES.length]!, deep: i >= HEX_TONES.length };
  return (
    <li className={["tt-lrow", me && "tt-lrow--me"].filter(Boolean).join(" ")} aria-current={me ? "true" : undefined}>
      <span className={["tt-lrow__rank", zone === "up" && "tt-lrow__rank--up"].filter(Boolean).join(" ")}>
        <span className="tt-visually-hidden">Место </span>
        {rank}
      </span>
      <HexAvatar size={40} tone={ava.tone} deep={ava.deep} art={avatarFor(nickname)} />
      <span className="tt-lrow__nick">
        {nickname}
        {me ? <span className="tt-lrow__me">ты</span> : null}
        {zone ? <span className="tt-visually-hidden">, {ZONE_TEXT[zone].toLowerCase()}</span> : null}
      </span>
      <span className="tt-lrow__pts">
        <Drop weight="fill" aria-hidden />
        {points}
        <span className="tt-visually-hidden"> мёда</span>
      </span>
    </li>
  );
}

/** Разделитель зоны («↑ Зона повышения» под последним повышаемым, «↓ Зона понижения» над первым понижаемым). */
export function LeagueZone({ kind }: { kind: LeagueZoneKind }) {
  return (
    <li className={`tt-lzone tt-lzone--${kind}`} aria-hidden="true">
      {kind === "up" ? <ArrowUp weight="bold" /> : <ArrowDown weight="bold" />}
      {ZONE_TEXT[kind]}
    </li>
  );
}
