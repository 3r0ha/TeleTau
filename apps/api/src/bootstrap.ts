import "reflect-metadata";
import { type INestApplication, Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { Problem } from "@teletau/contracts";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppModule } from "./app.module.js";
import { CONTROL_CHARS_DETAIL, findControlChars } from "./common/control-chars.js";
import { contractOperations } from "./common/contract.js";
import { RedactingLogger } from "./common/logger.js";
import { problemTitle } from "./common/problem.js";
import { ProblemFilter } from "./common/problem.filter.js";
import { uuidv7 } from "./common/uuidv7.js";
import { APP_CONFIG, type AppConfig } from "./config/config.js";

/**
 * Адаптер Fastify. Ошибки уровня фреймворка (битый URL и т. п.) возникают до роутинга Nest
 * и мимо ProblemFilter — переводим их в RFC 9457 здесь. Текст ошибки Fastify наружу не уходит.
 * Валидация запросов — ajv Fastify по схемам из контракта (@Operation): лишние поля не вырезаются молча,
 * а дают 422 (additionalProperties: false в контракте), ошибки собираются все сразу.
 */
export function createFastifyAdapter(config?: Pick<AppConfig, "TRUST_PROXY">): FastifyAdapter {
  return new FastifyAdapter({
    // Число — хопы, список — адреса и подсети (proxy-addr), boolean — всем или никому (config.ts, TRUST_PROXY).
    trustProxy: typeof config?.TRUST_PROXY === "number" ? (_addr: string, hop: number) => hop < (config.TRUST_PROXY as number) : (config?.TRUST_PROXY ?? false),
    genReqId: () => uuidv7(),
    bodyLimit: 64 * 1024,
    ajv: { customOptions: { removeAdditional: false, allErrors: true, coerceTypes: "array", useDefaults: true } },
    frameworkErrors: (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      const detail = error.code === "FST_ERR_BAD_URL" ? "Адрес запроса не разобран" : undefined;
      const problem: Problem = { type: "about:blank", title: problemTitle("bad_request"), status: 400, code: "bad_request", ...(detail ? { detail } : {}), instance: request.url };
      void reply.code(400).header("content-type", "application/problem+json").send(problem);
    },
  });
}

/** Где искать строки запроса для проверки управляющих символов и как указывать на них (контракт, FieldError). */
const REQUEST_PARTS = [
  ["body", ""],
  ["query", "#/query"],
  ["params", "#/path"],
] as const;

/**
 * Первая строка запроса с управляющим символом: тело, query, путь и заголовки-параметры операции из
 * контракта (`X-Poll-Token`, `X-Device-Install-Id`, `Idempotency-Key`). Остальные заголовки не проверяются: их
 * значения не попадают ни в базу, ни в ответ.
 */
