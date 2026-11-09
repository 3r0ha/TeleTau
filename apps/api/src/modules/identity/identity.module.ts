import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ACCOUNTS_PORT } from "../../common/ports.js";
import { AdminModule } from "../admin/index.js";
import { ConsentModule } from "../consent/index.js";
import { ModerationModule } from "../moderation/index.js";
import { OrgModule } from "../org/index.js";
import { AccountsService } from "./accounts.service.js";
import { AuthController } from "./auth.controller.js";
import { AccessCheckedGuard, AccessControl } from "./access-control.js";
import { MeController } from "./me.controller.js";
import { MeService } from "./me.service.js";
import { OtpService } from "./otp.service.js";
import { SelfLearnerService } from "./self-learner.service.js";
import { SessionsService } from "./sessions.service.js";
import { StaffSeed } from "./staff-seed.js";
import { StudentLoginService } from "./student-login.service.js";
import { TokenService } from "./token.service.js";

/**
 * Модуль identity: вход (QR-карточка, код класса, e-mail + одноразовый код, TOTP сотрудников, «Учусь сам» и личная
 * карточка входа — ADR 0022), сессии и ротация
 * refresh-токенов, устройства, ники, GET/PATCH /me и контроль доступа ко всем операциям (AccessControl). Таблицы — в identity.schema.ts (ADR 0014).
 * Верхний модуль графа: использует org, consent, moderation и admin через их index.ts, а им отдаёт порт ACCOUNTS_PORT.
 */
@Global()
@Module({
  imports: [OrgModule, ConsentModule, ModerationModule, AdminModule],
  controllers: [AuthController, MeController],
  providers: [
    TokenService,
    SessionsService,
    AccountsService,
    OtpService,
    StudentLoginService,
    SelfLearnerService,
    MeService,
    StaffSeed,
    { provide: ACCOUNTS_PORT, useExisting: AccountsService },
    AccessControl,
    { provide: APP_GUARD, useClass: AccessCheckedGuard },
  ],
  exports: [ACCOUNTS_PORT],
})
export class IdentityModule {}
