// Дуэль v0 — правила решения до Consensus Engine (ADR 0019, docs/03 §4a). Чистая функция журнала голосов:
// состояние исходника всегда пересчитывается из неизменяемых judgments (правило 9). Векторы — contracts/test-vectors/consensus/.
import type { DuelChoice, DuelSide } from "./xp.js";

export const DUEL_RULES_VERSION = "duel-v0";

export type VoterGroup = "child" | "adult" | "teacher" | "expert";
export type DuelStatus = "voting" | "accepted" | "escalated";

/** Вес голоса группы (эксперт не взвешивается — он решает). */
export const DUEL_WEIGHTS: Readonly<Record<Exclude<VoterGroup, "expert">, number>> = { child: 1, adult: 2, teacher: 3 };
/** Сколько голосов (a, b, both) нужно для решения по правилу. */
export const DUEL_MIN_VOTES = 3;
/** Взвешенный перевес лидера для решения по правилу. */
export const DUEL_MIN_LEAD = 2;

export interface DuelVote {
  /** Идентификатор участника (у участника учитывается последний голос). */
  voter: string;
  group: VoterGroup;
  choice: DuelChoice;
}

export interface DuelOutcome {
  status: DuelStatus;
  /** Принятые варианты (пусто, пока решения нет). */
  accepted: DuelSide[];
  /** Основной вариант; null — решения нет или эксперт принял оба. */
  main: DuelSide | null;
  decidedBy: "rule" | "expert" | null;
  /** Вариант, который предпочли дети вопреки итогу (метка children_prefer). */
  childrenPrefer: DuelSide | null;
  weighted: { a: number; b: number };
  /** Голосов a, b, both (без экспертов и «Не знаю»). */
  counted: number;
}

/** Большинство внутри группы без весов: both — по 0,5 обоим, skip не считается, ничья — null. */
function majority(votes: readonly DuelVote[]): DuelSide | null {
  let a = 0;
  let b = 0;
  for (const v of votes) {
    if (v.choice === "a") a += 1;
    else if (v.choice === "b") b += 1;
    else if (v.choice === "both") {
      a += 0.5;
      b += 0.5;
    }
  }
  return a > b ? "a" : b > a ? "b" : null;
}

export function duelV0(input: { votes: readonly DuelVote[] }): DuelOutcome {
  const last = new Map<string, DuelVote>();
  for (const v of input.votes) {
    last.delete(v.voter); // порядок Map — по последнему голосу
    last.set(v.voter, v);
  }
  const votes = [...last.values()];
  const people = votes.filter((v) => v.group !== "expert" && v.choice !== "skip");
  const of = (g: VoterGroup) => people.filter((v) => v.group === g);

  const weighted = { a: 0, b: 0 };
  for (const v of people) {
    const w = DUEL_WEIGHTS[v.group as Exclude<VoterGroup, "expert">];
    if (v.choice === "a") weighted.a += w;
    else if (v.choice === "b") weighted.b += w;
    else {
      weighted.a += w / 2;
      weighted.b += w / 2;
    }
  }
  const counted = people.length;
  const childMajority = majority(of("child"));
  const preferOf = (main: DuelSide | null) => (main && childMajority && childMajority !== main ? childMajority : null);
  const undecided = (status: DuelStatus): DuelOutcome => ({ status, accepted: [], main: null, decidedBy: null, childrenPrefer: null, weighted, counted });

  const expert = votes.filter((v) => v.group === "expert" && v.choice !== "skip").at(-1);
  if (expert) {
    const main = expert.choice === "both" ? null : (expert.choice as DuelSide);
    const accepted: DuelSide[] = main ? [main] : ["a", "b"];
    return { status: "accepted", accepted, main, decidedBy: "expert", childrenPrefer: preferOf(main), weighted, counted };
  }

  if (of("teacher").length === 0 && of("adult").length === 0) return undecided("voting");
  const teachers = majority(of("teacher"));
  const adults = majority(of("adult"));
  if (teachers && adults && teachers !== adults) return undecided("escalated");

  if (counted >= DUEL_MIN_VOTES && Math.abs(weighted.a - weighted.b) >= DUEL_MIN_LEAD) {
    const main: DuelSide = weighted.a > weighted.b ? "a" : "b";
    return { status: "accepted", accepted: [main], main, decidedBy: "rule", childrenPrefer: preferOf(main), weighted, counted };
  }
  return undecided("voting");
}
