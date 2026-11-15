// Привязки Telegram аккаунта целиком: состояние для GET /me и снятие всех привязок (отвязка из профиля, отзыв
// согласия, перевыпуск карточки, блокировка, выход на всех устройствах). Зависит только от базы — его берёт
// identity (AccountsService, MeService), не создавая цикла с TelegramService, которому нужен ACCOUNTS_PORT.
import { Inject, Injectable } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/database.js";
import { DB } from "../../infra/tokens.js";
import { telegramDialogs, telegramLinks } from "./telegram.schema.js";

@Injectable()
export class TelegramLinks {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Привязка аккаунта для GET /me: только факт и число чатов, без chat_id. */
  async status(accountId: string, db: Db = this.db): Promise<Schema<"MeTelegram">> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(telegramLinks)
      .where(eq(telegramLinks.accountId, accountId));
    const chats = row?.n ?? 0;
    return { linked: chats > 0, chats };
  }

  /**
   * Все чаты аккаунта отвязываются в транзакции `db`: строки привязок и диалоги этих чатов удаляются, как у отвязки
   * чата ботом (данных о чате не остаётся; голоса — в журнале у аккаунта). Возвращает число снятых привязок.
   */
  async unlinkAccount(db: Db, accountId: string): Promise<number> {
    const removed = await db.delete(telegramLinks).where(eq(telegramLinks.accountId, accountId)).returning({ chatId: telegramLinks.chatId });
    if (removed.length > 0) await db.delete(telegramDialogs).where(inArray(telegramDialogs.chatId, removed.map((c) => c.chatId)));
    return removed.length;
  }
}
