import { randomInt } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { DUEL_RULES_VERSION, SMALL_GROUP_THRESHOLD, dateToDay, ufaDate, ufaMidnight, ufaWeek } from "@teletau/domain-rules";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Principal } from "../../common/auth.js";
import { decodeCursor, encodeCursor, KeysetCursor } from "../../common/cursor.js";
import { conflict, forbidden, invalidField, notFound, unprocessable } from "../../common/problem.js";
import { typographicQuotes } from "../../common/text.js";
import type { Db } from "../../db/database.js";
import { DB } from "../../infra/tokens.js";
import { CorpusService, type DuelItem } from "../corpus/index.js";
import { classTitle, RosterService } from "../org/index.js";
import { ProgressService } from "../progress/index.js";
import type { ConsensusApi, DuelCard, VoteInput, VoteReceipt, Voter } from "./consensus.api.js";
import { itemState, judgments } from "./consensus.schema.js";
import { cellHoney, TALLY_GROUPS, tallyItem, voterGroupOf, weightOf, type ItemTally, type JudgmentRecord, type StoredGroupTally, type VotesByGroup } from "./tally.js";

type ItemStateRow = typeof itemState.$inferSelect;
type JudgmentRow = typeof judgments.$inferSelect;

const playable = (v: DuelItem["variants"][number]) => v.review !== "native_rejected";
const reviewOf = (item: DuelItem): Schema<"ReviewStatus"> => (item.variants.every((v) => v.review === "native_approved") ? "native_approved" : "needs_native_review");
const canonOf = (item: DuelItem): [string, string] => [item.variants[0].id, item.variants[1].id];


/** Языковые пары словаря — по языку исходника (source_items.lang): «башкирский ← русский» и «башкирский ← казахский». */
const LANG_PAIRS = { ru: "ba-ru", kz: "ba-kz" } as const;
type LangPair = (typeof LANG_PAIRS)[keyof typeof LANG_PAIRS];
/** Основная пара словаря: с ней работают лендинг и бот — фраза дня всегда из неё (русский исходник). */
const PRIMARY_LANG_PAIR: LangPair = LANG_PAIRS.ru;
const langPairOf = (lang: string): LangPair => (lang === "kz" ? LANG_PAIRS.kz : LANG_PAIRS.ru);

/** Перемешивание Фишера — Йейтса (crypto: порядок дуэлей и сторон не предсказывается клиентом). */
function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
}

/** Сколько голосующих подтвердили вариант: «за него» и «оба подходят» во всех группах. */
function confirmations(votes: Schema<"FundPair">["votes"]): number {
  return [votes.child, votes.adult, votes.teacher].reduce((n, g) => n + g.votesFor + g.both, 0);
}

/** FNV-1a 32 бит — устойчивый хеш даты YYYY-MM-DD (ASCII), одинаковый на любом сервере и клиенте. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

/**
 * Журнал голосов и состояние исходников (таблицы consensus.schema.ts). Решение — duel-v0 из @teletau/domain-rules
 * (ADR 0019): item_state всегда пересчитывается из всего журнала исходника (правило 9), голос не меняется никогда.
 * Принятое решение «липкое» (tally.ts): поздние голоса меняют votes_by_group, но не статус — кроме решения эксперта.
 * Мёд за голос — через ProgressService в транзакции голоса: pending 3 при голосе, при решении — final (3 или 1).
 * Детям распределение голосов не отдаётся (защита от конформизма): только «Голос учтён» и «Мой вклад».
 */
@Injectable()
export class ConsensusService implements ConsensusApi {
  constructor(
    @Inject(DB) protected readonly db: Db,
    protected readonly corpus: CorpusService,
    protected readonly progress: ProgressService,
    /** Состав школ и классов для доски почёта: org — глобальный модуль, RosterService доступен напрямую. */
    protected readonly roster: RosterService,
  ) {}

  // ── публичный сервис для learning ──

