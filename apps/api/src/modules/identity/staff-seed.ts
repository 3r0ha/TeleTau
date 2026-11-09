// Демо-сотрудники консоли (только при AUTH_DEMO_STAFF и не в production): модератор, администратор,
// министерство и Фонд (ADR 0023)
// с известными TOTP-секретами — для показа и интеграционных тестов. Инструкция — apps/api/data/README.md.
// Флаг отдельный от демо-кода AUTH_DEMO_OTP: демо-стенд может принимать код 0000, но не должен
// пускать в консоль по второму фактору из репозитория. Флаг выключен — заведённые ранее демо-сотрудники блокируются.
// Самостоятельной регистрации сотрудников нет (ADR 0015 §4): в проде их заводит администратор.
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { encrypt } from "../../common/crypto.js";
import type { Role } from "../../common/auth.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { demoStaffEnabled, encryptionKey } from "../../config/secrets.js";
import { describeError } from "../../common/errors.js";
import { pgErrorCode, type Db } from "../../db/database.js";
import { DB } from "../../infra/tokens.js";
import { AccountsService, normalizeEmail } from "./accounts.service.js";
import { accounts, adultProfiles, credentials } from "./identity.schema.js";

export interface DemoStaff {
  email: string;
  roles: Role[];
  /** Base32-секрет TOTP (RFC 6238). Только для демо: известен всем, кто читает репозиторий. */
  totpSecret: string;
}

export const DEMO_STAFF: readonly DemoStaff[] = [
  { email: "moderator@demo.teletau.local", roles: ["moderator"], totpSecret: "KEREZDEMOMODERATORTOTPSECRETAAAA" },
  { email: "admin@demo.teletau.local", roles: ["admin", "moderator"], totpSecret: "KEREZDEMOADMINTOTPSECRETBBBBBBBB" },
  // Кабинет министерства и словарь для Фонда (ADR 0023): только свои разделы, без заявок учителей и журнала аудита.
  { email: "ministry@demo.teletau.local", roles: ["ministry"], totpSecret: "KEREZDEMOMINISTRYTOTPSECRETCCCCC" },
  { email: "fund@demo.teletau.local", roles: ["fund"], totpSecret: "KEREZDEMOFUNDTOTPSECRETDDDDDDDDD" },
];

@Injectable()
export class StaffSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger(StaffSeed.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly accounts: AccountsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      if (demoStaffEnabled(this.config)) {
        for (const staff of DEMO_STAFF) await this.ensure(staff);
      } else {
        await this.disableDemoStaff();
      }
    } catch (e) {
      this.logger.warn(`demo staff seed skipped: ${describeError(e)}`);
    }
  }

  /** Флаг выключен: демо-сотрудники, заведённые раньше (их TOTP-секреты публичны), блокируются, их сессии завершаются. */
  async disableDemoStaff(list: readonly DemoStaff[] = DEMO_STAFF): Promise<void> {
    for (const staff of list) {
      const account = await this.accounts.findByEmailSubject(this.accounts.emailSubject(staff.email));
      if (!account || account.kind !== "staff" || account.status !== "active") continue;
      const families = await this.db.transaction(async (tx) => {
        await tx.update(accounts).set({ status: "blocked" }).where(eq(accounts.id, account.id));
        return this.accounts.revokeAllSessions(tx, account.id, "account_blocked");
      });
      await this.accounts.blockSessions(families).catch(() => undefined);
      this.logger.warn(`demo staff account ${account.id} blocked: AUTH_DEMO_STAFF is off`);
    }
  }

  /** Идемпотентно: аккаунт, e-mail-учётка, профиль и TOTP (секрет перешифровывается текущим ключом при каждом старте). */
  async ensure(staff: DemoStaff, attempt = 0): Promise<string> {
    const subject = this.accounts.emailSubject(staff.email);
    const key = encryptionKey(this.config);
    try {
      return await this.db.transaction(async (tx) => {
        let account = await this.accounts.findByEmailSubject(subject);
        if (!account) {
          [account] = await tx.insert(accounts).values({ kind: "staff", roles: staff.roles }).returning();
          await tx.insert(credentials).values({ accountId: account!.id, type: "email", subject, verifiedAt: new Date() });
          await tx.insert(adultProfiles).values({ accountId: account!.id, email: normalizeEmail(staff.email) });
        }
        const id = account!.id;
        await tx.update(accounts).set({ roles: staff.roles, status: "active" }).where(eq(accounts.id, id));
        const secretEnc = encrypt(key, staff.totpSecret, `totp:${id}`);
        const updated = await tx
          .update(credentials)
          .set({ secretEnc })
          .where(and(eq(credentials.accountId, id), eq(credentials.type, "totp")))
          .returning({ id: credentials.id });
        if (updated.length === 0) await tx.insert(credentials).values({ accountId: id, type: "totp", secretEnc, verifiedAt: new Date() });
        return id;
      });
    } catch (e) {
      // Параллельный старт нескольких экземпляров: второй увидит аккаунт, созданный первым.
      if (pgErrorCode(e) === "23505" && attempt < 3) return this.ensure(staff, attempt + 1);
      throw e;
    }
  }
}
