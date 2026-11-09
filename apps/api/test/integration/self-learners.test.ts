// «Учусь сам» (ADR 0022) — настоящее приложение против Docker-стека. Поток самостоятельного ученика без школы и без
// ПДн: аккаунт по нику и возрастному диапазону → урок с голосом в дуэли (voter_group child / adult) → группа лиги
// ровесников → цель дня → личная карточка: вход с другого устройства, перевыпуск (старая — card_revoked, другие
// сессии — завершены) → вступление в класс по коду с одобрением учителя (тот же аккаунт на месте) → отзыв согласия
// закрывает и вход по личной карточке. Взрослый: почта по желанию (карточка отзывается), вход по почте → «Учиться».
// Ребёнку почта разрешена по решению владельца (ADR 0022 §10): сам адрес не хранится, только ключ входа.
import { fileURLToPath } from "node:url";
import { buildPersonalCardPayload, parseLoginCard } from "@teletau/auth-codes";
import type { Schema } from "@teletau/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "../../src/common/uuidv7.js";
import { buildCourse, importCourse, readContent } from "../../src/modules/content/content-import.js";
import { importDuels } from "../../src/modules/corpus/duels-import.js";
import { scanPdf } from "../support/pdf-qr.js";
import { bootApi, DEMO_CODE, email, expectStatus, newDevice, randomIp, type AuthSession, type Device, type TestApi } from "./harness.js";

type Problem = Schema<"Problem">;
type Me = Schema<"Me">;
type Run = Schema<"LessonRun">;
type Card = Schema<"LoginCard">;

const FIXTURE = fileURLToPath(new URL("../fixtures/content/", import.meta.url));

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;
let moderator: AuthSession;

beforeAll(async () => {
  ({ api, pool, close } = await bootApi());
  moderator = await api.loginStaff("moderator");
  await importCourse(pool, buildCourse(readContent(FIXTURE)[0]!), { force: true });
  await importDuels(pool, { dir: `${FIXTURE}corpus/duels`, sourcesFile: `${FIXTURE}sources.yaml` });
});

afterAll(async () => {
  await close?.();
});

const signup = async (ageBand: Schema<"AgeBand">, extra: Partial<Schema<"SelfSignupRequest">> = {}, device: Device = newDevice()) => {
  const res = await api.post<AuthSession>("/auth/self", { body: { device, nicknameId: "a03.n02", ageBand, ...extra }, ip: randomIp() });
  expectStatus(res, 201);
  return { ...res.body, device };
};

const tilesOf = (e: Schema<"TilesExercise">, ...texts: string[]) => texts.map((t) => e.tiles.find((x) => x.text === t)!.id);

/**
 * Урок синтетического курса целиком верно (как passAll в m2-learning.test.ts): по умолчанию t-l1 — первый урок, в нём
 * дуэлей нет (docs/02 §3). Дуэль (у «Помоги языку» t-help) — голос `duel`: «Не знаю», чтобы не решить пару за другие
 * файлы прогона (пул дуэлей юнита общий, ADR 0019).
 */
async function passFirstLesson(who: AuthSession, duel: Schema<"DuelChoice"> = "skip", lessonId = "t-l1"): Promise<Schema<"LessonRunSummary">> {
  const runId = uuidv7();
  const started = await api.post<Run>(`/lessons/${lessonId}/runs`, { token: who.accessToken, body: { runId } });
  expectStatus(started, 201);
  for (const e of started.body.exercises) {
    const answer: Schema<"AttemptAnswer"> =
      e.type === "duel"
        ? { type: "duel", choice: duel }
        : e.type === "choice_ba_ru"
          ? { type: "choice", optionId: e.options.find((o) => ["Значение Б", "Значение К"].includes(o.textRu))!.id }
          : e.type === "tiles_ru_ba"
            ? { type: "tiles", tileIds: e.promptRu === "Синтетика А" ? tilesOf(e, "Пиҡол", "тумә") : tilesOf(e, "ғарыҙ", "һөлөк") }
            : { type: "text", text: (e as Schema<"FreeInputExercise">).promptRu === "Синтетика Д" ? "ҡаҙым" : (e as Schema<"FreeInputExercise">).promptRu === "Синтетика Е" ? "сәлдерәм" : "тумә" };
    expectStatus(await api.post(`/lesson-runs/${runId}/attempts`, { token: who.accessToken, body: { attemptId: uuidv7(), exerciseId: e.id, answer, latencyMs: 900 } }), 200);
  }
  const done = await api.post<Schema<"LessonRunSummary">>(`/lesson-runs/${runId}/complete`, { token: who.accessToken });
  expectStatus(done, 200);
  return done.body;
}

