// Модуль telegram (ADR 0020) против Docker-стека: привязка чата из Mini App по подписи initData (ученик и взрослый),
// служебные операции бота с X-Service-Token и выдача напоминаний о серии по Уфе с подменёнными часами. Под перехватом
// логов: ни initData (имя, ник из профиля Telegram), ни секрета сервиса в них нет.
process.env["NEST_LOG_LEVEL"] = "verbose,debug,log,warn,error,fatal";

import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Redis } from "ioredis";
import type { Schema } from "@teletau/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "../../src/common/auth.js";
import { ACCOUNTS_PORT } from "../../src/common/ports.js";
import type { Db } from "../../src/db/database.js";
import { RateLimiter } from "../../src/infra/rate-limiter.js";
import { DB, VALKEY } from "../../src/infra/tokens.js";
import { ConsensusService } from "../../src/modules/consensus/index.js";
import { importDuels } from "../../src/modules/corpus/duels-import.js";
import { ClassesService } from "../../src/modules/org/index.js";
import { ProgressService } from "../../src/modules/progress/index.js";
import { TelegramLinks, TelegramService } from "../../src/modules/telegram/index.js";
import { signInitData } from "../../src/modules/telegram/init-data.js";
import { scanPdf } from "../support/pdf-qr.js";
import { bootApi, email, expectStatus, newDevice, RUN, testConfig, type AuthSession, type TestApi } from "./harness.js";

type Problem = Schema<"Problem">;

const BOT_TOKEN = "7000000001:AAFakeTokenForIntegrationTests_0123";
const SERVICE_TOKEN = "it-bot-service-token-0123456789abcdef";
const PROFILE = { first_name: "Айгуль", last_name: "Тестова", username: "aigul_it_profile" };

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;
let db: Db;
let adult: AuthSession;
let student: AuthSession;

// ── перехват логов ──
const captured: string[] = [];
const restore: Array<() => void> = [];
function capture(stream: NodeJS.WriteStream): void {
  const original = stream.write.bind(stream);
  stream.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return (original as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof stream.write;
  restore.push(() => (stream.write = original as typeof stream.write));
}

/** initData, как его подписывает Telegram этим токеном бота: профиль пользователя внутри, подпись — hash. */
function initData(userId: number, o: { authDate?: number; token?: string } = {}): string {
  const p = new URLSearchParams({
    query_id: "AAE-it-query",
    user: JSON.stringify({ id: userId, ...PROFILE, language_code: "ru", photo_url: "https://t.me/i/userpic/320/it.svg" }),
    auth_date: String(o.authDate ?? Math.floor(Date.now() / 1000) - 30),
    signature: "it-signature",
  });
  p.set("hash", signInitData(p, o.token ?? BOT_TOKEN));
  return p.toString();
}

const service = { "x-service-token": SERVICE_TOKEN };
const linkRow = async (chatId: number) =>
  (await pool.query("SELECT * FROM telegram_links WHERE chat_id = $1", [chatId])).rows[0] as Record<string, unknown> | undefined;
const chatIds = new Set<number>();
let nextChat = 900_000_000 + Math.floor(Math.random() * 1_000_000) * 100;
const newChat = () => {
  const id = nextChat++;
  chatIds.add(id);
  return id;
};

beforeAll(async () => {
  capture(process.stdout);
  capture(process.stderr);
  ({ api, pool, close } = await bootApi({ ...testConfig(), TELEGRAM_BOT_TOKEN: BOT_TOKEN, BOT_SERVICE_TOKEN: SERVICE_TOKEN }));
  db = api.app.get<Db>(DB);
  adult = await api.loginAdult(email("tg-adult"));
  // Ученик — по QR-карточке своего класса, как в Mini App.
  const moderator = await api.loginStaff("moderator");
  const teacher = await api.verifiedTeacher("tg-teacher", moderator.accessToken);
  const cls = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher.accessToken, body: { grade: 5, letter: "Т", program: "native" } });
  expectStatus(cls, 201);
  const seats = await api.post<Schema<"SeatIssueResult">>(`/classes/${cls.body.id}/seats`, { token: teacher.accessToken, body: { count: 1 } });
  expectStatus(seats, 201);
  const pdf = await api.get(seats.body.printJob.pdfPath, { token: teacher.accessToken });
  const card = (await scanPdf(pdf.raw)).qr[0]![0]!;
  const qr = await api.post<AuthSession>("/auth/qr", { body: { payload: card, device: newDevice() } });
  expectStatus(qr, 200);
  student = qr.body;
});

afterAll(async () => {
  await close?.();
  for (const r of restore) r();
});

