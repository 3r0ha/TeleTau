// Подделки для тестов бота без сети: API «ТелеТау» в памяти и Telegram Bot API через transformer grammY.
import type { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { ApiUnavailableError, type ChatLink, type DailyDuel, type DuelAnswer, type DuelChoice, type TeleTauApi, type Reminders, type PhraseOfDayPair } from "../src/core/ports.js";

/** Исходник пула ежедневки: русский исходник и два башкирских варианта (тексты — синтетические, правило 6). */
export interface FakeDuelItem {
  sourceRu: string;
  a: string;
  b: string;
}

interface FakeDialog {
  chatId: string;
  item: number;
  status: "issued" | "answered" | "cancelled";
  choice?: string;
  /** Сутки ответа (done — на эти сутки). */
  answeredOn?: number;
}

/** API в памяти: привязки чатов, очередь «кому напомнить», мини-FSM ежедневки (как telegram_dialogs в API) и журнал вызовов. */
export class FakeApi implements TeleTauApi {
  readonly links = new Map<string, Reminders>();
  readonly calls: string[] = [];
  due: string[] = [];
  down = false;
  /** Одноразовые коды привязки: код → «аккаунт»; погашение удаляет код и связывает чат. */
  readonly linkCodes = new Map<string, string>();
  /** Пул дуэлей ежедневки; три синтетических исходника по умолчанию. */
  pool: FakeDuelItem[] = [
    { sourceRu: "Синтетическая фраза 1", a: "синтез1 икс", b: "синтез1 игрек" },
    { sourceRu: "Синтетическая фраза 2", a: "синтез2 икс", b: "синтез2 игрек" },
    { sourceRu: "Синтетическая фраза 3", a: "синтез3 икс", b: "синтез3 игрек" },
  ];
  /** Текущие «сутки по Уфе»: продвигаются nextDay() — на новые сутки выдаётся новая дуэль. */
  day = 1;
  /** Пара фразы дня (ТЗ §3.6); null — принятых пар в словаре нет. */
  phrase: PhraseOfDayPair | null = { sourceRu: "Здравствуйте!", kind: "phrase", textBa: "Һаумыһығыҙ!", sources: [] };
  /** Исходники, за которые аккаунт уже голосовал (кнопкой бота или «из веба» — externalVote). */
  readonly votedItems = new Set<number>();
  /** Диалоги в памяти: ключ — dialogId (UUID-подобный, как выдаёт API). */
  readonly dialogs = new Map<string, FakeDialog>();
  private seq = 0;

  link(chatId: string, reminders: Partial<Reminders> = {}): this {
    this.links.set(chatId, { enabled: false, hour: 18, ...reminders });
    return this;
  }

  /** Выдать код привязки (как сайт через POST /me/telegram/link-code). */
  issueCode(code: string, accountId = "00000000-0000-4000-8000-000000000009"): this {
    this.linkCodes.set(code, accountId);
    return this;
  }

  /** Сутки сменились: ответ вчера — не «done» сегодня. */
  nextDay(): number {
    return (this.day += 1);
  }

  /** «Голос из веба» по номеру исходника: из пула исключён, ответ кнопкой по выданному диалогу — voted. */
  externalVote(item: number): this {
    this.votedItems.add(item);
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

  async redeemLinkCode(chatId: string, code: string) {
    this.check(`redeem ${chatId} ${code}`);
    if (!this.linkCodes.has(code)) return null;
    this.linkCodes.delete(code);
    this.links.set(chatId, { enabled: false, hour: 18 });
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

  /** Возвращённые в выдачу чаты (releaseReminders): сутки и чаты. */
  readonly released: { day: string; chatIds: string[] }[] = [];

  async claimReminders() {
    this.check("claim");
    const due = this.due;
    this.due = [];
    return { day: `day-${this.day}`, chatIds: due };
  }

  async releaseReminders(day: string, chatIds: string[]) {
    this.check(`release ${day} ${chatIds.join(",")}`);
    this.released.push({ day, chatIds: [...chatIds] });
    this.due.push(...chatIds);
  }

  async dailyDuel(chatId: string): Promise<DailyDuel | null> {
    this.check(`daily ${chatId}`);
    if (!this.links.has(chatId)) return null;
    // Активный диалог возвращается тем же (выдача идемпотентна), ответ в эти сутки — done, пул исчерпан — empty.
    for (const [id, d] of this.dialogs) if (d.chatId === chatId && d.status === "issued") return this.issuedOf(id, d);
    for (const d of this.dialogs.values()) if (d.chatId === chatId && d.status === "answered" && d.answeredOn === this.day) return { state: "done" };
    const item = this.pool.findIndex((_, i) => !this.votedItems.has(i));
    if (item === -1) return { state: "empty" };
    this.seq += 1;
    const id = `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
    const d: FakeDialog = { chatId, item, status: "issued" };
    this.dialogs.set(id, d);
    return this.issuedOf(id, d);
  }

  async answerDuel(dialogId: string, choice: DuelChoice): Promise<DuelAnswer | null> {
    this.check(`answer ${dialogId} ${choice}`);
    const d = this.dialogs.get(dialogId);
    if (!d) return null;
    if (d.status === "cancelled") return { kind: "closed" };
    if (d.status === "answered") return d.choice === choice ? { kind: "ok", replay: true } : { kind: "voted" };
    if (this.votedItems.has(d.item)) {
      // За исходник уже голосовали другим путём (веб): диалог закрывается — кнопка больше не отвечает.
      d.status = "cancelled";
      return { kind: "voted" };
    }
    d.status = "answered";
    d.choice = choice;
    d.answeredOn = this.day;
    this.votedItems.add(d.item);
    return { kind: "ok", replay: false };
  }

  async cancelDaily(chatId: string) {
    this.check(`cancel ${chatId}`);
    if (!this.links.has(chatId)) return null;
    let cancelled = false;
    for (const d of this.dialogs.values()) {
      if (d.chatId === chatId && d.status === "issued") {
        d.status = "cancelled";
        cancelled = true;
      }
    }
    return { cancelled };
  }

  async phraseOfDay() {
    this.check("phrase");
    return this.phrase;
  }

  private issuedOf(id: string, d: FakeDialog): DailyDuel {
    const item = this.pool[d.item]!;
    return {
      state: "issued",
      dialogId: id,
      itemId: `00000000-0000-4000-8000-${String(d.item + 1).padStart(12, "0")}`,
      sourceRu: item.sourceRu,
      a: { variantId: `00000000-0000-4000-8000-${String(d.item + 101).padStart(12, "0")}`, text: item.a },
      b: { variantId: `00000000-0000-4000-8000-${String(d.item + 201).padStart(12, "0")}`, text: item.b },
    };
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