  async pickDuels(voter: Voter, unitId: string, n: number): Promise<DuelCard[]> {
    if (n <= 0) return [];
    const pool = await this.corpus.duelPool(unitId);
    const fresh = await this.notVotedBy(voter.accountId, pool);
    const states = await this.states(this.db, fresh.map((i) => i.itemId));
    // Сначала исходники, где голос ещё нужен (voting), затем остальные; внутри — случайно. Пул исчерпан — сколько есть.
    const rank = (i: DuelItem) => ((states.get(i.itemId)?.status ?? "voting") === "voting" ? 0 : 1);
    return shuffle(fresh)
      .sort((x, y) => rank(x) - rank(y))
      .slice(0, n)
      .map((i) => this.card(i));
  }

  async duelByRef(voter: Voter, externalId: string): Promise<DuelCard | undefined> {
    const item = await this.corpus.itemByExternalId(externalId);
    if (!item) return undefined;
    return (await this.notVotedBy(voter.accountId, [item])).length > 0 ? this.card(item) : undefined;
  }

  async pickDailyDuel(voter: Voter): Promise<DuelCard | undefined> {
    const fresh = await this.notVotedBy(voter.accountId, await this.corpus.allDuels());
    if (fresh.length === 0) return undefined;
    // Свежая дуэль вне урока (ежедневное задание бота, ADR 0024): сначала исходники в voting, внутри — случайно.
    const states = await this.states(this.db, fresh.map((i) => i.itemId));
    const rank = (i: DuelItem) => ((states.get(i.itemId)?.status ?? "voting") === "voting" ? 0 : 1);
    const [pick] = shuffle(fresh).sort((x, y) => rank(x) - rank(y));
    return pick ? this.card(pick) : undefined;
  }

  async duelForDialog(itemId: string, shown: readonly [string, string]): Promise<DuelCard | undefined> {
    const item = (await this.corpus.items([itemId], { withRejected: true })).get(itemId);
    if (!item) return undefined;
    // Стороны — в порядке выдачи диалога (не каноническом и не случайном заново): choice ответа относительно него.
    const a = item.variants.find((v) => v.id === shown[0]);
    const b = item.variants.find((v) => v.id === shown[1]);
    if (!a || !b || !playable(a) || !playable(b)) return undefined;
    return { itemId: item.itemId, sourceRu: item.sourceRu, a: { variantId: a.id, text: a.text }, b: { variantId: b.id, text: b.text }, review: reviewOf(item), sources: item.sources };
  }

