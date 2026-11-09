import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

// .env из корня монорепозитория; переменные окружения процесса важнее файла.
try {
  process.loadEnvFile(resolve(process.cwd(), "../../.env"));
} catch {
  // .env необязателен (CI задаёт переменные явно)
}

// Таблицы принадлежат модулям: каждая — в src/modules/<m>/<m>.schema.ts (ADR 0014, проверка — scripts/boundaries.mjs).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/modules/*/*.schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://teletau:teletau@localhost:15432/teletau" },
});
