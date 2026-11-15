import type { Button, Incoming, MenuButton, Outgoing } from "./messages.js";
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
  /** Отвязка чата из меню напоминаний (команда /unlink — запасной путь). */
  unlink: "chat:unlink",
  /** `dd:<uuid>:<choice>` — 44 байта максимум: влезает в лимит callback_data. */
  duel: (dialogId: string, choice: DuelChoice) => `dd:${dialogId}:${choice}`,
} as const;

/**
 * Метки постоянного меню (кнопки со смайликом перед текстом): нажатие текстовой кнопки Telegram присылает её метку
 * обычным сообщением — ядро узнаёт интенты дословно. «📚 Учиться» — web_app-кнопка, открывает Mini App.
 */
export const MENU = {
  learn: "📚 Учиться",
  daily: "⚡️ Задание дня",
  phrase: "💬 Фраза дня",
  reminders: "🔔 Напоминания",
} as const;

export const TEXT = {
  start: `Привет! Это ${BRAND} — башкирский язык каждый день.`,
  startLearn: "Уроки — по кнопке «📚 Учиться» под чатом.",
  startNoApp: `Уроки — в приложении и на сайте «${BRAND}».`,
  startRemind: "Напоминания о серии — «🔔 Напоминания».",
  startDaily: "Задание дня — «⚡️ Задание дня».",
  startPhrase: "Фраза дня — «💬 Фраза дня».",
  // ── привязка одноразовым кодом (ADR 0020) ──
  /** Код погашен: чат связан с аккаунтом — напоминания и дуэли придут сюда. */
  linked: "Готово! Этот телеграм теперь связан с твоим аккаунтом ТелеТау. Напоминания и дуэли придут сюда.",
  linkCodeBad: "Код не подошёл — возможно, истёк или уже использован. Возьми свежий в профиле на сайте и пришли /start <код>.",
  help: [
    "Всё — кнопками под чатом:",
    "",
    "📚 Учиться — уроки в приложении",
    "⚡️ Задание дня — помоги языку",
    "💬 Фраза дня — новая пара слов",
    "🔔 Напоминания — серия не прервётся",
    "",
    "Если кнопок не видно — нажми /start.",
  ].join("\n"),
  fallback: "Всё — кнопками под чатом: «📚 Учиться», «⚡️ Задание дня», «💬 Фраза дня», «🔔 Напоминания». Если их не видно — /start.",
  notLinked: "Сначала войди по кнопке «📚 Учиться» — карточкой, кодом класса или по почте. Потом снова — «🔔 Напоминания».",
  notLinkedDaily: "Сначала войди по кнопке «📚 Учиться» — карточкой, кодом класса или по почте. Потом снова — «⚡️ Задание дня».",
  remindersOff: "Напоминания выключены.\nНапишу раз в день, если сегодня ещё не было урока.",
  remindersOn: (hour: number) => `Напомню в ${clock(hour)}, если сегодня ещё не было урока.\nДругой час — кнопкой ниже.`,
  turnedOff: "Напоминания выключены. Включить снова — «🔔 Напоминания».",
  unlinked: "Чат отвязан. Привязать снова — открой «📚 Учиться» и войди.",
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
  duelBoth: "✅ Оба подходят",
  duelSkip: "🙈 Не знаю",
  duelCancel: "↩️ Отменить",
  duelVoted: "Голос учтён. Спасибо, что помогаешь языку!",
  duelVotedAlready: "Голос за эту пару уже учтён.",
  duelClosed: "Задание уже закрыто. Новое — «⚡️ Задание дня».",
  dailyCancelled: "Задание отменено. Новое — «⚡️ Задание дня».",
  dailyNothingToCancel: "Отменять нечего.",
  // ── фраза дня (ТЗ §3.6) ──
  phraseDisabled: "Фраза дня пока недоступна.",
  phraseEmpty: "Принятых пар в словаре ещё нет. Загляни позже!",
} as const;

const clock = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/** Inline-кнопка «Учиться» — в сообщениях с другими inline-кнопками (например, напоминание), где меню не поставить. */
const learnButton = (ctx: Pick<BotContext, "miniAppUrl">): Button[] =>
  ctx.miniAppUrl ? [{ label: MENU.learn, action: { kind: "openMiniApp", url: ctx.miniAppUrl } }] : [];

