import { Global, Module } from "@nestjs/common";
import { TEACHER_SCHOOL_PORT } from "../../common/ports.js";
import { AdminModule } from "../admin/index.js";
import { ConsentModule } from "../consent/index.js";
import { OrgModule } from "../org/index.js";
import { ModerationController } from "./moderation.controller.js";
import { VerificationService } from "./verification.service.js";

/**
 * Модуль moderation: заявки учителей на подтверждение и решения модератора (в аудит).
 * Таблица — в moderation.schema.ts (ADR 0014). Глобальный только ради порта TEACHER_SCHOOL_PORT для org.
 */
@Global()
@Module({
  imports: [OrgModule, ConsentModule, AdminModule],
  controllers: [ModerationController],
  providers: [VerificationService, { provide: TEACHER_SCHOOL_PORT, useExisting: VerificationService }],
  exports: [VerificationService, TEACHER_SCHOOL_PORT],
})
export class ModerationModule {}
