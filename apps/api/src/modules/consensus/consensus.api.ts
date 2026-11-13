// Публичный интерфейс модуля consensus: дуэли и голоса по группам, правила duel-v0 до Consensus Engine (ADR 0019).
// Граф: consensus → corpus (исходники, варианты), progress (мёд за голос: pending → final). Вызовы — в транзакции вызывающего.
import type { Schema } from "@teletau/contracts";
import type { DuelChoice, VoterGroup } from "@teletau/domain-rules";
import type { Principal } from "../../common/auth.js";
import type { Db } from "../../db/database.js";

/** Кто голосует: группа (child / teacher / adult) выводится из типа аккаунта и ролей на момент голоса. */
export type Voter = Pick<Principal, "accountId" | "kind" | "roles">;

export interface DuelSideView {
  variantId: string;
  text: string;
}

/** Дуэль для показа: стороны A и B уже в случайном порядке — его запоминает вызывающий (план забега). */
export interface DuelCard {
  itemId: string;
  sourceRu: string;
  a: DuelSideView;
  b: DuelSideView;
  review: Schema<"ReviewStatus">;
  sources: Schema<"SourceCitation">[];
}

export interface VoteInput {
  /** Клиентский UUIDv7: judgmentId (вне урока) или attemptId (в уроке). Повтор — тот же результат без новой записи. */
  judgmentId: string;
  voter: Voter;
  itemId: string;
  /** variantId в порядке показа: A, B; choice — относительно них. */
  shown: readonly [string, string];
  choice: DuelChoice;
  context: "lesson" | "corpus" | "telegram";
  /** Забег урока (context = lesson). */
  runId?: string;
  latencyMs?: number;
  at: Date;
}

export interface VoteReceipt {
  judgmentId: string;
  /** Голос с этим judgmentId уже был — ничего не записано заново. */
  replay: boolean;
  status: Schema<"ItemStatus">;
}

export interface ConsensusApi {
  /**
   * До n дуэлей пула юнита, за которые участник ещё не голосовал (один голос на исходник, повторов нет); сначала
   * исходники в статусе voting. Стороны — в случайном порядке. Пул исчерпан — сколько есть, вплоть до пустого списка.
   */
  pickDuels(voter: Voter, unitId: string, n: number): Promise<DuelCard[]>;
  /** Дуэль по внешнему id (ссылка duel в уроке); уже голосовал, нет такой или вариант отклонён носителем — undefined. */
  duelByRef(voter: Voter, externalId: string): Promise<DuelCard | undefined>;
  /**
   * Одна свежая дуэль курса вне урока для любого голосующего — ежедневное задание бота (ADR 0024): исходники, за
   * которые участник ещё не голосовал, сначала в статусе voting, случайный выбор. Нет — undefined.
   */
  pickDailyDuel(voter: Voter): Promise<DuelCard | undefined>;
  /**
   * Дуэль по сохранённому показу диалога бота (ADR 0024): itemId и стороны в порядке выдачи. Исходника нет или
   * вариант отклонён носителем — undefined (диалог закрывают и выдают свежую дуэль).
   */
  duelForDialog(itemId: string, shown: readonly [string, string]): Promise<DuelCard | undefined>;
  /**
   * Голос в журнал judgments (только вставка) с voter_group (child / teacher / adult — из voter) и rules_version,
   * пересчёт item_state по duel-v0 из всего журнала исходника (принятое решение закреплено), мёд за голос (pending 3) и при решении — pending → final
   * через ProgressService. Всё — в транзакции tx вызывающего; ошибки Postgres транзакцию не ломают.
   * Повтор с тем же judgmentId и тем же голосом — replay без новой записи. Ошибки (ApiError):
   * 404 not_found — нет исходника (или он не играбелен); 422 validation_failed — shown не два варианта исходника;
   * 422 idempotency_key_reused — judgmentId уже занят другим голосом; 409 already_voted — участник уже голосовал за исходник;
   * 403 forbidden — сотрудник (сотрудники не голосуют).
   */
  recordVote(tx: Db, vote: VoteInput): Promise<VoteReceipt>;

  // ── операции контракта (/corpus/*) ──
  listDuels(principal: Principal, limit: number): Promise<Schema<"CorpusDuelList">>;
  submitJudgment(principal: Principal, body: Schema<"JudgmentRequest">): Promise<Schema<"CorpusItemVotes">>;
  itemVotes(principal: Principal, itemId: string): Promise<Schema<"CorpusItemVotes">>;
  myCells(principal: Principal, limit: number, cursor?: string): Promise<Schema<"MyCellsPage">>;
}

export type { VoterGroup };
