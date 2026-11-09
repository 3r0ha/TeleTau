import { isIP } from "node:net";
import { z } from "zod";

/** Элемент списка TRUST_PROXY: имя диапазона proxy-addr (loopback, linklocal, uniquelocal), IP или подсеть CIDR. */
function isTrustedProxyEntry(entry: string): boolean {
  if (["loopback", "linklocal", "uniquelocal"].includes(entry)) return true;
  const [ip, prefix, extra] = entry.split("/");
  const family = isIP(ip ?? "");
  if (!family || extra !== undefined) return false;
  if (prefix === undefined) return true;
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128);
}

/** Адреса Docker-стека проекта по умолчанию (как в .env.example). */
export const DEFAULT_DATABASE_URL = "postgres://teletau:teletau@localhost:15432/teletau";
export const DEFAULT_VALKEY_URL = "redis://localhost:16379";

/** Перец по умолчанию для dev и тестов (как в .env.example). В production запрещён. */
export const DEV_SECRET_PEPPER = "dev-only-pepper-not-for-production";

/** Секрет бота для служебных операций по умолчанию в dev (как в .env.example). В production запрещён (ADR 0020). */
export const DEV_BOT_SERVICE_TOKEN = "dev-only-bot-service-token-not-for-production";

/** Токен бота от @BotFather: «<id бота>:<секрет>». */
export const TELEGRAM_BOT_TOKEN_RE = /^[0-9]{5,}:[A-Za-z0-9_-]{30,}$/;

/** Пустая строка из .env = переменная не задана. */
const optionalString = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().optional());

