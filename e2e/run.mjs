// pnpm e2e: сквозные тесты против настоящего стека (docs/demo/M1.md, docs/demo/M2.md).
// 1) окружение — как у pnpm dev (.env + недостающие ключи из .env.example + процесс), но база Postgres и база Valkey
//    свои: `<имя>_e2e` и база Valkey №2 (dev-база с демо-миром показа и база интеграционных тестов не трогаются);
// 2) Docker-стек проекта (docker compose up --wait: поднятый — используется как есть);
// 3) сборка api, web и console (turbo, кеш; адрес API вшивается в сборку веба — NEXT_PUBLIC_API_URL в globalEnv);
// 4) база сквозных тестов пересоздаётся и заполняется, как `pnpm demo:reset`: миграции, справочник, курс, дуэли и
//    демо-мир с двумя запасными мирами для повторов (`--repeat-each`) — e2e/.demo/world.json;
// 5) Playwright: сам запускает собранные api, web и console на портах из .env и гасит их после прогона.
// Браузер — уже скачанный Chromium из кеша Playwright (~/Library/Caches/ms-playwright), ничего не скачивается.
// Аргументы передаются Playwright: `pnpm e2e --repeat-each=3` (без `--`: с ним pnpm передал бы аргументы мимо Playwright).
import { execFileSync, spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildDemoDatabase, e2eEnv } from "../scripts/demo-reset.mjs";
import { findBusyPorts, loadDevEnv } from "../scripts/dev.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const log = (msg) => console.log(`e2e: ${msg}`);
const env = { ...e2eEnv(loadDevEnv(root, log)), NEXT_TELEMETRY_DISABLED: "1" };
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit", env });

/** Миров демо-сида: основной + запасные — по одному на повтор теста m2-demo (`--repeat-each` до 3). */
const E2E_WORLDS = 2;

try {
  execFileSync("docker", ["info"], { stdio: "ignore" });
} catch {
  console.error("e2e: Docker не запущен. Запустите Docker Desktop и повторите pnpm e2e.");
  process.exit(1);
}

// Приложения стека поднимает сам Playwright; занятый порт (например, работает pnpm dev) — понятная ошибка заранее.
const busy = (await findBusyPorts(env)).filter((b) => ["api", "web", "console"].includes(b.app));
if (busy.length) {
  for (const b of busy) console.error(`e2e: порт ${b.port} (${b.key}) занят — ${b.app} не запустить. Остановите pnpm dev или процесс на порту.`);
  process.exit(1);
}

log("Docker-стек проекта (Postgres, Valkey, ClickHouse, S3)…");
run("docker", ["compose", "up", "-d", "--wait"]);
log("сборка api, web, console (кеш turbo)…");
run(resolve(root, "node_modules/.bin/turbo"), ["run", "build", "--filter=@teletau/api", "--filter=@teletau/web", "--filter=@teletau/console", "--output-logs=errors-only"]);
log(`база ${new URL(env.DATABASE_URL).pathname.slice(1)}: миграции, справочник, курс, дуэли, демо-мир…`);
rebuildDemoDatabase({ env, force: true, seedArgs: ["--e2e-worlds", String(E2E_WORLDS), "--out", resolve(here, ".demo")], log });

log("Playwright…");
const child = spawn(resolve(here, "node_modules/.bin/playwright"), ["test", ...process.argv.slice(2)], { cwd: here, stdio: "inherit", env });
// Ctrl+C и SIGTERM передаются Playwright: он сам останавливает запущенные api, web и console.
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