const leagueGroupOf = async (accountId: string) =>
  (await pool.query<{ age_group: string }>("SELECT g.age_group::text FROM league_members m JOIN league_groups g ON g.id = m.group_id WHERE m.account_id = $1", [accountId])).rows.map((r) => r.age_group);
const voterGroupsOf = async (accountId: string) =>
  (await pool.query<{ voter_group: string }>("SELECT DISTINCT voter_group::text FROM judgments WHERE judge_account_id = $1", [accountId])).rows.map((r) => r.voter_group);

describe("«Учусь сам» — an account without a school and without personal data (ADR 0022)", () => {
  it("child bands make a child student account with the age mode; adult — an adult account without e-mail", async () => {
    const kid = await signup("age_7_10", { dailyGoal: 1 });
    expect(kid.account).toMatchObject({ kind: "child", roles: ["student"], nickname: "Мудрая сова", uiMode: "bee", ageBand: "age_7_10", dailyGoal: 1, loginCard: "none", classes: [] });
    expect(kid.account).not.toHaveProperty("profile");
    const teen = await signup("age_15_17");
    expect(teen.account).toMatchObject({ kind: "child", uiMode: "keeper", ageBand: "age_15_17" });
    expect(teen.account).not.toHaveProperty("dailyGoal");
    const grown = await signup("adult");
    expect(grown.account).toMatchObject({ kind: "adult", roles: [], nickname: "Мудрая сова", uiMode: "keeper", ageBand: "adult", loginCard: "none", teacherStatus: "none" });
    expect(grown.account).not.toHaveProperty("profile");
    // В базе нет ничего о возрасте по годам и ни строки ПДн.
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM pii.adult_profiles WHERE account_id = $1", [grown.account.id]);
    expect(rows[0].n).toBe(0);
  });

  it("422 for a nickname not from the dictionary or an unknown band; 429 after 20 accounts an hour from one IP", async () => {
    const bad = await api.post<Problem>("/auth/self", { body: { device: newDevice(), nicknameId: "a99.n99", ageBand: "age_11_14" } });
    expect([bad.status, bad.body.errors?.[0]?.pointer]).toEqual([422, "/nicknameId"]);
    expect((await api.post("/auth/self", { body: { device: newDevice(), nicknameId: "a00.n00", ageBand: "age_5" } })).status).toBe(422);
    const ip = randomIp();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await api.post("/auth/self", { body: { device: newDevice(), nicknameId: "a00.n00", ageBand: "age_11_14" }, ip })).status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(20);
    expect(statuses.at(-1)).toBe(429);
  });

  it("learns on the same trail: lesson summary with the chosen daily goal; votes as child / adult; leagues of peers", async () => {
    const kid = await signup("age_11_14", { dailyGoal: 3 });
    const grown = await signup("adult");
    const summary = await passFirstLesson(kid);
    expect(summary.dailyGoal).toMatchObject({ target: 3, done: 1, met: false });
    await passFirstLesson(grown);
    // Голоса — в «Помоги языку» (в первом уроке дуэлей нет); «Помоги языку» в цель дня не идёт.
    expect((await passFirstLesson(kid, "skip", "t-help")).votes).toBe(0);
    await passFirstLesson(grown, "skip", "t-help");
    expect(await voterGroupsOf(kid.account.id)).toEqual(["child"]);
    expect(await voterGroupsOf(grown.account.id)).toEqual(["adult"]);
    expect(await leagueGroupOf(kid.account.id)).toEqual(["child_11_14"]);
    expect(await leagueGroupOf(grown.account.id)).toEqual(["adult"]);
    // Цель дня меняется в профиле.
    const patched = await api.patch<Me>("/me", { token: kid.accessToken, body: { dailyGoal: 1 } });
    expect(patched.body.dailyGoal).toBe(1);
    const progress = await api.get<Schema<"MyProgress">>("/me/progress", { token: kid.accessToken });
    expect(progress.body.dailyGoal).toMatchObject({ target: 1, done: 1, met: true });
  });

  it("a school student of grade 5 lands in the 11–14 league group too — children compete with peers", async () => {
    const teacher = await api.verifiedTeacher("self-league", moderator.accessToken, 1);
    const c = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher.accessToken, body: { grade: 5, letter: "Ю", program: "native" } });
    expectStatus(c, 201);
    const seats = await api.post<Schema<"SeatIssueResult">>(`/classes/${c.body.id}/seats`, { token: teacher.accessToken, body: { count: 1 } });
    const payload = (await scanPdf((await api.get(seats.body.printJob.pdfPath, { token: teacher.accessToken })).raw)).qr[0]![0]!;
    const student = (await api.post<AuthSession>("/auth/qr", { body: { payload, device: newDevice() } })).body;
    expect(student.account.ageBand).toBe("age_11_14");
    expect(student.account).not.toHaveProperty("loginCard");
    await passFirstLesson(student);
    expect(await leagueGroupOf(student.account.id)).toEqual(["child_11_14"]);
  });
});

