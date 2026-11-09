import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { CurrentPrincipal, type Principal } from "../../common/auth.js";
import { Operation } from "../../common/contract.js";
import { TelegramService } from "./telegram.service.js";

/**
 * Привязка чата из Mini App (вошедший ученик или взрослый) и служебные операции бота (роль service, X-Service-Token —
 * проверяет AccessControl). Тело запроса привязки (initData) не логируется: ключ `initData` маскирует фильтр логов.
 */
@Controller()
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Post("telegram/link")
  @HttpCode(200)
  @Operation("linkTelegramChat")
  link(@CurrentPrincipal() principal: Principal, @Body() body: Schema<"TelegramLinkRequest">): Promise<Schema<"TelegramLink">> {
    return this.telegram.link(principal, body);
  }

  @Get("telegram/bot/chats/:chatId")
  @Operation("getTelegramChat")
  chat(@Param("chatId") chatId: string): Promise<Schema<"TelegramChat">> {
    return this.telegram.chat(chatId);
  }

  @Delete("telegram/bot/chats/:chatId")
  @HttpCode(204)
  @Operation("unlinkTelegramChat")
  unlink(@Param("chatId") chatId: string): Promise<void> {
    return this.telegram.unlink(chatId);
  }

  @Put("telegram/bot/chats/:chatId/reminders")
  @Operation("setTelegramChatReminders")
  reminders(@Param("chatId") chatId: string, @Body() body: Schema<"TelegramRemindersUpdate">): Promise<Schema<"TelegramChat">> {
    return this.telegram.setReminders(chatId, body);
  }

  @Post("telegram/bot/reminders/claim")
  @HttpCode(200)
  @Operation("claimTelegramReminders")
  claim(): Promise<Schema<"TelegramReminderBatch">> {
    return this.telegram.claimReminders();
  }
}
