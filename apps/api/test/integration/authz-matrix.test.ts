// Матрица авторизации (ADR 0017 §4, критерий приёмки 4). Все операции берутся из контракта (openapi.yaml →
// @teletau/contracts/openapi.json); у каждой должна быть строка в MATRIX, иначе тест падает. Для каждой строки:
//  • аноним → 401 (если операция закрытая);
//  • чужая роль → 403 (если x-access ограничивает роли) — и тест сверяет, что роль действительно не из x-access;
//  • чужой ресурс → 403 (или 404, где существование скрыто: заявка по X-Poll-Token) — для политик ABAC,
//    и тест сверяет, что роль «чужого» разрешена x-access (отказ — именно от политики).
// Проверки без побочных эффектов: все запросы отвергаются до изменения данных.
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { OperationId, Schema } from "@teletau/contracts";
import { ufaDate } from "@teletau/domain-rules";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasAccessRole, type Principal } from "../../src/common/auth.js";
import { contractOperations, type ContractOperation } from "../../src/common/contract.js";
import { buildCourse, importCourse, readContent } from "../../src/modules/content/content-import.js";
import { scanPdf } from "../support/pdf-qr.js";
import { bootApi, email, expectStatus, newDevice, type AuthSession, type TestApi } from "./harness.js";

type Who = "student" | "studentB" | "adult" | "adultB" | "teacher" | "teacherB" | "moderator" | "admin" | "ministry" | "fund";

interface Fixture {
  classA: string;
  classB: string;
  printJobA: string;
  joinRequestA: string;
  pollRequestId: string;
  paperConsentA: string;
  electronicConsentA: string;
  verificationPending: string;
  schoolA: string;
  /** Забег ученика A по уроку синтетического курса (test/fixtures/content). */
  runA: string;
  /** Задание класса A (повторение слов) и срок для новых заданий — сегодня по Уфе. */
  assignmentA: string;
  dueOn: string;
  /** Заявка в класс A ученика «Учусь сам» (POST /me/class-join, ADR 0022). */
  classJoinRequest: string;
}