  async recordVote(tx: Db, vote: VoteInput): Promise<VoteReceipt> {
    const group = voterGroupOf(vote.voter);
    if (!group) throw forbidden();
    if ((vote.context === "lesson") !== (vote.runId !== undefined)) throw new Error("recordVote: runId нужен только голосу из урока");
    const item = (await this.corpus.items([vote.itemId], { db: tx })).get(vote.itemId);
    if (!item) throw notFound();
    const canon = canonOf(item);
    const [shownA, shownB] = vote.shown;
    if (shownA === shownB || !canon.includes(shownA) || !canon.includes(shownB)) {
      throw invalidField("#/shown", "Варианты не этого исходника: shown — оба варианта дуэли в порядке показа");
    }

    // Голоса одного исходника пересчитываются по очереди: строка item_state — замок на время транзакции.
    await tx.insert(itemState).values({ sourceItemId: item.itemId, rulesVersion: DUEL_RULES_VERSION }).onConflictDoNothing();
    const [prev] = await tx.select().from(itemState).where(eq(itemState.sourceItemId, item.itemId)).for("update");
    if (!prev) throw new Error("recordVote: нет строки item_state");

    const [same] = await tx.select().from(judgments).where(eq(judgments.id, vote.judgmentId));
    if (same) {
      const replay =
        same.judgeAccountId === vote.voter.accountId && same.sourceItemId === item.itemId && same.choice === vote.choice && same.variantAId === shownA && same.variantBId === shownB;
      if (!replay) throw unprocessable("idempotency_key_reused");
      return { judgmentId: same.id, replay: true, status: prev.status };
    }

    const inserted = await tx
      .insert(judgments)
      .values({
        id: vote.judgmentId,
        createdAt: vote.at,
        sourceItemId: item.itemId,
        variantAId: shownA,
        variantBId: shownB,
        judgeAccountId: vote.voter.accountId,
        voterGroup: group,
        type: "pairwise",
        choice: vote.choice,
        context: vote.context,
        runId: vote.runId ?? null,
        latencyMs: vote.latencyMs ?? null,
        weightSnapshot: weightOf(group),
        rulesVersion: DUEL_RULES_VERSION,
      })
      // Второй голос участника за исходник (уникальный индекс judgments_one_pairwise_per_judge_uq) — 409, без
      // ошибки Postgres: транзакция вызывающего (попытка урока) остаётся живой.
      .onConflictDoNothing()
      .returning({ id: judgments.id });
    if (inserted.length === 0) throw conflict("already_voted");

    const tally = tallyItem(canon, await this.journal(tx, item.itemId));
    const decided = tally.outcome.status === "accepted";
    const sameDecision =
      prev.status === "accepted" && decided && prev.mainVariantId === tally.mainVariantId && sameIds(prev.acceptedVariantIds, tally.acceptedVariantIds);
    await tx
      .update(itemState)
      .set({
        status: tally.outcome.status,
        acceptedVariantIds: tally.acceptedVariantIds,
        mainVariantId: tally.mainVariantId,
        childrenPreferVariantId: tally.childrenPreferVariantId,
        votesByGroup: tally.votesByGroup,
        scores: tally.scores,
        decidedBy: tally.outcome.decidedBy,
        decidedAt: tally.decidedAt,
        rulesVersion: DUEL_RULES_VERSION,
      })
      .where(eq(itemState.sourceItemId, item.itemId));

    // Мёд: «созревает» сразу; при решении — начисляется. Новое решение — по всем голосам исходника, прежнее — только
    // новому голосу (settleVotes трогает лишь pending, повтор безопасен). Решение закреплено, поэтому начисленный мёд
    // не расходится с «Моим вкладом»; замена решения экспертом и отзыв мёда (revoked) — в Consensus Engine.
    const mine = tally.votes.find((v) => v.judgmentId === vote.judgmentId)!;
    await this.progress.creditVote(tx, { accountId: mine.accountId, judgmentId: mine.judgmentId, choice: mine.choice, at: vote.at });
    if (decided) {
      const settle = (sameDecision ? [mine] : tally.votes).filter((v) => v.group !== "expert" && v.choice !== "skip");
      if (settle.length > 0) {
        await this.progress.settleVotes(
          tx,
          { accepted: tally.outcome.accepted },
          settle.map((v) => ({ accountId: v.accountId, judgmentId: v.judgmentId, choice: v.choice })),
          vote.at,
        );
      }
    }
    return { judgmentId: vote.judgmentId, replay: false, status: tally.outcome.status };
  }

  // ── операции контракта /corpus/* ──

  async listDuels(principal: Principal, limit: number): Promise<Schema<"CorpusDuelList">> {
    const fresh = await this.notVotedBy(principal.accountId, await this.corpus.allDuels());
    const states = await this.states(this.db, fresh.map((i) => i.itemId));
    const votesOf = (i: DuelItem) => {
      const byGroup = states.get(i.itemId)?.votesByGroup as Partial<VotesByGroup> | undefined;
      return TALLY_GROUPS.reduce((n, g) => n + (byGroup?.[g]?.total ?? 0), 0);
    };
    // Только исходники, где голос ещё нужен; сначала те, где голосов больше (ближе к решению). Пул исчерпан — сколько есть.
    const items = fresh
      .filter((i) => (states.get(i.itemId)?.status ?? "voting") === "voting")
      .sort((x, y) => votesOf(y) - votesOf(x) || (x.externalId < y.externalId ? -1 : 1))
      .slice(0, limit)
      .map((i): Schema<"CorpusDuel"> => {
        const c = this.card(i);
        return { itemId: c.itemId, sourceRu: c.sourceRu, variants: [c.a, c.b], review: c.review, sources: c.sources };
      });
    return { items };
  }

  async submitJudgment(principal: Principal, body: Schema<"JudgmentRequest">): Promise<Schema<"CorpusItemVotes">> {
    const [a, b] = body.shown;
    await this.db.transaction((tx) =>
      this.recordVote(tx, {
        judgmentId: body.judgmentId,
        voter: principal,
        itemId: body.itemId,
        shown: [a!, b!],
        choice: body.choice,
        context: "corpus",
        ...(body.latencyMs !== undefined ? { latencyMs: body.latencyMs } : {}),
        at: new Date(),
      }),
    );
    return this.itemVotes(principal, body.itemId);
  }

