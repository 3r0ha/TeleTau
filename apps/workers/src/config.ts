import { parseValkeyUrl, type ValkeyConnection } from "@teletau/runtime";
import { z } from "zod";

/** Окно блокировки BullMQ при отложенных задачах (`maximumBlockTimeout`, 10 с) + запас 2 с. */
export const BULLMQ_MAX_BLOCK_MS = 10_000;
export const MIN_WORKER_SOCKET_TIMEOUT_MS = BULLMQ_MAX_BLOCK_MS + 2_000;

const Schema = z.object({
  VALKEY_URL: z.url().default("redis://localhost:16379"),
  // Политика таймаутов — docs/06-architecture.md §6.8. Должен быть больше самого длинного
  // окна блокирующих команд BullMQ: drainDelay (5 с) без отложенных задач и maximumBlockTimeout (10 с) при отложенных.
  // Иначе штатное ожидание задач обрывается таймаутом сокета: переподключения и предупреждения в логе.
  VALKEY_WORKER_SOCKET_TIMEOUT_MS: z.coerce.number().int().min(MIN_WORKER_SOCKET_TIMEOUT_MS).default(15_000),
});

export interface WorkersConfig {
  /** Полные параметры подключения: хост (включая IPv6), порт, пользователь, пароль, БД, TLS. */
  connection: ValkeyConnection;
  /** socketTimeout для соединений BullMQ: «умерший» без RST сокет уничтожается и переподключается. */
  socketTimeoutMs: number;
}

export function loadConfig(env: Record<string, string | undefined>): WorkersConfig {
  const parsed = Schema.safeParse(env);
  if (!parsed.success) throw new Error(`Некорректная конфигурация workers:\n${z.prettifyError(parsed.error)}`);
  return { connection: parseValkeyUrl(parsed.data.VALKEY_URL), socketTimeoutMs: parsed.data.VALKEY_WORKER_SOCKET_TIMEOUT_MS };
}