describe("personal login card — another device without personal data (ADR 0022)", () => {
  let kid: AuthSession & { device: Device };
  let card: Card;
  let tablet: AuthSession;

  it("none yet — 404; issue — a TP1 card; GET shows the same payload to the owner", async () => {
    kid = await signup("age_11_14");
    expect((await api.get<Problem>("/me/login-card", { token: kid.accessToken })).status).toBe(404);
    const issued = await api.post<Card>("/me/login-card", { token: kid.accessToken });
    expectStatus(issued, 201);
    card = issued.body;
    expect(card.version).toBe(1);
    expect(parseLoginCard(card.payload)).toMatchObject({ ok: true, kind: "personal" });
    expect((await api.get<Card>("/me/login-card", { token: kid.accessToken })).body).toEqual(card);
    expect((await api.get<Me>("/me", { token: kid.accessToken })).body.loginCard).toBe("issued");
    // Секрет — не в открытом виде: в базе хеш и шифртекст.
    const secret = parseLoginCard(card.payload).ok ? (parseLoginCard(card.payload) as { secret: string }).secret : "";
    const { rows } = await pool.query<{ secret_hash: string; secret_enc: string }>("SELECT secret_hash, secret_enc FROM login_cards WHERE account_id = $1", [kid.account.id]);
    expect(JSON.stringify(rows)).not.toContain(secret);
  });

  it("logs in on another device into the same account; seat and personal cards do not mix", async () => {
    const res = await api.post<AuthSession>("/auth/login-card", { body: { payload: card.payload, device: newDevice() } });
    expectStatus(res, 200);
    tablet = res.body;
    expect(tablet.account).toMatchObject({ id: kid.account.id, nickname: kid.account.nickname, loginCard: "issued" });
    const asSeat = await api.post<Problem>("/auth/qr", { body: { payload: card.payload, device: newDevice() } });
    expect([asSeat.status, asSeat.body.code]).toEqual([422, "payload_invalid"]);
    const swapped = await api.post<Problem>("/auth/login-card", { body: { payload: card.payload.replace(/^TP1/, "TT1"), device: newDevice() } });
    expect([swapped.status, swapped.body.code]).toEqual([422, "payload_invalid"]);
    const parsed = parseLoginCard(card.payload) as { handle: string };
    const forged = await api.post<Problem>("/auth/login-card", { body: { payload: forge(parsed.handle), device: newDevice() } });
    expect([forged.status, forged.body.code]).toEqual([401, "card_invalid"]);
  });

  it("reissue: the old card is card_revoked, sessions on other devices end, the current one stays", async () => {
    const again = await api.post<Card>("/me/login-card", { token: kid.accessToken });
    expectStatus(again, 201);
    expect(again.body.version).toBe(2);
    expect(again.body.payload).not.toBe(card.payload);
    const old = await api.post<Problem>("/auth/login-card", { body: { payload: card.payload, device: newDevice() } });
    expect([old.status, old.body.code]).toEqual([403, "card_revoked"]);
    expect((await api.get("/me", { token: tablet.accessToken })).status).toBe(401);
    expect((await api.get("/me", { token: kid.accessToken })).status).toBe(200);
    const audit = await pool.query("SELECT metadata FROM audit_log WHERE action = 'login_card.reissued' AND target_id = $1", [kid.account.id]);
    expect(audit.rows[0].metadata).toMatchObject({ version: 2, sessionsRevoked: 1 });
    card = again.body;
  });

  it("a school student and a teacher get no personal card — 403 login_card_unavailable", async () => {
    const teacher = await api.verifiedTeacher("self-card-teacher", moderator.accessToken, 1);
    for (const token of [teacher.accessToken]) {
      const r = await api.post<Problem>("/me/login-card", { token });
      expect([r.status, r.body.code]).toEqual([403, "login_card_unavailable"]);
    }
  });

  it("joins a class by code: the teacher approves, the seat gets the same account; then consent revoke closes the card login too", async () => {
    const teacher = await api.verifiedTeacher("self-join", moderator.accessToken, 1);
    const c = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher.accessToken, body: { grade: 6, letter: "Я", program: "native" } });
    const code = await api.post<Schema<"JoinCode">>(`/classes/${c.body.id}/join-code`, { token: teacher.accessToken });
    // Неверный код (не «000-000»: им может быть постоянный код стенда, AUTH_DEMO_CLASS_CODE в другом файле прогона).
    expect((await api.post<Problem>("/me/class-join", { token: kid.accessToken, body: { code: "Z9Z-9Z9" } })).status).toBe(404);
    const ticket = await api.post<Schema<"ClassJoinTicket">>("/me/class-join", { token: kid.accessToken, body: { code: code.body.display } });
    expectStatus(ticket, 202);
    expect(ticket.body).toMatchObject({ status: "pending", class: { title: "6 «Я»", grade: 6 } });
    expect(ticket.body).not.toHaveProperty("pollToken");
    const pending = await api.get<Schema<"JoinRequestList">>(`/classes/${c.body.id}/join-requests?status=pending`, { token: teacher.accessToken });
    expect(pending.body.items.map((r) => r.nickname)).toEqual([kid.account.nickname]);
    expectStatus(await api.post(`/classes/${c.body.id}/join-requests/${ticket.body.requestId}/approve`, { token: teacher.accessToken }), 200);
    const status = await api.get<Schema<"ClassJoinTicket">>(`/me/class-join/${ticket.body.requestId}`, { token: kid.accessToken });
    expect(status.body.status).toBe("approved");
    const me = await api.get<Me>("/me", { token: kid.accessToken });
    expect(me.body.classes).toEqual([expect.objectContaining({ id: c.body.id, role: "student", seatNumber: 1 })]);
    // Тот же аккаунт: мёд и прогресс остаются; режим, выбранный по возрасту, вход по классу не меняет.
    expect(me.body).toMatchObject({ id: kid.account.id, uiMode: "bortnik", loginCard: "issued" });
    const detail = await api.get<Schema<"ClassDetail">>(`/classes/${c.body.id}`, { token: teacher.accessToken });
    expect(detail.body.seats?.[0]).toMatchObject({ number: 1, student: { nickname: kid.account.nickname } });
    const second = await api.post<Problem>("/me/class-join", { token: kid.accessToken, body: { code: code.body.display } });
    expect([second.status, second.body.code]).toEqual([409, "already_in_class"]);
    // Чужая заявка неотличима от несуществующей.
    const other = await signup("age_11_14");
    expect((await api.get(`/me/class-join/${ticket.body.requestId}`, { token: other.accessToken })).status).toBe(404);

    // Родитель отозвал бумажное согласие места — вход по личной карточке закрыт так же, как по карточке места.
    const paper = await api.post<Schema<"Consent">>(`/classes/${c.body.id}/seats/1/paper-consent`, { token: teacher.accessToken });
    expectStatus(paper, 201);
    expectStatus(await api.post(`/consents/${paper.body.id}/revoke`, { token: teacher.accessToken }), 200);
    const blocked = await api.post<Problem>("/auth/login-card", { body: { payload: card.payload, device: newDevice() } });
    expect([blocked.status, blocked.body.code]).toEqual([403, "consent_revoked"]);
  });
});