  async itemVotes(principal: Principal, itemId: string): Promise<Schema<"CorpusItemVotes">> {
    const item = (await this.corpus.items([itemId], { withRejected: true })).get(itemId);
    if (!item) throw notFound();
    const [mine] = await this.db
      .select()
      .from(judgments)
      .where(and(eq(judgments.sourceItemId, itemId), eq(judgments.judgeAccountId, principal.accountId), eq(judgments.type, "pairwise")));
    if (!mine) throw forbidden("vote_required");
    const state = (await this.states(this.db, [itemId])).get(itemId);
    return votesView(item, state, mine);
  }

  async myCells(principal: Principal, limit: number, cursor?: string): Promise<Schema<"MyCellsPage">> {
    const after = decodeCursor(cursor, KeysetCursor);
    const mineWhere = and(eq(judgments.judgeAccountId, principal.accountId), eq(judgments.type, "pairwise"));
    // Все голоса участника — для сводки (их немного: один на исходник); страница — по ключу (время, id), новые сначала.
    const all = await this.db.select().from(judgments).where(mineWhere).orderBy(desc(judgments.createdAt), desc(judgments.id));
    const states = await this.states(this.db, [...new Set(all.map((j) => j.sourceItemId))]);
    const summary: Schema<"CellsSummary"> = { matured: 0, pending: 0, honeyFinal: 0, honeyPending: 0 };
    const cells = all.map((j) => cellOf(j, states.get(j.sourceItemId)));
    for (const c of cells) {
      if (c.status === "matured") {
        summary.matured += 1;
        summary.honeyFinal += c.honey;
      } else if (c.status === "pending") {
        summary.pending += 1;
        summary.honeyPending += c.honey;
      }
    }

    const start = after ? all.findIndex((j) => j.createdAt.getTime() < Date.parse(after.at) || (j.createdAt.getTime() === Date.parse(after.at) && j.id < after.id)) : 0;
    const page = start < 0 ? [] : all.slice(start, start + limit);
    const items = await this.corpus.items(
      page.map((j) => j.sourceItemId),
      { withRejected: true },
    );
    const out = page.map((j): Schema<"MyCell"> => {
      const item = items.get(j.sourceItemId);
      const cell = cells[all.indexOf(j)]!;
      const chosenId = j.choice === "a" ? j.variantAId : j.choice === "b" ? j.variantBId : undefined;
      const chosen = item?.variants.find((v) => v.id === chosenId);
      return {
        itemId: j.sourceItemId,
        sourceRu: item?.sourceRu ?? "",
        choice: j.choice,
        ...(chosen && playable(chosen) ? { chosen: { text: chosen.text, review: chosen.review as Schema<"ReviewStatus"> } } : {}),
        ...cell,
        votedAt: j.createdAt.toISOString(),
      };
    });
    const last = page.at(-1);
    const more = start >= 0 && start + limit < all.length;
    return { summary, items: out, ...(more && last ? { nextCursor: encodeCursor({ at: last.createdAt.toISOString(), id: last.id }) } : {}) };
  }

  // ── словарь для Фонда и сводка министерства (ADR 0023) ──

