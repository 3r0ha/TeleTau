import { Module } from "@nestjs/common";
import { ContentModule } from "../content/index.js";
import { OrgModule } from "../org/index.js";
import { ProgressModule } from "../progress/index.js";
import { AssignmentsController } from "./assignments.controller.js";
import { AssignmentsService } from "./assignments.service.js";

/**
 * Модуль assignments (ADR 0021): задания учителя классу и их выполнение. Таблицы — в assignments.schema.ts (ADR 0014).
 * Граф: assignments → org (политика class-teacher, места, классы ученика), content (уроки тропы), progress (пройден ли
 * урок раньше выдачи); learning → assignments.
 */
@Module({ imports: [ContentModule, OrgModule, ProgressModule], controllers: [AssignmentsController], providers: [AssignmentsService], exports: [AssignmentsService] })
export class AssignmentsModule {}
