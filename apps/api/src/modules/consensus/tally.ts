// Подсчёт состояния исходника по журналу judgments — чистые функции без ввода-вывода (правило 9: item_state всегда
// пересчитываем из журнала). Решение — duelV0 из @teletau/domain-rules (векторы contracts/test-vectors/consensus/,
// ADR 0019); здесь только приведение голосов к сторонам a/b и сводка по группам для показа (docs/03 §4a).
//
// Каждый голос записан относительно порядка показа (A, B — у каждого голосующего свой, стороны перемешиваются).
// Для правил голоса приводятся к каноническому порядку вариантов исходника: canon[0] — «a», canon[1] — «b».
//
// Решение v0 «липкое» (ADR 0019): журнал проходится по времени, и первое accepted
// закрепляется — поздние голоса пишутся в журнал и в votes_by_group/scores, но статус и принятые варианты не меняют.
// Отменить или заменить его может только решение эксперта. Это тоже чистая функция журнала: пересчёт даёт то же
// состояние. Пересчёт без закрепления — задача Consensus Engine.
import { agreesWith, DUEL_WEIGHTS, duelV0, voteHoney, type DuelChoice, type DuelOutcome, type DuelSide, type DuelStatus, type VoterGroup } from "@teletau/domain-rules";
import type { Principal } from "../../common/auth.js";

/** Группы, голоса которых показываются раздельно (эксперт — отдельная роль, решает, но не входит в сводку). */
export type TallyGroup = Exclude<VoterGroup, "expert">;
export const TALLY_GROUPS: readonly TallyGroup[] = ["child", "teacher", "adult"];

/** Голос из журнала — поля judgments, нужные для подсчёта. */
export interface JudgmentRecord {
  id: string;
  judgeAccountId: string;
  voterGroup: VoterGroup;
  /** Варианты в порядке показа этому голосующему. */
  variantAId: string;
  variantBId: string;
  choice: DuelChoice;
  createdAt: Date;
}

/** Сводка одной группы, как в item_state.votes_by_group: variants — число голосов за вариант по его id. */
export interface StoredGroupTally {
  total: number;
  both: number;
  skip: number;
  variants: Record<string, number>;
}
export type VotesByGroup = Record<TallyGroup, StoredGroupTally>;

/** Голос в канонической ориентации — для мёда (ProgressService.settleVotes) и сверки. */
export interface CanonicalVote {
  judgmentId: string;
  accountId: string;
  group: VoterGroup;
  choice: DuelChoice;
}

export interface ItemTally {
  /**
   * Действующее состояние: решение — закреплённое (первое accepted в журнале или решение эксперта), weighted и counted —
   * по всему журналу, childrenPrefer — нынешнее большинство детей против основного варианта. Стороны — относительно canon.
   */
  outcome: DuelOutcome;
  /** duelV0 по всему журналу без закрепления — то, что описывают векторы consensus/duel-v0.json. */
  journalOutcome: DuelOutcome;
  /** Момент решения: время голоса, после которого исходник впервые принят (или решения эксперта); нет решения — null. */
  decidedAt: Date | null;
  acceptedVariantIds: string[];
  mainVariantId: string | null;
  childrenPreferVariantId: string | null;
  votesByGroup: VotesByGroup;
  /** Взвешенные очки вариантов: { [variantId]: число }. */
  scores: Record<string, number>;
  /** Учтённые голоса (последний у каждого участника) в порядке времени. */
  votes: CanonicalVote[];
}

/**
 * Группа голосующего по типу аккаунта и ролям на момент голоса (docs/03 §4a): ребёнок — child, подтверждённый
 * учитель (роль teacher) — teacher, другой взрослый — adult. Сотрудники не голосуют.
 */
export function voterGroupOf(voter: Pick<Principal, "kind" | "roles">): TallyGroup | undefined {
  if (voter.kind === "child") return "child";
  if (voter.kind === "adult") return voter.roles.includes("teacher") ? "teacher" : "adult";
  return undefined;
}

/** Вес голоса группы на момент голоса (judgments.weight_snapshot); эксперт — без веса. */
export const weightOf = (group: VoterGroup): number | null => (group === "expert" ? null : DUEL_WEIGHTS[group]);

/** Голос, записанный относительно показа (A, B), → голос относительно canon. Чужая пара — undefined. */
export function canonicalChoice(j: Pick<JudgmentRecord, "variantAId" | "variantBId" | "choice">, canon: readonly [string, string]): DuelChoice | undefined {
  const straight = j.variantAId === canon[0] && j.variantBId === canon[1];
  const swapped = j.variantAId === canon[1] && j.variantBId === canon[0];
  if (!straight && !swapped) return undefined;
  if (j.choice === "both" || j.choice === "skip" || straight) return j.choice;
  return j.choice === "a" ? "b" : "a";
}

/** Стороны решения относительно произвольной пары (A, B): для мёда в «Моём вкладе» в ориентации самого голоса. */
export function sidesOf(acceptedVariantIds: readonly string[], pair: readonly [string, string]): DuelSide[] {
  const out: DuelSide[] = [];
  if (acceptedVariantIds.includes(pair[0])) out.push("a");
  if (acceptedVariantIds.includes(pair[1])) out.push("b");
  return out;
}