  /**
   * Принятые варианты (item_state.status = accepted): по строке на вариант — голоса групп, момент и автор решения.
   * Отклонённые носителем варианты не попадают. Решения duel-v0 — предварительные (ADR 0019): не для датасета.
   */
  async fundDictionary(now: Date = new Date()): Promise<Schema<"FundDictionary">> {
    const accepted = await this.db.select().from(itemState).where(eq(itemState.status, "accepted"));
    const items = await this.corpus.items(
      accepted.map((s) => s.sourceItemId),
      { withRejected: true },
    );
    const rows: Schema<"FundPair">[] = [];
    for (const state of accepted) {
      const item = items.get(state.sourceItemId);
      if (!item || !state.decidedAt || !state.decidedBy) continue;
      const byGroup = (state.votesByGroup ?? {}) as Partial<VotesByGroup>;
      for (const v of item.variants) {
        if (!state.acceptedVariantIds.includes(v.id) || v.review === "native_rejected") continue;
        const group = (g: StoredGroupTally | undefined): Schema<"FundGroupVotes"> => ({
          votesFor: g?.variants[v.id] ?? 0,
          both: g?.both ?? 0,
          total: Math.max(0, (g?.total ?? 0) - (g?.skip ?? 0)),
        });
        rows.push({
          itemId: item.itemId,
          variantId: v.id,
          sourceRu: item.sourceRu,
          langPair: langPairOf(item.sourceLang),
          kind: item.kind,
          textBa: v.text,
          review: v.review,
          origin: v.origin,
          sources: v.source ? [v.source] : [],
          main: state.mainVariantId === v.id,
          tags: state.childrenPreferVariantId === v.id ? ["children_prefer"] : [],
          votes: { child: group(byGroup.child), adult: group(byGroup.adult), teacher: group(byGroup.teacher) },
          decidedAt: state.decidedAt.toISOString(),
          decidedBy: state.decidedBy,
          rulesVersion: state.rulesVersion,
          preliminary: state.rulesVersion === DUEL_RULES_VERSION,
        });
      }
    }
    // Новые решения сверху; у одного исходника — основной вариант первым.
    rows.sort((x, y) => (x.decidedAt === y.decidedAt ? (x.itemId === y.itemId ? Number(y.main) - Number(x.main) : x.sourceRu.localeCompare(y.sourceRu, "ru")) : x.decidedAt < y.decidedAt ? 1 : -1));
    return { generatedAt: now.toISOString(), items: rows };
  }

  /** Голосов «Помоги языку» без «Не знаю» (все группы) и строк словаря для Фонда. */
  async republicStats(): Promise<{ votes: number; pairsAccepted: number }> {
    const [[votes], dictionary] = await Promise.all([
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(judgments)
        .where(and(eq(judgments.type, "pairwise"), ne(judgments.choice, "skip"))),
      this.fundDictionary(),
    ]);
    return { votes: votes?.n ?? 0, pairsAccepted: dictionary.items.length };
  }

  /**
   * Фраза дня (ТЗ §3.6) — публичная витрина без регистрации: основной принятый вариант исходника.
   * Только пара ba-ru (лендинг показывает русский исходник); принятые пары ba-kz в выбор не входят.
   * Выбор детерминирован: пары сортируются по variantId (не по моменту решения — его меняет решение эксперта),
   * индекс — FNV-1a учебных суток по Уфе. Набор — пары, принятые до начала суток: пара, принятая днём, не сдвигает
   * индекс до полуночи (пока таких нет совсем — все принятые). В течение суток все клиенты показывают одну пару.
   */
  async phraseOfDay(now: Date = new Date()): Promise<Schema<"PhraseOfDay">> {
    const date = ufaDate(now);
    const dayStart = ufaMidnight(dateToDay(date)).toISOString();
    const dictionary = await this.fundDictionary(now);
    const all = dictionary.items.filter((row) => row.main && row.langPair === PRIMARY_LANG_PAIR);
    const before = all.filter((row) => row.decidedAt < dayStart);
    const pairs = (before.length > 0 ? before : all).sort((a, b) => a.variantId.localeCompare(b.variantId));
    if (pairs.length === 0) return { date };
    const pair = pairs[fnv1a(date) % pairs.length]!;
    return { date, pair: { sourceRu: pair.sourceRu, kind: pair.kind, textBa: pair.textBa, sources: pair.sources } };
  }

