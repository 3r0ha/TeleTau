// pnpm dev: одна команда поднимает всё локальное окружение «ТелеТау».
// 1) .env из .env.example (если нет)  2) docker compose up --wait  3) миграции  4) справочник районов и школ (org:import), курс (content:import), дуэли корпуса (corpus:import)
// 5) все приложения (turbo).
// Переменные окружения процесса важнее .env; печатаются фактические порты.
// Занятые порты проверяются до старта; приложение на занятом порту не запускается, остальные работают.
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isInvokedDirectly } from "./lib/invoked.mjs";

/** Разбор .env: KEY=value, комментарии и пустые значения пропускаются, кавычки снимаются. */
export function parseEnvFile(text) {
  const env = {};
  for (const raw of text.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!m || raw.trim().startsWith("#")) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (value !== "") env[m[1]] = value;
  }
  return env;
}

/** Значения из окружения процесса важнее .env (как у node --env-file и docker compose). */
export function mergeEnv(processEnv, envFileText) {
  return { ...parseEnvFile(envFileText), ...processEnv };
}

/** Ключи, которые упомянуты в .env, — в том числе с пустым значением (пусто = осознанно выключено). */
export function mentionedKeys(text) {
  const keys = new Set();
  for (const raw of text.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(raw);
    if (m && !raw.trim().startsWith("#")) keys.add(m[1]);
  }
  return keys;
}

/**
 * Окружение dev и e2e: .env.example → .env → окружение процесса (каждый следующий слой важнее).
 * .env, созданный до появления новой переменной (например, TRUST_PROXY), получает её значение из .env.example;
 * `missing` — такие ключи, чтобы о них предупредить. Ключ, который в .env есть с пустым значением, не заменяется.
 */
export function layeredEnv(processEnv, envFileText, exampleText) {
  const mentioned = mentionedKeys(envFileText);
  const example = parseEnvFile(exampleText);
  const missing = Object.keys(example).filter((k) => !mentioned.has(k) && processEnv[k] === undefined);
  const defaults = Object.fromEntries(missing.map((k) => [k, example[k]]));
  return { env: { ...defaults, ...mergeEnv(processEnv, envFileText) }, missing };
}

/** .env (создаётся из .env.example, если его нет) + .env.example + окружение процесса. */
export function loadDevEnv(root, log = (msg) => console.log(`dev: ${msg}`)) {
  const envPath = resolve(root, ".env");
  const examplePath = resolve(root, ".env.example");
  if (!existsSync(envPath)) {
    copyFileSync(examplePath, envPath);
    log("создан .env из .env.example");
  }
  const { env, missing } = layeredEnv(process.env, readFileSync(envPath, "utf8"), readFileSync(examplePath, "utf8"));
  if (missing.length) log(`в .env нет ${missing.join(", ")} — беру значения из .env.example (добавьте их в .env, чтобы изменить)`);
  return env;
}

export function describeServices(env) {
  const p = (key, fallback) => env[key] ?? fallback;
  return (
    `api :${p("API_PORT", "4000")}, web :${p("WEB_PORT", "3000")}, console :${p("CONSOLE_PORT", "3100")}, ` +
    `ai-gateway :${p("AI_GATEWAY_PORT", "4100")}, ml-worker :${p("ML_WORKER_PORT", "4200")}, workers, bot`
  );
}

/** HTTP-приложения дев-стека и их порты (переменная окружения → значение по умолчанию). */
export const APP_PORTS = [
  { app: "api", key: "API_PORT", fallback: 4000 },
  { app: "web", key: "WEB_PORT", fallback: 3000 },
  { app: "console", key: "CONSOLE_PORT", fallback: 3100 },
  { app: "ai-gateway", key: "AI_GATEWAY_PORT", fallback: 4100 },
  { app: "ml-worker", key: "ML_WORKER_PORT", fallback: 4200 },
];

