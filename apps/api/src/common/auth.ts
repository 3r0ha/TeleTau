// Кто вызывает API: принципал из access-токена (ADR 0015) и служебные сведения запроса.
// Здесь нет зависимостей от модулей: токен проверяет AuthGuard модуля identity, остальные модули только читают результат.
import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import type { FastifyRequest } from "fastify";
import type { AccessRole } from "./contract.js";
import { unauthorized } from "./problem.js";

export type AccountKind = Schema<"AccountKind">;
/** Роль из контракта (`Role`): закрытый набор базовой версии контракта — `Me.roles`, `AuditActor.roles`. */
export type ContractRole = Schema<"Role">;
/** Роли сотрудников из ADR 0023: в ответах API — только в `staffRoles` (расширяемый `StaffRole`). */
export const LATER_STAFF_ROLES = ["ministry", "fund"] as const;
/** Роль RBAC аккаунта (accounts.roles, утверждение `roles` в JWT; ADR 0017, 0023). */
export type Role = ContractRole | (typeof LATER_STAFF_ROLES)[number];
export const ALL_ROLES: readonly Role[] = ["student", "teacher", "moderator", "admin", ...LATER_STAFF_ROLES];

/** Роли для полей `roles` контракта: только из закрытого набора `Role`. */
export const contractRoles = (roles: readonly Role[]): ContractRole[] =>
  roles.filter((r): r is ContractRole => !(LATER_STAFF_ROLES as readonly string[]).includes(r));
/** `staffRoles` контракта: все роли сотрудника (у не-сотрудника поля нет). */
export const staffRolesOf = (kind: AccountKind, roles: readonly Role[]): string[] | undefined =>
  kind === "staff" ? roles.filter((r) => r !== "student" && r !== "teacher") : undefined;

export interface Principal {
  accountId: string;
  kind: AccountKind;
  /** Роли RBAC — снимок на момент выпуска access-токена (ADR 0015 §1). */
  roles: Role[];
  /** `sid` — семейство сессии. */
  sessionId: string;
  /** `did` — устройство сессии. */
  deviceId: string;
}

/** Сведения о запросе для аудита и ограничения частоты: IP в аудит не пишется, только его HMAC (ADR 0017). */
export interface RequestMeta {
  ip: string;
  requestId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
  }
}

/** Проходит ли принципал роль x-access (`adult` — любой взрослый аккаунт, включая подтверждённого учителя). */
export function hasAccessRole(p: Principal | undefined, role: AccessRole): boolean {
  switch (role) {
    case "anonymous":
      return true;
    case "any":
      return p !== undefined;
    case "adult":
      return p?.kind === "adult";
    case "service":
      // Служебный вызов (ADR 0020): секрет сервиса проверяет AccessControl, у пользователя этой роли нет никогда.
      return false;
    default:
      return p?.roles.includes(role) ?? false;
  }
}

const requestOf = (ctx: ExecutionContext) => ctx.switchToHttp().getRequest<FastifyRequest>();

/** Принципал вошедшего пользователя; на операции без входа — 401. */
export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  const principal = requestOf(ctx).principal;
  if (!principal) throw unauthorized();
  return principal;
});

/** Принципал, если запрос с действительным токеном (операции с необязательным входом). */
export const OptionalPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal | undefined => requestOf(ctx).principal);

export const ReqMeta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = requestOf(ctx);
  return { ip: req.ip, requestId: String(req.id) };
});
