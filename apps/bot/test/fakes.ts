// Подделки для тестов бота без сети: API «ТелеТау» в памяти и Telegram Bot API через transformer grammY.
import type { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { ApiUnavailableError, type ChatLink, type TeleTauApi, type Reminders } from "../src/core/ports.js";

/** API в памяти: привязки чатов, очередь «кому напомнить», журнал вызовов. */
export class FakeApi implements TeleTauApi {
  readonly links = new Map<string, Reminders>();
  readonly calls: string[] = [];
  due: string[] = [];
  down = false;

  link(chatId: string, reminders: Partial<Reminders> = {}): this {
    this.links.set(chatId, { enabled: false, hour: 18, ...reminders });
    return this;
  }

  private check(call: string) {
    this.calls.push(call);
    if (this.down) throw new ApiUnavailableError(503);
  }

  private view(chatId: string): ChatLink | null {
    const r = this.links.get(chatId);
    return r ? { chatId, reminders: { ...r } } : null;
  }

  async chat(chatId: string) {
    this.check(`chat ${chatId}`);
    return this.view(chatId);
  }

  async setReminders(chatId: string, update: { enabled: boolean; hour?: number }) {
    this.check(`reminders ${chatId} ${JSON.stringify(update)}`);
    const r = this.links.get(chatId);
    if (!r) return null;
    r.enabled = update.enabled;
    if (update.hour !== undefined) r.hour = update.hour;
    return this.view(chatId);
  }

  async unlink(chatId: string) {
    this.check(`unlink ${chatId}`);
    this.links.delete(chatId);
  }

  async claimReminders() {
    this.check("claim");
    const due = this.due;
    this.due = [];
    return due;
  }
}

export const BOT_INFO = {
  id: 7000000001,
  is_bot: true,
  first_name: "ТелеТау — тест",
  username: "teletau_test_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as unknown as UserFromGetMe;

export interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

/**
 * Подменяет Bot API: каждый вызов записывается и получает ответ `reply(method, payload)` — по умолчанию `true`.
 * `{ error_code, description }` в ответе — ошибка Telegram (GrammyError). В сеть ничего не уходит.
 */
export function fakeTelegram(bot: Bot, reply: (call: ApiCall) => unknown = () => true): ApiCall[] {
  const calls: ApiCall[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    const call = { method, payload: (payload ?? {}) as Record<string, unknown> };
    calls.push(call);
    const result = reply(call);
    if (result && typeof result === "object" && "error_code" in result) return { ok: false, ...(result as object) } as never;
    return { ok: true, result } as never;
  });
  return calls;
}

let updateId = 1;

const USER = { id: 4242, is_bot: false, first_name: "Айгуль", last_name: "Тестова", username: "aigul_test", language_code: "ru" };

/** Сообщение в личном чате (как присылает Telegram: с профилем отправителя — бот не должен его использовать). */
export function textUpdate(text: string, chat: { id: number; type: "private" | "group" } = { id: USER.id, type: "private" }) {
  const command = text.startsWith("/") ? text.split(/\s/)[0]! : undefined;
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: 1_793_800_000,
      chat: chat.type === "private" ? { ...chat, first_name: USER.first_name, username: USER.username } : { ...chat, title: "6 «А»" },
      from: USER,
      text,
      ...(command ? { entities: [{ type: "bot_command", offset: 0, length: command.length }] } : {}),
    },
  };
}

export function callbackUpdate(data: string, chatId = USER.id) {
  return {
    update_id: updateId++,
    callback_query: {
      id: `cq-${updateId}`,
      from: USER,
      chat_instance: "-1",
      data,
      message: { message_id: 10, date: 1_793_800_000, chat: { id: chatId, type: "private", first_name: USER.first_name }, from: BOT_INFO, text: "…" },
    },
  };
}

export const USER_PII = [USER.first_name, USER.last_name, USER.username];
