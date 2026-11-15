// Вход по привязке Telegram (POST /auth/telegram): Mini App с уже привязанным чатом входит без карточки — как
// «Учусь сам» по личной карточке (ADR 0022), только вместо секрета карточки — подпись initData (ADR 0020).
// Подпись и поиск привязки — в модуле telegram (TelegramService.accountIdOfInitData, лимит на чат); здесь —
// статус аккаунта, согласие на местах в классе и выдача сессии: таблица accounts и SessionsService принадлежат identity.
import { Inject, Injectable } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { forbidden, unauthorized } from "../../common/problem.js";
import { DB } from "../../infra/tokens.js";
import type { Db } from "../../db/database.js";
import { ClassesService } from "../org/index.js";
import { TelegramService } from "../telegram/index.js";
import { AccountsService } from "./accounts.service.js";
import { SessionsService, type DeviceInfo, type SessionTokens } from "./sessions.service.js";

export interface TelegramSession {
  tokens: SessionTokens;
  accountId: string;
}

@Injectable()
export class TelegramLoginService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly telegram: TelegramService,
    private readonly accounts: AccountsService,
    private readonly sessions: SessionsService,
    private readonly classes: ClassesService,
  ) {}

  /**
   * POST /auth/telegram: подпись initData → чат → аккаунт привязки → сессия. Сотруднику вход в консоль — по e-mail
   * с TOTP, не здесь (403 telegram_login_forbidden); заблокированный — 401 account_blocked (причина названа прямо,
   * как у обновления сессии), удалённый — 401 session_revoked. Родитель отозвал бумажное согласие на месте ученика —
   * 403 consent_revoked, как у входа по карточке (ClassesService.admitAccount — под блокировкой мест, в транзакции
   * выдачи сессии). Перевыпуск карточки снимает сами привязки (AccountsService.dropSideLogins) — отдельной проверки нет.
   */
  async login(body: Schema<"TelegramLoginRequest">): Promise<TelegramSession> {
    const accountId = await this.telegram.accountIdOfInitData(body);
    const account = await this.accounts.get(accountId);
    if (!account) throw unauthorized("session_revoked");
    if (account.kind === "staff") throw forbidden("telegram_login_forbidden");
    if (account.status === "blocked") throw unauthorized("account_blocked");
    if (account.status !== "active") throw unauthorized("session_revoked");
    return this.db.transaction(async (tx) => {
      await this.classes.admitAccount(tx, account.id);
      await this.accounts.touchLogin(tx, account.id);
      const tokens = await this.sessions.issue(tx, { accountId: account.id, kind: account.kind, roles: account.roles }, body.device as DeviceInfo);
      return { tokens, accountId: account.id };
    });
  }
}
