// Общие колонки таблиц модулей (docs/07-data-and-api.md §1): ключ UUIDv7, created_at/updated_at в UTC.
// Здесь нет таблиц и нет импорта модулей (ADR 0014): только фабрики колонок и условий для *.schema.ts.
import { sql } from "drizzle-orm";
import { text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { uuidv7 } from "../common/uuidv7.js";

/** Первичный ключ UUIDv7, генерируется приложением. */
export const primaryId = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());

/** Момент времени с часовым поясом (хранение — UTC). */
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** created_at и updated_at; updated_at обновляет Drizzle при каждом UPDATE через ORM. */
export const timestamps = () => ({
  createdAt: tstz("created_at").notNull().defaultNow(),
  updatedAt: tstz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Хеш в hex (SHA-256 или HMAC-SHA-256, 64 символа). Секреты хранятся только так (ADR 0015, 0016). */
export const hashHex = (name: string) => text(name);

/** Условие CHECK: колонка — hex-хеш из 64 символов. */
export const isHex64 = (column: AnyPgColumn) => sql`${column} ~ '^[0-9a-f]{64}$'`;
