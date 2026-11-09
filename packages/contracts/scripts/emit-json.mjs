// openapi.yaml → src/generated/openapi.json. JSON-копия контракта нужна API во время выполнения:
// схемы запросов (валидация Fastify/ajv) и правила доступа x-access (ADR 0017) берутся прямо из контракта,
// без ручных DTO (CLAUDE.md, правило 1). Актуальность проверяет scripts/check.mjs (шаг 3).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const JSON_PATH = join(pkg, "src/generated/openapi.json");

/** Каноническая JSON-форма спецификации (отступ 2, перевод строки в конце). */
export function specToJson(yamlText) {
  return `${JSON.stringify(parse(yamlText), null, 2)}\n`;
}

export function readSpecJson() {
  return specToJson(readFileSync(join(pkg, "openapi.yaml"), "utf8"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(JSON_PATH, readSpecJson());
  console.log(`contracts: ${JSON_PATH.replace(`${pkg}/`, "")} обновлён`);
}
