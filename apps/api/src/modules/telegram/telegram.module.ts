import { Module } from "@nestjs/common";
import { ConsensusModule } from "../consensus/index.js";
import { ProgressModule } from "../progress/index.js";
import { TelegramLinks } from "./telegram-links.js";
import { TelegramController } from "./telegram.controller.js";
import { TelegramService } from "./telegram.service.js";

/**
 * Модуль telegram (ADR 0020, 0024): привязка личного чата с ботом по подписи initData Mini App или одноразовому
 * коду с сайта, согласие на напоминания о серии, выдача напоминаний боту и FSM-диалоги ежедневного задания. Таблицы —
 * telegram_links и telegram_dialogs в telegram.schema.ts (ADR 0014): только chat_id, id аккаунта и ссылки на контент. Граф:
 * telegram → progress (серия под угрозой), consensus (дуэль ежедневки и запись голоса). Группа голосующего —
 * через ACCOUNTS_PORT глобального identity, согласие на месте ученика — через ClassesService глобального org. TelegramLinks
 * (только база) отдаётся identity: состояние привязки в GET /me и снятие всех привязок аккаунта.
 */
@Module({ imports: [ProgressModule, ConsensusModule], controllers: [TelegramController], providers: [TelegramService, TelegramLinks], exports: [TelegramService, TelegramLinks] })
export class TelegramModule {}
