// Подсчёт состояния исходника модуля consensus поверх общих векторов (правило 2): contracts/test-vectors/consensus/
// duel-v0.json и xp/vote.json. Каждый голос в журнале записан относительно своего порядка показа (стороны
// перемешиваются), поэтому каждый вектор прогоняется с разными ориентациями — итог обязан совпасть с ожиданием.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { duelV0, type DuelChoice, type DuelOutcome, type DuelSide, type VoterGroup } from "@teletau/domain-rules";
import { describe, expect, it } from "vitest";
import { canonicalChoice, cellHoney, sidesOf, tallyItem, voterGroupOf, weightOf, type JudgmentRecord } from "../src/modules/consensus/tally.js";

const VECTORS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../contracts/test-vectors");
const load = <T>(file: string) => JSON.parse(readFileSync(resolve(VECTORS, file), "utf8")) as { suite: string; version: number; cases: T[] };

interface DuelCase {
  id: string;
  note: string;
  input: { votes: Array<{ voter: string; group: VoterGroup; choice: DuelChoice }> };
  expected: DuelOutcome;
}
interface VoteCase {
  id: string;
  note: string;
  input: { choice: DuelChoice; decision: { accepted: DuelSide[] } | null };
  expected: { status: "pending" | "final" | "none"; amount: number };
}

const duelSuite = load<DuelCase>("consensus/duel-v0.json");
const voteSuite = load<VoteCase>("xp/vote.json");

const CANON: [string, string] = [randomUUID(), randomUUID()];
const flip = (c: DuelChoice): DuelChoice => (c === "a" ? "b" : c === "b" ? "a" : c);
const idOf = (s: DuelSide | null) => (s === null ? null : s === "a" ? CANON[0] : CANON[1]);

/** Ориентации показа: все прямо, все наоборот, через один и псевдослучайно (по номеру голоса и вектора). */
const ORIENTATIONS: Array<[string, (i: number, caseNo: number) => boolean]> = [
  ["straight", () => false],
  ["swapped", () => true],
  ["alternating", (i) => i % 2 === 1],
  ["scrambled", (i, n) => (i * 7 + n * 3) % 5 < 2],
];

/** Журнал из голосов вектора: голос участника — отдельный judgment; группа и выбор — как в векторе. */
function journal(c: DuelCase, caseNo: number, swapped: (i: number, caseNo: number) => boolean): JudgmentRecord[] {
  const accounts = new Map<string, string>();
  return c.input.votes.map((v, i) => {
    const account = accounts.get(v.voter) ?? randomUUID();
    accounts.set(v.voter, account);
    const sw = swapped(i, caseNo);
    return {
      id: randomUUID(),
      judgeAccountId: account,
      voterGroup: v.group,
      variantAId: sw ? CANON[1] : CANON[0],
      variantBId: sw ? CANON[0] : CANON[1],
      choice: sw ? flip(v.choice) : v.choice,
      createdAt: new Date(Date.UTC(2026, 10, 4, 10, 0, i)),
    };
  });
}

/**
 * Закреплённое решение v0 (ADR 0019): эксперт — как в векторе; иначе первое accepted по ходу журнала, а метка
 * children_prefer — нынешнее большинство детей против закреплённого основного варианта. Считается здесь заново,
 * независимо от tally.ts.
 */
function sticky(c: DuelCase): DuelOutcome {
  if (c.expected.decidedBy === "expert") return c.expected;
  for (let i = 1; i <= c.input.votes.length; i++) {
    const p = duelV0({ votes: c.input.votes.slice(0, i) });
    if (p.status !== "accepted") continue;
    const last = new Map(c.input.votes.map((v) => [v.voter, v]));
    const kids = [...last.values()].filter((v) => v.group === "child");
    const a = kids.reduce((n, v) => n + (v.choice === "a" ? 1 : v.choice === "both" ? 0.5 : 0), 0);
    const b = kids.reduce((n, v) => n + (v.choice === "b" ? 1 : v.choice === "both" ? 0.5 : 0), 0);
    const kidsMajority: DuelSide | null = a > b ? "a" : b > a ? "b" : null;
    const childrenPrefer = p.main && kidsMajority && kidsMajority !== p.main ? kidsMajority : null;
    return { ...c.expected, status: "accepted", accepted: p.accepted, main: p.main, decidedBy: p.decidedBy, childrenPrefer };
  }
  return c.expected;
}

