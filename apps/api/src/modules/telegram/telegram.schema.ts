// Таблицы модуля telegram (ADR 0014, ADR 0020): привязка личного чата с ботом к аккаунту и согласие на напоминания.
// Хранится только chat_id (= user.id Telegram) и id аккаунта — ничего из профиля Telegram: ни имени, ни ника, ни фото
// (CLAUDE.md, правила 5 и 13). Ссылки на аккаунт — простой uuid без внешнего ключа, как в других модулях.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, pgEnum, pgTable, smallint, text, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { timestamps, tstz } from "../../db/columns.js";
import { uuidv7 } from "../../common/uuidv7.js";
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

/** Статус диалога ежедневного задания (ADR 0024): выдан → отвечен или отменён; назад — никогда. */
export const dialogStatus = pgEnum("telegram_dialog_status", ["issued", "answered", "cancelled"]);

/**
 * Диалог ежедневного задания бота (FSM в БД, ADR 0024): выданная дуэль «Помоги языку» и ответ на неё. Состояние —
 * только здесь: ни в памяти бота, ни в callback-данных. Активный (`issued`) диалог один на аккаунт (частичный
 * уникальный индекс); `judgment_id` генерируется при выдаче — повторное нажатие кнопки это replay того же голоса.
 * `choice` и `item_status` — снимок ответа: replay возвращает их без новой записи в журнале. Сутки `day` — по Уфе,
 * момент выдачи; «учтённые сутки» считаются по `answered_at`.
 */
export const telegramDialogs = pgTable(
  "telegram_dialogs",
  {
    dialogId: uuid("dialog_id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    accountId: uuid("account_id").notNull(),
    itemId: uuid("item_id").notNull(),
    /** Варианты в порядке показа этому диалогу: A и B; choice ответа — относительно них. */
    variantAId: uuid("variant_a_id").notNull(),
    variantBId: uuid("variant_b_id").notNull(),
    /** judgmentId голоса — идемпотентность ответа (как attemptId попытки урока). */
    judgmentId: uuid("judgment_id").notNull(),
    /** Сутки по Уфе, на которые выдан диалог. */
    day: date("day").notNull(),
    status: dialogStatus("status").notNull().default("issued"),
    /** Выбор (только у отвеченного): a | b | both | skip. */
    choice: text("choice"),
    /** Статус исходника на момент ответа (только у отвеченного): voting | accepted | escalated. */
    itemStatus: text("item_status"),
    answeredAt: tstz("answered_at"),
    cancelledAt: tstz("cancelled_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("telegram_dialogs_one_issued_per_account_uq").on(t.accountId).where(sql`${t.status} = 'issued'`),
    index("telegram_dialogs_chat_idx").on(t.chatId),
    index("telegram_dialogs_account_status_idx").on(t.accountId, t.status),
    check("telegram_dialogs_answered_fields", sql`(${t.status} = 'answered') = (${t.choice} IS NOT NULL AND ${t.itemStatus} IS NOT NULL AND ${t.answeredAt} IS NOT NULL)`),
    check("telegram_dialogs_cancelled_fields", sql`(${t.status} = 'cancelled') = (${t.cancelledAt} IS NOT NULL)`),
    check("telegram_dialogs_choice_values", sql`${t.choice} IS NULL OR ${t.choice} IN ('a', 'b', 'both', 'skip')`),
    check("telegram_dialogs_item_status_values", sql`${t.itemStatus} IS NULL OR ${t.itemStatus} IN ('voting', 'accepted', 'escalated')`),
  ],
);
