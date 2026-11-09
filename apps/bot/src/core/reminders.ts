// Рассылка напоминаний о серии (ADR 0020). Кому и когда — решает API (POST /telegram/bot/reminders/claim):
// привязан, напоминания включены, наступил выбранный час по Уфе, не тихие часы, серия под угрозой, сегодня ещё не
// напоминали. Бот только отправляет. Чат, который бота заблокировал или удалён, отвязывается — данных о нём не остаётся.
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

export interface ReminderRun {
  sent: number;
  failed: number;
  /** Отвязано чатов, которые заблокировали бота. */
  unlinked: number;
  /** API недоступно — ничего не выдано (повторится на следующем шаге). */
  apiUnavailable: boolean;
}

/** Пауза между сообщениями: Bot API — не больше ~30 сообщений в секунду. */
export const SEND_GAP_MS = 50;

export async function sendDueReminders(
  deps: { api: TeleTauApi; send: SendFn; ctx: Pick<BotContext, "miniAppUrl">; sleep?: (ms: number) => Promise<void> },
): Promise<ReminderRun> {
  const run: ReminderRun = { sent: 0, failed: 0, unlinked: 0, apiUnavailable: false };
  let chats: string[];
  try {
    chats = await deps.api.claimReminders();
  } catch (e) {
    if (e instanceof ApiUnavailableError) return { ...run, apiUnavailable: true };
    throw e;
  }
  const message = reminderMessage(deps.ctx);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (const [i, chatId] of chats.entries()) {
    if (i > 0) await sleep(SEND_GAP_MS);
    try {
      await deps.send(chatId, message);
      run.sent++;
    } catch (e) {
      run.failed++;
      if (e instanceof ChatUnreachableError) {
        await deps.api.unlink(chatId).then(
          () => void run.unlinked++,
          () => undefined,
        );
      }
    }
  }
  return run;
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
      if (r.sent || r.failed) log(`bot: напоминания — отправлено ${r.sent}, не доставлено ${r.failed}, отвязано ${r.unlinked}`);
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
