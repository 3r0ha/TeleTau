// Проверка контракта:
// (1) линт спецификации, (2) правила ответов (нет additionalProperties:false) и доступа (x-access — ADR 0017),
// (3) сгенерированные TS-типы и JSON-копия контракта (src/generated/openapi.json) актуальны, (4) нет ломающих изменений относительно openapi.baseline.yaml (oasdiff в Docker).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { findAccessViolations } from "./access-rules.mjs";
import { JSON_PATH, readSpecJson } from "./emit-json.mjs";
import { findClosedResponseSchemas } from "./response-rules.mjs";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name) => join(pkg, "node_modules", ".bin", name);
let failed = false;

console.log("1/4 redocly lint");
const lint = spawnSync(bin("redocly"), ["lint", "openapi.yaml", "--format", "stylish"], { cwd: pkg, stdio: "inherit" });
if (lint.status !== 0) failed = true;

console.log("2/4 правила схем ответов и доступа");
const spec = parse(readFileSync(join(pkg, "openapi.yaml"), "utf8"));
const closed = findClosedResponseSchemas(spec);
if (closed.length) {
  console.error(
    `additionalProperties: false в схемах ответов (${closed.length}) — ответы должны оставаться открытыми для новых полей:\n  ${closed.join("\n  ")}`,
  );
  failed = true;
}
const access = findAccessViolations(spec);
if (access.length) {
  console.error(`Правила доступа x-access нарушены (${access.length}):\n  ${access.join("\n  ")}`);
  failed = true;
}

console.log("3/4 сгенерированные типы актуальны");
const tmp = mkdtempSync(join(tmpdir(), "teletau-contracts-"));
try {
  execFileSync(bin("openapi-typescript"), ["openapi.yaml", "-o", join(tmp, "api.ts")], { cwd: pkg, stdio: "pipe" });
  const fresh = readFileSync(join(tmp, "api.ts"), "utf8");
  const current = readFileSync(join(pkg, "src/generated/api.ts"), "utf8");
  if (fresh !== current) {
    console.error("УСТАРЕЛО: src/generated/api.ts — запустите pnpm --filter @teletau/contracts generate");
    failed = true;
  }
  // JSON-копия контракта: по ней API валидирует запросы и применяет x-access (ADR 0017).
  if (readSpecJson() !== readFileSync(JSON_PATH, "utf8")) {
    console.error("УСТАРЕЛО: src/generated/openapi.json — запустите pnpm --filter @teletau/contracts generate");
    failed = true;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log("4/4 ломающие изменения (oasdiff, базовая версия openapi.baseline.yaml)");
const docker = spawnSync("docker", ["info"], { stdio: "ignore" });
if (docker.status !== 0) {
  console.warn("ПРЕДУПРЕЖДЕНИЕ: Docker недоступен — проверка ломающих изменений пропущена (в CI она обязательна)");
} else {
  const diff = spawnSync(
    "docker",
    ["run", "--rm", "-v", `${pkg}:/specs:ro`, "tufin/oasdiff:v1.35.0", "breaking", "/specs/openapi.baseline.yaml", "/specs/openapi.yaml", "--fail-on", "ERR"],
    { stdio: "inherit" },
  );
  if (diff.status !== 0) {
    console.error("Найдены ломающие изменения API. Нужна новая мажорная версия или явное решение (см. docs/07-data-and-api.md §5).");
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("contracts: OK");
