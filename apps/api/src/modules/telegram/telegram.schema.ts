// Таблицы модуля telegram (ADR 0014, ADR 0020): привязка личного чата с ботом к аккаунту и согласие на напоминания.
// Хранится только chat_id (= user.id Telegram) и id аккаунта — ничего из профиля Telegram: ни имени, ни ника, ни фото
// (CLAUDE.md, правила 5 и 13). Ссылка на аккаунт — простой uuid без внешнего ключа, как в других модулях.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, pgTable, smallint, uuid } from "drizzle-orm/pg-core";
import { timestamps, tstz } from "../../db/columns.js";
import { DEFAULT_REMINDER_HOUR } from "./reminders.js";

/**
 * Привязка: один личный чат — один аккаунт (повторная привязка переносит чат к новому аккаунту); у аккаунта может
 * быть несколько чатов. Напоминания — только по согласию (`reminders_enabled`, по умолчанию выключены), не чаще раза
 * в сутки по Уфе (`last_reminded_on`).
 */
export const telegramLinks = pgTable(
  "telegram_links",
  {
    /** chat.id личного чата = user.id Telegram (до 52 значащих бит — точно помещается в number). */
    chatId: bigint("chat_id", { mode: "number" }).primaryKey(),
    accountId: uuid("account_id").notNull(),
    remindersEnabled: boolean("reminders_enabled").notNull().default(false),
    /** Час напоминания по Уфе, вне тихих часов детей 21:00–08:00. */
    reminderHour: smallint("reminder_hour").notNull().default(DEFAULT_REMINDER_HOUR),
    /** Сутки по Уфе последнего выданного напоминания. */
    lastRemindedOn: date("last_reminded_on"),
    linkedAt: tstz("linked_at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    index("telegram_links_account_idx").on(t.accountId),
    index("telegram_links_reminders_idx").on(t.reminderHour).where(sql`${t.remindersEnabled}`),
    check("telegram_links_chat_positive", sql`${t.chatId} > 0`),
    check("telegram_links_hour_range", sql`${t.reminderHour} BETWEEN 8 AND 20`),
  ],
);
