import { Global, Module } from "@nestjs/common";
import { CLASS_ACCESS_PORT } from "../../common/ports.js";
import { AdminModule } from "../admin/index.js";
import { ConsentModule } from "../consent/index.js";
import { ClassPolicy } from "./class-policy.js";
import { ClassesController } from "./classes.controller.js";
import { ClassesService } from "./classes.service.js";
import { DirectoryController } from "./directory.controller.js";
import { DirectoryService } from "./directory.service.js";
import { JoinGrants } from "./join-grants.js";
import { JoinService } from "./join.service.js";
import { PrintJobStore } from "./print-jobs.js";
import { RosterService } from "./roster.service.js";

/**
 * Модуль org: справочник районов и школ, классы, места и QR-карточки, PDF, код класса и заявки на вход.
 * Таблицы — в org.schema.ts (ADR 0014). Глобальный только ради порта CLASS_ACCESS_PORT для модуля consent
 * (src/common/ports.ts); остальные модули импортируют org через index.ts.
 */
@Global()
@Module({
  imports: [ConsentModule, AdminModule],
  controllers: [DirectoryController, ClassesController],
  providers: [ClassPolicy, DirectoryService, ClassesService, JoinService, JoinGrants, PrintJobStore, RosterService, { provide: CLASS_ACCESS_PORT, useExisting: ClassPolicy }],
  exports: [DirectoryService, ClassesService, RosterService, JoinService, JoinGrants, ClassPolicy, CLASS_ACCESS_PORT],
})
export class OrgModule {}