describe("adults: e-mail is optional, the teacher application only by choice (ADR 0022)", () => {
  it("a self-learner adult saves progress by e-mail: card revoked, then logs in by e-mail into the same account", async () => {
    const grown = await signup("adult");
    const issued = await api.post<Card>("/me/login-card", { token: grown.accessToken });
    expectStatus(issued, 201);
    const address = email("self-adult");
    const ch = await api.post<Schema<"OtpChallenge">>("/auth/otp/request", { body: { email: address }, ip: randomIp() });
    const wrong = await api.post<Problem>("/me/email", { token: grown.accessToken, body: { challengeId: ch.body.challengeId, code: "9999" } });
    expect([wrong.status, wrong.body.code]).toEqual([401, "otp_invalid"]);
    const attached = await api.post<Me>("/me/email", { token: grown.accessToken, body: { challengeId: ch.body.challengeId, code: DEMO_CODE } });
    expectStatus(attached, 200);
    expect(attached.body.profile).toEqual({ email: address });
    expect(attached.body).not.toHaveProperty("loginCard");
    const old = await api.post<Problem>("/auth/login-card", { body: { payload: issued.body.payload, device: newDevice() } });
    expect([old.status, old.body.code]).toEqual([403, "card_revoked"]);
    const viaEmail = await api.loginAdult(address);
    expect(viaEmail.account).toMatchObject({ id: grown.account.id, nickname: grown.account.nickname, ageBand: "adult", teacherStatus: "none" });

    // Тот же адрес другому аккаунту — 409 email_in_use.
    const another = await signup("adult");
    const ch2 = await api.post<Schema<"OtpChallenge">>("/auth/otp/request", { body: { email: address }, ip: randomIp() });
    const taken = await api.post<Problem>("/me/email", { token: another.accessToken, body: { challengeId: ch2.body.challengeId, code: DEMO_CODE } });
    expect([taken.status, taken.body.code]).toEqual([409, "email_in_use"]);
  });

  it("a child attaches e-mail as well (owner decision, ADR 0022 §10): address is not stored, card revoked, e-mail opens the same account", async () => {
    const kid = await signup("age_15_17");
    const issued = await api.post<Card>("/me/login-card", { token: kid.accessToken });
    expectStatus(issued, 201);
    const address = email("self-kid");
    const ch = await api.post<Schema<"OtpChallenge">>("/auth/otp/request", { body: { email: address }, ip: randomIp() });
    const attached = await api.post<Me>("/me/email", { token: kid.accessToken, body: { challengeId: ch.body.challengeId, code: DEMO_CODE } });
    expectStatus(attached, 200);
    expect(attached.body.emailLogin).toBe(true);
    expect(attached.body).not.toHaveProperty("profile");
    expect(attached.body).not.toHaveProperty("loginCard");
    // Сам адрес не хранится: у детского аккаунта нет строки в pii (миграция 0002) — только ключ входа в credentials.
    const piiRows = await pool.query<{ count: string }>("select count(*)::text as count from pii.adult_profiles where account_id = $1", [kid.account.id]);
    expect(piiRows.rows[0]!.count).toBe("0");
    // Вход по почте — тот же детский аккаунт (ник и прогресс на месте).
    const viaEmail = await api.loginAdult(address);
    expect(viaEmail.account).toMatchObject({ id: kid.account.id, nickname: kid.account.nickname });
    // Личная карточка отозвана — вход по почте теперь единственный способ возврата.
    const old = await api.post<Problem>("/auth/login-card", { body: { payload: issued.body.payload, device: newDevice() } });
    expect([old.status, old.body.code]).toEqual([403, "card_revoked"]);
  });

  it("an adult who logged in by e-mail chooses «Учиться»: nickname and band via PATCH /me, no teacher application", async () => {
    const adult = await api.loginAdult(email("self-email-learner"));
    expect(adult.account).not.toHaveProperty("nickname");
    expect(adult.account).not.toHaveProperty("ageBand");
    const chosen = await api.patch<Me>("/me", { token: adult.accessToken, body: { nicknameId: "a05.n06", ageBand: "adult", dailyGoal: 2 } });
    expectStatus(chosen, 200);
    expect(chosen.body).toMatchObject({ nickname: expect.any(String), ageBand: "adult", uiMode: "keeper", dailyGoal: 2, teacherStatus: "none" });
    expect(chosen.body).not.toHaveProperty("loginCard");
    const child = await api.patch<Problem>("/me", { token: adult.accessToken, body: { ageBand: "age_11_14" } });
    expect([child.status, child.body.errors?.[0]?.pointer]).toEqual([422, "/ageBand"]);
    expect((await api.get(`/teacher/verification`, { token: adult.accessToken })).status).toBe(404);
  });
});

/** Карточка с существующим идентификатором и чужим секретом, но верной контрольной суммой — проверка секрета, а не разбора. */
const forge = (handle: string): string => buildPersonalCardPayload(handle, "0".repeat(26));
