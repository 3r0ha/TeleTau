// Входы в обход карточки и согласие родителя: привязка Telegram и почта ребёнка. Отзыв бумажного согласия и
// перевыпуск карточки снимают привязки Telegram (перевыпуск — и вход по почте детского аккаунта), вход через Telegram и
// по почте проверяет согласие на местах (403 consent_revoked), бот не выдаёт дуэли и напоминания аккаунтам без
// согласия или не действующим. Привязка видна в GET /me и снимается DELETE /me/telegram и «выйти на всех устройствах».
// Заодно — правила, которые проверяются только на настоящей базе: заявка учителя без почты, один класс у ученика
// «Учусь сам», задание архивному классу, дата бумажного согласия и курсоры страниц с микросекундами.
import { randomUUID } from "node:crypto";
import type { Schema } from "@teletau/contracts";
import { ufaDate } from "@teletau/domain-rules";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "../../src/common/auth.js";
import type { Db } from "../../src/db/database.js";
import { DB } from "../../src/infra/tokens.js";
import { ClassesService } from "../../src/modules/org/index.js";
import { ProgressService } from "../../src/modules/progress/index.js";
import { TelegramService } from "../../src/modules/telegram/index.js";
import { signInitData } from "../../src/modules/telegram/init-data.js";
import { bootApi, DEMO_CODE, email, expectStatus, newDevice, randomIp, testConfig, type AuthSession, type TestApi } from "./harness.js";

type Problem = Schema<"Problem">;
type Me = Schema<"Me">;

const BOT_TOKEN = "7000000001:AAFakeTokenForIntegrationTests_0123";
const SERVICE_TOKEN = "it-bot-service-token-side-logins-0123456789";
const service = { "x-service-token": SERVICE_TOKEN };

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;
let teacher: AuthSession;
let moderator: AuthSession;
let classId: string;
/** Ученики мест 1…4 класса (вход по карточке). */
const kids: AuthSession[] = [];

let nextChat = 700_000_000 + Math.floor(Math.random() * 1_000_000) * 100;
const newChat = () => nextChat++;

function initData(userId: number): string {
  const p = new URLSearchParams({ user: JSON.stringify({ id: userId, first_name: "Тест" }), auth_date: String(Math.floor(Date.now() / 1000) - 30) });
  p.set("hash", signInitData(p, BOT_TOKEN));
  return p.toString();
}

const principalOf = (s: AuthSession): Principal => ({ accountId: s.account.id, kind: s.account.kind, roles: s.account.roles, sessionId: "", deviceId: "" });
const linksOf = async (accountId: string) =>
  (await pool.query<{ chat_id: string }>("SELECT chat_id FROM telegram_links WHERE account_id = $1", [accountId])).rows.map((r) => r.chat_id);
const link = async (who: AuthSession) => {
  const chat = newChat();
  expectStatus(await api.post("/telegram/link", { token: who.accessToken, body: { initData: initData(chat) } }), 200);
  return chat;
};
/** Привязка, оставшаяся с прежних версий (до снятия при отзыве): строка прямо в базе. */
const legacyLink = async (accountId: string, reminders = false) => {
  const chat = newChat();
  await pool.query("INSERT INTO telegram_links (chat_id, account_id, reminders_enabled, reminder_hour) VALUES ($1, $2, $3, 8)", [chat, accountId, reminders]);
  return chat;
};
const attachEmail = async (who: AuthSession, address: string) => {
  const ch = await api.post<Schema<"OtpChallenge">>("/auth/otp/request", { body: { email: address }, ip: randomIp() });
  expectStatus(ch, 202);
  expectStatus(await api.post("/me/email", { token: who.accessToken, body: { challengeId: ch.body.challengeId, code: DEMO_CODE } }), 200);
};
const otpLogin = async (address: string) => {
  const ch = await api.post<Schema<"OtpChallenge">>("/auth/otp/request", { body: { email: address }, ip: randomIp() });
  expectStatus(ch, 202);
  return api.post<AuthSession | Problem>("/auth/otp/verify", { body: { challengeId: ch.body.challengeId, code: DEMO_CODE, device: newDevice() }, ip: randomIp() });
};
const revokePaperConsent = async (seat: number) => {
  const given = await api.post<Schema<"Consent">>(`/classes/${classId}/seats/${seat}/paper-consent`, { token: teacher.accessToken });
  expectStatus(given, 201);
  expectStatus(await api.post(`/consents/${given.body.id}/revoke`, { token: teacher.accessToken }), 200);
};

