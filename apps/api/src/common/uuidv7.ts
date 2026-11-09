import { randomBytes } from "node:crypto";

/**
 * UUIDv7 (RFC 9562): 48 бит — время в миллисекундах (big-endian), затем версия 7, вариант 10 и 74 случайных бита.
 * Ключи сортируются по времени создания (docs/07-data-and-api.md §1). В Postgres 17 нет встроенного uuidv7(),
 * поэтому ключи генерирует приложение (Drizzle `$defaultFn`).
 */
export function uuidv7(now: number = Date.now()): string {
  const b = randomBytes(16);
  const ms = BigInt(now);
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
