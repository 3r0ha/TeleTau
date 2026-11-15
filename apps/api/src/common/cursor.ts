// Непрозрачные курсоры пагинации (docs/07 §2): base64url(JSON). Каждый эндпоинт проверяет курсор своей схемой:
// битый, чужой или подделанный курсор — 422 validation_failed, а не 500 из-за неверной даты или UUID в SQL.
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { z } from "zod";
import { invalidField } from "./problem.js";

export function encodeCursor(value: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** Курсор «смещение в стабильной сортировке» (поиск школ). */
export const OffsetCursor = z.strictObject({ o: z.number().int().min(0).max(1_000_000) });
/**
 * Курсор «(время, id) последней записи» (журнал аудита, очередь модератора). Время — с микросекундами, как хранит
 * timestamptz (microsIso): Date в JS округлил бы до миллисекунд, и строки с тем же миллисекундным моментом терялись
 * бы или повторялись на стыке страниц.
 */
export const KeysetCursor = z.strictObject({ at: z.iso.datetime({ offset: true }), id: z.uuid() });

export function decodeCursor<S extends z.ZodType>(raw: string | undefined, schema: S): z.infer<S> | undefined {
  if (raw === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    value = undefined;
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalidField("#/query/cursor", "Неверный курсор страницы — откройте список с первой страницы");
  return parsed.data;
}

/** Момент timestamptz в UTC с микросекундами (`2026-11-15T10:00:00.123456Z`) — для курсора страницы. */
export function microsIso(column: SQLWrapper): SQL<string> {
  return sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}