describe(`${duelSuite.suite} v${duelSuite.version} through the consensus tally (votes stored in shown order)`, () => {
  it("the suite is the one this tally was written against", () => {
    expect(duelSuite.version).toBe(1);
    expect(duelSuite.cases.length).toBeGreaterThan(10);
  });

  duelSuite.cases.forEach((c, caseNo) => {
    for (const [name, swapped] of ORIENTATIONS) {
      it(`${c.id} (${name}): ${c.note}`, () => {
        const j = journal(c, caseNo, swapped);
        const t = tallyItem(CANON, j);
        expect(t.journalOutcome).toEqual(c.expected);
        const held = sticky(c);
        expect(t.outcome).toEqual(held);
        expect(t.acceptedVariantIds).toEqual(held.accepted.map(idOf));
        expect(t.mainVariantId).toBe(idOf(held.main));
        expect(t.childrenPreferVariantId).toBe(idOf(held.childrenPrefer));
        expect(t.decidedAt === null).toBe(held.status !== "accepted");
        expect(t.scores).toEqual({ [CANON[0]]: c.expected.weighted.a, [CANON[1]]: c.expected.weighted.b });

        // Сводка по группам — из последних голосов участников, без экспертов (считаем независимо от tally).
        const last = new Map<string, { group: VoterGroup; choice: DuelChoice }>();
        for (const v of c.input.votes) {
          last.delete(v.voter);
          last.set(v.voter, v);
        }
        for (const g of ["child", "teacher", "adult"] as const) {
          const mine = [...last.values()].filter((v) => v.group === g);
          expect(t.votesByGroup[g], `${g}`).toEqual({
            total: mine.length,
            both: mine.filter((v) => v.choice === "both").length,
            skip: mine.filter((v) => v.choice === "skip").length,
            variants: { [CANON[0]]: mine.filter((v) => v.choice === "a").length, [CANON[1]]: mine.filter((v) => v.choice === "b").length },
          });
        }
        // Порядок строк журнала не важен: пересчёт сортирует по времени.
        expect(tallyItem(CANON, [...j].reverse())).toEqual(t);
      });
    }
  });
});

describe(`${voteSuite.suite} v${voteSuite.version} through «Мой вклад» (honey in the orientation of the vote itself)`, () => {
  voteSuite.cases.forEach((c) => {
    for (const swapped of [false, true]) {
      it(`${c.id} (${swapped ? "swapped" : "straight"}): ${c.note}`, () => {
        const vote = { variantAId: swapped ? CANON[1] : CANON[0], variantBId: swapped ? CANON[0] : CANON[1], choice: swapped ? flip(c.input.choice) : c.input.choice };
        const state = c.input.decision ? { status: "accepted" as const, acceptedVariantIds: c.input.decision.accepted.map((s) => idOf(s)!) } : { status: "voting" as const, acceptedVariantIds: [] };
        const cell = cellHoney(vote, state);
        expect(cell.honey).toBe(c.expected.amount);
        expect(cell.status).toBe({ pending: "pending", final: "matured", none: "none" }[c.expected.status]);
        if (cell.status === "matured") expect(cell.agreed).toBe(c.expected.amount === 3);
      });
    }
  });

  it("escalated is not a decision: the vote keeps ripening", () => {
    expect(cellHoney({ variantAId: CANON[0], variantBId: CANON[1], choice: "a" }, { status: "escalated", acceptedVariantIds: [] })).toEqual({ status: "pending", honey: 3 });
    expect(cellHoney({ variantAId: CANON[0], variantBId: CANON[1], choice: "a" }, undefined)).toEqual({ status: "pending", honey: 3 });
  });
});