/**
 * Постоянное меню (reply-клавиатура, ставится сообщением без inline-кнопок): «Учиться» — web_app, остальные метки
 * приходят текстом и распознаются как интенты. Без API показываем только «Учиться»: остальное ответило бы «недоступно».
 */
export function menuRows(ctx: Pick<BotContext, "miniAppUrl" | "api">): MenuButton[][] {
  const rows: MenuButton[][] = [];
  if (ctx.miniAppUrl) rows.push([{ label: MENU.learn, webAppUrl: ctx.miniAppUrl }]);
  if (ctx.api) rows.push([{ label: MENU.daily }, { label: MENU.phrase }], [{ label: MENU.reminders }]);
  return rows;
}

/** Сообщение с меню, если меню есть (пустое меню — просто текст). */
const withMenu = (out: Omit<Outgoing, "menu">, ctx: Pick<BotContext, "miniAppUrl" | "api">): Outgoing => {
  const menu = menuRows(ctx);
  return menu.length ? { ...out, menu } : out;
};

/** Состояние напоминаний: текст и кнопки (включить / выбрать час / выключить / отвязать чат). */
function remindersView(link: ChatLink): Outgoing {
  const { enabled, hour } = link.reminders;
  if (!enabled) {
    return {
      text: TEXT.remindersOff,
      buttons: [[{ label: `✅ Включить в ${clock(hour)}`, action: { kind: "callback", data: CALLBACK.on } }], [{ label: "❌ Отвязать чат", action: { kind: "callback", data: CALLBACK.unlink } }]],
    };
  }
  const hours = REMINDER_HOUR_CHOICES.map((h) => ({ label: h === hour ? `✅ ${clock(h)}` : `⏰ ${clock(h)}`, action: { kind: "callback", data: CALLBACK.hour(h) } }) as const);
  return {
    text: TEXT.remindersOn(hour),
    buttons: [hours, [{ label: "🔕 Выключить", action: { kind: "callback", data: CALLBACK.off } }], [{ label: "❌ Отвязать чат", action: { kind: "callback", data: CALLBACK.unlink } }]],
  };
}

/** Напоминание о серии для рассылки (core/reminders.ts): «Учиться», «Задание дня» и выключение — под сообщением. */
export function reminderMessage(ctx: Pick<BotContext, "miniAppUrl" | "api">): Outgoing {
  const rows: Button[][] = [];
  const learn = learnButton(ctx);
  if (learn.length) rows.push(learn);
  if (ctx.api) rows.push([{ label: MENU.daily, action: { kind: "callback", data: CALLBACK.daily } }]);
  rows.push([{ label: "🔕 Выключить напоминания", action: { kind: "callback", data: CALLBACK.off } }]);
  return { text: TEXT.reminder, buttons: rows };
}

function start(ctx: BotContext): Outgoing {
  const lines: string[] = [TEXT.start, ctx.miniAppUrl ? TEXT.startLearn : TEXT.startNoApp];
  if (ctx.api) lines.push("", TEXT.startDaily, TEXT.startPhrase, TEXT.startRemind);
  return withMenu({ text: lines.join("\n") }, ctx);
}

/** Код привязки из `/start <код>`: первый аргумент, 8 знаков без похожих 0/O и 1/I (контракт). */
const LINK_CODE_RE = /^[2-9A-HJ-NP-Z]{8}$/;

/** `/start <код>`: погасить код и связать чат с аккаунтом; код не подошёл — подсказка взять свежий в профиле. */
async function startWithCode(chatId: string, args: string, ctx: BotContext): Promise<Outgoing> {
  const code = (args.trim().split(/\s+/)[0] ?? "").toUpperCase();
  if (!LINK_CODE_RE.test(code)) return start(ctx);
  const api = ctx.api;
  if (!api) return { text: TEXT.unavailable };
  const link = await api.redeemLinkCode(chatId, code);
  return link ? withMenu({ text: TEXT.linked }, ctx) : { text: TEXT.linkCodeBad };
}

