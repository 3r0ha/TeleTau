import { Module } from "@nestjs/common";
import { OrgModule } from "../org/index.js";
import { CompetitionController } from "./competition.controller.js";
import { CompetitionService } from "./competition.service.js";

/**
 * Модуль competition: недельная лига медоносов и квест класса. Таблицы — в competition.schema.ts (ADR 0014).
 * Граф: competition → org (политика class-member), identity (ники — через порт ACCOUNTS_PORT, src/common/ports.ts).
 */
@Module({ imports: [OrgModule], controllers: [CompetitionController], providers: [CompetitionService], exports: [CompetitionService] })
export class CompetitionModule {}
