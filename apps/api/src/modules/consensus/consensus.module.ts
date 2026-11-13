import { Module } from "@nestjs/common";
import { CorpusModule } from "../corpus/index.js";
import { OrgModule } from "../org/index.js";
import { ProgressModule } from "../progress/index.js";
import { ConsensusController } from "./consensus.controller.js";
import { ConsensusService } from "./consensus.service.js";
import { FundController } from "./fund.controller.js";
import { PublicController } from "./public.controller.js";

/**
 * Модуль consensus: журнал голосов judgments (только вставка, правило 9), состояние исходников item_state,
 * правила duel-v0 до Consensus Engine (ADR 0019), операции /corpus/*. Таблицы — в consensus.schema.ts (ADR 0014).
 * Словарь для Фонда — GET /fund/dictionary (ADR 0023). Публичная витрина — GET /public/phrase-of-day (ТЗ §3.6),
 * GET /public/dictionary (ТЗ §5) и GET /public/leaderboard (ТЗ §4.5).
 * Граф: consensus → corpus, progress, org (состав для доски почёта).
 */
@Module({ imports: [CorpusModule, OrgModule, ProgressModule], controllers: [ConsensusController, FundController, PublicController], providers: [ConsensusService], exports: [ConsensusService] })
export class ConsensusModule {}

