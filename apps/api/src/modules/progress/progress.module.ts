import { Module } from "@nestjs/common";
import { CompetitionModule } from "../competition/index.js";
import { ContentModule } from "../content/index.js";
import { OrgModule } from "../org/index.js";
import { ProgressController } from "./progress.controller.js";
import { ProgressService } from "./progress.service.js";

/**
 * Модуль progress: журнал мёда (pending / final / revoked), серия по суткам Уфы, дни занятий, счётчики, прогресс класса.
 * Таблицы — в progress.schema.ts (ADR 0014). Граф: progress → competition (очки лиги, квест), org (политика class-teacher,
 * места класса), content (лист графа: уроки тропы для прогресса класса).
 */
@Module({ imports: [CompetitionModule, ContentModule, OrgModule], controllers: [ProgressController], providers: [ProgressService], exports: [ProgressService] })
export class ProgressModule {}
