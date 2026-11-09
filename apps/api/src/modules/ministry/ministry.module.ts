import { Module } from "@nestjs/common";
import { ConsensusModule } from "../consensus/index.js";
import { OrgModule } from "../org/index.js";
import { ProgressModule } from "../progress/index.js";
import { MinistryController } from "./ministry.controller.js";
import { MinistryService } from "./ministry.service.js";

/**
 * Модуль ministry — кабинет министерства (ADR 0023): агрегаты по республике, районам и школам. Своих таблиц нет.
 * Граф: ministry → org (состав), progress (уроки, слова), consensus (голоса, принятые пары); identity — через порт
 * ACCOUNTS_PORT («Учусь сам», учителя). От ministry не зависит ни один модуль.
 */
@Module({ imports: [OrgModule, ProgressModule, ConsensusModule], controllers: [MinistryController], providers: [MinistryService] })
export class MinistryModule {}
