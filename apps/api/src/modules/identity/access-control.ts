// Контроль доступа (ADR 0015, 0017): access-токен → принципал, стоп-лист семейств в Valkey, роль из x-access контракта.
// Проверка идёт в хуке Fastify onRequest — до разбора и проверки тела: аноним получает 401, чужая роль — 403,
// а не 422 за неполное тело. Nest-guard ниже — страховка: обработчик не выполнится, если хук не отработал.
// Политики ресурса (учитель класса, участник класса, субъект согласия) проверяют сервисы модулей.
// Роль service (ADR 0020) — служебный вызов сервиса проекта (Telegram-бот): секрет в X-Service-Token, без пользователя;
// access-токен пользователя такую операцию не открывает (403), а секрет сервиса не открывает операции пользователей.
import { Inject, Injectable, type CanActivate, type ExecutionContext, type OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { hasAccessRole, type Principal } from "../../common/auth.js";
import { getOperation, type TeleTauRouteConfig } from "../../common/contract.js";
import { safeEquals } from "../../common/crypto.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { ApiError, forbidden, unauthorized } from "../../common/problem.js";
import { SessionsService } from "./sessions.service.js";
import { AccessTokenError, TokenService } from "./token.service.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Хук контроля доступа отработал для этого запроса. */
    accessChecked?: boolean;
    /** Запрос сервиса проекта с верным X-Service-Token (роль service). */
    serviceCaller?: boolean;
  }
}

const bearer = (header: string | undefined): string | undefined => /^Bearer\s+(\S+)$/i.exec(header ?? "")?.[1];

@Injectable()
export class AccessControl implements OnModuleInit {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly tokens: TokenService,
    private readonly sessions: SessionsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    const instance = this.adapterHost.httpAdapter.getInstance<FastifyInstance>();
    instance.addHook("onRequest", async (req) => this.authorize(req));
  }

  async authorize(req: FastifyRequest): Promise<void> {
    const id = (req.routeOptions.config as TeleTauRouteConfig | undefined)?.operationId;
    if (!id) return; // не маршрут контракта (404 и т. п.) — обработчика не будет
    const { roles } = getOperation(id).access;
    const token = bearer(req.headers.authorization);
    if (roles.includes("service")) return this.authorizeService(req, token);
    const anonymous = roles.includes("anonymous");

    let principal: Principal | undefined;
    if (token) {
      try {
        principal = await this.tokens.verify(token);
        if (await this.sessions.isFamilyRevoked(principal.sessionId)) {
          principal = undefined;
          if (!anonymous) throw unauthorized("session_revoked");
        }
      } catch (e) {
        principal = undefined;
        // На открытой операции недействительный токен не мешает: вход по QR или обновление сессии часто
        // приходят со старым access-токеном. Valkey недоступен — 503 только для закрытых операций.
        if (!anonymous) {
          if (e instanceof AccessTokenError) throw unauthorized(e.expired ? "token_expired" : "unauthenticated");
          throw e instanceof ApiError ? e : unauthorized();
        }
      }
    }
    if (principal) req.principal = principal;
    if (!anonymous) {
      if (!principal) throw unauthorized();
      if (!roles.some((r) => hasAccessRole(principal, r))) {
        throw forbidden(roles.length === 1 && roles[0] === "teacher" && principal.kind === "adult" ? "teacher_not_verified" : "forbidden");
      }
    }
    req.accessChecked = true;
  }

  /**
   * Роль service: верный X-Service-Token — пропуск. Без него действительный access-токен пользователя — чужая роль
   * (403), иначе — 401. Секрет не задан в конфигурации (BOT_SERVICE_TOKEN) — служебные операции закрыты для всех.
   */
  private async authorizeService(req: FastifyRequest, token: string | undefined): Promise<void> {
    const presented = req.headers["x-service-token"];
    const expected = this.config.BOT_SERVICE_TOKEN;
    if (expected && typeof presented === "string" && presented.length > 0 && safeEquals(presented, expected)) {
      req.serviceCaller = true;
      req.accessChecked = true;
      return;
    }
    // Пользователь с действительным access-токеном — чужая роль; стоп-лист семейств здесь не нужен: пропуска нет всё равно.
    if (token && (await this.tokens.verify(token).catch(() => undefined))) throw forbidden();
    throw unauthorized();
  }
}

/** Страховка: обработчик без пройденного контроля доступа не выполняется (deny by default). */
@Injectable()
export class AccessCheckedGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.switchToHttp().getRequest<FastifyRequest>().accessChecked !== true) throw forbidden();
    return true;
  }
}
