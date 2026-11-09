import { Module } from "@nestjs/common";
import { AuditController } from "./audit.controller.js";
import { AuditService } from "./audit.service.js";

/**
 * Модуль admin: журнал аудита только для вставки (ADR 0017). Таблица — в admin.schema.ts (ADR 0014);
 * другие модули пишут в журнал через AuditService в своей транзакции.
 */
@Module({ controllers: [AuditController], providers: [AuditService], exports: [AuditService] })
export class AdminModule {}
