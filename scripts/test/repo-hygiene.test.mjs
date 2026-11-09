import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test(".gitignore excludes Gradle and Kotlin caches in any Android subproject (M0-R2-11)", () => {
  const dir = mkdtempSync(join(tmpdir(), "teletau-gitignore-"));
  try {
    copyFileSync(join(root, ".gitignore"), join(dir, ".gitignore"));
    spawnSync("git", ["init", "-q"], { cwd: dir });
    const paths = [
      "android/build-logic/.gradle/9.8.2/x",
      "android/build-logic/.kotlin/sessions/x",
      "android/core/designsystem/.gradle/x",
      "android/.gradle/x",
    ];
    for (const p of paths) {
      mkdirSync(join(dir, dirname(p)), { recursive: true });
      writeFileSync(join(dir, p), "");
      const res = spawnSync("git", ["check-ignore", "-q", p], { cwd: dir });
      assert.equal(res.status, 0, `не игнорируется: ${p}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verify.sh applies migrations the same way as developers do — via .env (M0-R2-08)", () => {
  const verify = readFileSync(join(root, "scripts/verify.sh"), "utf8");
  const migrate = verify.split("\n").find((l) => l.includes('"Миграции"'));
  assert.ok(migrate, "в verify.sh нет шага «Миграции»");
  assert.match(migrate, /pnpm db:migrate/);
  assert.doesNotMatch(verify, /localhost:15432/, "адрес базы не должен быть зашит в verify.sh — его читает drizzle.config.ts из .env");
});

test("verify.sh and CI run the screen checks on mocks and the e2e suite against the real stack (M1 T7)", () => {
  const verify = readFileSync(join(root, "scripts/verify.sh"), "utf8");
  const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  for (const [name, text] of [["verify.sh", verify], ["ci.yml", ci]]) {
    assert.match(text, /@teletau\/web test:a11y/, `${name}: нет проверки экранов веба`);
    assert.match(text, /@teletau\/console test:a11y/, `${name}: нет проверки экранов консоли`);
    assert.match(text, /pnpm e2e/, `${name}: нет сквозных тестов`);
  }
  assert.match(verify, /--skip-e2e\) SKIP_E2E=1/, "verify.sh: нет флага --skip-e2e");
  // Сквозные тесты — после интеграционных: обоим нужен Docker-стек.
  assert.ok(verify.indexOf("pnpm e2e") > verify.indexOf("test:integration"), "verify.sh: e2e должен идти после интеграционных тестов");
});
