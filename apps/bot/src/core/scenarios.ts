import type { Button, Incoming, Outgoing } from "./messages.js";
import { ApiUnavailableError, type ChatLink, type DailyDuel, type DuelChoice, type IssuedDailyDuel, type TeleTauApi } from "./ports.js";

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

/** Данные inline-кнопок (≤ 64 байт, Bot API). Кнопки дуэли несут dialogId — голос относится именно к этому заданию. */
export const CALLBACK = {
  menu: "rem:menu",
  on: "rem:on",
  off: "rem:off",
  hour: (h: number) => `rem:h:${h}`,
  daily: "dd:menu",
  dailyCancel: "dd:cancel",
  /** `dd:<uuid>:<choice>` — 44 байта максимум: влезает в лимит callback_data. */
  duel: (dialogId: string, choice: DuelChoice) => `dd:${dialogId}:${choice}`,
} as const;

export const TEXT = {
  start: `Привет! Это ${BRAND} — башкирский язык каждый день.`,
  startLearn: "Уроки — по кнопке «Учиться».",
  startNoApp: `Уроки — в приложении и на сайте «${BRAND}».`,
  startRemind: "Напоминания о серии — /remind",
  startDaily: "Задание дня — /daily",
  startPhrase: "Фраза дня — /phrase",
  help: [
    "Команды:",
    "/start — начать",
    "/daily — задание дня",
    "/cancel — отменить задание",
    "/phrase — фраза дня",
    "/remind — напоминания о серии",
    "/remind_off — выключить напоминания",
    "/unlink — отвязать этот чат",
    "/help — помощь",
  ].join("\n"),
  fallback: "Уроки — по кнопке «Учиться». Задание дня — /daily. Команды — /help.",
  notLinked: "Сначала открой «Учиться» и войди. Потом снова набери /remind.",
  notLinkedDaily: "Сначала открой «Учиться» и войди. Потом снова набери /daily.",
  remindersOff: "Напоминания выключены.\nНапишу раз в день, если сегодня ещё не было урока.",
  remindersOn: (hour: number) => `Напомню в ${clock(hour)} по Уфе, если сегодня ещё не было урока.\nДругой час — кнопкой ниже.`,
  turnedOff: "Напоминания выключены. Включить снова — /remind.",
  unlinked: "Чат отвязан. Привязать снова — открой «Учиться» и войди.",
  unavailable: "Нет связи с сервером. Попробуй позже.",
  remindersDisabled: "Напоминания пока недоступны.",
  /** Напоминание о серии: без имени, ника, числа дней — ничего личного (правило 13). */
  reminder: "Сегодня ещё не было урока. Пройди один, чтобы не прервать серию.",
  // ── ежедневное задание (ADR 0024) ──
  dailyDisabled: "Задание дня пока недоступно.",
  dailyDone: "Сегодня голос уже учтён. Возвращайся завтра!",
  dailyEmpty: "Нерешённых дуэлей сейчас нет. Спасибо, что помогаешь языку!",
  /** Дуэль: контент и номера сторон; распределение голосов не показываем (защита от конформизма). */
  duelHeader: "Задание дня — «Помоги языку»",
  duelAsk: "Какой перевод лучше?",
  duelBoth: "Оба подходят",
  duelSkip: "Не знаю",
  duelCancel: "Отменить",
  duelVoted: "Голос учтён. Спасибо, что помогаешь языку!",
  duelVotedAlready: "Голос за эту пару уже учтён.",
  duelClosed: "Задание уже закрыто. Новое — /daily.",
  dailyCancelled: "Задание отменено. Новое — /daily.",
  dailyNothingToCancel: "Отменять нечего.",
  // ── фраза дня (ТЗ §3.6) ──
  phraseDisabled: "Фраза дня пока недоступна.",
  phraseEmpty: "Принятых пар в словаре ещё нет. Загляни позже!",
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

/** Напоминание о серии для рассылки (core/reminders.ts): «Учиться», «Задание дня» и выключение — под сообщением. */
export function reminderMessage(ctx: Pick<BotContext, "miniAppUrl" | "api">): Outgoing {
  const daily = ctx.api ? [{ label: "Задание дня", action: { kind: "callback", data: CALLBACK.daily } } as Button] : undefined;
  return {
    text: TEXT.reminder,
    buttons: [...learnRow({ ...ctx, api: null }), ...(daily ? [daily] : []), [{ label: "Выключить напоминания", action: { kind: "callback", data: CALLBACK.off } }]],
  };
}

function start(ctx: BotContext): Outgoing {
  const lines: string[] = [TEXT.start, ctx.miniAppUrl ? TEXT.startLearn : TEXT.startNoApp];
  if (ctx.api) lines.push("", TEXT.startRemind, TEXT.startDaily, TEXT.startPhrase);
  const buttons = [
    ...learnRow(ctx),
    ...(ctx.api
      ? [[{ label: "Напоминания", action: { kind: "callback", data: CALLBACK.menu } } as Button, { label: "Задание дня", action: { kind: "callback", data: CALLBACK.daily } } as Button]]
      : []),
  ];
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

/** Нажатие кнопки дуэли: dialogId и выбор из `dd:<uuid>:<choice>`. */
function parseDuelCallback(data: string): { dialogId: string; choice: DuelChoice } | "daily" | "cancel" | null {
  if (data === CALLBACK.daily) return "daily";
  if (data === CALLBACK.dailyCancel) return "cancel";
  const m = /^dd:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(a|b|both|skip)$/.exec(data);
  return m ? { dialogId: m[1]!, choice: m[2]! as DuelChoice } : null;
}

/** Сообщение-дуэль: исходник и стороны по номерам; ответ кнопкой относится к dialogId этого задания. */
function duelMessage(duel: IssuedDailyDuel): Outgoing {
  return {
    text: `${TEXT.duelHeader}\n\n${TEXT.duelAsk}\n\n«${duel.sourceRu}»\n\n1. ${duel.a.text}\n2. ${duel.b.text}`,
    buttons: [
      [{ label: `1. ${duel.a.text}`, action: { kind: "callback", data: CALLBACK.duel(duel.dialogId, "a") } }],
      [{ label: `2. ${duel.b.text}`, action: { kind: "callback", data: CALLBACK.duel(duel.dialogId, "b") } }],
      [
        { label: TEXT.duelBoth, action: { kind: "callback", data: CALLBACK.duel(duel.dialogId, "both") } },
        { label: TEXT.duelSkip, action: { kind: "callback", data: CALLBACK.duel(duel.dialogId, "skip") } },
      ],
      [{ label: TEXT.duelCancel, action: { kind: "callback", data: CALLBACK.dailyCancel } }],
    ],
  };
}

/** /daily и кнопка «Задание дня»: выдать дуэль или объяснить, что на сегодня всё (FSM — в API, ADR 0024). */
async function daily(chatId: string, ctx: BotContext): Promise<Outgoing> {
  const api = ctx.api;
  if (!api) return { text: TEXT.dailyDisabled };
  const duel = await api.dailyDuel(chatId);
  if (!duel) return { text: TEXT.notLinkedDaily, ...(ctx.miniAppUrl ? { buttons: learnRow(ctx) } : {}) };
  if (duel.state === "done") return { text: TEXT.dailyDone };
  if (duel.state === "empty") return { text: TEXT.dailyEmpty };
  // state = issued — по контракту есть dialogId и стороны (IssuedDailyDuel).
  return duelMessage(duel as IssuedDailyDuel);
}

/** Нажатие кнопки выбора: голос уже учтён — тот же ответ; диалог закрыт или пара уже голосована — спокойное пояснение. */
async function duelAnswer(dialogId: string, choice: DuelChoice, ctx: BotContext): Promise<Outgoing> {
  const api = ctx.api;
  if (!api) return { text: TEXT.dailyDisabled };
  const result = await api.answerDuel(dialogId, choice);
  if (!result || result.kind === "closed") return { text: TEXT.duelClosed };
  if (result.kind === "voted") return { text: TEXT.duelVotedAlready };
  // Распределение голосов не показывается (защита от конформизма, docs/03 §4a): только «учтён».
  return { text: TEXT.duelVoted };
}

/** /cancel: закрыть активное задание — голоса не было, новая дуэля доступна сразу. */
async function cancelDaily(chatId: string, ctx: BotContext): Promise<Outgoing> {
  const api = ctx.api;
  if (!api) return { text: TEXT.dailyDisabled };
  const result = await api.cancelDaily(chatId);
  if (!result) return { text: TEXT.notLinkedDaily };
  return { text: result.cancelled ? TEXT.dailyCancelled : TEXT.dailyNothingToCancel };
}

/** /phrase: пара дня из словаря — публичная витрина (ТЗ §3.6), привязка чата не нужна. */
async function phrase(ctx: BotContext): Promise<Outgoing> {
  const api = ctx.api;
  if (!api) return { text: TEXT.phraseDisabled };
  const pair = await api.phraseOfDay();
  if (!pair) return { text: TEXT.phraseEmpty };
  return { text: `Фраза дня\n\n«${pair.textBa}»\n— «${pair.sourceRu}»`, buttons: learnRow(ctx) };
}

async function route(message: Incoming, ctx: BotContext): Promise<Outgoing[]> {
  if (message.kind === "callback") {
    const action = parseCallback(message.data);
    if (action) return [await reminders(message.chatId, action, ctx)];
    const duel = parseDuelCallback(message.data);
    if (duel === "daily") return [await daily(message.chatId, ctx)];
    if (duel === "cancel") return [await cancelDaily(message.chatId, ctx)];
    if (duel) return [await duelAnswer(duel.dialogId, duel.choice, ctx)];
    return [];
  }
  if (message.kind === "command") {
    switch (message.command) {
      case "start":
        return [start(ctx)];
      case "help":
        return [{ text: TEXT.help }];
      case "daily":
        return [await daily(message.chatId, ctx)];
      case "cancel":
        return [await cancelDaily(message.chatId, ctx)];
      case "phrase":
        return [await phrase(ctx)];
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
 * Сценарии бота: /start, /help, напоминания о серии (/remind, /remind_on, /remind_off, кнопки), /unlink,
 * ежедневное задание (ADR 0024): /daily, /cancel, кнопки дуэли — и фраза дня /phrase (ТЗ §3.6). Ответы
 * не содержат данных пользователя; API недоступно — вежливое «попробуй позже», а не ошибка.
 */
export async function handle(message: Incoming, ctx: BotContext): Promise<Outgoing[]> {
  try {
    return await route(message, ctx);
  } catch (e) {
    if (e instanceof ApiUnavailableError) return [{ text: TEXT.unavailable }];
    throw e;
  }
}

export type { DailyDuel };