/** Кто-то уже принимает соединения на порту (IPv4 или IPv6 loopback)? */
function canConnect(port, host) {
  return new Promise((resolvePromise) => {
    const socket = connect({ port, host });
    const done = (result) => {
      socket.destroy();
      resolvePromise(result);
    };
    socket.setTimeout(300, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** Порт нельзя занять (на случай, когда процесс слушает, но ещё не принимает соединения)? */
function cannotListen(port) {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once("error", (err) => resolvePromise(err.code === "EADDRINUSE"));
    server.once("listening", () => server.close(() => resolvePromise(false)));
    server.listen(port, "0.0.0.0");
  });
}

async function isPortBusy(port) {
  return (await canConnect(port, "127.0.0.1")) || (await canConnect(port, "::1")) || (await cannotListen(port));
}

/** Занятые порты приложений. Порт 0 (эфемерный) не проверяется. */
export async function findBusyPorts(env) {
  const busy = [];
  for (const { app, key, fallback } of APP_PORTS) {
    const port = Number(env[key] ?? fallback);
    if (port > 0 && (await isPortBusy(port))) busy.push({ app, key, port });
  }
  return busy;
}

/** Аргументы turbo: приложения на занятых портах не запускаются, падение одного не роняет остальные. */
export function turboArgs(busy) {
  return [
    "run",
    "dev",
    "--filter=./apps/*",
    ...busy.map((b) => `--filter=!@teletau/${b.app}`),
    "--concurrency=20",
    "--continue",
  ];
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const env = loadDevEnv(root);
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit", env });

  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
  } catch {
    console.error("dev: Docker не запущен. Запустите Docker Desktop и повторите pnpm dev.");
    process.exit(1);
  }

  console.log("dev: поднимаю Postgres, Valkey, ClickHouse, S3 (SeaweedFS)…");
  run("docker", ["compose", "up", "-d", "--wait"]);

  console.log("dev: применяю миграции…");
  run("pnpm", ["--filter", "@teletau/api", "exec", "drizzle-kit", "migrate"]);

  // Справочник районов и школ РБ + демо-школы (идемпотентный upsert: повторный запуск — доли секунды).
  console.log("dev: загружаю справочник районов и школ…");
  // Импорт приводит названия к канонической форме @teletau/bashkir-text — пакет должен быть собран (кеш turbo).
  run(resolve(root, "node_modules/.bin/turbo"), ["run", "build", "--filter=@teletau/bashkir-text", "--output-logs=errors-only"]);
  run("pnpm", ["--silent", "--filter", "@teletau/api", "org:import"]);
  // Курс из content/course (идемпотентно: та же version с тем же содержимым — без изменений). Та же version с другим
  // содержимым — ошибка импорта (поднимите version в course.yaml); в dev она не мешает запуску — остаётся прежний курс.
  console.log("dev: загружаю курс…");
  try {
    run("pnpm", ["--silent", "--filter", "@teletau/api", "content:import"]);
  } catch {
    console.warn("dev: курс не обновлён (причина — выше); приложения запустятся с ранее загруженным курсом");
  }
  // Дуэли «Помоги языку» из content/corpus/duels (идемпотентно; набор вариантов загруженной дуэли не меняется — ADR 0019).
  console.log("dev: загружаю дуэли корпуса…");
  run("pnpm", ["--silent", "--filter", "@teletau/api", "corpus:import"]);

  const busy = await findBusyPorts(env);
  for (const b of busy) {
    console.warn(`dev: порт ${b.port} (${b.key}) занят другим процессом — ${b.app} не будет запущен. Освободите порт или задайте ${b.key}=… в .env`);
  }
  console.log(`dev: запускаю приложения (${describeServices(env)})…`);
  // Отдельная группа процессов: сигнал (Ctrl+C или kill -INT <pid>) гасит всё дерево.
  const turbo = spawn(resolve(root, "node_modules/.bin/turbo"), turboArgs(busy), {
    cwd: root,
    stdio: "inherit",
    env,
    detached: true,
  });
  const stop = (sig) => {
    try {
      process.kill(-turbo.pid, sig);
    } catch {
      // группа уже завершилась
    }
  };
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => stop(sig));
  turbo.on("exit", (code) => process.exit(code ?? 0));
}

if (isInvokedDirectly(import.meta.url)) void main();
