import { Module } from "@nestjs/common";
import { CorpusModule } from "../corpus/index.js";
import { ProgressModule } from "../progress/index.js";
import { ConsensusController } from "./consensus.controller.js";
import { ConsensusService } from "./consensus.service.js";
import { FundController } from "./fund.controller.js";

/**
 * Модуль consensus: журнал голосов judgments (только вставка, правило 9), состояние исходников item_state,
 * правила duel-v0 до Consensus Engine (ADR 0019), операции /corpus/*. Таблицы — в consensus.schema.ts (ADR 0014).
 * Словарь для Фонда — GET /fund/dictionary (ADR 0023). Граф: consensus → corpus, progress.
 */
@Module({ imports: [CorpusModule, ProgressModule], controllers: [ConsensusController, FundController], providers: [ConsensusService], exports: [ConsensusService] })
export class ConsensusModule {}
