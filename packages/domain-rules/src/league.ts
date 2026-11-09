// Недельная лига медоносов (docs/02 §6): 5 тиров, группы до 20 участников одной возрастной группы, неделя пн–вс по Уфе.
// Повышение — первые 5, понижение — последние 3; неделя закрывается лениво, при первом запросе новой недели (это делает
// модуль competition). Правила проверяются юнит-тестами с подменёнными часами (docs/plans/M2.md §3), векторов нет.
import { ufaWeek } from "./calendar.js";

export const LEAGUE_TIERS = ["clover", "buckwheat", "sweetclover", "fireweed", "linden"] as const;
export type LeagueTier = (typeof LEAGUE_TIERS)[number];
export type LeagueOutcome = "promoted" | "stayed" | "demoted";
export type LeagueZone = "promote" | "stay" | "demote";

export const LEAGUE_GROUP_SIZE = 20;
export const LEAGUE_PROMOTE = 5;
export const LEAGUE_DEMOTE = 3;

/** Неделя лиги по Уфе: понедельник, воскресенье и конец недели (понедельник 00:00 по Уфе, момент UTC). */
export const leagueWeek = (now: Date | string) => ufaWeek(now);

/** Зоны тира: на высшем тире повышения нет, на низшем — понижения. */
export function leagueZones(tier: LeagueTier): { promote: number; demote: number } {
  const i = LEAGUE_TIERS.indexOf(tier);
  return { promote: i === LEAGUE_TIERS.length - 1 ? 0 : LEAGUE_PROMOTE, demote: i === 0 ? 0 : LEAGUE_DEMOTE };
}

export interface LeagueEntry {
  id: string;
  points: number;
  /** Когда участник набрал текущие очки (ISO 8601): при равенстве очков выше тот, кто набрал раньше. */
  scoredAt: string;
}

export interface RankedEntry extends LeagueEntry {
  rank: number;
  zone: LeagueZone;
}

/**
 * Места в группе: по очкам, при равенстве — кто раньше набрал, затем по id (детерминированно). Зоны: первые `promote`
 * с очками > 0 — повышение; последние `demote` (не пересекаясь с повышением) — понижение.
 */
export function rankGroup(tier: LeagueTier, entries: readonly LeagueEntry[]): RankedEntry[] {
  const zones = leagueZones(tier);
  const sorted = [...entries].sort(
    (x, y) => y.points - x.points || Date.parse(x.scoredAt) - Date.parse(y.scoredAt) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  );
  const n = sorted.length;
  const demoteFrom = Math.max(zones.promote, n - zones.demote); // индекс, с которого понижение
  return sorted.map((e, i) => ({
    ...e,
    rank: i + 1,
    zone: i < zones.promote && e.points > 0 ? "promote" : i >= demoteFrom ? "demote" : "stay",
  }));
}

/** Тир после итога недели. */
export function nextTier(tier: LeagueTier, zone: LeagueZone): LeagueTier {
  const i = LEAGUE_TIERS.indexOf(tier);
  if (zone === "promote") return LEAGUE_TIERS[Math.min(i + 1, LEAGUE_TIERS.length - 1)]!;
  if (zone === "demote") return LEAGUE_TIERS[Math.max(i - 1, 0)]!;
  return tier;
}

export interface WeekResult {
  id: string;
  rank: number;
  points: number;
  outcome: LeagueOutcome;
  tierBefore: LeagueTier;
  tierAfter: LeagueTier;
}

/** Итог закрытой недели для группы тира `tier`. */
export function closeWeek(tier: LeagueTier, entries: readonly LeagueEntry[]): WeekResult[] {
  return rankGroup(tier, entries).map((e) => {
    const tierAfter = nextTier(tier, e.zone);
    const outcome: LeagueOutcome = tierAfter === tier ? "stayed" : e.zone === "promote" ? "promoted" : "demoted";
    return { id: e.id, rank: e.rank, points: e.points, outcome, tierBefore: tier, tierAfter };
  });
}