  /**
   * Публичный словарь (ТЗ §5) — принятые пары без регистрации, поверх тех же строк, что для Фонда
   * (fundDictionary: принятые + без отклонённых носителем). Пары обеих языковых пар: ba-ru и ba-kz — по языку
   * исходника (source_items.lang). `status=expert_review` оставляет только проверенные носителем (native_approved).
   * `confirmed` — сколько пользователей подтвердили вариант: голоса всех групп за него и «оба подходят» (по одному
   * голосу на голосующего; «не знаю» и голоса за другой вариант не считаются). Персональных данных нет (правило 13):
   * fragmentId — идентификатор варианта, не аккаунта; голосов по группам здесь нет (они — в выгрузке Фонда).
   */
  async publicDictionary(status: Schema<"PublicDictionaryEntry">["status"] = "confirmed", now: Date = new Date()): Promise<Schema<"PublicDictionary">> {
    const rows = (await this.fundDictionary(now)).items
      .filter((row) => (status === "expert_review" ? row.review === "native_approved" : true))
      .map(
        (row): Schema<"PublicDictionaryEntry"> => ({
          fragmentId: row.variantId,
          textBa: row.textBa,
          langPair: row.langPair ?? LANG_PAIRS.ru,
          translation: row.sourceRu,
          sources: row.sources,
          confirmed: confirmations(row.votes),
          status: row.review === "native_approved" ? "expert_review" : "confirmed",
        }),
      );
    return { generatedAt: now.toISOString(), langPair: PRIMARY_LANG_PAIR, items: rows };
  }

  /**
   * Доска почёта (ТЗ §4.5): топ школ и классов по урокам за период, при равенстве — по выученным словам.
   * Периоды по Уфе: day — сутки, week — неделя пн–вс, month — календарный месяц, year — календарный год.
   * Правило 13: в ответе только школы и классы с числами — ни ников, ни имён, ни идентификаторов учеников;
   * идентификаторы аккаунтов живут только внутри расчёта. Группы с активными учениками меньше порога
   * малых групп (как в кабинете министерства, ADR 0023) в доску не попадают. Дополнительное скрытие: школа не
   * показывается, если её ученики вне показанных классов школы — это 1…порог−1 учеников или активных учеников
   * (иначе их числа получались бы вычитанием классов из школы). Демо-школы справочника (schools.is_demo — демо-записи
   * импорта, все школы демо-района такие) — не участники доски; реальные школы справочника остаются, даже если в них
   * демо-классы. Прямые кавычки названий — «ёлочки».
   */
  async publicLeaderboard(period: Schema<"PublicLeaderboard">["period"] = "week", now: Date = new Date()): Promise<Schema<"PublicLeaderboard">> {
    const day = ufaDate(now);
    const periodStart = period === "day" ? day : period === "week" ? ufaWeek(now).start : period === "month" ? `${day.slice(0, 7)}-01` : `${day.slice(0, 4)}-01-01`;
    const [roster, allClasses] = await Promise.all([this.roster.roster(), this.roster.classRoster()]);
    const districtOf = new Map(roster.districts.map((d) => [d.id, typographicQuotes(d.nameRu)]));
    const schools = roster.schools.filter((s) => !s.isDemo);
    const schoolOf = new Map(schools.map((s) => [s.id, s]));
    const classes = allClasses.filter((c) => schoolOf.has(c.schoolId));
    // Все ученики школ и классов: словарный запас — у всех, активность — за период.
    const ids = [...new Set([...schools.flatMap((s) => s.studentIds), ...classes.flatMap((c) => c.studentIds)])];
    const totals = await this.progress.periodTotals(ids, periodStart);
    const of = (id: string) => totals.get(id) ?? { lessons: 0, words: 0 };
    const group = (studentIds: readonly string[]) => {
      const rows = studentIds.map(of);
      return { lessons: rows.reduce((n, t) => n + t.lessons, 0), activeStudents: rows.filter((t) => t.lessons > 0).length, wordsLearned: rows.reduce((n, t) => n + t.words, 0) };
    };
    const small = (n: number) => n > 0 && n < SMALL_GROUP_THRESHOLD;

    const shownClasses = classes
      .map((cls) => {
        const school = schoolOf.get(cls.schoolId)!;
        return { cls, row: { school: typographicQuotes(school.shortNameRu), district: districtOf.get(school.districtId) ?? "", classLabel: classTitle(cls.grade, cls.letter), ...group(cls.studentIds) } };
      })
      .filter((c) => c.row.activeStudents >= SMALL_GROUP_THRESHOLD)
      .sort((x, y) => y.row.lessons - x.row.lessons || y.row.wordsLearned - x.row.wordsLearned || x.row.school.localeCompare(y.row.school, "ru") || x.row.classLabel.localeCompare(y.row.classLabel, "ru"))
      .slice(0, 10);
    const classRows = shownClasses.map((c, i): Schema<"PublicLeaderboardClass"> => ({ rank: i + 1, ...c.row }));

    // Ученики каждой школы, чьи числа видны в показанных классах: остаток школы не должен быть малой группой.
    const visible = new Map<string, Set<string>>();
    for (const { cls } of shownClasses) {
      const set = visible.get(cls.schoolId) ?? new Set<string>();
      for (const id of cls.studentIds) set.add(id);
      visible.set(cls.schoolId, set);
    }
    const schoolRows = schools
      .filter((school) => {
        const shown = visible.get(school.id);
        if (!shown) return true;
        const rest = school.studentIds.filter((id) => !shown.has(id));
        return !small(rest.length) && !small(rest.filter((id) => of(id).lessons > 0).length);
      })
      .map((school) => ({ school: typographicQuotes(school.shortNameRu), district: districtOf.get(school.districtId) ?? "", ...group(school.studentIds) }))
      .filter((r) => r.activeStudents >= SMALL_GROUP_THRESHOLD)
      .sort((x, y) => y.lessons - x.lessons || y.wordsLearned - x.wordsLearned || x.school.localeCompare(y.school, "ru") || x.district.localeCompare(y.district, "ru"))
      .slice(0, 10)
      .map((r, i): Schema<"PublicLeaderboardSchool"> => ({ rank: i + 1, ...r }));

    return { asOf: now.toISOString(), period, periodStart, smallGroupThreshold: SMALL_GROUP_THRESHOLD, schools: schoolRows, classes: classRows };
  }

