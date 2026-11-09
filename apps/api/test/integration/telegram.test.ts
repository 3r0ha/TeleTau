// Модуль telegram (ADR 0020) против Docker-стека: привязка чата из Mini App по подписи initData (ученик и взрослый),
// служебные операции бота с X-Service-Token и выдача напоминаний о серии по Уфе с подменёнными часами. Под перехватом
// логов: ни initData (имя, ник из профиля Telegram), ни секрета сервиса в них нет.
process.env["NEST_LOG_LEVEL"] = "verbose,debug,log,warn,error,fatal";

import { randomUUID } from "node:crypto";
import type { Schema } from "@teletau/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "../../src/common/auth.js";
import type { Db } from "../../src/db/database.js";
import { DB } from "../../src/infra/tokens.js";
import { ProgressService } from "../../src/modules/progress/index.js";
import { TelegramService } from "../../src/modules/telegram/index.js";
import { signInitData } from "../../src/modules/telegram/init-data.js";
import { scanPdf } from "../support/pdf-qr.js";
import { bootApi, email, expectStatus, newDevice, testConfig, type AuthSession, type TestApi } from "./harness.js";

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
    const svc = new TelegramService(db, config, api.app.get(ProgressService));
    const principal: Principal = { accountId: adult.account.id, kind: "adult", roles: [], sessionId: "", deviceId: "" };
    await expect(svc.link(principal, { initData: initData(newChat()) })).rejects.toMatchObject({ status: 503, code: "telegram_unavailable" });
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
