// Адаптер Telegram (grammY, long polling — публичный адрес не нужен). Чистые преобразования «ядро ⇄ Telegram» и тонкий
// транспорт. Из обновлений Telegram берётся только технический chat id личного чата; имя, ник, фото и язык из `from`
// не читаются (CLAUDE.md, правило 13). Групповые чаты бот не обслуживает: привязка, напоминания и задание дня —
// только личные.
import { Bot, GrammyError } from "grammy";
import type { BotCommand, InlineKeyboardButton, InlineKeyboardMarkup, KeyboardButton, ReplyKeyboardMarkup, UserFromGetMe } from "grammy/types";
import type { Button, Incoming, MenuButton, Outgoing } from "../core/messages.js";
import { ChatUnreachableError, type SendFn } from "../core/reminders.js";
import { handle, type BotContext } from "../core/scenarios.js";

export interface TelegramMessage {
  text: string;
  /** Одно на сообщение: постоянная клавиатура меню или inline-кнопки (Bot API). */
  reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup;
}

function toButton(button: Button): InlineKeyboardButton {
  return button.action.kind === "openMiniApp"
    ? { text: button.label, web_app: { url: button.action.url } }
    : { text: button.label, callback_data: button.action.data };
}

function toMenuButton(button: MenuButton): KeyboardButton {
  return button.webAppUrl ? { text: button.label, web_app: { url: button.webAppUrl } } : { text: button.label };
}

/** Постоянное меню: reply-клавиатура, не исчезает при следующих сообщениях без кнопок. */
function toMenu(menu: MenuButton[][]): ReplyKeyboardMarkup {
  return { keyboard: menu.map((row) => row.map(toMenuButton)), is_persistent: true, resize_keyboard: true };
}

/** Чистое преобразование «ядро → Telegram» (тестируется без сети). */
export function toTelegram(out: Outgoing): TelegramMessage {
  if (out.menu?.length) return { text: out.text, reply_markup: toMenu(out.menu) };
  if (!out.buttons?.length) return { text: out.text };
  return { text: out.text, reply_markup: { inline_keyboard: out.buttons.map((row) => row.map(toButton)) } };
}

/** Чистое преобразование «Telegram → ядро». Из профиля Telegram берём только технический chat id. */
export function fromTelegram(chatId: number, text: string): Incoming {
  const match = /^\/([a-z_]+)(?:@\w+)?\s*(.*)$/i.exec(text.trim());
  if (match) return { chatId: String(chatId), kind: "command", command: (match[1] ?? "").toLowerCase(), args: match[2] ?? "" };
  return { chatId: String(chatId), kind: "text", text };
}

/**
 * Меню команд (setMyCommands): управление — кнопками под чатом, поэтому из команд остаются только /start
 * (вызвать меню) и /help. Остальные команды (/daily, /remind, …) работают, но не рекламируются.
 */
export const COMMANDS: BotCommand[] = [
  { command: "start", description: "Показать меню" },
  { command: "help", description: "Помощь" },
];

/** Название кнопки меню чата — открывает Mini App. */
export const MENU_BUTTON_TEXT = "Учиться";

const options = (m: TelegramMessage) => (m.reply_markup ? { reply_markup: m.reply_markup } : {});

/** «message is not modified» — повторное нажатие той же кнопки: не ошибка. */
const notModified = (e: unknown) => e instanceof GrammyError && e.error_code === 400 && /not modified/i.test(e.description);

export function createTelegramBot(token: string, ctx: BotContext, opts: { botInfo?: UserFromGetMe } = {}): Bot {
  const bot = new Bot(token, opts.botInfo ? { botInfo: opts.botInfo } : {});
  const personal = bot.chatType("private");

  personal.on("message:text", async (tg) => {
    for (const out of await handle(fromTelegram(tg.chat.id, tg.message.text), ctx)) {
      const m = toTelegram(out);
      await tg.reply(m.text, options(m));
    }
  });

  // Нажатие кнопки: ответ — правкой того же сообщения (чат не засоряется), остальное — новыми сообщениями.
  // editMessageText принимает только inline-разметку: меню-клавиатуру с ответа снимаем (она и так постоянная).
  personal.on("callback_query:data", async (tg) => {
    const [first, ...rest] = await handle({ chatId: String(tg.chat.id), kind: "callback", data: tg.callbackQuery.data }, ctx);
    await tg.answerCallbackQuery();
    if (first) {
      const m = toTelegram(first);
      const markup = m.reply_markup && "inline_keyboard" in m.reply_markup ? { reply_markup: m.reply_markup } : {};
      await tg.editMessageText(m.text, markup).catch(async (e: unknown) => {
        if (!notModified(e)) await tg.reply(m.text, options(m));
      });
    }
    for (const out of rest) {
      const m = toTelegram(out);
      await tg.reply(m.text, options(m));
    }
  });

  bot.catch((err) => console.error(`bot: ошибка обработки обновления: ${err.error instanceof Error ? err.error.message : String(err.error)}`));
  return bot;
}

/**
 * Меню команд и кнопка меню чата «Учиться» → Mini App (если адрес https). Кнопку можно задать и вручную в @BotFather
 * (docs/demo/M2.md); с TELEGRAM_MINIAPP_URL бот ставит её сам при каждом запуске.
 */
export async function configureBot(bot: Bot, ctx: Pick<BotContext, "miniAppUrl">): Promise<void> {
  await bot.api.setMyCommands(COMMANDS);
  if (ctx.miniAppUrl) {
    await bot.api.setChatMenuButton({ menu_button: { type: "web_app", text: MENU_BUTTON_TEXT, web_app: { url: ctx.miniAppUrl } } });
  }
}

/**
 * Отправка напоминания. Telegram ответил «бот заблокирован», «пользователь удалён» или «чат не найден» — чат недоступен
 * навсегда (ChatUnreachableError): рассылка его отвяжет.
 */
export function telegramSender(bot: Bot): SendFn {
  return async (chatId, out) => {
    const m = toTelegram(out);
    try {
      await bot.api.sendMessage(Number(chatId), m.text, options(m));
    } catch (e) {
      if (e instanceof GrammyError && (e.error_code === 403 || (e.error_code === 400 && /chat not found|user is deactivated/i.test(e.description)))) {
        throw new ChatUnreachableError();
      }
      throw e;
    }
  };
}
