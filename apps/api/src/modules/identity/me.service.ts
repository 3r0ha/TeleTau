// GET/PATCH /me: аккаунт с ролями из базы (свежее токена), классы, статус учителя и непринятые документы.
import { Injectable } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { contractRoles, staffRolesOf, type Principal } from "../../common/auth.js";
import { forbidden, invalidField, unauthorized } from "../../common/problem.js";
import { ConsentService } from "../consent/index.js";
import { VerificationService } from "../moderation/index.js";
import { ClassesService } from "../org/index.js";
import { AccountsService, UI_MODE_BY_BAND, ageBandOf } from "./accounts.service.js";
import { nicknameById } from "./nicknames.js";
import { SelfLearnerService } from "./self-learner.service.js";

export type Me = Schema<"Me">;

@Injectable()
export class MeService {
  constructor(
    private readonly accounts: AccountsService,
    private readonly classes: ClassesService,
    private readonly verifications: VerificationService,
    private readonly consents: ConsentService,
    private readonly selfLearners: SelfLearnerService,
  ) {}

  async me(accountId: string): Promise<Me> {
    const account = await this.accounts.get(accountId);
    if (!account || account.status !== "active") throw unauthorized("session_revoked");
    const [classes, teacherStatus, pendingConsents, profile, loginCard] = await Promise.all([
      this.classes.myClasses({ accountId, roles: account.roles }),
      account.kind === "adult" ? this.verifications.teacherStatus(accountId) : Promise.resolve("none" as const),
      this.consents.pendingKinds(accountId, account.kind),
      account.kind === "child" ? Promise.resolve(undefined) : this.accounts.profile(accountId),
      this.selfLearners.cardStatus(account),
    ]);
    // Возрастной диапазон (ADR 0022): у ребёнка — по режиму, у взрослого — только если он учится (выбрал ник).
    const staff = staffRolesOf(account.kind, account.roles);
    const ageBand = account.kind === "adult" && !account.nickname ? undefined : ageBandOf(account);
    return {
      id: account.id,
      kind: account.kind,
      roles: contractRoles(account.roles),
      ...(staff ? { staffRoles: staff } : {}),
      ...(account.nickname ? { nickname: account.nickname } : {}),
      ...(account.uiMode ? { uiMode: account.uiMode } : {}),
      ...(ageBand ? { ageBand } : {}),
      ...(account.dailyGoal ? { dailyGoal: account.dailyGoal } : {}),
      ...(loginCard ? { loginCard } : {}),
      locale: account.locale,
      teacherStatus,
      classes,
      // ПДн взрослого — только ему самому (AdultProfile); у детей поля нет вовсе.
      ...(profile ? { profile: { email: profile.email, ...(profile.fullName ? { fullName: profile.fullName } : {}) } } : {}),
      pendingConsents,
    };
  }

  /**
   * Ник — только из словаря, у детей и у взрослых, которые учатся (ADR 0022); учителю и сотруднику — 403
   * nickname_not_allowed (ник виден в лиге, а учитель в ней не соревнуется).
   * Возрастной диапазон: ребёнку — детские, взрослому — только adult (вид аккаунта не меняется); задаёт режим.
   */
  async update(principal: Principal, body: Schema<"UpdateMeRequest">): Promise<Me> {
    const patch: Parameters<AccountsService["update"]>[1] = {};
    if (body.nicknameId !== undefined) {
      if (principal.kind === "staff" || principal.roles.includes("teacher")) throw forbidden("nickname_not_allowed");
      const nickname = nicknameById(body.nicknameId);
      if (!nickname) throw invalidField("/nicknameId", "Такого ника нет в словаре — выберите из предложенных");
      patch.nicknameKey = nickname.id;
      patch.nickname = nickname.text;
    }
    // Выбор самого пользователя: дальше вход по классу режим не меняет.
    if (body.uiMode !== undefined) {
      patch.uiMode = body.uiMode;
      patch.uiModeManual = true;
    }
    if (body.ageBand !== undefined) {
      if ((body.ageBand === "adult") !== (principal.kind === "adult") || principal.kind === "staff") {
        throw invalidField("/ageBand", principal.kind === "adult" ? "Для взрослого аккаунта — только «взрослый»" : "Этот возраст здесь выбрать нельзя");
      }
      patch.uiMode = UI_MODE_BY_BAND[body.ageBand];
      patch.uiModeManual = true;
    }
    if (body.dailyGoal !== undefined) patch.dailyGoal = body.dailyGoal;
    if (body.locale !== undefined) patch.locale = body.locale;
    await this.accounts.update(principal.accountId, patch);
    return this.me(principal.accountId);
  }
}