beforeAll(async () => {
  ({ api, pool, close } = await bootApi({ ...testConfig(), TELEGRAM_BOT_TOKEN: BOT_TOKEN, BOT_SERVICE_TOKEN: SERVICE_TOKEN }));
  moderator = await api.loginStaff("moderator");
  teacher = await api.verifiedTeacher("side-teacher", moderator.accessToken);
  const cls = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher.accessToken, body: { grade: 7, letter: "Ж", program: "native" } });
  expectStatus(cls, 201);
  classId = cls.body.id;
  const issued = await api.post<Schema<"SeatIssueResult">>(`/classes/${classId}/seats`, { token: teacher.accessToken, body: { count: 4 } });
  expectStatus(issued, 201);
  const cards = await api.app.get(ClassesService).printJobCards(principalOf(teacher), classId, issued.body.printJob.id);
  for (const card of cards) {
    const kid = await api.post<AuthSession>("/auth/qr", { body: { payload: card.payload, device: newDevice() } });
    expectStatus(kid, 200);
    kids.push(kid.body);
  }
});

afterAll(async () => {
  await close?.();
});

describe("отзыв бумажного согласия: Telegram и почта ребёнка", () => {
  let address: string;
  let survivingChat: number;

  beforeAll(async () => {
    const kid = kids[0]!;
    await link(kid);
    address = email("side-kid-1");
    await attachEmail(kid, address);
    // Код привязки, выпущенный до отзыва: погасить его после отзыва нельзя.
    const code = await api.post<Schema<"TelegramLinkCode">>("/me/telegram/link-code", { token: kid.accessToken });
    expectStatus(code, 200);
    survivingChat = newChat();
    await revokePaperConsent(1);
    const redeem = await api.post<Problem>("/telegram/bot/chats/link-code/redeem", { headers: service, body: { code: code.body.code, chatId: String(survivingChat) } });
    expect([redeem.status, redeem.body.code]).toEqual([404, "code_not_found"]);
  });

  it("привязки Telegram аккаунта снимаются вместе с сессиями", async () => {
    expect(await linksOf(kids[0]!.account.id)).toEqual([]);
  });

  it("вход через Telegram по оставшейся привязке — 403 consent_revoked, сессии нет", async () => {
    const chat = await legacyLink(kids[0]!.account.id);
    const res = await api.post<Problem>("/auth/telegram", { body: { initData: initData(chat), device: newDevice() } });
    expect([res.status, res.body.code]).toEqual([403, "consent_revoked"]);
  });

  it("вход по почте ребёнка — 403 consent_revoked (код израсходован, сессии нет)", async () => {
    const res = await otpLogin(address);
    expect([res.status, (res.body as Problem).code]).toEqual([403, "consent_revoked"]);
  });

  it("бот: дуэль дня такому аккаунту не выдаётся — 404 chat_not_linked, привязка снята", async () => {
    const chat = await legacyLink(kids[0]!.account.id);
    const res = await api.post<Problem>(`/telegram/bot/chats/${chat}/daily-duel`, { headers: service });
    expect([res.status, res.body.code]).toEqual([404, "chat_not_linked"]);
    expect(await linksOf(kids[0]!.account.id)).not.toContain(String(chat));
  });

  it("бот: напоминание о серии такому аккаунту не выдаётся, соседу по классу с той же серией — да", async () => {
    const telegram = api.app.get(TelegramService);
    const progress = api.app.get(ProgressService);
    const db = api.app.get<Db>(DB);
    // 18:30 по Уфе в далёком дне (серии других файлов к нему давно прерваны); урок накануне — серия под угрозой у обоих.
    const now = new Date("2030-03-10T13:30:00Z");
    const yesterday = new Date(now.getTime() - 86_400_000);
    for (const kid of [kids[0]!, kids[1]!]) {
      await db.transaction((tx) =>
        progress.recordLessonCompletion(tx, {
          accountId: kid.account.id,
          accountKind: "child",
          runId: randomUUID(),
          lessonId: "side-lesson",
          kind: "lesson",
          firstAttempts: ["correct"],
          accuracy: 1,
          newWords: 0,
          completionToday: 1,
          completedAt: yesterday,
        }),
      );
    }
    const blocked = await legacyLink(kids[0]!.account.id, true);
    const fine = await link(kids[1]!);
    await pool.query("UPDATE telegram_links SET reminders_enabled = true, reminder_hour = 8 WHERE chat_id = $1", [fine]);
    const batch = await telegram.claimReminders(now);
    expect(batch.day).toBe(ufaDate(now));
    const chats = batch.items.map((i) => i.chatId);
    expect(chats).toContain(String(fine));
    expect(chats).not.toContain(String(blocked));
  });
});

