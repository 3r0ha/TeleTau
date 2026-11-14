// pnpm demo:reset — демо-мир показа с нуля (docs/demo/M2.md): dev-база из .env пересоздаётся целиком
// (DROP/CREATE: голоса в judgments удалить нельзя — правило 9), база Valkey очищается, затем миграции, справочник
// районов и школ (org:import), курс (content:import), дуэли (corpus:import) и демо-сид (demo:seed).
// Если к базе подключены приложения (работает pnpm dev), скрипт ничего не меняет и просит остановить pnpm dev.
// Аргументы передаются сиду: `pnpm demo:reset --e2e-worlds 2`. Ту же подготовку для своей базы делает e2e/run.mjs.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDevEnv } from "./dev.mjs";
import { isInvokedDirectly } from "./lib/invoked.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Код выхода db-reset.mjs, когда к базе есть подключения. */
const BUSY_EXIT_CODE = 3;

export class DatabaseBusyError extends Error {}

/** Суффикс базы сквозных тестов: `pnpm e2e` пересоздаёт её на каждый прогон, dev-база (демо-мир) не трогается. */
export const E2E_DATABASE_SUFFIX = "_e2e";

/** `postgres://…/teletau` → `postgres://…/teletau_e2e`: тот же сервер, своя база сквозных тестов. */
export function e2eDatabaseUrl(devUrl) {
  const url = new URL(devUrl);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!name || name.endsWith(E2E_DATABASE_SUFFIX)) throw new Error(`DATABASE_URL должен указывать на dev-базу, а не «${name}»`);
  url.pathname = `/${encodeURIComponent(`${name}${E2E_DATABASE_SUFFIX}`)}`;
  return url.toString();
}

/** `redis://…:16379` (база 0) → `redis://…:16379/2`: база 1 — у интеграционных тестов API, 2 — у сквозных. */
export function e2eValkeyUrl(devUrl) {
  const url = new URL(devUrl);
  const db = Number(url.pathname.replace(/^\//, "") || "0");
  if (!Number.isInteger(db) || db < 0) throw new Error(`VALKEY_URL: некорректный номер базы в ${devUrl}`);
  url.pathname = `/${db + 2}`;
  return url.toString();
}

/**
 * Окружение сквозных тестов: то же, что у dev, но своя база Postgres и своя база Valkey и без постоянного кода класса
 * (AUTH_DEMO_CLASS_CODE). Метка TELETAU_E2E=1 — окружение
 * уже переведено (e2e/run.mjs передаёт его Playwright, а тот снова читает e2e/support/env.ts).
 */
export function e2eEnv(devEnv) {
  // Постоянного кода класса в сквозных тестах нет: сценарий docs/demo/M1.md проверяет настоящие коды на 15 минут и их гашение.
  // Снимается всегда — и при повторном вызове: Playwright заново дочитывает недостающие ключи из .env.example.
  const env = { ...devEnv };
  delete env.AUTH_DEMO_CLASS_CODE;
  // Сквозные тесты входят в консоль с настоящим TOTP (loginStaff): «демо без TOTP» из локального .env
  // снимаем — на стене флаг включён для показа, а здесь он убирает шаг TOTP, и тесты его не находят.
  delete env.AUTH_DEMO_STAFF_WITHOUT_TOTP;
  if (env.TELETAU_E2E === "1") return env;
  const databaseUrl = env.DATABASE_URL ?? "postgres://teletau:teletau@localhost:15432/teletau";
  const valkeyUrl = env.VALKEY_URL ?? "redis://localhost:16379";
  return { ...env, DATABASE_URL: e2eDatabaseUrl(databaseUrl), VALKEY_URL: e2eValkeyUrl(valkeyUrl), TELETAU_E2E: "1" };
}

/**
 * Пересоздать базу из `env.DATABASE_URL` и заполнить её: миграции, справочник, курс, дуэли, демо-сид.
 * `force` — разорвать подключения (база сквозных тестов); без него занятая база — DatabaseBusyError.
 */
export function rebuildDemoDatabase({ env, force = false, seedArgs = [], log = (msg) => console.log(`demo:reset: ${msg}`) }) {
  const run = (cmd, args, extra = {}) => execFileSync(cmd, args, { cwd: root, stdio: "inherit", env, ...extra });
  // Сиду нужна сборка API (dist), импорту справочника — сборка @teletau/bashkir-text (кеш turbo: обычно секунды).
  log("сборка API (кеш turbo)…");
  run(resolve(root, "node_modules/.bin/turbo"), ["run", "build", "--filter=@teletau/api", "--output-logs=errors-only"]);
  log(`пересоздаю базу ${new URL(env.DATABASE_URL).pathname.slice(1)} и очищаю Valkey…`);
  try {
    run(process.execPath, [resolve(root, "apps/api/scripts/db-reset.mjs"), "--flush-valkey", ...(force ? ["--force"] : [])]);
  } catch (e) {
    if (e.status === BUSY_EXIT_CODE) throw new DatabaseBusyError("к базе подключены приложения — остановите pnpm dev");
    throw e;
  }
  log("миграции…");
  run("pnpm", ["--silent", "--filter", "@teletau/api", "exec", "drizzle-kit", "migrate"]);
  log("справочник районов и школ…");
  run("pnpm", ["--silent", "--filter", "@teletau/api", "org:import"]);
  log("курс…");
  run("pnpm", ["--silent", "--filter", "@teletau/api", "content:import"]);
  log("дуэли корпуса…");
  run("pnpm", ["--silent", "--filter", "@teletau/api", "corpus:import"]);
  log("демо-мир…");
  run(process.execPath, [`--env-file-if-exists=${resolve(root, ".env")}`, "dist/demo/seed.js", ...seedArgs], { cwd: resolve(root, "apps/api") });
}

function main() {
  const env = loadDevEnv(root, (msg) => console.log(`demo:reset: ${msg}`));
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
  } catch {
    console.error("demo:reset: Docker не запущен. Запустите Docker Desktop и повторите pnpm demo:reset.");
    process.exit(1);
  }
  console.log("demo:reset: Docker-стек проекта (Postgres, Valkey, ClickHouse, S3)…");
  execFileSync("docker", ["compose", "up", "-d", "--wait"], { cwd: root, stdio: "inherit", env });
  try {
    rebuildDemoDatabase({ env, seedArgs: process.argv.slice(2) });
  } catch (e) {
    if (e instanceof DatabaseBusyError) {
      console.error(`demo:reset: ${e.message} (Ctrl+C в его терминале) и повторите pnpm demo:reset.`);
      process.exit(1);
    }
    console.error("demo:reset: не получилось — причина выше.");
    process.exit(1);
  }
  console.log("demo:reset: готово. Запустите pnpm dev и откройте сценарий docs/demo/M2.md.");
}

if (isInvokedDirectly(import.meta.url)) main();
