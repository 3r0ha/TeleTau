// Окружение сквозных тестов: то же, что у `pnpm dev` (.env + недостающие ключи из .env.example + процесс), но база
// Postgres и база Valkey свои (`<имя>_e2e`, Valkey №2): e2e/run.mjs пересоздаёт их и строит демо-мир на каждый прогон.
// Адреса и порты — только из .env (ничего не зашито): QR-карточка ведёт на PUBLIC_WEB_URL, CORS API разрешает
// PUBLIC_WEB_URL и PUBLIC_CONSOLE_URL, веб ходит в NEXT_PUBLIC_API_URL.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { e2eEnv } from "../../scripts/demo-reset.mjs";
import { loadDevEnv } from "../../scripts/dev.mjs";

export interface Stack {
  env: Record<string, string>;
  apiUrl: string;
  webUrl: string;
  consoleUrl: string;
  apiPort: number;
  webPort: number;
  consolePort: number;
  /** Демо-код входа взрослых (AUTH_DEMO_OTP; если в .env пусто — 0000, как в интеграционных тестах API). */
  demoCode: string;
  pepper: string;
  valkeyUrl: string;
  /** Демо-мир сквозных тестов (src/demo/seed.ts → e2e/.demo/world.json). */
  worldFile: string;
}

let cached: Stack | undefined;

const origin = (u: string) => new URL(u).origin;

export function stack(): Stack {
  if (cached) return cached;
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const raw = e2eEnv(loadDevEnv(root, () => undefined));
  const env = Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => e[1] !== undefined));
  const apiPort = Number(env["API_PORT"] ?? 4000);
  const webPort = Number(env["WEB_PORT"] ?? 3000);
  const consolePort = Number(env["CONSOLE_PORT"] ?? 3100);
  const webUrl = origin(env["PUBLIC_WEB_URL"] ?? `http://localhost:${webPort}`);
  const consoleUrl = origin(env["PUBLIC_CONSOLE_URL"] ?? `http://localhost:${consolePort}`);
  const apiUrl = origin(env["NEXT_PUBLIC_API_URL"] ?? `http://localhost:${apiPort}`);
  // Адреса из .env должны вести на порты из .env — иначе ссылка в QR или CORS указывали бы мимо запущенного стека.
  for (const [name, url, port] of [
    ["PUBLIC_WEB_URL", webUrl, webPort],
    ["PUBLIC_CONSOLE_URL", consoleUrl, consolePort],
    ["NEXT_PUBLIC_API_URL", apiUrl, apiPort],
  ] as const) {
    if (Number(new URL(url).port || 80) !== port) throw new Error(`e2e: ${name}=${url} не совпадает с портом ${port} из .env`);
  }
  cached = {
    env,
    apiUrl,
    webUrl,
    consoleUrl,
    apiPort,
    webPort,
    consolePort,
    demoCode: env["AUTH_DEMO_OTP"] || "0000",
    pepper: env["AUTH_SECRET_PEPPER"] ?? "dev-only-pepper-not-for-production",
    valkeyUrl: env["VALKEY_URL"]!,
    worldFile: resolve(root, "e2e/.demo/world.json"),
  };
  return cached;
}
