import { Inject, Injectable } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { ufaDate } from "@teletau/domain-rules";
import { and, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import type { Principal } from "../../common/auth.js";
import { notFound, unavailable, unprocessable } from "../../common/problem.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import type { Db } from "../../db/database.js";
import { DB } from "../../infra/tokens.js";
import { ProgressService } from "../progress/index.js";
import { verifyInitData } from "./init-data.js";
import { outsideQuietHours, ufaHour } from "./reminders.js";
import { telegramLinks } from "./telegram.schema.js";

type LinkRow = typeof telegramLinks.$inferSelect;

const remindersOf = (row: Pick<LinkRow, "remindersEnabled" | "reminderHour">): Schema<"TelegramReminders"> => ({
  enabled: row.remindersEnabled,
  hour: row.reminderHour,
});

const chatOf = (row: LinkRow): Schema<"TelegramChat"> => ({ chatId: String(row.chatId), reminders: remindersOf(row) });

/** chat_id из пути: контракт уже проверил шаблон ^[1-9][0-9]{0,15}$ — здесь только перевод в число без потери точности. */
function chatIdOf(raw: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound("chat_not_linked");
  return id;
}

/**
 * Модуль telegram (ADR 0020): привязка личного чата с ботом к аккаунту по подписи initData Mini App и напоминания о
 * серии по согласию. Хранит только chat_id и id аккаунта (telegram.schema.ts). Серию берёт у progress через его
 * публичный сервис — чужие таблицы не читает (правило 4). Служебные операции бота (роль service) проверяет
 * AccessControl до обработчика.
 */
@Injectable()
export class TelegramService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly progress: ProgressService,
  ) {}

  /** POST /telegram/link: подпись initData → user.id → привязка к вызывающему. Сама строка нигде не сохраняется. */
  async link(principal: Principal, body: Schema<"TelegramLinkRequest">, now: Date = new Date()): Promise<Schema<"TelegramLink">> {
    const botToken = this.config.TELEGRAM_BOT_TOKEN;
    if (!botToken) throw unavailable("telegram_unavailable");
    const check = verifyInitData(body.initData, botToken, now);
    if (!check.ok) throw unprocessable(check.reason === "expired" ? "init_data_expired" : "init_data_invalid");
    const [row] = await this.db
      .insert(telegramLinks)
      .values({ chatId: check.userId, accountId: principal.accountId, linkedAt: now })
      .onConflictDoUpdate({ target: telegramLinks.chatId, set: { accountId: principal.accountId, linkedAt: now, updatedAt: now } })
      .returning();
    return { reminders: remindersOf(row!) };
  }

  /** GET /telegram/bot/chats/{chatId} (бот). */
  async chat(chatId: string): Promise<Schema<"TelegramChat">> {
    const [row] = await this.db.select().from(telegramLinks).where(eq(telegramLinks.chatId, chatIdOf(chatId)));
    if (!row) throw notFound("chat_not_linked");
    return chatOf(row);
  }

  /** PUT /telegram/bot/chats/{chatId}/reminders (бот): согласие на напоминания и час. */
  async setReminders(chatId: string, body: Schema<"TelegramRemindersUpdate">): Promise<Schema<"TelegramChat">> {
    const [row] = await this.db
      .update(telegramLinks)
      .set({ remindersEnabled: body.enabled, ...(body.hour !== undefined ? { reminderHour: body.hour } : {}) })
      .where(eq(telegramLinks.chatId, chatIdOf(chatId)))
      .returning();
    if (!row) throw notFound("chat_not_linked");
    return chatOf(row);
  }

  /** DELETE /telegram/bot/chats/{chatId} (бот): /unlink или бот заблокирован. Повтор — то же 204. */
  async unlink(chatId: string): Promise<void> {
    const id = Number(chatId);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    await this.db.delete(telegramLinks).where(eq(telegramLinks.chatId, id));
  }

  /**
   * POST /telegram/bot/reminders/claim (бот): чаты, которым пора напомнить, — и сразу отметка «напомнили сегодня».
   * Отметка — условным UPDATE: два параллельных вызова не выдадут один чат дважды за сутки.
   */
  async claimReminders(now: Date = new Date()): Promise<Schema<"TelegramReminderBatch">> {
    const day = ufaDate(now);
    const hour = ufaHour(now);
    if (!outsideQuietHours(hour)) return { day, items: [] };
    const notYetToday = or(isNull(telegramLinks.lastRemindedOn), lt(telegramLinks.lastRemindedOn, day));
    const candidates = await this.db
      .select({ chatId: telegramLinks.chatId, accountId: telegramLinks.accountId })
      .from(telegramLinks)
      .where(and(eq(telegramLinks.remindersEnabled, true), lte(telegramLinks.reminderHour, hour), notYetToday));
    if (candidates.length === 0) return { day, items: [] };

    const atRisk = await this.progress.streaksAtRisk([...new Set(candidates.map((c) => c.accountId))], now);
    const due = candidates.filter((c) => atRisk.has(c.accountId)).map((c) => c.chatId);
    if (due.length === 0) return { day, items: [] };
    const claimed = await this.db
      .update(telegramLinks)
      .set({ lastRemindedOn: day })
      .where(and(inArray(telegramLinks.chatId, due), eq(telegramLinks.remindersEnabled, true), notYetToday))
      .returning({ chatId: telegramLinks.chatId });
    return { day, items: claimed.map((c) => ({ chatId: String(c.chatId) })).sort((a, b) => a.chatId.localeCompare(b.chatId)) };
  }
}
