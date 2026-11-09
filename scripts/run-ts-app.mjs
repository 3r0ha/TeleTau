// Dev-запуск TS-приложения: tsc --watch, а node --watch dist/main.js стартует только после первой
// успешной компиляции — иначе первичная перезапись dist перезапускает сервис второй раз.
// Дочерние процессы — в своих группах: сигнал гасит всё дерево.
// Использование (из каталога приложения): node ../../scripts/run-ts-app.mjs
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { isInvokedDirectly } from "./lib/invoked.mjs";

/** Строка tsc --watch об успешном завершении компиляции (с учётом управляющих последовательностей терминала). */
export function isFirstCompileDone(line) {
  return /Found 0 errors\. Watching for file changes\./.test(line);
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const tsc = resolve(root, "node_modules/.bin/tsc");
  const cwd = process.cwd();
  const children = [];

  const tscChild = spawn(tsc, ["-p", "tsconfig.build.json", "--watch", "--preserveWatchOutput"], {
    cwd,
    stdio: ["ignore", "pipe", "inherit"],
    detached: true,
  });
  children.push(tscChild);

  let nodeChild;
  createInterface({ input: tscChild.stdout }).on("line", (line) => {
    console.log(line);
    if (!nodeChild && isFirstCompileDone(line)) {
      nodeChild = spawn(process.execPath, ["--watch", `--env-file-if-exists=${resolve(root, ".env")}`, "dist/main.js"], {
        cwd,
        stdio: "inherit",
        detached: true,
      });
      children.push(nodeChild);
    }
  });

  const stop = (sig) => {
    for (const child of children) {
      try {
        process.kill(-child.pid, sig);
      } catch {
        // процесс уже завершился
      }
    }
    process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  tscChild.on("exit", (code) => code && stop("SIGTERM"));
}

if (isInvokedDirectly(import.meta.url)) main();
