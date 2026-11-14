// Что ядру бота нужно от API (ADR 0020, 0024). Типы — только из контракта (CLAUDE.md, правило 1): реализация —
// adapters/api.ts (openapi-fetch по сгенерированным путям), в тестах — подделка в памяти.
import type { Schema } from "@teletau/contracts";

export type ChatLink = Schema<"TelegramChat">;
export type Reminders = Schema<"TelegramReminders">;
export type DailyDuel = Schema<"TelegramDailyDuel">;
export type DuelSide = Schema<"TelegramDuelSide">;
export type DuelChoice = Schema<"DuelChoice">;
/** Пара фразы дня (ТЗ §3.6): публичная принятая пара корпуса — без привязки чата. */
export type PhraseOfDayPair = NonNullable<Schema<"PhraseOfDay">["pair"]>;
/** Выданный диалог: при state = issued контракт гарантирует поля диалога. */
export type IssuedDailyDuel = DailyDuel & { state: "issued"; dialogId: string; itemId: string; sourceRu: string; a: DuelSide; b: DuelSide };

/** API недоступно (сеть, 5xx, таймаут) или отвергло секрет сервиса — ответить «попробуй позже», а не упасть. */
export class ApiUnavailableError extends Error {
  constructor(readonly status?: number) {
    super(status ? `API ответил ${status}` : "API недоступно");
  }
}

/** Ответ на диалог ежедневки: ok — голос учтён (replay — уже был учтён этой же кнопкой); closed — диалог закрыт; voted — за пару уже голосовали. */
export type DuelAnswer = { kind: "ok"; replay: boolean } | { kind: "closed" } | { kind: "voted" };

export interface TeleTauApi {
  /** Привязка чата; null — чат не привязан. */
  chat(chatId: string): Promise<ChatLink | null>;
  /** Погасить одноразовый код привязки (`/start <код>`); null — код не найден, истёк или уже использован. */
  redeemLinkCode(chatId: string, code: string): Promise<ChatLink | null>;
  /** Согласие на напоминания и час по Уфе; null — чат не привязан. */
  setReminders(chatId: string, update: Schema<"TelegramRemindersUpdate">): Promise<ChatLink | null>;
  /** Удалить привязку целиком (вместе с настройками). */
  unlink(chatId: string): Promise<void>;
  /** Чаты, которым пора напомнить сейчас; API сразу отмечает их напомненными на эти сутки. */
  claimReminders(): Promise<string[]>;
  /** Ежедневное задание (ADR 0024): выданный диалог, «на сегодня всё» или «нерешённых дуэлей нет»; null — чат не привязан. */
  dailyDuel(chatId: string): Promise<DailyDuel | null>;
  /** Ответ кнопкой выбора: диалог исчез (отвязка) — null. */
  answerDuel(dialogId: string, choice: DuelChoice): Promise<DuelAnswer | null>;
  /** Отмена активного диалога чата; null — чат не привязан. */
  cancelDaily(chatId: string): Promise<{ cancelled: boolean } | null>;
  /** Фраза дня (ТЗ §3.6) — публичная витрина, привязка чата не нужна; null — принятых пар ещё нет. */
  phraseOfDay(): Promise<PhraseOfDayPair | null>;
}
