// Обвязка интеграционных тестов: настоящее приложение (in-process, Fastify inject) против Docker-стека проекта.
// База и Valkey — свои у интеграционных тестов (`<имя>_it` и следующий номер базы Valkey, it-env.ts), их пересоздаёт
// global-setup.ts перед каждым прогоном: dev-база из корневого .env не меняется. Внутри прогона у файлов
// свои адреса e-mail и IP, так что лимиты частоты и аудит одного файла не мешают другому.
import { randomInt, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { Schema } from "@teletau/contracts";
import type { Redis } from "ioredis";
import { generate } from "otplib";
import pg from "pg";
import { createApp } from "../../src/bootstrap.js";
import { loadConfig, type AppConfig } from "../../src/config/config.js";
import { DEMO_STAFF } from "../../src/modules/identity/index.js";
import { importDirectory } from "../../src/modules/org/directory-import.js";
import { VALKEY } from "../../src/infra/tokens.js";
import { AccountsService } from "../../src/modules/identity/accounts.service.js";

export type AuthSession = Schema<"AuthSession">;
export type Device = Schema<"DeviceInfo">;

export const RUN = `${Date.now().toString(36)}${randomInt(1000).toString(36)}`;
export const randomIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
export const newDevice = (platform: Device["platform"] = "web"): Device => ({ installId: randomUUID(), platform });
export const email = (who: string) => `${who}.${RUN}@school.example.org`;

/** Кириллица вместо латинских букв и цифр: ФИО принимает только русские и башкирские буквы. */
const CYR = "абвгдежзийклмнопрстуфхцчшщэюя";
/** Уникальное в прогоне ФИО учителя — кириллицей (его ищет тест на утечки в логах). */
export const teacherName = (who: string): string => {
  const tag = [...`${who}${RUN}`.toLowerCase()].map((c) => (/[0-9a-z]/.test(c) ? CYR[parseInt(c, 36) % CYR.length]! : "")).join("");
  return `Учитель ${tag.charAt(0).toUpperCase()}${tag.slice(1)} Тестович`;
};

export interface Res<T = unknown> {
  status: number;
  body: T;
  raw: Buffer;
  headers: Record<string, string | string[] | number | undefined>;
}

export interface RequestOptions {
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  ip?: string;
}

export class TestApi {
  /** IP по умолчанию для этого клиента (лимиты частоты — по IP). */
  ip = randomIp();

  constructor(readonly app: NestFastifyApplication) {}

  async call<T = unknown>(method: string, url: string, o: RequestOptions = {}): Promise<Res<T>> {
    const res = await this.app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: method as "GET",
        url: url.startsWith("/api/") ? url : `/api/v1${url}`,
        remoteAddress: o.ip ?? this.ip,
        headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.body !== undefined ? { "content-type": "application/json" } : {}), ...o.headers },
        ...(o.body !== undefined ? { payload: JSON.stringify(o.body) } : {}),
      });
    const type = String(res.headers["content-type"] ?? "");
    return { status: res.statusCode, body: (type.includes("json") ? res.json() : res.body) as T, raw: res.rawPayload, headers: res.headers };
  }

  get = <T = unknown>(url: string, o?: RequestOptions) => this.call<T>("GET", url, o);
  post = <T = unknown>(url: string, o?: RequestOptions) => this.call<T>("POST", url, o);
  patch = <T = unknown>(url: string, o?: RequestOptions) => this.call<T>("PATCH", url, o);
  del = <T = unknown>(url: string, o?: RequestOptions) => this.call<T>("DELETE", url, o);

  /** Взрослый: e-mail + демо-код (AUTH_DEMO_OTP). */
  async loginAdult(address: string, device = newDevice()): Promise<AuthSession & { device: Device }> {
    const ch = await this.post<Schema<"OtpChallenge">>("/auth/otp/request", { body: { email: address }, ip: randomIp() });
    expectStatus(ch, 202);
    const s = await this.post<AuthSession>("/auth/otp/verify", { body: { challengeId: ch.body.challengeId, code: DEMO_CODE, device }, ip: randomIp() });
    expectStatus(s, 200);
    return { ...s.body, device };
  }

  /**
   * Демо-сотрудники входят в каждом прогоне, а лимит запросов кода на адрес — 5 за 10 минут (ADR 0015 §4).
   * Чтобы три прогона подряд не упирались в него, тест сбрасывает счётчик только своих демо-адресов.
   */
  private async resetEmailLimit(address: string): Promise<void> {
    const subject = this.app.get(AccountsService).emailSubject(address);
    await this.app.get<Redis>(VALKEY).del(`rl:otp:email:${subject.slice(0, 24)}`);
  }

  /** Сотрудник: e-mail + демо-код + TOTP. Один код TOTP дважды не принимается — берём соседние шаги окна ±1. */
  async loginStaff(which: "moderator" | "admin" | "ministry" | "fund", device = newDevice()): Promise<AuthSession & { device: Device }> {
    const staff = DEMO_STAFF.find((s) => s.roles[0] === which)!;
    for (let wait = 0; wait < 2; wait++) {
      for (const offset of [0, 30, -30]) {
        await this.resetEmailLimit(staff.email);
        const ch = await this.post<Schema<"OtpChallenge">>("/auth/otp/request", { body: { email: staff.email }, ip: randomIp() });
        expectStatus(ch, 202);
        const totp = await generate({ secret: staff.totpSecret, epoch: Math.floor(Date.now() / 1000) + offset });
        const s = await this.post<AuthSession>("/auth/otp/verify", {
          body: { challengeId: ch.body.challengeId, code: DEMO_CODE, totp, device },
          ip: randomIp(),
        });
        if (s.status === 200) return { ...s.body, device };
        if ((s.body as unknown as Schema<"Problem">).code !== "totp_invalid") expectStatus(s, 200);
      }
      await new Promise((r) => setTimeout(r, 31_000 - ((Date.now() / 1000) % 30) * 1000));
    }
    throw new Error(`не удалось войти как ${which}`);
  }

  /** Принимает все действующие документы, обязательные для взрослого. */
  async acceptRequiredConsents(token: string): Promise<void> {
    const docs = await this.get<Schema<"LegalDocumentList">>("/legal-documents/current");
    const ids = docs.body.items.filter((d) => ["terms", "privacy", "consent_adult"].includes(d.kind)).map((d) => d.id);
    expectStatus(await this.post("/consents", { token, body: { documentIds: ids } }), 201);
  }

  async demoSchool(token: string, n = 1): Promise<Schema<"School">> {
    const res = await this.get<Schema<"SchoolPage">>(`/schools?q=${encodeURIComponent(`Демо-школа № ${n}`)}`, { token });
    const school = res.body.items.find((s) => s.isDemo && s.shortNameRu === `Демо-школа № ${n}`);
    if (!school) throw new Error("демо-школа не найдена — импорт справочника не выполнен");
    return school;
  }

  /** Подтверждённый учитель: вход, условия, заявка, одобрение модератором, обновление токена (роль teacher). */
  async verifiedTeacher(who: string, moderatorToken: string, school = 1) {
    const s = await this.loginAdult(email(who));
    await this.acceptRequiredConsents(s.accessToken);
    const demo = await this.demoSchool(s.accessToken, school);
    const v = await this.post<Schema<"TeacherVerification">>("/teacher/verification", {
      token: s.accessToken,
      body: { schoolId: demo.id, fullName: teacherName(who), position: "Учитель башкирского языка" },
    });
    expectStatus(v, 201);
    expectStatus(await this.post(`/moderation/teacher-verifications/${v.body.id}/approve`, { token: moderatorToken }), 200);
    const r = await this.post<AuthSession>("/auth/refresh", { body: { refreshToken: s.refreshToken, deviceInstallId: s.device.installId } });
    expectStatus(r, 200);
    return { ...r.body, device: s.device, school: demo, verificationId: v.body.id, email: email(who), fullName: teacherName(who) };
  }
}