describe("перевыпуск карточки: входы в обход новой карточки снимаются", () => {
  it("карточка места: привязки Telegram и вход по почте детского аккаунта сняты; новая карточка — тот же ученик", async () => {
    const kid = kids[2]!;
    const chat = await link(kid);
    const address = email("side-kid-3");
    await attachEmail(kid, address);
    expect((await api.get<Me>("/me", { token: kid.accessToken })).body).toMatchObject({ emailLogin: true, telegram: { linked: true, chats: 1 } });

    const reissued = await api.post<Schema<"SeatIssueResult">>(`/classes/${classId}/seats/3/reissue`, { token: teacher.accessToken });
    expectStatus(reissued, 200);
    expect(await linksOf(kid.account.id)).toEqual([]);
    const tg = await api.post<Problem>("/auth/telegram", { body: { initData: initData(chat), device: newDevice() } });
    expect([tg.status, tg.body.code]).toEqual([404, "chat_not_linked"]);
    // Вход по той же почте больше не ведёт в аккаунт ученика.
    const viaEmail = await otpLogin(address);
    expect(viaEmail.status).toBe(200);
    expect((viaEmail.body as AuthSession).account.id).not.toBe(kid.account.id);

    const [card] = await api.app.get(ClassesService).printJobCards(principalOf(teacher), classId, reissued.body.printJob.id);
    const again = await api.post<AuthSession>("/auth/qr", { body: { payload: card!.payload, device: newDevice() } });
    expectStatus(again, 200);
    expect(again.body.account).toMatchObject({ id: kid.account.id, telegram: { linked: false, chats: 0 } });
    expect(again.body.account).not.toHaveProperty("emailLogin");
  });

  it("личная карточка «Учусь сам»: перевыпуск снимает привязки Telegram", async () => {
    const solo = await api.post<AuthSession>("/auth/self", { body: { device: newDevice(), nicknameId: "a04.n05", ageBand: "age_11_14" } });
    expectStatus(solo, 201);
    expectStatus(await api.post("/me/login-card", { token: solo.body.accessToken }), 201);
    await link(solo.body);
    expect(await linksOf(solo.body.account.id)).toHaveLength(1);
    expectStatus(await api.post("/me/login-card", { token: solo.body.accessToken }), 201);
    expect(await linksOf(solo.body.account.id)).toEqual([]);
  });
});

describe("привязка Telegram в профиле: GET /me, DELETE /me/telegram, выход на всех устройствах", () => {
  it("Me.telegram — факт и число чатов, без chat_id; DELETE /me/telegram снимает все, повтор — 204", async () => {
    const adult = await api.loginAdult(email("side-adult"));
    expect((await api.get<Me>("/me", { token: adult.accessToken })).body.telegram).toEqual({ linked: false, chats: 0 });
    const a = await link(adult);
    const b = await link(adult);
    const me = await api.get<Me>("/me", { token: adult.accessToken });
    expect(me.body.telegram).toEqual({ linked: true, chats: 2 });
    expect(JSON.stringify(me.body)).not.toContain(String(a));
    expectStatus(await api.del("/me/telegram", { token: adult.accessToken }), 204);
    expectStatus(await api.del("/me/telegram", { token: adult.accessToken }), 204);
    expect(await linksOf(adult.account.id)).toEqual([]);
    const tg = await api.post<Problem>("/auth/telegram", { body: { initData: initData(b), device: newDevice() } });
    expect([tg.status, tg.body.code]).toEqual([404, "chat_not_linked"]);
  });

  it("сотруднику поля telegram нет", async () => {
    const me = await api.get<Me>("/me", { token: moderator.accessToken });
    expect(me.body).not.toHaveProperty("telegram");
  });

  it("«выйти на всех устройствах» снимает и привязки Telegram; обычный выход — нет", async () => {
    const adult = await api.loginAdult(email("side-logout"));
    await link(adult);
    const other = await api.loginAdult(email("side-logout"));
    expectStatus(await api.post("/auth/logout", { token: other.accessToken, body: {} }), 204);
    expect(await linksOf(adult.account.id)).toHaveLength(1);
    expectStatus(await api.post("/auth/logout", { token: adult.accessToken, body: { allDevices: true } }), 204);
    expect(await linksOf(adult.account.id)).toEqual([]);
  });
});

