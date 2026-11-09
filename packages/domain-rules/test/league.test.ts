// Лига проверяется юнит-тестами, без общих векторов (docs/plans/M2.md §3): неделя пн–вс по Уфе, первые 5 вверх, последние 3 вниз.
import { describe, expect, it } from "vitest";
import { closeWeek, leagueWeek, leagueZones, rankGroup, type LeagueEntry } from "../src/index.js";

const entries = (n: number): LeagueEntry[] =>
  Array.from({ length: n }, (_, i) => ({ id: `m${String(i).padStart(2, "0")}`, points: 100 - i * 5, scoredAt: "2026-11-03T10:00:00Z" }));

describe("league week (Ufa, Mon–Sun)", () => {
  it("Sunday 23:59 in Ufa is still the old week, Monday 00:00 in Ufa starts a new one", () => {
    expect(leagueWeek("2026-11-08T18:59:59Z")).toMatchObject({ start: "2026-11-02", end: "2026-11-08" });
    expect(leagueWeek("2026-11-08T19:00:00Z")).toMatchObject({ start: "2026-11-09", end: "2026-11-15" });
  });

  it("the week ends at Monday 00:00 Ufa = Sunday 19:00 UTC", () => {
    expect(leagueWeek("2026-11-04T12:00:00Z").endsAt.toISOString()).toBe("2026-11-08T19:00:00.000Z");
  });
});

describe("league zones and results", () => {
  it("top 5 are promoted and bottom 3 demoted in a middle tier", () => {
    const ranked = rankGroup("buckwheat", entries(10));
    expect(ranked.map((r) => r.zone)).toEqual(["promote", "promote", "promote", "promote", "promote", "stay", "stay", "demote", "demote", "demote"]);
  });

  it("no promotion from the top tier, no demotion from the bottom tier", () => {
    expect(leagueZones("linden")).toEqual({ promote: 0, demote: 3 });
    expect(leagueZones("clover")).toEqual({ promote: 5, demote: 0 });
    expect(rankGroup("clover", entries(10)).filter((r) => r.zone === "demote")).toEqual([]);
    expect(closeWeek("linden", entries(10)).filter((r) => r.outcome === "promoted")).toEqual([]);
  });

  it("small groups: promotion wins over demotion, zones never overlap", () => {
    expect(rankGroup("fireweed", entries(6)).map((r) => r.zone)).toEqual(["promote", "promote", "promote", "promote", "promote", "demote"]);
    expect(rankGroup("fireweed", entries(3)).map((r) => r.zone)).toEqual(["promote", "promote", "promote"]);
  });

  it("ties are broken by who scored first, then by id", () => {
    const tied: LeagueEntry[] = [
      { id: "b", points: 50, scoredAt: "2026-11-03T10:00:00Z" },
      { id: "a", points: 50, scoredAt: "2026-11-03T10:00:00Z" },
      { id: "c", points: 50, scoredAt: "2026-11-02T10:00:00Z" },
    ];
    expect(rankGroup("clover", tied).map((r) => [r.id, r.rank])).toEqual([
      ["c", 1],
      ["a", 2],
      ["b", 3],
    ]);
  });

  it("members without points are not promoted", () => {
    const zeros = entries(3).map((e) => ({ ...e, points: 0 }));
    expect(rankGroup("clover", zeros).map((r) => r.zone)).toEqual(["stay", "stay", "stay"]);
  });

  it("closeWeek moves tiers by one step", () => {
    const res = closeWeek("sweetclover", entries(10));
    expect(res[0]).toMatchObject({ rank: 1, outcome: "promoted", tierBefore: "sweetclover", tierAfter: "fireweed" });
    expect(res[5]).toMatchObject({ outcome: "stayed", tierAfter: "sweetclover" });
    expect(res[9]).toMatchObject({ outcome: "demoted", tierAfter: "buckwheat" });
  });
});
