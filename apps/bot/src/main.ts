import { GrammyError, HttpError } from "grammy";
import { createTeleTauApi } from "./adapters/api.js";
import { configureBot, createTelegramBot, telegramSender } from "./adapters/telegram.js";
import { loadConfig, miniAppUrlFor, MISSING_TOKEN_MESSAGE } from "./config.js";
import { sendDueReminders, startReminderLoop } from "./core/reminders.js";
import type { BotContext } from "./core/scenarios.js";

const config = loadConfig(process.env);
const token = config.TELEGRAM_BOT_TOKEN;

if (!token) {
  // Без токена бот не стартует. В dev это обычное состояние (pnpm dev не падает), в production — ошибка запуска.
  console.error(MISSING_TOKEN_MESSAGE);
  process.exitCode = config.NODE_ENV === "production" ? 1 : 0;
} else {
  const miniAppUrl = miniAppUrlFor(config);
  if (!config.TELEGRAM_MINIAPP_URL) console.warn("bot: TELEGRAM_MINIAPP_URL не задан — кнопки «Учиться» не будет");
  else if (!miniAppUrl) console.warn("bot: TELEGRAM_MINIAPP_URL не https:// — Telegram открывает Mini App только по HTTPS, кнопки «Учиться» не будет");
  const api = config.BOT_SERVICE_TOKEN ? createTeleTauApi({ baseUrl: config.BOT_API_URL, serviceToken: config.BOT_SERVICE_TOKEN }) : null;
  if (!api) console.warn("bot: BOT_SERVICE_TOKEN не задан — напоминания о серии выключены");

  const ctx: BotContext = { miniAppUrl, api };
  const bot = createTelegramBot(token, ctx);
  let stopReminders = () => undefined as void;
  const stop = () => {
    stopReminders();
    void bot.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await configureBot(bot, ctx).catch((e: unknown) => console.warn(`bot: команды и кнопка меню не заданы: ${e instanceof Error ? e.message : String(e)}`));
    console.log("bot: запускаю long polling");
    await bot.start({
      onStart: (me) => {
        console.log(`bot: @${me.username} на связи${api ? `, напоминания — раз в ${config.BOT_REMINDER_INTERVAL_SECONDS} с` : ""}`);
        if (api) stopReminders = startReminderLoop(() => sendDueReminders({ api, send: telegramSender(bot), ctx }), config.BOT_REMINDER_INTERVAL_SECONDS * 1000);
      },
    });
  } catch (e) {
    stopReminders();
    if (e instanceof GrammyError && e.error_code === 401) console.error("bot: Telegram не принял токен (401) — проверьте TELEGRAM_BOT_TOKEN");
    else if (e instanceof HttpError) console.error("bot: Telegram недоступен — проверьте сеть; учёба в вебе и приложениях от бота не зависит");
    else console.error(`bot: остановлен с ошибкой: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}
