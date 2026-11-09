/** Параметры подключения к Valkey/Redis в формате, который принимают ioredis и BullMQ. */
export interface ValkeyConnection {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
  /** Задан для rediss:// и valkeys:// — включает TLS. */
  tls?: Record<string, never>;
  /** 4 или 6. Для IPv6-литерала ставится автоматически. */
  family?: 4 | 6;
}

const SCHEMES: Record<string, { tls: boolean }> = {
  "redis:": { tls: false },
  "rediss:": { tls: true },
  "valkey:": { tls: false },
  "valkeys:": { tls: true },
};
const KNOWN_PARAMS = new Set(["db", "family"]);

function parseDb(raw: string, where: string): number {
  const db = Number(raw);
  if (raw === "" || !Number.isInteger(db) || db < 0) throw new Error(`Некорректный номер базы в VALKEY_URL (${where}): «${raw}»`);
  return db;
}

/**
 * Единственный разборщик VALKEY_URL для всех приложений (API, workers): хост (включая IPv6-литерал),
 * порт, пользователь, пароль, номер базы (путь или ?db=), TLS, семейство адресов.
 * Неизвестные параметры запроса — ошибка, а не тихое игнорирование.
 */
export function parseValkeyUrl(raw: string): ValkeyConnection {
  const url = new URL(raw);
  const scheme = SCHEMES[url.protocol];
  if (!scheme) {
    throw new Error(
      `VALKEY_URL должен начинаться с redis://, rediss://, valkey:// или valkeys:// (получено ${url.protocol}//)`,
    );
  }

  for (const key of url.searchParams.keys()) {
    if (!KNOWN_PARAMS.has(key)) throw new Error(`VALKEY_URL: неизвестный параметр «${key}» (поддерживаются: db, family)`);
  }

  const dbPath = url.pathname.replace(/^\//, "");
  const dbQuery = url.searchParams.get("db");
  let db = dbPath === "" ? 0 : parseDb(dbPath, "путь");
  if (dbQuery !== null) {
    const q = parseDb(dbQuery, "параметр db");
    if (dbPath !== "" && q !== db) throw new Error(`Конфликт: номер базы в пути (${db}) и в параметре db (${q})`);
    db = q;
  }

  const ipv6 = /^\[(.*)\]$/.exec(url.hostname);
  const connection: ValkeyConnection = {
    host: ipv6 ? (ipv6[1] as string) : url.hostname,
    port: url.port ? Number(url.port) : 6379,
    db,
  };
  if (url.username) connection.username = decodeURIComponent(url.username);
  if (url.password) connection.password = decodeURIComponent(url.password);
  if (scheme.tls) connection.tls = {};

  const family = url.searchParams.get("family");
  if (family !== null) {
    if (family !== "4" && family !== "6") throw new Error(`VALKEY_URL: family должен быть 4 или 6 (получено «${family}»)`);
    connection.family = family === "4" ? 4 : 6;
  } else if (ipv6) {
    connection.family = 6;
  }
  return connection;
}
