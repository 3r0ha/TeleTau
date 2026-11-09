// `node --test <каталог>` не работает на целевой Node 24 (MODULE_NOT_FOUND) — только glob-шаблоны.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function packageJsons() {
  const out = [join(root, "package.json")];
  for (const group of ["apps", "packages"]) {
    for (const name of readdirSync(join(root, group))) {
      const p = join(root, group, name, "package.json");
      if (existsSync(p)) out.push(p);
    }
  }
  return out;
}

/** Аргументы `node --test …` из строки скрипта (без флагов). */
export function nodeTestArgs(script) {
  const found = [];
  for (const m of script.matchAll(/node\s+(?:--[\w-]+(?:=\S+)?\s+)*--test((?:\s+(?!&&|\|\||;)\S+)*)/g)) {
    for (const raw of m[1].trim().split(/\s+/).filter(Boolean)) {
      if (raw.startsWith("--")) continue;
      found.push(raw.replace(/^['"]|['"]$/g, ""));
    }
  }
  return found;
}

test("nodeTestArgs extracts positional arguments", () => {
  assert.deepEqual(nodeTestArgs("turbo run test && node --test scripts/test/"), ["scripts/test/"]);
  assert.deepEqual(nodeTestArgs("node --test 'test/*.test.mjs'"), ["test/*.test.mjs"]);
});

test("no package.json runs `node --test` with a directory argument (fails on Node 24)", () => {
  const offenders = [];
  for (const file of packageJsons()) {
    const scripts = JSON.parse(readFileSync(file, "utf8")).scripts ?? {};
    for (const [name, script] of Object.entries(scripts)) {
      for (const arg of nodeTestArgs(script)) {
        const abs = resolve(dirname(file), arg);
        const isDir = arg.endsWith("/") || (existsSync(abs) && statSync(abs).isDirectory());
        if (isDir) offenders.push(`${file.replace(root + "/", "")} → scripts.${name}: «${arg}» — используйте glob в кавычках`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
