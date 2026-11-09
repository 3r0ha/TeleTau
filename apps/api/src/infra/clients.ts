import { Logger } from "@nestjs/common";
import { createThrottledErrorLogger, parseValkeyUrl, type ErrorReporter } from "@teletau/runtime";
import { Redis, type RedisOptions } from "ioredis";
import pg from "pg";
import type { AppConfig } from "../config/config.js";

const logger = new Logger("Infra");
/** Один репортёр на процесс: ошибки инфраструктуры логируются не чаще раза в 30 с на (источник, код). */
export const reportInfraError: ErrorReporter = createThrottledErrorLogger({ write: (m) => logger.warn(m) });

/** Параметры пула Postgres. Вынесены отдельно, чтобы политику таймаутов можно было проверить тестом. */
export function pgPoolConfig(config: AppConfig): pg.PoolConfig {
  return {
    connectionString: config.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 30_000,
    // Без таймаутов соединение, «умершее» без RST (failover, падение узла, разрыв сети),
    // висит до таймаута TCP в ОС (~15 мин в Linux) и держит клиента пула.
    query_timeout: config.DB_QUERY_TIMEOUT_MS,
    statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  };
}

/**
 * Пул Postgres. Обработчик `error` обязателен: без него обрыв простаивающего соединения
 * (рестарт или failover БД, pg_terminate_backend) порождает необработанное событие и роняет процесс.
 * Сломанный или зависший (query_timeout) клиент пул выбрасывает сам; следующий запрос получит новое соединение.
 */
export function createPgPool(config: AppConfig, report: ErrorReporter = reportInfraError): pg.Pool {
  const pool = new pg.Pool(pgPoolConfig(config));
  pool.on("error", (err) => report("postgres", err));
  return pool;
}

/**
 * Потолок задержки переподключения к Valkey. У ioredis по умолчанию — min(n × 50, 2000) мс; после долгого «тихого»
 * разрыва цикл «socketTimeout (3 с) + задержка (2 с)» даёт восстановление до 6,3 с — дольше целевых 5.
 * С потолком 1 с худший случай — socketTimeout + 1 с + рукопожатие ≈ 4 с; нагрузка на Valkey при отказе —
 * не больше одной попытки в секунду на процесс.
 */
export const VALKEY_MAX_RECONNECT_DELAY_MS = 1000;
export const valkeyRetryDelay = (attempt: number): number => Math.min(attempt * 100, VALKEY_MAX_RECONNECT_DELAY_MS);

/** Параметры клиента Valkey: единый разборщик VALKEY_URL (как у workers) + политика таймаутов. */
export function valkeyOptions(config: AppConfig): RedisOptions {
  return {
    ...parseValkeyUrl(config.VALKEY_URL),
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    commandTimeout: config.VALKEY_COMMAND_TIMEOUT_MS,
    socketTimeout: config.VALKEY_SOCKET_TIMEOUT_MS,
    retryStrategy: valkeyRetryDelay,
  };
}

/** Клиент Valkey. Без обработчика `error` ioredis пишет «Unhandled error event» на каждую попытку переподключения. */
export function createValkey(config: AppConfig, report: ErrorReporter = reportInfraError): Redis {
  const client = new Redis(valkeyOptions(config));
  client.on("error", (err) => report("valkey", err));
  return client;
}
