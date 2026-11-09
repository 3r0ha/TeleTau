import assert from "node:assert/strict";
import { test } from "node:test";
import { describeServices, layeredEnv, mergeEnv, parseEnvFile } from "../dev.mjs";
import { isFirstCompileDone } from "../run-ts-app.mjs";

test("parseEnvFile reads KEY=value, skips comments and empty values", () => {
  const env = parseEnvFile("# comment\nAPI_PORT=4000\nEMPTY=\n  WEB_PORT=3000  \nQUOTED=\"a b\"\n");
  assert.deepEqual(env, { API_PORT: "4000", WEB_PORT: "3000", QUOTED: "a b" });
});

test("process environment wins over .env (M0-10)", () => {
  const merged = mergeEnv({ WEB_PORT: "3555", PATH: "/bin" }, "WEB_PORT=3000\nAPI_PORT=4000\n");
  assert.equal(merged.WEB_PORT, "3555");
  assert.equal(merged.API_PORT, "4000");
  assert.equal(merged.PATH, "/bin");
});

test("an old .env gets new variables from .env.example; explicit empty values and the process env win (M1)", () => {
  const example = "TRUST_PROXY=loopback\nAUTH_DEMO_OTP=0000\nAPI_PORT=4000\n";
  const { env, missing } = layeredEnv({ API_PORT: "4555" }, "AUTH_DEMO_OTP=\nAPI_PORT=4000\n", example);
  assert.equal(env.TRUST_PROXY, "loopback", "новой переменной нет в старом .env — берётся из примера");
  assert.equal(env.AUTH_DEMO_OTP, undefined, "пустое значение в .env — осознанный выбор, пример его не заменяет");
  assert.equal(env.API_PORT, "4555", "окружение процесса важнее .env");
  assert.deepEqual(missing, ["TRUST_PROXY"]);
  assert.deepEqual(layeredEnv({ TRUST_PROXY: "false" }, "", example).env.TRUST_PROXY, "false");
});

test("describeServices prints the actual ports, not hardcoded defaults (M0-10)", () => {
  const line = describeServices({ API_PORT: "4555", WEB_PORT: "3555", CONSOLE_PORT: "3655", AI_GATEWAY_PORT: "4655", ML_WORKER_PORT: "4755" });
  for (const port of ["4555", "3555", "3655", "4655", "4755"]) assert.ok(line.includes(`:${port}`), line);
  assert.ok(!line.includes(":4000"));
});

test("run-ts-app starts node only after the first successful tsc --watch compile (M0-11)", () => {
  assert.equal(isFirstCompileDone("8:01:02 PM - Starting compilation in watch mode..."), false);
  assert.equal(isFirstCompileDone("8:01:04 PM - Found 2 errors. Watching for file changes."), false);
  assert.equal(isFirstCompileDone("8:01:04 PM - Found 0 errors. Watching for file changes."), true);
  assert.equal(isFirstCompileDone("\u001b[2J8:01:04 PM - Found 0 errors. Watching for file changes."), true);
});

test("findBusyPorts reports an app whose port is already taken (M0-R2-10)", async () => {
  const { createServer } = await import("node:net");
  const { findBusyPorts, APP_PORTS } = await import("../dev.mjs");
  const blocker = createServer();
  await new Promise((r) => blocker.listen(0, "127.0.0.1", r));
  const port = blocker.address().port;
  try {
    // Остальные порты — 0 (не проверяются): тест не зависит от запущенного рядом pnpm dev.
    const env = Object.fromEntries(APP_PORTS.map((p) => [p.key, "0"]));
    const busy = await findBusyPorts({ ...env, WEB_PORT: String(port) });
    assert.deepEqual(busy.map((b) => b.app), ["web"]);
    assert.equal(busy[0].port, port);
  } finally {
    await new Promise((r) => blocker.close(r));
  }
});

test("turboArgs skips apps on busy ports and keeps the rest running (M0-R2-10)", async () => {
  const { turboArgs } = await import("../dev.mjs");
  const args = turboArgs([{ app: "web", key: "WEB_PORT", port: 3000 }]);
  assert.ok(args.includes("--continue"), "одно упавшее приложение не должно ронять остальные");
  assert.ok(args.includes("--filter=!@teletau/web"), "приложение на занятом порту не запускается");
  assert.ok(args.includes("--filter=./apps/*"));
  assert.ok(!turboArgs([]).some((a) => a.startsWith("--filter=!")));
});