export const DEMO_CODE = "0000";
/** Секрет служебных операций бота в тестах (роль service, ADR 0020), если в окружении нет своего. */
export const TEST_BOT_SERVICE_TOKEN = "it-default-bot-service-token-0123456789";

export function expectStatus(res: Res, status: number): void {
  if (res.status !== status) {
    throw new Error(`ожидался ответ ${status}, получен ${res.status}: ${typeof res.body === "string" ? res.body.slice(0, 300) : JSON.stringify(res.body)}`);
  }
}

/**
 * Демо-режим входа и демо-сотрудники включены всегда (тесты входят как модератор и администратор). Постоянного кода
 * класса (AUTH_DEMO_CLASS_CODE из .env стенда) нет: тесты кода класса проверяют настоящие коды на 15 минут,
 * постоянный код включает только свой тест (demo-class-code.test.ts).
 */
export const testConfig = (): AppConfig =>
  loadConfig({
    ...process.env,
    AUTH_DEMO_OTP: process.env["AUTH_DEMO_OTP"] || DEMO_CODE,
    AUTH_DEMO_STAFF: process.env["AUTH_DEMO_STAFF"] || "1",
    AUTH_DEMO_CLASS_CODE: "",
    BOT_SERVICE_TOKEN: process.env["BOT_SERVICE_TOKEN"] || TEST_BOT_SERVICE_TOKEN,
  });

/** Поднимает приложение; гарантирует демо-школы (импорт только демо-записей — быстро и идемпотентно). */
export async function bootApi(config: AppConfig = testConfig()): Promise<{ api: TestApi; pool: pg.Pool; close: () => Promise<void> }> {
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 3 });
  await importDirectory(pool, { demo: true, directory: { districts: [], schools: [] } });
  const app = await createApp(config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const valkey = app.get<Redis>(VALKEY);
  if (valkey.status !== "ready") await once(valkey, "ready");
  return {
    api: new TestApi(app),
    pool,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}
