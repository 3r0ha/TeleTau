// «запущен как скрипт» должно срабатывать и при запуске через симлинк (macOS: /var → /private/var).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scripts = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("check-hardcoded-colors runs its check when launched through a symlink", () => {
  const dir = mkdtempSync(join(tmpdir(), "teletau-link-"));
  try {
    const link = join(dir, "colors.mjs");
    symlinkSync(join(scripts, "check-hardcoded-colors.mjs"), link);
    const res = spawnSync(process.execPath, [link], { encoding: "utf8" });
    assert.match(res.stdout + res.stderr, /Цвета/, "скрипт молча ничего не проверил");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