const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.url().default(DEFAULT_DATABASE_URL),
    VALKEY_URL: z.url().default(DEFAULT_VALKEY_URL),
    HEALTH_TIMEOUT_MS: z.coerce.number().int().positive().default(1000),
    // Политика таймаутов внешних вызовов — docs/06-architecture.md §6.8.
    /** Клиентский таймаут запроса: зависший запрос возвращает клиента пулу с ошибкой, и пул его уничтожает. */
    DB_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    /** Серверный statement_timeout: Postgres сам прерывает долгий запрос раньше клиентского таймаута. */
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(4000),
    /** Таймаут одной команды Valkey. */
    VALKEY_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
    /** Нет данных на сокете при ожидающих командах дольше этого — сокет уничтожается и переподключается. */
    VALKEY_SOCKET_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),

    // Вход и сессии (ADR 0015–0017).
    /** Демо-режим входа взрослых: письмо не отправляется, принимается этот код (4–6 цифр). В проде не задаётся. */
    AUTH_DEMO_OTP: optionalString.pipe(z.string().regex(/^[0-9]{4,6}$/, "AUTH_DEMO_OTP — 4–6 цифр").optional()),
    /**
     * Постоянный код класса для стенда показа: 6 символов base32 Crockford, как у обычного кода (ADR 0016).
     * Задан — «Показать код класса» выдаёт классу этот код на год (у класса, где он был, код снимается), а «Закрыть код
     * класса» его не гасит. Одобрение заявок учителем, лимиты и очередь — как обычно. В production запрещён.
     */
    AUTH_DEMO_CLASS_CODE: optionalString.pipe(
      z
        .string()
        .transform((v) => v.trim().toUpperCase())
        .pipe(z.string().regex(/^[0-9A-HJKMNP-TV-Z]{6}$/, "AUTH_DEMO_CLASS_CODE — 6 символов base32 Crockford (цифры и латиница без I, L, O, U)"))
        .optional(),
    ),
    /**
     * Демо-сотрудники консоли (модератор и администратор с TOTP-секретами из репозитория) — отдельно от демо-кода:
     * демо-код без демо-сотрудников годится для показа учителю, а сотрудник с публичным вторым фактором — нет.
     * `1`/`true` — включить (dev, e2e, интеграционные тесты), иначе выключено. В production запрещено.
     */
    AUTH_DEMO_STAFF: z
      .preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.union([z.literal(""), z.enum(["0", "1", "true", "false"]), z.boolean()]).optional())
      .transform((v) => v === true || v === "1" || v === "true"),
    /** Ключ подписи access-токенов ES256 (PKCS#8 PEM). Пусто — только dev/test: временный ключ при старте. */
    AUTH_JWT_PRIVATE_KEY: optionalString,
    /** Перец HMAC для e-mail, кода класса и IP. */
    AUTH_SECRET_PEPPER: optionalString.pipe(z.string().min(16, "AUTH_SECRET_PEPPER — не короче 16 символов").default(DEV_SECRET_PEPPER)),
    /** Ключ AES-256-GCM (base64, 32 байта): TOTP-секреты сотрудников, задания печати, адреса в вызовах кода. */
    AUTH_ENCRYPTION_KEY: optionalString.pipe(
      z
        .string()
        .refine((v) => Buffer.from(v, "base64").length === 32, "AUTH_ENCRYPTION_KEY — base64 от 32 байт")
        .optional(),
    ),
    /** Адрес веба: печатается на QR-карточке текстом (в самом QR — только полезная нагрузка, ADR 0016) и разрешённый origin CORS. */
    PUBLIC_WEB_URL: z.url().default("http://localhost:3000"),
    /**
     * Кому доверять X-Forwarded-For: `false`, `true`, число прокси-хопов или список адресов и подсетей через запятую
     * (`loopback`, `10.0.0.0/8`, `127.0.0.1,::1`). Без этого все запросы пришли бы «с адреса» балансировщика или
     * BFF Next.js, и ограничения частоты по IP сработали бы на всех учеников сразу. В dev — `loopback`: веб и
     * консоль вызывают API с этого же компьютера и передают IP браузера.
     */
    TRUST_PROXY: z
      .preprocess((v) => (v === undefined || v === "" ? "false" : v), z.string().trim())
      .transform((v): boolean | number | string[] =>
        v === "true" ? true : v === "false" ? false : /^\d+$/.test(v) ? Number(v) : v.split(",").map((s) => s.trim()),
      )
      .pipe(
        z.union([
          z.boolean(),
          z.number().int().min(0).max(10),
          z.array(z.string().refine(isTrustedProxyEntry, "TRUST_PROXY — true/false, число хопов или адреса и подсети через запятую")).min(1),
        ]),
      ),
    /** Адрес консоли сотрудников — разрешённый origin CORS. */
    PUBLIC_CONSOLE_URL: z.url().default("http://localhost:3100"),

    // Telegram (ADR 0020).
    /**
     * Токен бота от @BotFather — тот же, что у apps/bot: им API проверяет подпись initData Mini App (POST /telegram/link).
     * Пусто — привязка Telegram выключена (503 telegram_unavailable), остальное работает.
     */
    TELEGRAM_BOT_TOKEN: optionalString.pipe(z.string().trim().regex(TELEGRAM_BOT_TOKEN_RE, "TELEGRAM_BOT_TOKEN — токен от @BotFather вида 123456:ABC…").optional()),
    /** Секрет служебных операций бота (заголовок X-Service-Token, роль service). Пусто — служебные операции закрыты (401). */
    BOT_SERVICE_TOKEN: optionalString.pipe(z.string().trim().min(24, "BOT_SERVICE_TOKEN — не короче 24 символов").optional()),
  })
  .superRefine((c, ctx) => {
    if (c.DB_STATEMENT_TIMEOUT_MS >= c.DB_QUERY_TIMEOUT_MS) {
      ctx.addIssue({
        code: "custom",
        path: ["DB_STATEMENT_TIMEOUT_MS"],
        message: "DB_STATEMENT_TIMEOUT_MS должен быть меньше DB_QUERY_TIMEOUT_MS (сервер прерывает запрос раньше клиента)",
      });
    }
    if (c.NODE_ENV === "production") {
      // В проде секреты приходят из Lockbox: временные и выведенные dev-ключи недопустимы (ADR 0015).
      if (!c.AUTH_JWT_PRIVATE_KEY) ctx.addIssue({ code: "custom", path: ["AUTH_JWT_PRIVATE_KEY"], message: "обязателен в production" });
      if (!c.AUTH_ENCRYPTION_KEY) ctx.addIssue({ code: "custom", path: ["AUTH_ENCRYPTION_KEY"], message: "обязателен в production" });
      if (c.AUTH_SECRET_PEPPER === DEV_SECRET_PEPPER || c.AUTH_SECRET_PEPPER.length < 32) {
        ctx.addIssue({ code: "custom", path: ["AUTH_SECRET_PEPPER"], message: "в production — собственный перец не короче 32 символов" });
      }
      if (c.AUTH_DEMO_OTP) ctx.addIssue({ code: "custom", path: ["AUTH_DEMO_OTP"], message: "демо-код запрещён в production" });
      if (c.AUTH_DEMO_CLASS_CODE) ctx.addIssue({ code: "custom", path: ["AUTH_DEMO_CLASS_CODE"], message: "постоянный код класса запрещён в production" });
      if (c.AUTH_DEMO_STAFF) ctx.addIssue({ code: "custom", path: ["AUTH_DEMO_STAFF"], message: "демо-сотрудники запрещены в production" });
      if (c.BOT_SERVICE_TOKEN !== undefined && (c.BOT_SERVICE_TOKEN === DEV_BOT_SERVICE_TOKEN || c.BOT_SERVICE_TOKEN.length < 32)) {
        ctx.addIssue({ code: "custom", path: ["BOT_SERVICE_TOKEN"], message: "в production — собственный секрет не короче 32 символов" });
      }
    }
  });

export type AppConfig = z.infer<typeof ConfigSchema>;
export const APP_CONFIG = Symbol("APP_CONFIG");

/** Конфигурация валидируется при старте: неверное окружение = немедленная понятная ошибка. */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Некорректная конфигурация API:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
