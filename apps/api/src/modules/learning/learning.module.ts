import { Module } from "@nestjs/common";
import { AssignmentsModule } from "../assignments/index.js";
import { ConsensusModule } from "../consensus/index.js";
import { ContentModule } from "../content/index.js";
import { CorpusModule } from "../corpus/index.js";
import { ProgressModule } from "../progress/index.js";
import { LearningController } from "./learning.controller.js";
import { AiExplanations } from "./learning.ai.js";
import { LearningService } from "./learning.service.js";

/**
 * Модуль learning: тропа (GET /course), забеги уроков, проверка ответов на сервере, итог урока, «Что в уроке» для учителя.
 * Таблицы — в learning.schema.ts (ADR 0014). Граф: learning → content, corpus, consensus, progress, assignments
 * (задания учителя на тропе и их выполнение, ADR 0021) — верхний модуль графа.
 */
@Module({
  imports: [ContentModule, CorpusModule, ConsensusModule, ProgressModule, AssignmentsModule],
  controllers: [LearningController],
  providers: [LearningService, AiExplanations],
  exports: [LearningService],
})
export class LearningModule {}
