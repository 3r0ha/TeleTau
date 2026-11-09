import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";
import { integrationEnv } from "./test/integration/it-env.js";

// SWC нужен, чтобы в тестах работали декораторы и метаданные типов NestJS (DI по типу).
// NEST_LOG_LEVEL=warn — без журнала маршрутов и запросов в выводе тестов; тест на утечки в логах
// включает все уровни сам (test/integration/m1-flow.test.ts).
const NEST_LOG_LEVEL = process.env["NEST_LOG_LEVEL"] ?? "warn";

export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    env: { NEST_LOG_LEVEL },
    projects: [
      { extends: true, test: { name: "unit", include: ["test/**/*.test.ts"], exclude: ["test/integration/**"] } },
      {
        extends: true,
        // Герметично: своя база `<имя>_it` и своя база Valkey (test/integration/it-env.ts); global-setup.ts
        // пересоздаёт их перед прогоном, dev-база из корневого .env не меняется. Файлы идут по очереди: база и Valkey
        // общие для всех файлов прогона, лимиты частоты и аудит не должны пересекаться.
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          env: { NEST_LOG_LEVEL, ...integrationEnv(process.env) },
          globalSetup: ["test/integration/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
