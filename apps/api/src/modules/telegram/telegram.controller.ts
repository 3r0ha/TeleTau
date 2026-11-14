import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { CurrentPrincipal, type Principal } from "../../common/auth.js";
import { Operation } from "../../common/contract.js";
import { TelegramService } from "./telegram.service.js";

/**
 * Привязка чата из Mini App (вошедший ученик или взрослый), одноразовый код привязки с сайта и служебные операции
 * бота (роль service, X-Service-Token — проверяет AccessControl). Тело запроса привязки (initData) не логируется:
 * ключ `initData` маскирует фильтр логов.
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

  /** Одноразовый код привязки без Mini App (ADR 0020): ученик или взрослый берёт на сайте, шлёт боту /start <код>. */
  @Post("me/telegram/link-code")
  @HttpCode(200)
  @Operation("issueTelegramLinkCode")
  issueLinkCode(@CurrentPrincipal() principal: Principal): Promise<Schema<"TelegramLinkCode">> {
    return this.telegram.issueLinkCode(principal);
  }

  /** Погашение кода привязки (бот): чат связывается с аккаунтом кода — как POST /telegram/link. */
  @Post("telegram/bot/chats/link-code/redeem")
  @HttpCode(200)
  @Operation("redeemTelegramLinkCode")
  redeemLinkCode(@Body() body: Schema<"TelegramLinkCodeRedeemRequest">): Promise<Schema<"TelegramChat">> {
    return this.telegram.redeemLinkCode(body);
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

  @Post("telegram/bot/chats/:chatId/daily-duel")
  @HttpCode(200)
  @Operation("issueTelegramDailyDuel")
  dailyDuel(@Param("chatId") chatId: string): Promise<Schema<"TelegramDailyDuel">> {
    return this.telegram.dailyDuel(chatId);
  }

  @Post("telegram/bot/chats/:chatId/daily-duel/cancel")
  @HttpCode(200)
  @Operation("cancelTelegramDailyDuel")
  cancelDaily(@Param("chatId") chatId: string): Promise<Schema<"TelegramDailyCancel">> {
    return this.telegram.cancelDaily(chatId);
  }

  @Post("telegram/bot/dialogs/:dialogId/answer")
  @HttpCode(200)
  @Operation("answerTelegramDailyDuel")
  answer(@Param("dialogId") dialogId: string, @Body() body: Schema<"TelegramDailyAnswerRequest">): Promise<Schema<"TelegramDailyAnswer">> {
    return this.telegram.answerDialog(dialogId, body);
  }

  @Post("telegram/bot/reminders/claim")
  @HttpCode(200)
  @Operation("claimTelegramReminders")
  claim(): Promise<Schema<"TelegramReminderBatch">> {
    return this.telegram.claimReminders();
  }
}