describe("v0 decision is sticky until M4 (ADR 0019): late votes are counted, the status holds", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 10, 4, 12, 0, s));
  const vote = (s: number, group: VoterGroup, choice: DuelChoice, swapped = s % 2 === 0): JudgmentRecord => ({
    id: randomUUID(),
    judgeAccountId: randomUUID(),
    voterGroup: group,
    variantAId: swapped ? CANON[1] : CANON[0],
    variantBId: swapped ? CANON[0] : CANON[1],
    choice: swapped ? flip(choice) : choice,
    createdAt: at(s),
  });
  // 3 ребёнка и учитель за a — принят (вектор c003); затем 2 взрослых и 4 ребёнка за b.
  const decided = [vote(1, "child", "a"), vote(2, "child", "a"), vote(3, "child", "a"), vote(4, "teacher", "a")];
  const late = [vote(5, "adult", "b"), vote(6, "adult", "b"), vote(7, "child", "b"), vote(8, "child", "b"), vote(9, "child", "b"), vote(10, "child", "b")];

  it("accepted stays accepted with the same main variant and decision time; votes_by_group and scores grow", () => {
    const before = tallyItem(CANON, decided);
    expect(before.outcome).toMatchObject({ status: "accepted", main: "a", decidedBy: "rule" });
    expect(before.decidedAt).toEqual(at(4));

    const after = tallyItem(CANON, [...decided, ...late]);
    expect(after.journalOutcome.status).toBe("escalated"); // без закрепления учителя (a) и взрослые (b) разошлись бы
    expect(after.outcome).toMatchObject({ status: "accepted", accepted: ["a"], main: "a", decidedBy: "rule" });
    expect(after.acceptedVariantIds).toEqual([CANON[0]]);
    expect(after.decidedAt).toEqual(at(4));
    expect(after.votesByGroup.adult).toEqual({ total: 2, both: 0, skip: 0, variants: { [CANON[0]]: 0, [CANON[1]]: 2 } });
    expect(after.votesByGroup.child).toEqual({ total: 7, both: 0, skip: 0, variants: { [CANON[0]]: 3, [CANON[1]]: 4 } });
    expect(after.scores).toEqual({ [CANON[0]]: 6, [CANON[1]]: 8 });
    // Большинство детей теперь за b — вариант b получает метку children_prefer, основным остаётся a.
    expect(after.childrenPreferVariantId).toBe(CANON[1]);
  });

  it("only an expert decision replaces it", () => {
    const expert = vote(11, "expert", "b");
    const t = tallyItem(CANON, [...decided, ...late, expert]);
    expect(t.outcome).toMatchObject({ status: "accepted", accepted: ["b"], main: "b", decidedBy: "expert" });
    expect(t.decidedAt).toEqual(at(11));
    expect(t.childrenPreferVariantId).toBeNull();
  });

  it("escalated and voting are not held: they follow the journal until the first acceptance", () => {
    const t = tallyItem(CANON, [vote(1, "teacher", "a"), vote(2, "adult", "b")]);
    expect(t.outcome.status).toBe("escalated");
    expect(t.decidedAt).toBeNull();
    const resolved = tallyItem(CANON, [vote(1, "teacher", "a"), vote(2, "adult", "b"), vote(3, "teacher", "b"), vote(4, "child", "b")]);
    // После третьего голоса у учителей ничья (большинства нет), перевес b: 5 против 3 — принят; голос ребёнка уже поздний.
    expect(resolved.outcome).toMatchObject({ status: "accepted", main: "b", decidedBy: "rule" });
    expect(resolved.decidedAt).toEqual(at(3));
  });
});

describe("voter groups and orientation", () => {
  it("group comes from the account kind and roles at the time of the vote (docs/03 §4a)", () => {
    expect(voterGroupOf({ kind: "child", roles: ["student"] })).toBe("child");
    expect(voterGroupOf({ kind: "adult", roles: ["teacher"] })).toBe("teacher");
    expect(voterGroupOf({ kind: "adult", roles: [] })).toBe("adult");
    expect(voterGroupOf({ kind: "adult", roles: ["student"] })).toBe("adult");
    expect(voterGroupOf({ kind: "staff", roles: ["moderator"] })).toBeUndefined();
    expect([weightOf("child"), weightOf("adult"), weightOf("teacher"), weightOf("expert")]).toEqual([1, 2, 3, null]);
  });

  it("maps a shown-order choice to the canonical sides and refuses a foreign pair", () => {
    const [x, y] = CANON;
    expect(canonicalChoice({ variantAId: x, variantBId: y, choice: "a" }, CANON)).toBe("a");
    expect(canonicalChoice({ variantAId: y, variantBId: x, choice: "a" }, CANON)).toBe("b");
    expect(canonicalChoice({ variantAId: y, variantBId: x, choice: "both" }, CANON)).toBe("both");
    expect(canonicalChoice({ variantAId: y, variantBId: x, choice: "skip" }, CANON)).toBe("skip");
    expect(canonicalChoice({ variantAId: x, variantBId: randomUUID(), choice: "a" }, CANON)).toBeUndefined();
    expect(sidesOf([y], [y, x])).toEqual(["a"]);
    expect(sidesOf([x, y], [y, x])).toEqual(["a", "b"]);
  });

  it("ignores votes for another pair of variants instead of miscounting them", () => {
    const t = tallyItem(CANON, [
      { id: randomUUID(), judgeAccountId: randomUUID(), voterGroup: "teacher", variantAId: CANON[0], variantBId: randomUUID(), choice: "a", createdAt: new Date() },
    ]);
    expect(t.votes).toEqual([]);
    expect(t.outcome.status).toBe("voting");
  });
});