/** Мёд и статус ячейки «Моего вклада» (CellStatus): pending — решения нет, matured — принято, none — «Не знаю». */
export interface CellHoney {
  status: "pending" | "matured" | "none";
  honey: number;
  /** Совпал ли голос с итогом (только у matured). */
  agreed?: boolean;
}

/**
 * Ячейка «Моего вклада» по голосу и состоянию исходника: voteHoney в ориентации самого голоса (его порядок показа A, B) —
 * те же числа, что ProgressService пишет в xp_ledger (pending 3; final 3 при согласии, 1 при несогласии).
 */
export function cellHoney(
  vote: Pick<JudgmentRecord, "variantAId" | "variantBId" | "choice">,
  state: { status: DuelStatus; acceptedVariantIds: readonly string[] } | undefined,
): CellHoney {
  if (vote.choice === "skip") return { status: "none", honey: 0 };
  if (state?.status !== "accepted") return { status: "pending", honey: voteHoney({ choice: vote.choice, decision: null }).amount };
  const decision = { accepted: sidesOf(state.acceptedVariantIds, [vote.variantAId, vote.variantBId]) };
  return { status: "matured", honey: voteHoney({ choice: vote.choice, decision }).amount, agreed: agreesWith(vote.choice, decision) };
}

/** Метка children_prefer против основного варианта: большинство детей без весов (both — по 0,5, skip не считается), как в duelV0. */
function childrenPreferAgainst(votes: readonly CanonicalVote[], main: DuelSide | null): DuelSide | null {
  if (!main) return null;
  let a = 0;
  let b = 0;
  for (const v of votes) {
    if (v.group !== "child") continue;
    if (v.choice === "a") a += 1;
    else if (v.choice === "b") b += 1;
    else if (v.choice === "both") {
      a += 0.5;
      b += 0.5;
    }
  }
  const majority: DuelSide | null = a > b ? "a" : b > a ? "b" : null;
  return majority && majority !== main ? majority : null;
}

const emptyGroup = (canon: readonly [string, string]): StoredGroupTally => ({ total: 0, both: 0, skip: 0, variants: { [canon[0]]: 0, [canon[1]]: 0 } });

/** Состояние исходника по журналу его голосов (в любом порядке — сортируется по времени и id). */
export function tallyItem(canon: readonly [string, string], judgments: readonly JudgmentRecord[]): ItemTally {
  const ordered = [...judgments].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime() || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  // У участника учитывается последний голос (как в duelV0): сводка по группам считает те же голоса, что и правило.
  const last = new Map<string, CanonicalVote>();
  for (const j of ordered) {
    const choice = canonicalChoice(j, canon);
    if (!choice) continue; // голос за другую пару вариантов — импорт этого не допускает (duels-import.ts)
    last.delete(j.judgeAccountId);
    last.set(j.judgeAccountId, { judgmentId: j.id, accountId: j.judgeAccountId, group: j.voterGroup, choice });
  }
  const votes = [...last.values()];
  const asDuel = (list: readonly { accountId: string; group: VoterGroup; choice: DuelChoice }[]) =>
    duelV0({ votes: list.map((v) => ({ voter: v.accountId, group: v.group, choice: v.choice })) });
  const journalOutcome = asDuel(votes);

  // Закреплённое решение: эксперт — всегда его последнее решение; иначе — первое accepted по ходу журнала.
  let outcome: DuelOutcome = journalOutcome;
  let decidedAt: Date | null = null;
  const timeline = ordered.flatMap((j) => {
    const choice = canonicalChoice(j, canon);
    return choice ? [{ accountId: j.judgeAccountId, group: j.voterGroup, choice, at: j.createdAt }] : [];
  });
  if (journalOutcome.decidedBy === "expert") {
    decidedAt = timeline.filter((v) => v.group === "expert" && v.choice !== "skip").at(-1)?.at ?? null;
  } else {
    for (let i = 0; i < timeline.length; i++) {
      const prefix = asDuel(timeline.slice(0, i + 1));
      if (prefix.status !== "accepted") continue;
      outcome = { ...journalOutcome, status: "accepted", accepted: prefix.accepted, main: prefix.main, decidedBy: prefix.decidedBy, childrenPrefer: childrenPreferAgainst(votes, prefix.main) };
      decidedAt = timeline[i]!.at;
      break;
    }
  }

  const votesByGroup = { child: emptyGroup(canon), teacher: emptyGroup(canon), adult: emptyGroup(canon) } satisfies VotesByGroup;
  for (const v of votes) {
    if (v.group === "expert") continue;
    const g = votesByGroup[v.group];
    g.total += 1;
    if (v.choice === "both") g.both += 1;
    else if (v.choice === "skip") g.skip += 1;
    else g.variants[v.choice === "a" ? canon[0] : canon[1]]! += 1;
  }
  const idOf = (side: DuelSide | null) => (side === null ? null : side === "a" ? canon[0] : canon[1]);
  return {
    outcome,
    journalOutcome,
    decidedAt,
    acceptedVariantIds: outcome.accepted.map((s) => idOf(s)!),
    mainVariantId: idOf(outcome.main),
    childrenPreferVariantId: idOf(outcome.childrenPrefer),
    votesByGroup,
    scores: { [canon[0]]: outcome.weighted.a, [canon[1]]: outcome.weighted.b },
    votes,
  };
}
