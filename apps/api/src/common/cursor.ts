// Непрозрачные курсоры пагинации (docs/07 §2): base64url(JSON). Каждый эндпоинт проверяет курсор своей схемой:
// битый, чужой или подделанный курсор — 422 validation_failed, а не 500 из-за неверной даты или UUID в SQL.
import { z } from "zod";
import { invalidField } from "./problem.js";

export function encodeCursor(value: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** Курсор «смещение в стабильной сортировке» (поиск школ). */
export const OffsetCursor = z.strictObject({ o: z.number().int().min(0).max(1_000_000) });
/** Курсор «(время, id) последней записи» (журнал аудита, очередь модератора). */
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