interface Req {
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

type Check<S extends number> = { as: Who | "anonymous"; status: S; req?: (f: Fixture) => Req; note?: string } | { na: string };

interface Row {
  req: (f: Fixture) => Req;
  anonymous: 401 | { na: string };
  wrongRole: Check<403>;
  foreign: Check<403 | 404>;
}

const CONTENT_FIXTURE = fileURLToPath(new URL("../fixtures/content/", import.meta.url));
const NA_PUBLIC = { na: "открытая операция (x-access: anonymous)" };
const NA_ANY = { na: "любой вошедший (x-access: any)" };
const NA_SELF = { na: "политика self: ресурс — сам вызывающий, чужого нет" };
const NA_NO_POLICY = { na: "без политики ресурса" };
const NA_SERVICE = { na: "служебная операция бота (x-access: service): ресурса пользователя нет" };
const device = () => ({ installId: randomUUID(), platform: "web" });

const MATRIX: Record<OperationId, Row> = {
  getHealth: { req: () => ({ path: "/health" }), anonymous: NA_PUBLIC, wrongRole: NA_PUBLIC, foreign: NA_PUBLIC },
  loginWithQrCard: { req: () => ({ path: "/auth/qr" }), anonymous: NA_PUBLIC, wrongRole: NA_PUBLIC, foreign: NA_PUBLIC },
  requestClassCodeLogin: { req: () => ({ path: "/auth/class-code" }), anonymous: NA_PUBLIC, wrongRole: NA_PUBLIC, foreign: NA_PUBLIC },
  getClassCodeLoginStatus: {
    req: (f) => ({ path: `/auth/class-code/${f.pollRequestId}` }),
    anonymous: NA_PUBLIC,
    wrongRole: NA_PUBLIC,
    foreign: {
      as: "anonymous",
      status: 404,
      note: "чужой X-Poll-Token неотличим от несуществующей заявки",
      req: (f) => ({ path: `/auth/class-code/${f.pollRequestId}`, headers: { "x-poll-token": "ttp_not-the-token-of-this-request" } }),
    },
  },
  requestEmailOtp: { req: () => ({ path: "/auth/otp/request" }), anonymous: NA_PUBLIC, wrongRole: NA_PUBLIC, foreign: NA_PUBLIC },
  verifyEmailOtp: { req: () => ({ path: "/auth/otp/verify" }), anonymous: NA_PUBLIC, wrongRole: NA_PUBLIC, foreign: NA_PUBLIC },
  refreshSession: { req: () => ({ path: "/auth/refresh" }), anonymous: NA_PUBLIC, wrongRole: NA_PUBLIC, foreign: NA_PUBLIC },
  logout: { req: () => ({ path: "/auth/logout", body: {} }), anonymous: 401, wrongRole: NA_ANY, foreign: NA_SELF },
  getMe: { req: () => ({ path: "/me" }), anonymous: 401, wrongRole: NA_ANY, foreign: NA_SELF },
  updateMe: { req: () => ({ path: "/me", body: { locale: "ru" } }), anonymous: 401, wrongRole: NA_ANY, foreign: NA_SELF },
  suggestNicknames: { req: () => ({ path: "/nicknames/suggest" }), anonymous: NA_PUBLIC, wrongRole: NA_PUBLIC, foreign: NA_PUBLIC },
  listDistricts: { req: () => ({ path: "/districts" }), anonymous: 401, wrongRole: NA_ANY, foreign: NA_NO_POLICY },
  listSchools: { req: () => ({ path: "/schools" }), anonymous: 401, wrongRole: NA_ANY, foreign: NA_NO_POLICY },
  createClass: {
    req: () => ({ path: "/classes", body: { grade: 9, letter: "В", program: "elective" } }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403 },
    foreign: {
      as: "teacherB",
      status: 403,
      note: "школа другого учителя — school_not_allowed",
      req: (f) => ({ path: "/classes", body: { schoolId: f.schoolA, grade: 9, letter: "В", program: "elective" } }),
    },
  },
  listClasses: { req: () => ({ path: "/classes" }), anonymous: 401, wrongRole: NA_ANY, foreign: NA_SELF },
  getClass: { req: (f) => ({ path: `/classes/${f.classA}` }), anonymous: 401, wrongRole: { as: "adult", status: 403 }, foreign: { as: "teacherB", status: 403 } },
  issueSeats: {
    req: (f) => ({ path: `/classes/${f.classA}/seats`, body: { count: 1 } }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403 },
    foreign: { as: "teacherB", status: 403 },
  },
  getClassCardsPdf: {
    req: (f) => ({ path: `/classes/${f.classA}/cards.pdf?printJob=${f.printJobA}` }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403 },
    foreign: { as: "teacherB", status: 403 },
  },
  reissueSeatCard: {
    req: (f) => ({ path: `/classes/${f.classA}/seats/1/reissue` }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403 },
    foreign: { as: "teacherB", status: 403 },
  },
  createClassJoinCode: {
    req: (f) => ({ path: `/classes/${f.classA}/join-code` }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403 },
    foreign: { as: "teacherB", status: 403 },
  },
  closeClassJoinCode: {
    req: (f) => ({ path: `/classes/${f.classA}/join-code` }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403 },
    foreign: { as: "teacherB", status: 403 },
  },
  listClassJoinRequests: {
    req: (f) => ({ path: `/classes/${f.classA}/join-requests` }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403 },
    foreign: { as: "teacherB", status: 403 },
  },
  approveJoinRequest: {
    req: (f) => ({ path: `/classes/${f.classA}/join-requests/${f.joinRequestA}/approve` }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403 },
    foreign: { as: "teacherB", status: 403 },
  },
  rejectJoinRequest: {
    req: (f) => ({ path: `/classes/${f.classA}/join-requests/${f.joinRequestA}/reject` }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403 },
    foreign: { as: "teacherB", status: 403 },
  },
  submitTeacherVerification: {
    req: (f) => ({ path: "/teacher/verification", body: { schoolId: f.schoolA, fullName: "Иванова Мария Петровна", position: "Учитель" } }),
    anonymous: 401,
    wrongRole: { as: "moderator", status: 403, note: "сотрудник не подаёт заявку учителя" },
    foreign: NA_SELF,
  },
  getMyTeacherVerification: { req: () => ({ path: "/teacher/verification" }), anonymous: 401, wrongRole: { as: "student", status: 403 }, foreign: NA_SELF },
  listTeacherVerifications: {
    req: () => ({ path: "/moderation/teacher-verifications" }),
    anonymous: 401,
    wrongRole: { as: "teacher", status: 403 },
    foreign: NA_NO_POLICY,
  },
  approveTeacherVerification: {
    req: (f) => ({ path: `/moderation/teacher-verifications/${f.verificationPending}/approve` }),
    anonymous: 401,
    wrongRole: { as: "teacher", status: 403 },
    foreign: NA_NO_POLICY,
  },
  rejectTeacherVerification: {
    req: (f) => ({ path: `/moderation/teacher-verifications/${f.verificationPending}/reject`, body: { reason: "Не та школа" } }),
    anonymous: 401,
    wrongRole: { as: "adult", status: 403 },
    foreign: NA_NO_POLICY,
  },
  listCurrentLegalDocuments: { req: () => ({ path: "/legal-documents/current" }), anonymous: NA_PUBLIC, wrongRole: NA_PUBLIC, foreign: NA_PUBLIC },
  getLegalDocument: { req: () => ({ path: "/legal-documents/terms/2026-11-01" }), anonymous: NA_PUBLIC, wrongRole: NA_PUBLIC, foreign: NA_PUBLIC },
  acceptConsents: {
    req: () => ({ path: "/consents", body: { documentIds: [randomUUID()] } }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403 },
    foreign: NA_SELF,
  },
  recordPaperConsent: {
    req: (f) => ({ path: `/classes/${f.classA}/seats/3/paper-consent`, body: {} }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403 },
    foreign: { as: "teacherB", status: 403 },
  },
  revokeConsent: {
    req: (f) => ({ path: `/consents/${f.paperConsentA}/revoke` }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403 },
    foreign: { as: "teacherB", status: 403, note: "бумажное согласие чужого класса" },
  },
  listAuditLog: { req: () => ({ path: "/admin/audit-log" }), anonymous: 401, wrongRole: { as: "teacher", status: 403 }, foreign: NA_NO_POLICY },

  // ── Кабинет министерства и словарь для Фонда (ADR 0023): только свои роли, ресурсов пользователя нет ──
  getRepublicSummary: {
    req: () => ({ path: "/ministry/summary" }),
    anonymous: 401,
    wrongRole: { as: "admin", status: 403, note: "даже администратор без роли ministry" },
    foreign: NA_NO_POLICY,
  },
  listRepublicDistricts: { req: () => ({ path: "/ministry/districts" }), anonymous: 401, wrongRole: { as: "teacher", status: 403 }, foreign: NA_NO_POLICY },
  getRepublicDistrict: {
    req: () => ({ path: `/ministry/districts/${randomUUID()}` }),
    anonymous: 401,
    wrongRole: { as: "fund", status: 403, note: "роль Фонда не открывает кабинет министерства" },
    foreign: NA_NO_POLICY,
  },
  getFundDictionary: {
    req: () => ({ path: "/fund/dictionary" }),
    anonymous: 401,
    wrongRole: { as: "ministry", status: 403, note: "министерство видит только агрегаты, не словарь" },
    foreign: NA_NO_POLICY,
  },
  listEscalatedItems: {
    req: () => ({ path: "/fund/escalated" }),
    anonymous: 401,
    wrongRole: { as: "moderator", status: 403, note: "спорные случаи — только Фонд (ТЗ §4.4/§5)" },
    foreign: NA_NO_POLICY,
  },

  // ── Тропа, уроки, мотивация, дуэли. Отказы 401/403 — до обработчика (x-access) или от политики ресурса;
  // чужой забег урока (политика self) неотличим от несуществующего — 404 (настоящий забег ученика A, fixture.runA). ──
  getCourse: { req: () => ({ path: "/course" }), anonymous: 401, wrongRole: { as: "moderator", status: 403, note: "сотрудник не проходит курс" }, foreign: NA_NO_POLICY },
  startLessonRun: {
    req: () => ({ path: "/lessons/u01-privet/runs", body: { runId: randomUUID() } }),
    anonymous: 401,
    wrongRole: { as: "admin", status: 403 },
    foreign: NA_NO_POLICY,
  },
  submitLessonAttempt: {
    req: (f) => ({ path: `/lesson-runs/${f.runA}/attempts`, body: { attemptId: randomUUID(), exerciseId: "e1", answer: { type: "text", text: "x" } } }),
    anonymous: 401,
    wrongRole: { as: "moderator", status: 403 },
    foreign: { as: "studentB", status: 404, note: "забег ученика A: чужой забег неотличим от несуществующего" },
  },
  getLessonPreview: {
    req: () => ({ path: "/lessons/t-l1/preview" }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403, note: "«Что в уроке» — только учителю: ученик не видит ответы заданий" },
    foreign: NA_NO_POLICY,
  },
  completeLessonRun: {
    req: (f) => ({ path: `/lesson-runs/${f.runA}/complete` }),
    anonymous: 401,
    wrongRole: { as: "moderator", status: 403 },
    foreign: { as: "studentB", status: 404, note: "забег ученика A: чужой забег неотличим от несуществующего" },
  },
  getMyProgress: { req: () => ({ path: "/me/progress" }), anonymous: 401, wrongRole: { as: "admin", status: 403 }, foreign: NA_SELF },
  getClassProgress: {
    req: (f) => ({ path: `/classes/${f.classA}/progress` }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403 },
    foreign: { as: "teacherB", status: 403 },
  },
  getSeatProgress: {
    req: (f) => ({ path: `/classes/${f.classA}/seats/1/progress` }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403, note: "ученик не видит карточку одноклассника" },
    foreign: { as: "teacherB", status: 403 },
  },
  // ── Задания учителя (ADR 0021): только учитель этого класса. Задание A — настоящее (fixture.assignmentA). ──
  listClassAssignments: {
    req: (f) => ({ path: `/classes/${f.classA}/assignments` }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403 },
    foreign: { as: "teacherB", status: 403 },
  },
  createClassAssignment: {
    req: (f) => ({ path: `/classes/${f.classA}/assignments`, body: { kind: "review", dueOn: f.dueOn } }),
    anonymous: 401,
    wrongRole: { as: "adult", status: 403, note: "взрослый без роли учителя" },
    foreign: { as: "teacherB", status: 403 },
  },
  cancelClassAssignment: {
    req: (f) => ({ path: `/classes/${f.classA}/assignments/${f.assignmentA}` }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403 },
    foreign: { as: "teacherB", status: 403 },
  },
  getCurrentLeague: { req: () => ({ path: "/leagues/current" }), anonymous: 401, wrongRole: { as: "moderator", status: 403 }, foreign: NA_NO_POLICY },
  markLeagueResultSeen: {
    req: () => ({ path: "/leagues/result-seen", body: { weekStart: "2026-11-02" } }),
    anonymous: 401,
    wrongRole: { as: "moderator", status: 403 },
    foreign: NA_NO_POLICY,
  },
  getClassHive: { req: (f) => ({ path: `/classes/${f.classA}/hive` }), anonymous: 401, wrongRole: NA_ANY, foreign: { as: "studentB", status: 403, note: "ученик чужого класса" } },
  listCorpusDuels: { req: () => ({ path: "/corpus/duels" }), anonymous: 401, wrongRole: { as: "student", status: 403, note: "дети голосуют только в уроке" }, foreign: NA_NO_POLICY },
  submitCorpusJudgment: {
    req: () => ({ path: "/corpus/judgments", body: { judgmentId: randomUUID(), itemId: randomUUID(), shown: [randomUUID(), randomUUID()], choice: "a" } }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403, note: "ребёнок вне урока не голосует" },
    foreign: NA_NO_POLICY,
  },
  getCorpusItemVotes: {
    req: () => ({ path: `/corpus/items/${randomUUID()}/votes` }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403, note: "детям распределение голосов не показываем" },
    foreign: { na: "без политики ресурса: «голоса — после своего голоса» (403 vote_required) — тест модуля consensus (Ч3)" },
  },
  listMyCorpusCells: { req: () => ({ path: "/corpus/my-cells" }), anonymous: 401, wrongRole: { as: "moderator", status: 403 }, foreign: NA_SELF },
  // Повторение слов и «Мой словарь» (FSRS-6): свои карточки — ресурса другого ученика в запросе нет.
  startReviewRun: {
    req: () => ({ path: "/reviews/runs", body: { runId: randomUUID() } }),
    anonymous: 401,
    wrongRole: { as: "moderator", status: 403, note: "сотрудник не повторяет слова" },
    foreign: NA_NO_POLICY,
  },
  listMyWords: { req: () => ({ path: "/me/words" }), anonymous: 401, wrongRole: { as: "admin", status: 403 }, foreign: NA_SELF },
  listMyAchievements: { req: () => ({ path: "/me/achievements" }), anonymous: 401, wrongRole: { as: "admin", status: 403 }, foreign: NA_SELF },
  startJumpRun: {
    req: () => ({ path: "/units/t-u2/jump-runs", body: { runId: randomUUID() } }),
    anonymous: 401,
    wrongRole: { as: "admin", status: 403, note: "сотрудник не проходит испытаний" },
    foreign: NA_NO_POLICY,
  },

  // ── Telegram (ADR 0020): привязка из Mini App и служебные операции бота (роль service, X-Service-Token). Access-токен
  // пользователя служебную операцию не открывает — 403; неверный секрет сервиса — 401 (test/integration/telegram.test.ts). ──
  linkTelegramChat: {
    req: () => ({ path: "/telegram/link", body: { initData: "auth_date=1&hash=00" } }),
    anonymous: 401,
    wrongRole: { as: "moderator", status: 403, note: "сотрудник не привязывает Telegram" },
    foreign: NA_SELF,
  },
  getTelegramChat: {
    req: () => ({ path: "/telegram/bot/chats/279058397" }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403, note: "токен пользователя — не секрет сервиса" },
    foreign: NA_SERVICE,
  },
  unlinkTelegramChat: {
    req: () => ({ path: "/telegram/bot/chats/279058397" }),
    anonymous: 401,
    wrongRole: { as: "admin", status: 403, note: "даже администратор не вызывает операции бота" },
    foreign: NA_SERVICE,
  },
  setTelegramChatReminders: {
    req: () => ({ path: "/telegram/bot/chats/279058397/reminders", body: { enabled: true } }),
    anonymous: 401,
    wrongRole: { as: "adult", status: 403 },
    foreign: NA_SERVICE,
  },
  claimTelegramReminders: {
    req: () => ({ path: "/telegram/bot/reminders/claim" }),
    anonymous: 401,
    wrongRole: { as: "teacher", status: 403 },
    foreign: NA_SERVICE,
  },
  issueTelegramDailyDuel: {
    req: () => ({ path: "/telegram/bot/chats/279058397/daily-duel" }),
    anonymous: 401,
    wrongRole: { as: "student", status: 403, note: "ежедневка бота — служебная операция, не операция ученика" },
    foreign: NA_SERVICE,
  },
  cancelTelegramDailyDuel: {
    req: () => ({ path: "/telegram/bot/chats/279058397/daily-duel/cancel" }),
    anonymous: 401,
    wrongRole: { as: "adult", status: 403 },
    foreign: NA_SERVICE,
  },
  answerTelegramDailyDuel: {
    req: () => ({ path: `/telegram/bot/dialogs/${randomUUID()}/answer`, body: { choice: "a" } }),
    anonymous: 401,
    wrongRole: { as: "moderator", status: 403 },
    foreign: NA_SERVICE,
  },

  // ── «Учусь сам» (ADR 0022). Личная карточка и почта — только свои (self); заявка в класс уже вошедшего ученика —
  // своя: чужая неотличима от несуществующей (404, настоящая заявка самостоятельного ученика — fixture.classJoinRequest). ──
  createSelfLearner: { req: () => ({ path: "/auth/self" }), anonymous: NA_PUBLIC, wrongRole: NA_PUBLIC, foreign: NA_PUBLIC },
  loginWithLoginCard: { req: () => ({ path: "/auth/login-card" }), anonymous: NA_PUBLIC, wrongRole: NA_PUBLIC, foreign: NA_PUBLIC },
  getMyLoginCard: { req: () => ({ path: "/me/login-card" }), anonymous: 401, wrongRole: { as: "moderator", status: 403, note: "у сотрудника карточки нет" }, foreign: NA_SELF },
  issueMyLoginCard: { req: () => ({ path: "/me/login-card" }), anonymous: 401, wrongRole: { as: "admin", status: 403 }, foreign: NA_SELF },
  attachMyEmail: {
    req: () => ({ path: "/me/email", body: { challengeId: randomUUID(), code: "0000" } }),
    anonymous: 401,
    wrongRole: { as: "moderator", status: 403, note: "сотруднику почту не привязывает" },
    foreign: NA_SELF,
  },
  requestClassJoin: {
    req: () => ({ path: "/me/class-join", body: { code: "ABC-DEF" } }),
    anonymous: 401,
    wrongRole: { as: "adult", status: 403, note: "взрослый в класс детей не вступает" },
    foreign: NA_SELF,
  },
  getClassJoinStatus: {
    req: (f) => ({ path: `/me/class-join/${f.classJoinRequest}` }),
    anonymous: 401,
    wrongRole: { as: "adult", status: 403 },
    foreign: { as: "student", status: 404, note: "заявка другого ученика неотличима от несуществующей" },
  },
};

/** Дополнительные строки «чужой ресурс» сверх одной на операцию. */
const EXTRA_FOREIGN: Array<{ op: OperationId; as: Who; status: 403 | 404; req: (f: Fixture) => Req; note: string }> = [
  { op: "getClass", as: "studentB", status: 403, req: (f) => ({ path: `/classes/${f.classA}` }), note: "ученик чужого класса" },
  { op: "getClass", as: "teacher", status: 403, req: (f) => ({ path: `/classes/${f.classB}` }), note: "учитель A — класс учителя B" },
  { op: "revokeConsent", as: "adultB", status: 403, req: (f) => ({ path: `/consents/${f.electronicConsentA}/revoke` }), note: "электронное согласие другого взрослого" },
  { op: "getClassCardsPdf", as: "teacher", status: 403, req: (f) => ({ path: `/classes/${f.classB}/cards.pdf?printJob=${f.printJobA}` }), note: "задание A в чужом классе" },
  { op: "getClassProgress", as: "teacher", status: 403, req: (f) => ({ path: `/classes/${f.classB}/progress` }), note: "учитель A — прогресс класса учителя B" },
  { op: "getClassHive", as: "teacherB", status: 403, req: (f) => ({ path: `/classes/${f.classA}/hive` }), note: "учитель другого класса" },
  { op: "getSeatProgress", as: "teacher", status: 403, req: (f) => ({ path: `/classes/${f.classB}/seats/1/progress` }), note: "учитель A — ученик класса учителя B" },
  { op: "cancelClassAssignment", as: "teacher", status: 403, req: (f) => ({ path: `/classes/${f.classB}/assignments/${f.assignmentA}` }), note: "задание A через чужой класс" },
];

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;
let fixture: Fixture;
const sessions = {} as Record<Who, AuthSession>;

beforeAll(async () => {
  ({ api, pool, close } = await bootApi());
  sessions.moderator = await api.loginStaff("moderator");
  sessions.admin = await api.loginStaff("admin");
  sessions.ministry = await api.loginStaff("ministry");
  sessions.fund = await api.loginStaff("fund");
  const teacherA = await api.verifiedTeacher("matrix-a", sessions.moderator.accessToken, 1);
  const teacherB = await api.verifiedTeacher("matrix-b", sessions.moderator.accessToken, 2);
  sessions.teacher = teacherA;
  sessions.teacherB = teacherB;

  const mkClass = async (s: AuthSession, letter: string) => {
    const c = await api.post<Schema<"ClassDetail">>("/classes", { token: s.accessToken, body: { grade: 6, letter, program: "native" } });
    expectStatus(c, 201);
    const seats = await api.post<Schema<"SeatIssueResult">>(`/classes/${c.body.id}/seats`, { token: s.accessToken, body: { count: 3 } });
    expectStatus(seats, 201);
    const pdf = await api.get(seats.body.printJob.pdfPath, { token: s.accessToken });
    return { id: c.body.id, printJob: seats.body.printJob.id, links: (await scanPdf(pdf.raw)).qr[0]! };
  };
  const a = await mkClass(teacherA, "А");
  const b = await mkClass(teacherB, "Б");
  sessions.student = (await api.post<AuthSession>("/auth/qr", { body: { payload: a.links[0], device: newDevice() } })).body;
  sessions.studentB = (await api.post<AuthSession>("/auth/qr", { body: { payload: b.links[0], device: newDevice() } })).body;

  const adult = await api.loginAdult(email("matrix-adult"));
  await api.acceptRequiredConsents(adult.accessToken);
  sessions.adult = adult;
  const adultB = await api.loginAdult(email("matrix-adult-b"));
  sessions.adultB = adultB;
  const pendingApplicant = await api.loginAdult(email("matrix-applicant"));
  await api.acceptRequiredConsents(pendingApplicant.accessToken);
  const v = await api.post<Schema<"TeacherVerification">>("/teacher/verification", {
    token: pendingApplicant.accessToken,
    body: { schoolId: teacherA.school.id, fullName: "Заявитель Матрицы", position: "Учитель" },
  });
  expectStatus(v, 201);

  const code = await api.post<Schema<"JoinCode">>(`/classes/${a.id}/join-code`, { token: teacherA.accessToken });
  const ticket = await api.post<Schema<"ClassCodeLoginTicket">>("/auth/class-code", { body: { code: code.body.code, nicknameId: "a00.n00", device: device() } });
  expectStatus(ticket, 202);
  const solo = await api.post<AuthSession>("/auth/self", { body: { device: device(), nicknameId: "a01.n02", ageBand: "age_11_14" } });
  expectStatus(solo, 201);
  const join = await api.post<Schema<"ClassJoinTicket">>("/me/class-join", { token: solo.body.accessToken, body: { code: code.body.code } });
  expectStatus(join, 202);
  const paper = await api.post<Schema<"Consent">>(`/classes/${a.id}/seats/2/paper-consent`, { token: teacherA.accessToken });
  expectStatus(paper, 201);
  const mine = await api.get<Schema<"Me">>("/me", { token: adult.accessToken });
  expect(mine.body.pendingConsents).toEqual([]);
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM consents WHERE subject_account_id = $1 AND revoked_at IS NULL LIMIT 1", [adult.account.id]);

  // Забег ученика A (синтетический курс — как в m2-learning.test.ts; импорт идемпотентен).
  await importCourse(pool, buildCourse(readContent(CONTENT_FIXTURE)[0]!), { force: true });
  const runA = randomUUID();
  expectStatus(await api.post(`/lessons/t-l1/runs`, { token: sessions.student.accessToken, body: { runId: runA } }), 201);
  const dueOn = ufaDate(new Date());
  const assignment = await api.post<Schema<"ClassAssignment">>(`/classes/${a.id}/assignments`, { token: teacherA.accessToken, body: { kind: "lesson", lessonId: "t-l1", dueOn } });
  expectStatus(assignment, 201);

  fixture = {
    classA: a.id,
    classB: b.id,
    printJobA: a.printJob,
    joinRequestA: ticket.body.requestId,
    pollRequestId: ticket.body.requestId,
    paperConsentA: paper.body.id,
    electronicConsentA: rows[0]!.id,
    verificationPending: v.body.id,
    schoolA: teacherA.school.id,
    runA,
    assignmentA: assignment.body.id,
    dueOn,
    classJoinRequest: join.body.requestId,
  };
});

afterAll(async () => {
  await close?.();
});

const principalOf = (who: Who): Principal => {
  const s = sessions[who];
  return { accountId: s.account.id, kind: s.account.kind, roles: s.account.roles, sessionId: "", deviceId: "" };
};

async function send(op: ContractOperation, r: Req, token?: string) {
  return api.call<Schema<"Problem">>(op.method, r.path, {
    ...(token ? { token } : {}),
    ...(r.body !== undefined ? { body: r.body } : {}),
    ...(r.headers ? { headers: r.headers } : {}),
  });
}

describe("authorization matrix covers every contract operation (ADR 0017 §4)", () => {
  const ops = contractOperations();

  it("every operation of openapi.yaml has a row, and every row is an operation", () => {
    const ids = ops.map((o) => o.id).sort();
    expect(Object.keys(MATRIX).sort()).toEqual(ids);
  });

  it("rows agree with x-access: n/a only where the contract makes the case impossible", () => {
    for (const op of ops) {
      const row = MATRIX[op.id];
      const anon = op.access.roles.includes("anonymous");
      expect(row.anonymous === 401, `${op.id}: аноним`).toBe(!anon);
      const restricted = op.access.roles.some((r) => !["anonymous", "any"].includes(r));
      expect(!("na" in row.wrongRole), `${op.id}: чужая роль`).toBe(restricted && !anon);
      const policy = op.access.policy;
      if (policy && policy !== "self") expect("na" in row.foreign, `${op.id}: у операции политика ${policy} — нужна проверка чужого ресурса`).toBe(false);
    }
  });

  for (const op of ops) {
    const row = MATRIX[op.id];
    describe(`${op.method} ${op.path} (${op.id})`, () => {
      if (row.anonymous === 401) {
        it("anonymous → 401", async () => {
          const res = await send(op, row.req(fixture));
          expect(res.status, JSON.stringify(res.body)).toBe(401);
          expect(res.headers["content-type"]).toContain("application/problem+json");
        });
      } else {
        const reason = row.anonymous.na;
        it(`anonymous is let through (${reason})`, async () => {
          const res = await send(op, row.req(fixture));
          expect([401, 403], JSON.stringify(res.body)).not.toContain(res.status);
        });
      }
      const wrong = row.wrongRole;
      if (!("na" in wrong)) {
        it(`wrong role (${wrong.as}) → 403`, async () => {
          expect(op.access.roles.some((r) => hasAccessRole(principalOf(wrong.as as Who), r)), "эта роль разрешена контрактом").toBe(false);
          const res = await send(op, (wrong.req ?? row.req)(fixture), sessions[wrong.as as Who].accessToken);
          expect(res.status, JSON.stringify(res.body)).toBe(403);
        });
      }
      const foreign = row.foreign;
      if (!("na" in foreign)) {
        it(`foreign resource (${foreign.as}${foreign.note ? `: ${foreign.note}` : ""}) → ${foreign.status}`, async () => {
          if (foreign.as !== "anonymous") {
            expect(op.access.roles.some((r) => hasAccessRole(principalOf(foreign.as as Who), r)), "отказ должен идти от политики, а не от роли").toBe(true);
          }
          const res = await send(op, (foreign.req ?? row.req)(fixture), foreign.as === "anonymous" ? undefined : sessions[foreign.as].accessToken);
          expect(res.status, JSON.stringify(res.body)).toBe(foreign.status);
        });
      }
    });
  }

  for (const extra of EXTRA_FOREIGN) {
    it(`${extra.op}: ${extra.note} → ${extra.status}`, async () => {
      const op = ops.find((o) => o.id === extra.op)!;
      expect(op.access.roles.some((r) => hasAccessRole(principalOf(extra.as), r))).toBe(true);
      const res = await send(op, extra.req(fixture), sessions[extra.as].accessToken);
      expect(res.status, JSON.stringify(res.body)).toBe(extra.status);
    });
  }

  it("rejected requests changed nothing: class A still has 3 seats, the join request is pending, the consent is given, run A has no attempts, one assignment", async () => {
    const detail = await api.get<Schema<"ClassDetail">>(`/classes/${fixture.classA}`, { token: sessions.teacher.accessToken });
    expect(detail.body.seats?.map((s) => [s.number, s.cardVersion])).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    expect(detail.body.seats?.[1]?.consent?.status).toBe("given");
    const list = await api.get<Schema<"JoinRequestList">>(`/classes/${fixture.classA}/join-requests`, { token: sessions.teacher.accessToken });
    expect(list.body.items.find((i) => i.id === fixture.joinRequestA)?.status).toBe("pending");
    const run = await pool.query<{ status: string; attempts: number }>(
      "SELECT status, (SELECT count(*)::int FROM attempts WHERE run_id = lesson_runs.id) AS attempts FROM lesson_runs WHERE id = $1",
      [fixture.runA],
    );
    expect(run.rows).toEqual([{ status: "active", attempts: 0 }]);
    const tasks = await api.get<Schema<"ClassAssignments">>(`/classes/${fixture.classA}/assignments`, { token: sessions.teacher.accessToken });
    expect(tasks.body.active.map((t) => [t.id, t.kind])).toEqual([[fixture.assignmentA, "lesson"]]);
  });
});
