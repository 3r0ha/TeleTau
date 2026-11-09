import { z } from "zod";

/** Токен бота от @BotFather: «<id бота>:<секрет>» — как TELEGRAM_BOT_TOKEN_RE в apps/api/src/config/config.ts. */
const TOKEN_RE = /^[0-9]{5,}:[A-Za-z0-9_-]{30,}$/;

/** Пустая строка из .env = переменная не задана. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v), schema.optional());

const Schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Токен от @BotFather. Без него бот не стартует (main.ts). */
  TELEGRAM_BOT_TOKEN: optional(z.string().regex(TOKEN_RE, "TELEGRAM_BOT_TOKEN — токен от @BotFather вида 123456:ABC…")),
  /**
   * Адрес Mini App для кнопок «Учиться» и кнопки меню: https://<домен веба>/miniapp. Telegram открывает Mini App
   * только по HTTPS — с http:// (локальная разработка) бот работает, но без кнопки Mini App.
   */
  TELEGRAM_MINIAPP_URL: optional(z.url()),
  /** API для служебных операций бота (привязка, напоминания). */
  BOT_API_URL: z.url().default("http://localhost:4000"),
  /** Секрет служебных операций (X-Service-Token, ADR 0020) — тот же, что у API. Пусто — напоминания недоступны. */
  BOT_SERVICE_TOKEN: optional(z.string().min(24, "BOT_SERVICE_TOKEN — не короче 24 символов")),
  /** Как часто спрашивать API «кому напомнить», секунды. */
  BOT_REMINDER_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
});
export type BotConfig = z.infer<typeof Schema>;

/** Ошибки конфигурации — без значений переменных (токены не печатаются). */
export function loadConfig(env: Record<string, string | undefined>): BotConfig {
  const parsed = Schema.safeParse(env);
  if (!parsed.success) throw new Error(`Некорректная конфигурация бота:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Кнопки Mini App (web_app) Telegram принимает только с https://. */
export function miniAppUrlFor(config: Pick<BotConfig, "TELEGRAM_MINIAPP_URL">): string | undefined {
  const url = config.TELEGRAM_MINIAPP_URL;
  return url && url.startsWith("https://") ? url : undefined;
}

export const MISSING_TOKEN_MESSAGE = [
  "bot: TELEGRAM_BOT_TOKEN не задан — бот не запущен.",
  "  1. В Telegram: @BotFather → /newbot → токен.",
  "  2. В корневой .env: TELEGRAM_BOT_TOKEN=<токен> (и TELEGRAM_MINIAPP_URL=https://<домен веба>/miniapp для кнопки «Учиться»).",
  "  3. pnpm --filter @teletau/bot dev. Подробно — docs/demo/M2.md, раздел «Telegram Mini App».",
].join("\n");
