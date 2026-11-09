// Что ядру бота нужно от API (ADR 0020). Типы — только из контракта (CLAUDE.md, правило 1): реализация —
// adapters/api.ts (openapi-fetch по сгенерированным путям), в тестах — подделка в памяти.
import type { Schema } from "@teletau/contracts";

export type ChatLink = Schema<"TelegramChat">;
export type Reminders = Schema<"TelegramReminders">;

/** API недоступно (сеть, 5xx, таймаут) или отвергло секрет сервиса — ответить «попробуй позже», а не упасть. */
export class ApiUnavailableError extends Error {
  constructor(readonly status?: number) {
    super(status ? `API ответил ${status}` : "API недоступно");
  }
}

export interface TeleTauApi {
  /** Привязка чата; null — чат не привязан. */
  chat(chatId: string): Promise<ChatLink | null>;
  /** Согласие на напоминания и час по Уфе; null — чат не привязан. */
  setReminders(chatId: string, update: Schema<"TelegramRemindersUpdate">): Promise<ChatLink | null>;
  /** Удалить привязку целиком (вместе с настройками). */
  unlink(chatId: string): Promise<void>;
  /** Чаты, которым пора напомнить сейчас; API сразу отмечает их напомненными на эти сутки. */
  claimReminders(): Promise<string[]>;
}