  /**
   * Спорные исходники (status = escalated, отдельный список — ТЗ §4.4/§5) с голосами групп по вариантам — для
   * передачи экспертам (УФИЦ РАН); операции решения эксперта нет. Свежие споры сверху.
   */
  async fundEscalated(now: Date = new Date()): Promise<Schema<"FundEscalated">> {
    const rows = await this.db.select().from(itemState).where(eq(itemState.status, "escalated")).orderBy(desc(itemState.updatedAt));
    const items = await this.corpus.items(
      rows.map((s) => s.sourceItemId),
      { withRejected: true },
    );
    const out: Schema<"EscalatedItem">[] = [];
    for (const state of rows) {
      const item = items.get(state.sourceItemId);
      // Оба варианта должны быть видимы; отклонённый носителем спор уже не спор.
      const shown = item?.variants.filter(playable) ?? [];
      if (!item || shown.length !== 2) continue;
      const byGroup = (state.votesByGroup ?? {}) as Partial<VotesByGroup>;
      const votes = (g: StoredGroupTally | undefined, variantId: string): Schema<"FundGroupVotes"> => ({
        votesFor: g?.variants[variantId] ?? 0,
        both: g?.both ?? 0,
        total: Math.max(0, (g?.total ?? 0) - (g?.skip ?? 0)),
      });
      const variants: Schema<"EscalatedVariant">[] = shown.map((v) => ({
        variantId: v.id,
        text: v.text,
        review: v.review as Schema<"ReviewStatus">,
        origin: v.origin,
        votes: { child: votes(byGroup.child, v.id), adult: votes(byGroup.adult, v.id), teacher: votes(byGroup.teacher, v.id) },
      }));
      out.push({ itemId: item.itemId, sourceRu: item.sourceRu, kind: item.kind, variants, lastVoteAt: state.updatedAt.toISOString() });
    }
    return { generatedAt: now.toISOString(), items: out };
  }

  // ── внутреннее ──

  /** Дуэль для показа: стороны — в случайном порядке (защита от позиционного смещения, docs/03 §6). */
  private card(item: DuelItem): DuelCard {
    const [x, y] = randomInt(2) === 0 ? item.variants : [item.variants[1], item.variants[0]];
    return {
      itemId: item.itemId,
      sourceRu: item.sourceRu,
      a: { variantId: x.id, text: x.text },
      b: { variantId: y.id, text: y.text },
      review: reviewOf(item),
      sources: item.sources,
    };
  }