describe("POST /telegram/link — привязка чата по подписи initData", () => {
  it("взрослый: подпись верна → 200, напоминания выключены; в базе только chat_id и id аккаунта", async () => {
    const chat = newChat();
    const res = await api.post<Schema<"TelegramLink">>("/telegram/link", { token: adult.accessToken, body: { initData: initData(chat) } });
    expectStatus(res, 200);
    expect(res.body).toEqual({ reminders: { enabled: false, hour: 18 } });
    const row = await linkRow(chat);
    expect(row).toMatchObject({ chat_id: String(chat), account_id: adult.account.id, reminders_enabled: false, reminder_hour: 18, last_reminded_on: null });
    expect(JSON.stringify(row)).not.toMatch(/Айгуль|Тестова|aigul_it_profile|userpic|AAE-it-query|it-signature/);
    // Повтор безопасен: та же строка.
    expectStatus(await api.post("/telegram/link", { token: adult.accessToken, body: { initData: initData(chat) } }), 200);
    expect((await pool.query("SELECT count(*)::int AS n FROM telegram_links WHERE chat_id = $1", [chat])).rows[0]).toEqual({ n: 1 });
  });

  it("ученик по карточке привязывает свой чат; чат, привязанный к другому аккаунту, переходит к нему", async () => {
    const chat = newChat();
    expectStatus(await api.post("/telegram/link", { token: adult.accessToken, body: { initData: initData(chat) } }), 200);
    const res = await api.post<Schema<"TelegramLink">>("/telegram/link", { token: student.accessToken, body: { initData: initData(chat) } });
    expectStatus(res, 200);
    expect((await linkRow(chat))?.["account_id"]).toBe(student.account.id);
  });

  it("таблица модуля — только привязка и настройки напоминаний, ничего из профиля Telegram", async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'telegram_links' ORDER BY ordinal_position",
    );
    expect(rows.map((r) => r.column_name)).toEqual(["chat_id", "account_id", "reminders_enabled", "reminder_hour", "last_reminded_on", "linked_at", "created_at", "updated_at"]);
  });

  it("чужая подпись, подделанный пользователь, мусор — 422 init_data_invalid; старше суток — 422 init_data_expired; привязки нет", async () => {
    const chat = newChat();
    const cases: Array<[string, string]> = [
      [initData(chat, { token: "7000000002:AAAnotherBotTokenForTests_000000000" }), "init_data_invalid"],
      [initData(chat).replace(String(chat), String(chat + 1)), "init_data_invalid"],
      ["query_id=1&auth_date=1&hash=zz", "init_data_invalid"],
      [initData(chat, { authDate: Math.floor(Date.now() / 1000) - 2 * 86_400 }), "init_data_expired"],
    ];
    for (const [raw, code] of cases) {
      const res = await api.post<Problem>("/telegram/link", { token: student.accessToken, body: { initData: raw } });
      expect([res.status, res.body.code], raw.slice(0, 40)).toEqual([422, code]);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      expect(JSON.stringify(res.body)).not.toMatch(/Айгуль|aigul_it_profile/);
    }
    expect(await linkRow(chat)).toBeUndefined();
    expect(await linkRow(chat + 1)).toBeUndefined();
  });

  it("лишние поля и пустая строка — 422 validation_failed до обработчика", async () => {
    const extra = await api.post<Problem>("/telegram/link", { token: student.accessToken, body: { initData: initData(newChat()), chatId: "1" } });
    expect([extra.status, extra.body.code]).toEqual([422, "validation_failed"]);
    const empty = await api.post<Problem>("/telegram/link", { token: student.accessToken, body: { initData: "" } });
    expect([empty.status, empty.body.code]).toEqual([422, "validation_failed"]);
  });

  it("бот не настроен (нет TELEGRAM_BOT_TOKEN) — 503 telegram_unavailable", async () => {
    const config = { ...testConfig(), TELEGRAM_BOT_TOKEN: undefined };
    const svc = new TelegramService(db, config, api.app.get<Redis>(VALKEY), api.app.get(RateLimiter), api.app.get(ProgressService), api.app.get(ConsensusService), api.app.get(ClassesService), api.app.get(TelegramLinks), api.app.get(ACCOUNTS_PORT));
    const principal: Principal = { accountId: adult.account.id, kind: "adult", roles: [], sessionId: "", deviceId: "" };
    await expect(svc.link(principal, { initData: initData(newChat()) })).rejects.toMatchObject({ status: 503, code: "telegram_unavailable" });
  });
});

describe("POST /auth/telegram — вход по привязке (Mini App без карточки)", () => {
  const principalOf = (s: AuthSession): Principal => ({ accountId: s.account.id, kind: s.account.kind, roles: s.account.roles, sessionId: "", deviceId: "" });
  const telegram = () => api.app.get(TelegramService);
  const login = (init: string, device = newDevice()) => api.post<AuthSession>("/auth/telegram", { body: { initData: init, device } });

  it("связанный чат → 200 и сессия аккаунта привязки, как по личной карточке", async () => {
    const chat = newChat();
    await telegram().link(principalOf(student), { initData: initData(chat) });
    const res = await login(initData(chat));
    expectStatus(res, 200);
    expect(res.body.account.id).toBe(student.account.id);
    expect(res.body.refreshToken).toMatch(/^ttr_/);
    // Сессия работает: GET /me по access-токену.
    const me = await api.get("/me", { token: res.body.accessToken });
    expectStatus(me, 200);
  });

  it("чат не привязан → 404 chat_not_linked (клиент покажет обычный вход)", async () => {
    const res = await api.post<Problem>("/auth/telegram", { body: { initData: initData(newChat()), device: newDevice() } });
    expect([res.status, res.body.code]).toEqual([404, "chat_not_linked"]);
  });

  it("чужая подпись и мусор — 401 init_data_invalid; старше суток — 401 init_data_expired", async () => {
    const chat = newChat();
    await telegram().link(principalOf(adult), { initData: initData(chat) });
    const cases: Array<[string, string]> = [
      [initData(chat, { token: "7000000002:AAAnotherBotTokenForTests_000000000" }), "init_data_invalid"],
      ["query_id=1&auth_date=1&hash=zz", "init_data_invalid"],
      [initData(chat, { authDate: Math.floor(Date.now() / 1000) - 2 * 86_400 }), "init_data_expired"],
    ];
    for (const [raw, code] of cases) {
      const res = await api.post<Problem>("/auth/telegram", { body: { initData: raw, device: newDevice() } });
      expect([res.status, res.body.code], raw.slice(0, 40)).toEqual([401, code]);
    }
  });

  it("аккаунт сотрудника → 403 telegram_login_forbidden (сотрудникам — консоль с TOTP)", async () => {
    const moderator = await api.loginStaff("moderator");
    const chat = newChat();
    await telegram().link({ accountId: moderator.account.id, kind: "staff", roles: moderator.account.roles, sessionId: "", deviceId: "" }, { initData: initData(chat) });
    const res = await api.post<Problem>("/auth/telegram", { body: { initData: initData(chat), device: newDevice() } });
    expect([res.status, res.body.code]).toEqual([403, "telegram_login_forbidden"]);
  });

  it("заблокированный аккаунт → 401 account_blocked; разблокированный — снова входит", async () => {
    const who = await api.loginAdult(email("tg-blocked"));
    const chat = newChat();
    await telegram().link(principalOf(who), { initData: initData(chat) });
    await pool.query("UPDATE accounts SET status = 'blocked' WHERE id = $1", [who.account.id]);
    const blocked = await api.post<Problem>("/auth/telegram", { body: { initData: initData(chat), device: newDevice() } });
    expect([blocked.status, blocked.body.code]).toEqual([401, "account_blocked"]);
    await pool.query("UPDATE accounts SET status = 'active' WHERE id = $1", [who.account.id]);
    expectStatus(await login(initData(chat)), 200);
  });

  it("лимит входа: 10 в час на чат, 11-й — 429 rate_limited", async () => {
    const chat = newChat();
    await telegram().link(principalOf(adult), { initData: initData(chat) });
    const device = newDevice();
    for (let i = 0; i < 10; i++) expectStatus(await login(initData(chat), device), 200);
    const limited = await api.post<Problem>("/auth/telegram", { body: { initData: initData(chat), device } });
    expect([limited.status, limited.body.code]).toEqual([429, "rate_limited"]);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  });
});