/** Команды и кнопки напоминаний: всё через API — бот сам ничего не хранит. */
async function reminders(chatId: string, action: "menu" | "on" | "off" | { hour: number }, ctx: BotContext): Promise<Outgoing> {
  const api = ctx.api;
  if (!api) return { text: TEXT.remindersDisabled };
  const link =
    action === "menu"
      ? await api.chat(chatId)
      : await api.setReminders(chatId, action === "on" ? { enabled: true } : action === "off" ? { enabled: false } : { enabled: true, hour: action.hour });
  if (!link) return withMenu({ text: TEXT.notLinked }, ctx);
  if (action === "off") return { text: TEXT.turnedOff };
  return remindersView(link);
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
      [{ label: `1️⃣ ${duel.a.text}`, action: { kind: "callback", data: CALLBACK.duel(duel.dialogId, "a") } }],
      [{ label: `2️⃣ ${duel.b.text}`, action: { kind: "callback", data: CALLBACK.duel(duel.dialogId, "b") } }],
      [
        { label: TEXT.duelBoth, action: { kind: "callback", data: CALLBACK.duel(duel.dialogId, "both") } },
        { label: TEXT.duelSkip, action: { kind: "callback", data: CALLBACK.duel(duel.dialogId, "skip") } },
      ],
      [{ label: TEXT.duelCancel, action: { kind: "callback", data: CALLBACK.dailyCancel } }],
    ],
  };
}

/** /daily и кнопка «⚡️ Задание дня»: выдать дуэль или объяснить, что на сегодня всё (FSM — в API, ADR 0024). */
async function daily(chatId: string, ctx: BotContext): Promise<Outgoing> {
  const api = ctx.api;
  if (!api) return { text: TEXT.dailyDisabled };
  const duel = await api.dailyDuel(chatId);
  if (!duel) return withMenu({ text: TEXT.notLinkedDaily }, ctx);
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
  return withMenu({ text: `Фраза дня\n\n«${pair.textBa}»\n— «${pair.sourceRu}»` }, ctx);
}

/** Отвязка чата: кнопка «❌ Отвязать чат» в меню напоминаний или команда /unlink. */
async function unlinkChat(chatId: string, ctx: BotContext): Promise<Outgoing> {
  if (!ctx.api) return { text: TEXT.remindersDisabled };
  await ctx.api.unlink(chatId);
  return { text: TEXT.unlinked };
}

async function route(message: Incoming, ctx: BotContext): Promise<Outgoing[]> {
  if (message.kind === "callback") {
    if (message.data === CALLBACK.unlink) return [await unlinkChat(message.chatId, ctx)];
    const action = parseCallback(message.data);
    if (action) return [await reminders(message.chatId, action, ctx)];
    const duel = parseDuelCallback(message.data);
    if (duel === "daily") return [await daily(message.chatId, ctx)];
    if (duel === "cancel") return [await cancelDaily(message.chatId, ctx)];
    if (duel) return [await duelAnswer(duel.dialogId, duel.choice, ctx)];
    return [];
  }
  if (message.kind === "text") {
    // Нажатие кнопки постоянного меню приходит текстом метки — распознаём интенты дословно (MENU).
    const text = message.text.trim();
    if (text === MENU.daily) return [await daily(message.chatId, ctx)];
    if (text === MENU.phrase) return [await phrase(ctx)];
    if (text === MENU.reminders) return [await reminders(message.chatId, "menu", ctx)];
    return [withMenu({ text: TEXT.fallback }, ctx)];
  }
  if (message.kind === "command") {
    switch (message.command) {
      case "start":
        return [await startWithCode(message.chatId, message.args, ctx)];
      case "help":
        return [withMenu({ text: TEXT.help }, ctx)];
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
        return [await unlinkChat(message.chatId, ctx)];
    }
  }
  return [withMenu({ text: TEXT.fallback }, ctx)];
}

/**
 * Сценарии бота: постоянное меню кнопок (📚 Учиться, ⚡️ Задание дня, 💬 Фраза дня, 🔔 Напоминания) и команды как
 * запасной путь (/start, /help, /remind*, /daily, /cancel, /phrase, /unlink); `/start <код>` — привязка чата
 * одноразовым кодом с сайта (ADR 0020); напоминания о серии, ежедневное задание (ADR 0024) и фраза дня (ТЗ §3.6).
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

export type { DailyDuel };
