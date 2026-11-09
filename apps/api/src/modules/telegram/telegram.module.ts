import { Module } from "@nestjs/common";
import { ProgressModule } from "../progress/index.js";
import { TelegramController } from "./telegram.controller.js";
import { TelegramService } from "./telegram.service.js";

/**
 * Модуль telegram (ADR 0020): привязка личного чата с ботом по подписи initData Mini App, согласие на напоминания о
 * серии и выдача напоминаний боту. Таблица — telegram_links в telegram.schema.ts (ADR 0014): только chat_id, id
 * аккаунта и настройки напоминаний. Граф: telegram → progress (серия под угрозой — через ProgressService).
 */
@Module({ imports: [ProgressModule], controllers: [TelegramController], providers: [TelegramService], exports: [TelegramService] })
export class TelegramModule {}
