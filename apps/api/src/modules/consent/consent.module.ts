import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/index.js";
import { ConsentController } from "./consent.controller.js";
import { ConsentService } from "./consent.service.js";

/**
 * Модуль consent: версии юридических документов, электронные согласия взрослых и бумажные согласия на место ученика.
 * Таблицы — в consent.schema.ts (ADR 0014). «Учитель класса» и сессии ученика — через порты CLASS_ACCESS_PORT
 * и ACCOUNTS_PORT (src/common/ports.ts): consent — нижний модуль и не импортирует org и identity.
 */
@Module({ imports: [AdminModule], controllers: [ConsentController], providers: [ConsentService], exports: [ConsentService] })
export class ConsentModule {}
