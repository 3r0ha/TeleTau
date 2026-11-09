// Публичный интерфейс модуля corpus: исходники и варианты перевода (лист графа модулей).
import type { Schema } from "@teletau/contracts";
import type { Db } from "../../db/database.js";

export interface CorpusVariant {
  id: string;
  /** Каноническая форма normalize(). */
  text: string;
  /** native_rejected приходит только из items(…, { withRejected: true }) — такой текст не показывают никому. */
  review: Schema<"ReviewStatus"> | "native_rejected";
  origin: "human" | "import" | "mt" | "llm";
  /** Источник самого варианта (source_ref; у origin = import — всегда) — для словаря Фонда (ADR 0023). */
  source?: Schema<"SourceCitation">;
}

/**
 * Исходник дуэли с двумя вариантами (пока только origin = import). Порядок variants — канонический и постоянный
 * (по id варианта): относительно него consensus приводит голоса к сторонам a/b правил duel-v0.
 */
export interface DuelItem {
  itemId: string;
  /** id дуэли из content/corpus/duels/*.yaml. */
  externalId: string;
  unitId?: string;
  sourceRu: string;
  kind: "word" | "phrase" | "sentence" | "term";
  variants: [CorpusVariant, CorpusVariant];
  sources: Schema<"SourceCitation">[];
}

export interface CorpusItemsOptions {
  /** Транзакция вызывающего (по умолчанию — общий пул). */
  db?: Db;
  /** Вернуть и исходники с отклонённым носителем вариантом (для истории голосов). По умолчанию — только играбельные. */
  withRejected?: boolean;
}

export interface CorpusApi {
  /** Пул дуэлей юнита: исходники, у которых оба варианта не отклонены носителем (native_rejected). */
  duelPool(unitId: string): Promise<DuelItem[]>;
  /** Все играбельные дуэли курса (дуэли вне урока — GET /corpus/duels). */
  allDuels(): Promise<DuelItem[]>;
  /** Исходники по id (нет — нет в Map). */
  items(itemIds: readonly string[], options?: CorpusItemsOptions): Promise<Map<string, DuelItem>>;
  /** Играбельный исходник по внешнему id дуэли (ссылка duel в уроке). */
  itemByExternalId(externalId: string): Promise<DuelItem | undefined>;
}
