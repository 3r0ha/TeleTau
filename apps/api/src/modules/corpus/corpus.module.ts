import { Module } from "@nestjs/common";
import { CorpusService } from "./corpus.service.js";

/**
 * Модуль corpus: исходники и варианты перевода, импорт дуэлей из content/corpus/duels (corpus:import).
 * Таблицы — в corpus.schema.ts (ADR 0014). Лист графа модулей; HTTP-операций нет — дуэли и голоса отдаёт consensus.
 */
@Module({ providers: [CorpusService], exports: [CorpusService] })
export class CorpusModule {}
