import type { Button, Incoming, Outgoing } from "./messages.js";
import { ApiUnavailableError, type ChatLink, type TeleTauApi } from "./ports.js";

export interface BotContext {
  /** https-адрес Mini App; нет — кнопки «Учиться» нет (Telegram открывает Mini App только по HTTPS). */
  miniAppUrl?: string | undefined;
  /** Служебные операции API; null — бот запущен без BOT_SERVICE_TOKEN, напоминаний нет. */
  api: TeleTauApi | null;
}

// «ТелеТау» — имя бренда, needs_native_review (docs/native-review-queue.md, №1)
const BRAND = "ТелеТау";

/** Часы напоминания на кнопках (по Уфе): после уроков и до тихих часов 21:00–08:00 (docs/02 §8). */
export const REMINDER_HOUR_CHOICES = [16, 17, 18, 19, 20] as const;

/** Данные inline-кнопок (≤ 64 байт, Bot API). */
export const CALLBACK = {
  menu: "rem:menu",
  on: "rem:on",
  off: "rem:off",
  hour: (h: number) => `rem:h:${h}`,
} as const;

export const TEXT = {
  start: `Привет! Это ${BRAND} — башкирский язык каждый день.`,
  startLearn: "Уроки — по кнопке «Учиться».",
  startNoApp: `Уроки — в приложении и на сайте «${BRAND}».`,
  startRemind: "Напоминания о серии — /remind",
  help: [
    "Команды:",
    "/start — начать",
    "/remind — напоминания о серии",
    "/remind_off — выключить напоминания",
    "/unlink — отвязать этот чат",
    "/help — помощь",
  ].join("\n"),
  fallback: "Уроки — по кнопке «Учиться». Команды — /help.",
  notLinked: "Сначала открой «Учиться» и войди. Потом снова набери /remind.",
  remindersOff: "Напоминания выключены.\nНапишу раз в день, если сегодня ещё не было урока.",
  remindersOn: (hour: number) => `Напомню в ${clock(hour)} по Уфе, если сегодня ещё не было урока.\nДругой час — кнопкой ниже.`,
  turnedOff: "Напоминания выключены. Включить снова — /remind.",
  unlinked: "Чат отвязан. Привязать снова — открой «Учиться» и войди.",
  unavailable: "Нет связи с сервером. Попробуй позже.",
  remindersDisabled: "Напоминания пока недоступны.",
  /** Напоминание о серии: без имени, ника, числа дней — ничего личного (правило 13). */
  reminder: "Сегодня ещё не было урока. Пройди один, чтобы не прервать серию.",
} as const;

const clock = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

const learnRow = (ctx: BotContext): Button[][] =>
  ctx.miniAppUrl ? [[{ label: "Учиться", action: { kind: "openMiniApp", url: ctx.miniAppUrl } }]] : [];

/** Состояние напоминаний: текст и кнопки (включить / выбрать час / выключить). */
function remindersView(link: ChatLink, ctx: BotContext): Outgoing {
  const { enabled, hour } = link.reminders;
  if (!enabled) {
    return { text: TEXT.remindersOff, buttons: [[{ label: `Включить в ${clock(hour)}`, action: { kind: "callback", data: CALLBACK.on } }], ...learnRow(ctx)] };
  }
  const hours = REMINDER_HOUR_CHOICES.map((h) => ({ label: h === hour ? `✓ ${clock(h)}` : clock(h), action: { kind: "callback", data: CALLBACK.hour(h) } }) as const);
  return { text: TEXT.remindersOn(hour), buttons: [hours, [{ label: "Выключить", action: { kind: "callback", data: CALLBACK.off } }]] };
}

/** Напоминание о серии для рассылки (core/reminders.ts): «Учиться» и выключение — прямо под сообщением. */
export function reminderMessage(ctx: Pick<BotContext, "miniAppUrl">): Outgoing {
  return {
    text: TEXT.reminder,
    buttons: [...learnRow({ ...ctx, api: null }), [{ label: "Выключить напоминания", action: { kind: "callback", data: CALLBACK.off } }]],
  };
}

function start(ctx: BotContext): Outgoing {
  const lines: string[] = [TEXT.start, ctx.miniAppUrl ? TEXT.startLearn : TEXT.startNoApp];
  if (ctx.api) lines.push("", TEXT.startRemind);
  const buttons = [...learnRow(ctx), ...(ctx.api ? [[{ label: "Напоминания", action: { kind: "callback", data: CALLBACK.menu } } as Button]] : [])];
  return buttons.length ? { text: lines.join("\n"), buttons } : { text: lines.join("\n") };
}

/** Команды и кнопки напоминаний: всё через API — бот сам ничего не хранит. */
async function reminders(chatId: string, action: "menu" | "on" | "off" | { hour: number }, ctx: BotContext): Promise<Outgoing> {
  const api = ctx.api;
  if (!api) return { text: TEXT.remindersDisabled };
  const link =
    action === "menu"
      ? await api.chat(chatId)
      : await api.setReminders(chatId, action === "on" ? { enabled: true } : action === "off" ? { enabled: false } : { enabled: true, hour: action.hour });
  if (!link) return { text: TEXT.notLinked, ...(ctx.miniAppUrl ? { buttons: learnRow(ctx) } : {}) };
  if (action === "off") return { text: TEXT.turnedOff };
  return remindersView(link, ctx);
}

function parseCallback(data: string): "menu" | "on" | "off" | { hour: number } | null {
  if (data === CALLBACK.menu) return "menu";
  if (data === CALLBACK.on) return "on";
  if (data === CALLBACK.off) return "off";
  const m = /^rem:h:(\d{1,2})$/.exec(data);
  const hour = m ? Number(m[1]) : NaN;
  return (REMINDER_HOUR_CHOICES as readonly number[]).includes(hour) ? { hour } : null;
}

async function route(message: Incoming, ctx: BotContext): Promise<Outgoing[]> {
  if (message.kind === "callback") {
    const action = parseCallback(message.data);
    return action ? [await reminders(message.chatId, action, ctx)] : [];
  }
  if (message.kind === "command") {
    switch (message.command) {
      case "start":
        return [start(ctx)];
      case "help":
        return [{ text: TEXT.help }];
      case "remind":
      case "reminders":
        return [await reminders(message.chatId, "menu", ctx)];
      case "remind_on":
        return [await reminders(message.chatId, "on", ctx)];
      case "remind_off":
        return [await reminders(message.chatId, "off", ctx)];
      case "unlink":
        if (!ctx.api) return [{ text: TEXT.remindersDisabled }];
        await ctx.api.unlink(message.chatId);
        return [{ text: TEXT.unlinked }];
    }
  }
  return [{ text: TEXT.fallback }];
}

/**
 * Сценарии бота: /start, /help, напоминания о серии (/remind, /remind_on, /remind_off, кнопки), /unlink.
 * Ответы не содержат данных пользователя; API недоступно — вежливое «попробуй позже», а не ошибка.
 */
export async function handle(message: Incoming, ctx: BotContext): Promise<Outgoing[]> {
  try {
    return await route(message, ctx);
  } catch (e) {
    if (e instanceof ApiUnavailableError) return [{ text: TEXT.unavailable }];
    throw e;
  }
}