describe("правила на настоящей базе", () => {
  it("заявка учителя от взрослого «Учусь сам» без почты — 409 email_required (ФИО негде хранить)", async () => {
    const grown = await api.post<AuthSession>("/auth/self", { body: { device: newDevice(), nicknameId: "a05.n06", ageBand: "adult" } });
    expectStatus(grown, 201);
    await api.acceptRequiredConsents(grown.body.accessToken);
    const school = await api.demoSchool(grown.body.accessToken);
    const res = await api.post<Problem>("/teacher/verification", { token: grown.body.accessToken, body: { schoolId: school.id, fullName: "Иванова Анна", position: "Учитель" } });
    expect([res.status, res.body.code]).toEqual([409, "email_required"]);
  });

  it("ученик «Учусь сам» — только в одном классе: вторая одобренная заявка в другой класс — 409 already_in_class", async () => {
    const solo = await api.post<AuthSession>("/auth/self", { body: { device: newDevice(), nicknameId: "a06.n07", ageBand: "age_11_14" } });
    expectStatus(solo, 201);
    const teacher2 = await api.verifiedTeacher("side-teacher-2", moderator.accessToken);
    const second = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher2.accessToken, body: { grade: 7, letter: "З", program: "native" } });
    expectStatus(second, 201);
    const codeOf = async (t: AuthSession, id: string) => {
      const res = await api.post<Schema<"JoinCode">>(`/classes/${id}/join-code`, { token: t.accessToken });
      expectStatus(res, 201);
      return res.body.code;
    };
    const join = async (t: AuthSession, id: string) => {
      const ticket = await api.post<Schema<"ClassJoinTicket">>("/me/class-join", { token: solo.body.accessToken, body: { code: await codeOf(t, id) } });
      expectStatus(ticket, 202);
      return ticket.body.requestId;
    };
    const r1 = await join(teacher, classId);
    const r2 = await join(teacher2, second.body.id);
    expectStatus(await api.post(`/classes/${classId}/join-requests/${r1}/approve`, { token: teacher.accessToken }), 200);
    const late = await api.post<Problem>(`/classes/${second.body.id}/join-requests/${r2}/approve`, { token: teacher2.accessToken });
    expect([late.status, late.body.code]).toEqual([409, "already_in_class"]);
  });

  it("задание классу в архиве — 409 class_archived", async () => {
    const t = await api.verifiedTeacher("side-teacher-3", moderator.accessToken);
    const cls = await api.post<Schema<"ClassDetail">>("/classes", { token: t.accessToken, body: { grade: 7, letter: "И", program: "native" } });
    expectStatus(cls, 201);
    await pool.query("UPDATE classes SET status = 'archived' WHERE id = $1", [cls.body.id]);
    const res = await api.post<Problem>(`/classes/${cls.body.id}/assignments`, { token: t.accessToken, body: { kind: "review", dueOn: ufaDate(new Date()) } });
    expect([res.status, res.body.code]).toEqual([409, "class_archived"]);
  });

  it("бумажное согласие завтрашним числом — 422 (сутки по Уфе); сегодняшним — 201", async () => {
    const tomorrow = ufaDate(new Date(Date.now() + 86_400_000));
    const res = await api.post<Problem>(`/classes/${classId}/seats/4/paper-consent`, { token: teacher.accessToken, body: { signedOn: tomorrow } });
    expect([res.status, res.body.errors?.[0]?.pointer]).toEqual([422, "/signedOn"]);
    expectStatus(await api.post(`/classes/${classId}/seats/4/paper-consent`, { token: teacher.accessToken, body: { signedOn: ufaDate(new Date()) } }), 201);
  });

  it("курсоры страниц — с микросекундами: записи одной миллисекунды не теряются и не повторяются", async () => {
    // Пять записей аудита одной миллисекунды с разными микросекундами — и очередь модератора так же.
    // Действие аудита — только латиница и точки (CHECK audit_log_action_format): цифры случайного id — буквами.
    const action = `it.cursor.${randomUUID().slice(0, 8).replace(/\d/g, (d) => "ghijklmnop"[Number(d)]!)}`;
    const base = "2026-11-15 10:00:00.123";
    for (const us of ["100", "200", "300", "400", "500"]) {
      await pool.query("INSERT INTO audit_log (id, action, metadata, created_at) VALUES ($1, $2, '{}', $3::timestamptz)", [randomUUID(), action, `${base}${us}+00`]);
    }
    const admin = await api.loginStaff("admin");
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await api.get<Schema<"AuditLogPage">>(`/admin/audit-log?action=${action}&limit=2${cursor ? `&cursor=${cursor}` : ""}`, { token: admin.accessToken });
      expectStatus(res, 200);
      seen.push(...res.body.items.map((i) => i.id));
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });
});