function controlCharsPointer(req: FastifyRequest): string | undefined {
  for (const [part, base] of REQUEST_PARTS) {
    const pointer = findControlChars(req[part], base);
    if (pointer) return pointer;
  }
  const declared = (req.routeOptions.schema?.headers as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
  for (const name of Object.keys(declared)) {
    const pointer = findControlChars(req.headers[name], `#/header/${name}`);
    if (pointer) return pointer;
  }
  return undefined;
}

/** Хуки Fastify: пустое JSON-тело, необязательное тело, управляющие символы, журнал запросов без секретов, no-store. */
function installHooks(instance: FastifyInstance): void {
  // Пустое тело с Content-Type: application/json — это «тела нет», а не ошибка разбора (POST …/approve из fetch).
  instance.addHook("onRequest", async (req) => {
    const empty = (req.headers["content-length"] ?? "0") === "0" && !req.headers["transfer-encoding"];
    if (empty && /json/i.test(req.headers["content-type"] ?? "")) delete req.headers["content-type"];
  });
  // Необязательное тело (logout, бумажное согласие) без Content-Type — проверяется схемой как пустой объект.
  instance.addHook("preValidation", async (req) => {
    if (req.body === undefined && req.method !== "GET" && req.method !== "HEAD") req.body = {};
  });
  // Управляющие символы в любой строке запроса — 422 до проверки схемы и до обработчика. Одна проверка на все
  // операции: NUL не доходит до Postgres (иначе — 500), а запрос ничего не успевает израсходовать (код из письма).
  instance.addHook("preValidation", async (req, reply) => {
    if (req.is404) return;
    const pointer = controlCharsPointer(req);
    if (!pointer) return;
    const problem: Problem = {
      type: "about:blank",
      title: problemTitle("validation_failed"),
      status: 422,
      code: "validation_failed",
      errors: [{ pointer, detail: CONTROL_CHARS_DETAIL }],
      instance: req.url,
    };
    // Ответ уже отправлен: возврат reply останавливает обработку запроса (документация Fastify, хуки async).
    void reply.code(422).header("content-type", "application/problem+json").header("cache-control", "no-store").send(problem);
    return reply;
  });
  // Ответы API содержат токены и личные данные взрослых — их не кешируют ни браузер, ни прокси.
  instance.addHook("onSend", async (_req, reply, payload) => {
    if (!reply.hasHeader("cache-control")) void reply.header("cache-control", "no-store");
    void reply.header("x-content-type-options", "nosniff");
    return payload;
  });
  // Журнал запросов: шаблон маршрута (без идентификаторов и query), статус и время. Тела и заголовки не пишутся.
  const http = new Logger("HTTP");
  instance.addHook("onResponse", async (req, reply) => {
    http.log(`${req.method} ${req.routeOptions.url ?? "(no route)"} ${reply.statusCode} ${Math.round(reply.elapsedTime)}ms`);
  });
}

/** Все HTTP-методы операций контракта и OPTIONS для preflight. */
export function corsMethods(): string[] {
  return [...new Set(contractOperations().map((o) => o.method.toUpperCase())), "OPTIONS"].sort();
}

/** Loopback и частные адреса (RFC 1918): локальный стенд открывают и по ним. */
function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

/**
 * Origins для CORS: PUBLIC_WEB_URL/PUBLIC_CONSOLE_URL и их loopback-синонимы (localhost и 127.0.0.1 с тем же портом).
 * Локальный стенд открывают по-разному — localhost:3000, 127.0.0.1:3000, по адресу машины в сети, — а браузеру для
 * запроса к API нужен в allowlist origin из адресной строки, иначе ответ режется без Access-Control-Allow-Origin и
 * веб показывает «Нет связи» (BFF сам сверяет origin с фактическим host и такой проблемы не имеет). Публичные адреса
 * (production) синонимов не получают — их allowlist не расширяется.
 */
export function corsOrigins(urls: string[]): string[] {
  const origins = new Set<string>();
  for (const url of urls) {
    const { origin, protocol, hostname, port } = new URL(url);
    origins.add(origin);
    if (isLocalHostname(hostname)) {
      for (const host of ["localhost", "127.0.0.1", hostname]) origins.add(`${protocol}//${host}${port ? `:${port}` : ""}`);
    }
  }
  return [...origins];
}

/** Общая настройка приложения для main.ts и тестов. */
export function configureApp<T extends INestApplication>(app: T, config?: AppConfig): T {
  const cfg = config ?? app.get<AppConfig>(APP_CONFIG);
  app.useLogger(new RedactingLogger());
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new ProblemFilter());
  // Веб и консоль ходят в API из браузера со своих origin; refresh-токен веба — в cookie BFF Next.js (ADR 0015 §3).
  // Origin из адресной строки стенда может отличаться от PUBLIC_*_URL — см. corsOrigins.
  app.enableCors({
    origin: corsOrigins([cfg.PUBLIC_WEB_URL, cfg.PUBLIC_CONSOLE_URL]),
    // Методы — из контракта: новая операция с другим методом (например, DELETE) не упадёт на preflight в браузере.
    methods: corsMethods(),
    allowedHeaders: ["authorization", "content-type", "idempotency-key", "x-poll-token", "x-device-install-id", "x-request-id"],
    exposedHeaders: ["retry-after", "content-disposition", "x-request-id"],
    maxAge: 600,
  });
  installHooks(app.getHttpAdapter().getInstance() as FastifyInstance);
  app.enableShutdownHooks();
  return app;
}

export async function createApp(config: AppConfig): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(config), createFastifyAdapter(config), {
    logger: new RedactingLogger(),
    bufferLogs: true,
  });
  return configureApp(app, config);
}