  /** Исходники, за которые участник ещё не голосовал (один голос на исходник, без повторов). */
  private async notVotedBy(accountId: string, pool: DuelItem[]): Promise<DuelItem[]> {
    if (pool.length === 0) return [];
    const voted = await this.db
      .select({ itemId: judgments.sourceItemId })
      .from(judgments)
      .where(
        and(
          eq(judgments.judgeAccountId, accountId),
          eq(judgments.type, "pairwise"),
          inArray(
            judgments.sourceItemId,
            pool.map((i) => i.itemId),
          ),
        ),
      );
    const seen = new Set(voted.map((v) => v.itemId));
    return pool.filter((i) => !seen.has(i.itemId));
  }

  private async states(db: Db, itemIds: readonly string[]): Promise<Map<string, ItemStateRow>> {
    if (itemIds.length === 0) return new Map();
    const rows = await db.select().from(itemState).where(inArray(itemState.sourceItemId, [...itemIds]));
    return new Map(rows.map((r) => [r.sourceItemId, r]));
  }

  /** Журнал голосов исходника в порядке времени. */
  private async journal(db: Db, itemId: string): Promise<JudgmentRecord[]> {
    return db
      .select({
        id: judgments.id,
        judgeAccountId: judgments.judgeAccountId,
        voterGroup: judgments.voterGroup,
        variantAId: judgments.variantAId,
        variantBId: judgments.variantBId,
        choice: judgments.choice,
        createdAt: judgments.createdAt,
      })
      .from(judgments)
      .where(eq(judgments.sourceItemId, itemId))
      .orderBy(asc(judgments.createdAt), asc(judgments.id));
  }

  /** Пересчёт состояния исходника из журнала (для сверки с item_state — правило 9). */
  async recompute(itemId: string): Promise<ItemTally | undefined> {
    const item = (await this.corpus.items([itemId], { withRejected: true })).get(itemId);
    if (!item) return undefined;
    return tallyItem(canonOf(item), await this.journal(this.db, itemId));
  }
}

const sameIds = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((id) => y.includes(id));

/** Ячейка «Моего вклада»: мёд — cellHoney (ориентация самого голоса), «созрело» — момент решения по исходнику. */
function cellOf(j: JudgmentRow, state: ItemStateRow | undefined): Pick<Schema<"MyCell">, "status" | "honey" | "agreed" | "maturedAt"> {
  const cell = cellHoney(j, state);
  return { ...cell, ...(cell.status === "matured" && state?.decidedAt ? { maturedAt: state.decidedAt.toISOString() } : {}) };
}

/** Голоса по группам и статус (после своего голоса): варианты — в каноническом порядке, отклонённые носителем не показываются. */
function votesView(item: DuelItem, state: ItemStateRow | undefined, mine: JudgmentRow): Schema<"CorpusItemVotes"> {
  const shown = item.variants.filter(playable);
  const byGroup = (state?.votesByGroup ?? {}) as Partial<VotesByGroup>;
  const group = (g: StoredGroupTally | undefined): Schema<"GroupTally"> => ({
    total: g?.total ?? 0,
    both: g?.both ?? 0,
    skip: g?.skip ?? 0,
    variants: shown.map((v) => ({ variantId: v.id, votes: g?.variants[v.id] ?? 0 })),
  });
  const chosen = mine.choice === "a" ? mine.variantAId : mine.choice === "b" ? mine.variantBId : undefined;
  return {
    itemId: item.itemId,
    sourceRu: item.sourceRu,
    status: state?.status ?? "voting",
    ...(state?.decidedBy ? { decidedBy: state.decidedBy } : {}),
    variants: shown.map((v) => ({
      variantId: v.id,
      text: v.text,
      accepted: state?.acceptedVariantIds.includes(v.id) ?? false,
      main: state?.mainVariantId === v.id,
      tags: state?.childrenPreferVariantId === v.id ? ["children_prefer"] : [],
    })),
    groups: { child: group(byGroup.child), teacher: group(byGroup.teacher), adult: group(byGroup.adult) },
    myVote: { choice: mine.choice, ...(chosen ? { variantId: chosen } : {}), votedAt: mine.createdAt.toISOString() },
    rulesVersion: state?.rulesVersion ?? DUEL_RULES_VERSION,
  };
}
