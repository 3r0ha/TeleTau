// Рассылка напоминаний о серии (ADR 0020). Кому и когда — решает API (POST /telegram/bot/reminders/claim):
// привязан, напоминания включены, наступил выбранный час по Уфе, не тихие часы, серия под угрозой, сегодня ещё не
// напоминали. Бот только отправляет. Чат, который бота заблокировал или удалён, отвязывается — данных о нём не остаётся.
// API отмечает чат напомненным при выдаче (не больше одного напоминания в сутки), поэтому недоставленное возвращается
// явно: Telegram просит подождать (429, retry_after) — повтор после паузы; Telegram ответил ошибкой и после повторов —
// сообщение точно не ушло, чат возвращается в выдачу (POST /telegram/bot/reminders/release). Обрыв сети — исход
// неизвестен, чат не возвращается: лучше пропустить напоминание, чем прислать ребёнку два.
import type { Outgoing } from "./messages.js";
import { ApiUnavailableError, type TeleTauApi } from "./ports.js";
import { reminderMessage, type BotContext } from "./scenarios.js";

/** Отправка в канал. Чат недоступен навсегда (заблокировал бота, удалён) — ChatUnreachableError. */
export type SendFn = (chatId: string, message: Outgoing) => Promise<void>;

export class ChatUnreachableError extends Error {
  constructor() {
    super("чат недоступен");
  }
}

/** Telegram просит повторить позже (429): `retryAfterSeconds` — из parameters.retry_after. */
export class RetryLaterError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`повторить через ${retryAfterSeconds} с`);
  }
}

/** Telegram ответил ошибкой — сообщение точно не доставлено (в отличие от обрыва сети). */
export class NotDeliveredError extends Error {
  constructor(readonly status: number) {
    super(`не доставлено (${status})`);
  }
}

export interface ReminderRun {
  sent: number;
  failed: number;
  /** Отвязано чатов, которые заблокировали бота. */
  unlinked: number;
  /** Возвращено в выдачу чатов, которым Telegram точно не доставил напоминание. */
  released: number;
  /** API недоступно — ничего не выдано (повторится на следующем шаге). */
  apiUnavailable: boolean;
}

/** Пауза между сообщениями: Bot API — не больше ~30 сообщений в секунду. */
export const SEND_GAP_MS = 50;
/** Повторов одного сообщения по 429 и самая длинная пауза retry_after, которую шаг готов ждать. */
export const SEND_RETRIES = 2;
export const MAX_RETRY_AFTER_SECONDS = 30;

export async function sendDueReminders(
  deps: { api: TeleTauApi; send: SendFn; ctx: Pick<BotContext, "miniAppUrl">; sleep?: (ms: number) => Promise<void> },
): Promise<ReminderRun> {
  const run: ReminderRun = { sent: 0, failed: 0, unlinked: 0, released: 0, apiUnavailable: false };
  let batch: { day: string; chatIds: string[] };
  try {
    batch = await deps.api.claimReminders();
  } catch (e) {
    if (e instanceof ApiUnavailableError) return { ...run, apiUnavailable: true };
    throw e;
  }
  const message = reminderMessage({ ...deps.ctx, api: deps.api });
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const undelivered: string[] = [];
  for (const [i, chatId] of batch.chatIds.entries()) {
    if (i > 0) await sleep(SEND_GAP_MS);
    try {
      await sendWithRetry(() => deps.send(chatId, message), sleep);
      run.sent++;
    } catch (e) {
      run.failed++;
      if (e instanceof ChatUnreachableError) {
        await deps.api.unlink(chatId).then(
          () => void run.unlinked++,
          () => undefined,
        );
      } else if (e instanceof RetryLaterError || e instanceof NotDeliveredError) {
        undelivered.push(chatId);
      }
    }
  }
  if (undelivered.length > 0 && batch.day) {
    await deps.api.releaseReminders(batch.day, undelivered).then(
      () => void (run.released = undelivered.length),
      () => undefined,
    );
  }
  return run;
}

/** Отправка с повтором по 429: ждём retry_after (если он не длиннее MAX_RETRY_AFTER_SECONDS), не больше SEND_RETRIES раз. */
async function sendWithRetry(send: () => Promise<void>, sleep: (ms: number) => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (e) {
      if (!(e instanceof RetryLaterError) || attempt >= SEND_RETRIES || e.retryAfterSeconds > MAX_RETRY_AFTER_SECONDS) throw e;
      await sleep(Math.max(1, e.retryAfterSeconds) * 1000);
    }
  }
}

/**
 * Периодический шаг рассылки: сразу и затем каждые `intervalMs`; шаги не накладываются. В лог — только счётчики,
 * без chat_id (это идентификатор человека в Telegram).
 */
export function startReminderLoop(step: () => Promise<ReminderRun>, intervalMs: number, log: (line: string) => void = console.log): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await step();
      if (r.sent || r.failed) log(`bot: напоминания — отправлено ${r.sent}, не доставлено ${r.failed}, отвязано ${r.unlinked}${r.released ? `, возвращено ${r.released}` : ""}`);
    } catch (e) {
      log(`bot: шаг напоминаний не выполнен: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