describe("одноразовый код привязки (без Mini App): выпуск на сайте, погашение ботом", () => {
  const telegram = () => api.app.get(TelegramService);
  const valkey = () => api.app.get<Redis>(VALKEY);
  const principalOf = (s: AuthSession): Principal => ({ accountId: s.account.id, kind: s.account.kind, roles: s.account.roles, sessionId: "", deviceId: "" });
  const issue = (token: string) => api.post<Schema<"TelegramLinkCode">>("/me/telegram/link-code", { token });
  const redeem = (code: string, chatId: number, headers: Record<string, string> = service) =>
    api.post<Schema<"TelegramChat"> & Problem>("/telegram/bot/chats/link-code/redeem", { headers, body: { code, chatId: String(chatId) } });

  it("выпуск: код 8 знаков без похожих, срок 10 минут; повтор в ту же минуту — 429", async () => {
    const res = await issue(adult.accessToken);
    expectStatus(res, 200);
    expect(res.body.code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    expect(Date.parse(res.body.expiresAt)).toBeGreaterThan(Date.now() + 9 * 60_000);
    const again = await api.post<Problem>("/me/telegram/link-code", { token: adult.accessToken });
    expect([again.status, again.body.code]).toEqual([429, "rate_limited"]);
    // Счётчик лимита — свой на аккаунт: ученик берёт код свободно.
    expectStatus(await issue(student.accessToken), 200);
  });

  it("погашение: чат привязывается к аккаунту кода; код одноразовый; неверный — 404 code_not_found", async () => {
    await valkey().del(`rl:tg-link-code:issue:${adult.account.id}`);
    const { body } = await issue(adult.accessToken);
    const chat = newChat();
    const res = await redeem(body.code, chat);
    expectStatus(res, 200);
    expect(res.body).toEqual({ chatId: String(chat), reminders: { enabled: false, hour: 18 } });
    expect((await linkRow(chat))?.["account_id"]).toBe(adult.account.id);
    // Код израсходован: повтор (в том числе из другого чата) — 404.
    const replay = await redeem(body.code, newChat());
    expect([replay.status, replay.body.code]).toEqual([404, "code_not_found"]);
    // Несуществующий код — тот же ответ (без различения причин).
    const missing = await redeem("ZZZZZZZZ", chat);
    expect([missing.status, missing.body.code]).toEqual([404, "code_not_found"]);
  });

  it("новый код гасит прежний: после перевыпуска старый не гасится", async () => {
    const who = await api.loginAdult(email("tg-code"));
    const first = (await issue(who.accessToken)).body;
    await valkey().del(`rl:tg-link-code:issue:${who.account.id}`);
    const second = (await issue(who.accessToken)).body;
    expect(second.code).not.toBe(first.code);
    const chat = newChat();
    const stale = await redeem(first.code, chat);
    expect([stale.status, stale.body.code]).toEqual([404, "code_not_found"]);
    expectStatus(await redeem(second.code, chat), 200);
    expect((await linkRow(chat))?.["account_id"]).toBe(who.account.id);
  });

  // Своя синтетическая дуэль (как в «ежедневном задании»): этот describe идёт раньше импорта его пула,
  // а в прогоне одних telegram-тестов корпус до сих пор пуст.
  const CODE_UNIT = `tg-code-${RUN}`;
  const codeSources = `sources:
  - id: synthetic-tg-code
    title: "Синтетический источник кода привязки"
    url: https://example.org/tg-code
    license: CC0
    accessed: "2026-11-14"
`;
  const codeDuel = `  - id: ${CODE_UNIT}-d01
    ru: "Синтетическая фраза кода"
    kind: phrase
    variants:
      - ba: код-синтез икс
        source:
          ref: synthetic-tg-code
          url: https://example.org/tg-code/1x
          locator: строка «икс 1»
        review: needs_native_review
      - ba: код-синтез игрек
        source:
          ref: synthetic-tg-code
          url: https://example.org/tg-code/1y
          locator: строка «игрек 1»
        review: needs_native_review
`;

  it("погашение переносит чат от прежнего владельца и закрывает его активную дуэль (семантика /telegram/link)", async () => {
    const holder = await api.loginAdult(email("tg-code-holder"));
    const chat = newChat();
    await telegram().link(principalOf(holder), { initData: initData(chat) });
    const dir = mkdtempSync(join(tmpdir(), "tg-code-pool"));
    writeFileSync(join(dir, "sources.yaml"), codeSources);
    mkdirSync(join(dir, "duels"));
    writeFileSync(join(dir, "duels", "duels.yaml"), `unit: ${CODE_UNIT}\nduels:\n${codeDuel}`);
    await importDuels(pool, { dir: join(dir, "duels"), sourcesFile: join(dir, "sources.yaml") });
    const issued = await telegram().dailyDuel(String(chat), new Date());
    expect(issued.state).toBe("issued");

    const who = await api.loginAdult(email("tg-code-new"));
    await valkey().del(`rl:tg-link-code:issue:${who.account.id}`);
    const { body } = await issue(who.accessToken);
    expectStatus(await redeem(body.code, chat), 200);
    expect((await linkRow(chat))?.["account_id"]).toBe(who.account.id);
    // Диалог прежнего владельца закрыт — голос не уйдёт от прошлого аккаунта привязки (ADR 0024).
    const dialog = await pool.query<{ status: string }>("SELECT status::text AS status FROM telegram_dialogs WHERE dialog_id = $1", [issued.dialogId]);
    expect(dialog.rows[0]?.status).toBe("cancelled");
  });

  it("доступ: без секрета — 401, access-токен пользователя — 403; выпуск кода анониму — 401", async () => {
    await valkey().del(`rl:tg-link-code:issue:${adult.account.id}`);
    const code = (await issue(adult.accessToken)).body.code;
    expect((await api.post("/telegram/bot/chats/link-code/redeem", { body: { code, chatId: String(newChat()) } })).status).toBe(401);
    expect((await api.post("/telegram/bot/chats/link-code/redeem", { token: student.accessToken, body: { code, chatId: String(newChat()) } })).status).toBe(403);
    expect((await api.post("/me/telegram/link-code", { body: {} })).status).toBe(401);
  });

  it("брут-форс кодов: 10 погашений в час на чат, 11-й — 429", async () => {
    const chat = newChat();
    for (let i = 0; i < 10; i++) expect([(await redeem("ZZZZZZZZ", chat)).status]).toEqual([404]);
    const limited = await redeem("ZZZZZZZZ", chat);
    expect([limited.status, limited.body.code]).toEqual([429, "rate_limited"]);
  });
});

describe("служебные операции бота (роль service, X-Service-Token)", () => {
  let chat: number;
  beforeAll(async () => {
    chat = newChat();
    expectStatus(await api.post("/telegram/link", { token: student.accessToken, body: { initData: initData(chat) } }), 200);
  });

  it("без секрета и с неверным секретом — 401; access-токен пользователя — 403", async () => {
    const path = `/telegram/bot/chats/${chat}`;
    expect((await api.get(path)).status).toBe(401);
    expect((await api.get(path, { headers: { "x-service-token": "wrong-token-wrong-token-wrong" } })).status).toBe(401);
    expect((await api.get(path, { headers: { "x-service-token": "" } })).status).toBe(401);
    expect((await api.get(path, { token: student.accessToken })).status).toBe(403);
    expect((await api.get(path, { token: "not-a-jwt", headers: { "x-service-token": "nope" } })).status).toBe(401);
  });

  it("GET: привязка и настройки — без аккаунта; непривязанный чат — 404 chat_not_linked; не id чата — 422", async () => {
    const res = await api.get<Schema<"TelegramChat">>(`/telegram/bot/chats/${chat}`, { headers: service });
    expectStatus(res, 200);
    expect(res.body).toEqual({ chatId: String(chat), reminders: { enabled: false, hour: 18 } });
    expect(JSON.stringify(res.body)).not.toContain(student.account.id);
    const missing = await api.get<Problem>(`/telegram/bot/chats/${newChat()}`, { headers: service });
    expect([missing.status, missing.body.code]).toEqual([404, "chat_not_linked"]);
    for (const bad of ["-100123", "0", "abc", "12345678901234567"]) {
      expect((await api.get(`/telegram/bot/chats/${bad}`, { headers: service })).status, bad).toBe(422);
    }
  });

  it("PUT reminders: включить, сменить час, выключить; час вне 8–20 — 422; непривязанный — 404", async () => {
    const put = (body: unknown, id: number = chat) => api.call<Schema<"TelegramChat"> & Problem>("PUT", `/telegram/bot/chats/${id}/reminders`, { headers: service, body });
    const on = await put({ enabled: true });
    expectStatus(on, 200);
    expect(on.body.reminders).toEqual({ enabled: true, hour: 18 });
    expect((await put({ enabled: true, hour: 20 })).body.reminders).toEqual({ enabled: true, hour: 20 });
    expect((await put({ enabled: false })).body.reminders).toEqual({ enabled: false, hour: 20 });
    for (const hour of [7, 21, 18.5]) expect((await put({ enabled: true, hour })).status, String(hour)).toBe(422);
    expect((await put({ enabled: true, extra: 1 })).status).toBe(422);
    const missing = await put({ enabled: true }, newChat());
    expect([missing.status, missing.body.code]).toEqual([404, "chat_not_linked"]);
    expect(await linkRow(chat)).toMatchObject({ reminders_enabled: false, reminder_hour: 20 });
  });

  it("DELETE: отвязка удаляет строку целиком; повтор — тоже 204", async () => {
    const other = newChat();
    expectStatus(await api.post("/telegram/link", { token: adult.accessToken, body: { initData: initData(other) } }), 200);
    expect((await api.del(`/telegram/bot/chats/${other}`, { headers: service })).status).toBe(204);
    expect(await linkRow(other)).toBeUndefined();
    expect((await api.del(`/telegram/bot/chats/${other}`, { headers: service })).status).toBe(204);
  });

  it("POST reminders/claim по HTTP: сутки по Уфе и список чатов (только chat_id)", async () => {
    const res = await api.post<Schema<"TelegramReminderBatch">>("/telegram/bot/reminders/claim", { headers: service });
    expectStatus(res, 200);
    expect(res.body.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const item of res.body.items) expect(Object.keys(item)).toEqual(["chatId"]);
  });
});

describe("напоминания о серии: кому и когда (подменённые часы, сутки по Уфе)", () => {
  const telegram = () => api.app.get(TelegramService);
  const progress = () => api.app.get(ProgressService);
  // 04.11.2026: 13:30Z = 18:30 по Уфе.
  const at = (iso: string) => new Date(iso);
  const lesson = (accountId: string, completedAt: string) =>
    db.transaction((tx) =>
      progress().recordLessonCompletion(tx, {
        accountId,
        accountKind: "adult",
        runId: randomUUID(),
        lessonId: "t-tg-lesson",
        kind: "lesson",
        firstAttempts: ["correct"],
        accuracy: 1,
        newWords: 0,
        completionToday: 1,
        completedAt: at(completedAt),
      }),
    );
  const linked = async (accountId: string, reminders: { enabled: boolean; hour?: number }) => {
    const chat = newChat();
    const principal: Principal = { accountId, kind: "adult", roles: [], sessionId: "", deviceId: "" };
    await telegram().link(principal, { initData: initData(chat) });
    await telegram().setReminders(String(chat), reminders);
    return String(chat);
  };
  const mine = (batch: Schema<"TelegramReminderBatch">) => batch.items.map((i) => i.chatId).filter((id) => chatIds.has(Number(id)));

  const who = { atRisk: randomUUID(), doneToday: randomUUID(), noStreak: randomUUID(), disabled: randomUUID(), late: randomUUID() };
  const chats = {} as Record<keyof typeof who, string>;

  beforeAll(async () => {
    // Напоминания — только действующим аккаунтам: строки аккаунтов нужны и здесь.
    for (const id of Object.values(who)) await pool.query("INSERT INTO accounts (id, kind) VALUES ($1, 'adult')", [id]);
    await lesson(who.atRisk, "2026-11-03T10:00:00Z");
    await lesson(who.doneToday, "2026-11-03T10:00:00Z");
    await lesson(who.doneToday, "2026-11-04T05:00:00Z");
    await lesson(who.disabled, "2026-11-03T10:00:00Z");
    await lesson(who.late, "2026-11-03T10:00:00Z");
    chats.atRisk = await linked(who.atRisk, { enabled: true });
    chats.doneToday = await linked(who.doneToday, { enabled: true });
    chats.noStreak = await linked(who.noStreak, { enabled: true });
    chats.disabled = await linked(who.disabled, { enabled: false });
    chats.late = await linked(who.late, { enabled: true, hour: 20 });
  });

  it("до часа напоминания (17:59 по Уфе) — никому", async () => {
    expect(mine(await telegram().claimReminders(at("2026-11-04T12:59:00Z")))).toEqual([]);
  });

  it("18:30: только серия под угрозой, напоминания включены и час наступил; повтор в те же сутки — никому", async () => {
    const batch = await telegram().claimReminders(at("2026-11-04T13:30:00Z"));
    expect(batch.day).toBe("2026-11-04");
    expect(mine(batch)).toEqual([chats.atRisk]);
    const marked = await pool.query("SELECT last_reminded_on::text AS day FROM telegram_links WHERE chat_id = $1", [chats.atRisk]);
    expect(marked.rows).toEqual([{ day: "2026-11-04" }]);
    expect(mine(await telegram().claimReminders(at("2026-11-04T13:45:00Z")))).toEqual([]);
  });

  it("20:10 — свой час у «позднего»; 21:30 — тихие часы, никому", async () => {
    expect(mine(await telegram().claimReminders(at("2026-11-04T15:10:00Z")))).toEqual([chats.late]);
    await lesson(who.disabled, "2026-11-04T15:20:00Z"); // не влияет: напоминания выключены
    const quiet = await telegram().claimReminders(at("2026-11-04T16:30:00Z"));
    expect(quiet).toEqual({ day: "2026-11-04", items: [] });
  });

  it("следующие сутки: серия под угрозой (04.11 закрыт заморозкой) — снова напоминание; выключил — нет; занимался — нет", async () => {
    await telegram().setReminders(chats.late, { enabled: false });
    await lesson(who.noStreak, "2026-11-05T04:00:00Z"); // новая серия, цель дня выполнена
    const next = await telegram().claimReminders(at("2026-11-05T15:30:00Z"));
    expect(next.day).toBe("2026-11-05");
    // atRisk: 04.11 пропущен и закрыт заморозкой — серия жива, 05.11 урока нет; doneToday: 05.11 урока нет.
    expect(mine(next)).toEqual([chats.atRisk, chats.doneToday]);
  });

  it("в логах нет initData, профиля Telegram и секрета сервиса", () => {
    const all = captured.join("");
    expect(all).not.toMatch(/Айгуль|Тестова|aigul_it_profile|userpic|AAE-it-query|auth_date=|tgWebAppData/);
    expect(all).not.toContain(SERVICE_TOKEN);
    expect(all).not.toContain(BOT_TOKEN);
  });
});

describe("ежедневное задание бота (ADR 0024): FSM-диалог, голос, одна дуэль в сутки по Уфе", () => {
  const UNIT = `tg-${RUN}`;
  const telegram = () => api.app.get(TelegramService);
  const principalOf = (s: AuthSession): Principal => ({ accountId: s.account.id, kind: s.account.kind, roles: s.account.roles, sessionId: "", deviceId: "" });

  // Синтетические дуэли в своей директории (как m2-duel.test.ts): три исходника, голоса — только этого прогона.
  const SOURCES = `sources:
  - id: synthetic-tg
    title: "Синтетический источник Telegram-теста"
    url: https://example.org/tg
    license: CC0
    accessed: "2026-11-04"
`;
  const duel = (n: number) => `  - id: ${UNIT}-d0${n}
    ru: "Синтетическая фраза ${n}"
    kind: phrase
    variants:
      - ba: синтез${n} икс
        source:
          ref: synthetic-tg
          url: https://example.org/tg/${n}x
          locator: строка «икс ${n}»
        review: needs_native_review
      - ba: синтез${n} игрек
        source:
          ref: synthetic-tg
          url: https://example.org/tg/${n}y
          locator: строка «игрек ${n}»
        review: needs_native_review
`;

  /** Чат ученика и выданный ему диалог (ответ и replay — в следующем тесте). */
  let chat: number;
  let dialog: Schema<"TelegramDailyDuel">;

  const issue = (chatId: number) => api.post<Schema<"TelegramDailyDuel">>(`/telegram/bot/chats/${chatId}/daily-duel`, { headers: service });
  const answer = (dialogId: string, choice: string) =>
    api.post<Schema<"TelegramDailyAnswer">>(`/telegram/bot/dialogs/${dialogId}/answer`, { headers: service, body: { choice } });
  const judgmentIdOf = async (dialogId: string) =>
    (await pool.query<{ judgment_id: string }>("SELECT judgment_id FROM telegram_dialogs WHERE dialog_id = $1", [dialogId])).rows[0]!.judgment_id;
  const dialogStatus = async (dialogId: string) =>
    (await pool.query<{ status: string }>("SELECT status::text AS status FROM telegram_dialogs WHERE dialog_id = $1", [dialogId])).rows[0]?.status;

  beforeAll(async () => {
    chat = newChat();
    expectStatus(await api.post("/telegram/link", { token: student.accessToken, body: { initData: initData(chat) } }), 200);

    // База у файлов прогона общая: к этому моменту в корпусе уже реальный дуэли (achievements.test.ts) и синтетика
    // других файлов. Выкачиваем пул ЭТОГО аккаунта ответами «Не знаю» ДО импорта своей синтетики — иначе в выдачу
    // попадает реальная фраза. «Не знаю» мёда не приносит, а исходник выбывает из пула голосующего при любом choice.
    // Дни слива — январь 2025 и далее: они старше «сейчас» и сценариев ниже больше чем на 48 часов, а аккаунт у слива
    // свой — с последним тестом блока (его слив — сентябрь 2026) пул не пересекается.
    let drained: Schema<"TelegramDailyDuel"> | undefined;
    for (let i = 0; i < 400; i++) {
      const at = new Date(Date.UTC(2025, 0, 1 + i));
      drained = await telegram().dailyDuel(String(chat), at);
      if (drained.state !== "issued") break;
      await telegram().answerDialog(drained.dialogId!, { choice: "skip" }, at);
    }
    expect(drained?.state).toBe("empty");

    const dir = mkdtempSync(join(tmpdir(), "tg-daily-"));
    writeFileSync(join(dir, "sources.yaml"), SOURCES);
    mkdirSync(join(dir, "duels"));
    writeFileSync(join(dir, "duels", "duels.yaml"), `unit: ${UNIT}\nduels:\n${duel(1)}${duel(2)}${duel(3)}`);
    await importDuels(pool, { dir: join(dir, "duels"), sourcesFile: join(dir, "sources.yaml") });
    dialog = (await issue(chat)).body;
  });

  it("выдача: dialogId, исходник и стороны A/B; повтор — тот же диалог и тот же порядок сторон; аккаунта в ответе нет", async () => {
    expect(dialog.state).toBe("issued");
    expect(dialog.dialogId).toMatch(/^[0-9a-f-]{36}$/);
    expect(dialog.sourceRu).toMatch(/^Синтетическая фраза \d$/);
    expect(dialog.a).toBeDefined();
    expect(dialog.b).toBeDefined();
    expect(dialog.a!.text).not.toBe(dialog.b!.text);
    expect(JSON.stringify(dialog)).not.toContain(student.account.id);
    expect((await dialogStatus(dialog.dialogId!))).toBe("issued");

    const again = await issue(chat);
    expectStatus(again, 200);
    expect(again.body).toEqual(dialog);
  });

  it("ответ: голос ребёнка в журнале с контекстом telegram, мёд pending 3; та же кнопка — replay, другой выбор — 409 already_voted", async () => {
    const judgmentId = await judgmentIdOf(dialog.dialogId!);
    const answered = await answer(dialog.dialogId!, "a");
    expectStatus(answered, 200);
    expect(answered.body.replay).toBe(false);
    expect(["voting", "accepted", "escalated"]).toContain(answered.body.status);

    const [row] = (
      await pool.query<{ context: string; choice: string; vg: string; variant_a_id: string; variant_b_id: string; latency_ms: number }>(
        "SELECT context::text AS context, choice::text AS choice, voter_group::text AS vg, variant_a_id, variant_b_id, latency_ms FROM judgments WHERE id = $1",
        [judgmentId],
      )
    ).rows;
    // Порядок показа — из строки диалога: choice «a» — это вариант A выдачи; группа — из типа аккаунта (ребёнок).
    expect(row).toMatchObject({ context: "telegram", choice: "a", vg: "child", variant_a_id: dialog.a!.variantId, variant_b_id: dialog.b!.variantId });
    expect(row!.latency_ms).toBeGreaterThanOrEqual(0);
    // Мёд — как в вебе: pending 3 (мёд «созревает» — ADR 0019).
    const honey = (await pool.query<{ status: string; amount: number }>("SELECT status::text AS status, amount FROM xp_ledger WHERE reason = 'vote' AND ref_id = $1", [judgmentId])).rows;
    expect(honey).toEqual([{ status: "pending", amount: 3 }]);
    expect((await dialogStatus(dialog.dialogId!))).toBe("answered");

    // Повторное нажатие той же кнопки — тот же ответ, помеченный replay (новой записи в журнале нет).
    const replay = await answer(dialog.dialogId!, "a");
    expectStatus(replay, 200);
    expect(replay.body).toEqual({ replay: true, status: answered.body.status });
    // Другой выбор по отвеченному диалогу — второй голос за исходник запрещён.
    const other = await api.post<Schema<"Problem">>(`/telegram/bot/dialogs/${dialog.dialogId}/answer`, { headers: service, body: { choice: "b" } });
    expect([other.status, other.body.code]).toEqual([409, "already_voted"]);
    // Ответ в эти же сутки по Уфе уже учтён — новая дуэль не выдаётся.
    const done = await issue(chat);
    expectStatus(done, 200);
    expect(done.body).toEqual({ state: "done" });
  });

  it("отмена: активный диалог закрывается без голоса; повтор — false; ответ по закрытому — 409 dialog_closed; затем — свежая дуэль", async () => {
    const adultChat = newChat();
    expectStatus(await api.post("/telegram/link", { token: adult.accessToken, body: { initData: initData(adultChat) } }), 200);
    const issued = (await issue(adultChat)).body;
    expect(issued.state).toBe("issued");
    expect((await api.post<Schema<"TelegramDailyCancel">>(`/telegram/bot/chats/${adultChat}/daily-duel/cancel`, { headers: service })).body).toEqual({ cancelled: true });
    expect((await api.post<Schema<"TelegramDailyCancel">>(`/telegram/bot/chats/${adultChat}/daily-duel/cancel`, { headers: service })).body).toEqual({ cancelled: false });
    expect(await dialogStatus(issued.dialogId!)).toBe("cancelled");

    const closed = await api.post<Schema<"Problem">>(`/telegram/bot/dialogs/${issued.dialogId}/answer`, { headers: service, body: { choice: "both" } });
    expect([closed.status, closed.body.code]).toEqual([409, "dialog_closed"]);
    expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM judgments WHERE id = $1", [await judgmentIdOf(issued.dialogId!)])).rows[0]).toEqual({ n: 0 });

    // Кнопки старого диалога больше не отвечают: следующая выдача — другой диалог (взрослый голосует — группа adult).
    const reissued = await issue(adultChat);
    expectStatus(reissued, 200);
    expect(reissued.body.state).toBe("issued");
    expect(reissued.body.dialogId).not.toBe(issued.dialogId);
    const voted = await answer(reissued.body.dialogId!, "b");
    expectStatus(voted, 200);
    const [row] = (await pool.query<{ vg: string }>("SELECT voter_group::text AS vg FROM judgments WHERE id = $1", [await judgmentIdOf(reissued.body.dialogId!)])).rows;
    expect(row).toEqual({ vg: "adult" });
  });

  it("чужой dialogId — 404 dialog_not_found; мусорный — 422; непривязанный чат — 404 chat_not_linked; тело — 422", async () => {
    const missing = await api.post<Schema<"Problem">>(`/telegram/bot/dialogs/${randomUUID()}/answer`, { headers: service, body: { choice: "a" } });
    expect([missing.status, missing.body.code]).toEqual([404, "dialog_not_found"]);
    expect((await api.post("/telegram/bot/dialogs/not-a-uuid/answer", { headers: service, body: { choice: "a" } })).status).toBe(422);
    const unlinked = await api.post<Schema<"Problem">>(`/telegram/bot/chats/${newChat()}/daily-duel`, { headers: service });
    expect([unlinked.status, unlinked.body.code]).toEqual([404, "chat_not_linked"]);
    expect((await api.post(`/telegram/bot/dialogs/${randomUUID()}/answer`, { headers: service, body: { choice: "a", extra: 1 } })).status).toBe(422);
    expect((await api.post(`/telegram/bot/dialogs/${randomUUID()}/answer`, { headers: service, body: { choice: "x" } })).status).toBe(422);
  });

  it("одна дуэль в сутки по Уфе: после ответа — done; в следующие сутки — новая; «Не знаю» — без мёда; пул исчерпан — empty", async () => {
    const fresh = await api.loginAdult(email("tg-daily"));
    const freshChat = newChat();
    await telegram().link(principalOf(fresh), { initData: initData(freshChat) });
    const day = (n: number) => new Date(`2026-11-1${n}T10:00:00Z`); // 15:00 по Уфе, три следующих суток

    // База у файлов прогона общая: к этому моменту в корпусе уже реальный дуэли (achievements.test.ts) и синтетика
    // других файлов. Выкачиваем пул этой учётной записи ответами «Не знаю» — исходник выбывает из пула голосующего
    // при любом choice, а «Не знаю» мёда не приносит. Дни слива — сентябрь/октябрь: до сценария ниже не пересекаются
    // ни с окном 48 часов, ни с сутками по Уфе.
    let drained: Schema<"TelegramDailyDuel"> | undefined;
    for (let i = 0; i < 400; i++) {
      const at = new Date(Date.UTC(2026, 8, 1 + i));
      drained = await telegram().dailyDuel(String(freshChat), at);
      if (drained.state !== "issued") break;
      await telegram().answerDialog(drained.dialogId!, { choice: "skip" }, at);
    }
    expect(drained?.state).toBe("empty");

    // Свой пул ровно на трое суток: три свежие синтетические дуэли, которых эта учётная запись ещё не видела.
    const dir = mkdtempSync(join(tmpdir(), "tg-daily-pool"));
    writeFileSync(join(dir, "sources.yaml"), SOURCES);
    mkdirSync(join(dir, "duels"));
    writeFileSync(join(dir, "duels", "duels.yaml"), `unit: ${UNIT}-pool\nduels:\n${duel(4)}${duel(5)}${duel(6)}`);
    await importDuels(pool, { dir: join(dir, "duels"), sourcesFile: join(dir, "sources.yaml") });

    const d1 = await telegram().dailyDuel(String(freshChat), day(0));
    expect(d1.state).toBe("issued");
    expect((await telegram().answerDialog(d1.dialogId!, { choice: "a" }, day(0))).replay).toBe(false);
    expect(await telegram().dailyDuel(String(freshChat), day(0))).toEqual({ state: "done" });

    const d2 = await telegram().dailyDuel(String(freshChat), day(1));
    expect(d2.state).toBe("issued");
    expect(d2.dialogId).not.toBe(d1.dialogId);
    await telegram().answerDialog(d2.dialogId!, { choice: "b" }, day(1));
    const d3 = await telegram().dailyDuel(String(freshChat), day(2));
    expect(d3.state).toBe("issued");
    await telegram().answerDialog(d3.dialogId!, { choice: "skip" }, day(2));

    expect(await telegram().dailyDuel(String(freshChat), day(3))).toEqual({ state: "empty" });
    // Мёд — за два содержательных голоса («Не знаю» — без мёда).
    expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM xp_ledger WHERE account_id = $1 AND reason = 'vote'", [fresh.account.id])).rows[0]).toEqual({ n: 2 });
  });

  it("повторная привязка чата к другому аккаунту закрывает выданный диалог; отвязка удаляет диалоги чата", async () => {
    const holder = await api.loginAdult(email("tg-holder"));
    const shared = newChat();
    await telegram().link(principalOf(holder), { initData: initData(shared) });
    const issued = await telegram().dailyDuel(String(shared), new Date("2026-11-10T10:00:00Z"));
    expect(issued.state).toBe("issued");

    // Чат переходит к ученику: диалог прежнего владельца закрыт — голос не уйдёт от прошлого аккаунта привязки.
    expectStatus(await api.post("/telegram/link", { token: student.accessToken, body: { initData: initData(shared) } }), 200);
    expect(await dialogStatus(issued.dialogId!)).toBe("cancelled");
    const stale = await api.post<Schema<"Problem">>(`/telegram/bot/dialogs/${issued.dialogId}/answer`, { headers: service, body: { choice: "a" } });
    expect([stale.status, stale.body.code]).toEqual([409, "dialog_closed"]);

    // Ученик из этого же чата получает свою дуэлю.
    const mine = await telegram().dailyDuel(String(shared), new Date("2026-11-12T10:00:00Z"));
    expect(mine.state).toBe("issued");
    // Отвязка: диалоги чата удалены — данных о чате не остаётся (как у привязки).
    expect((await api.del(`/telegram/bot/chats/${shared}`, { headers: service })).status).toBe(204);
    expect((await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM telegram_dialogs WHERE chat_id = $1", [shared])).rows[0]).toEqual({ n: 0 });
    const gone = await api.post<Schema<"Problem">>(`/telegram/bot/dialogs/${mine.dialogId}/answer`, { headers: service, body: { choice: "a" } });
    expect([gone.status, gone.body.code]).toEqual([404, "dialog_not_found"]);
  });

  it("аккаунт заблокирован после выдачи: ответ — 409 dialog_closed без голоса в журнале; новая выдача — 404, привязка снята", async () => {
    const holder = await api.loginAdult(email("tg-blocked-holder"));
    const own = newChat();
    await telegram().link(principalOf(holder), { initData: initData(own) });
    const issued = await telegram().dailyDuel(String(own), new Date("2026-11-11T10:00:00Z"));
    expect(issued.state).toBe("issued");
    const judgmentId = await judgmentIdOf(issued.dialogId!);
    await pool.query("UPDATE accounts SET status = 'blocked' WHERE id = $1", [holder.account.id]);
    try {
      const res = await answer(issued.dialogId!, "a");
      expect([res.status, (res.body as unknown as Schema<"Problem">).code]).toEqual([409, "dialog_closed"]);
      expect(await dialogStatus(issued.dialogId!)).toBe("cancelled");
      expect((await pool.query("SELECT 1 FROM judgments WHERE id = $1", [judgmentId])).rowCount).toBe(0);
      const again = await issue(own);
      expect([again.status, (again.body as unknown as Schema<"Problem">).code]).toEqual([404, "chat_not_linked"]);
      expect(await linkRow(own)).toBeUndefined();
    } finally {
      await pool.query("UPDATE accounts SET status = 'active' WHERE id = $1", [holder.account.id]);
    }
  });
});
