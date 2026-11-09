import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { CurrentPrincipal, ReqMeta, type Principal, type RequestMeta } from "../../common/auth.js";
import { Operation } from "../../common/contract.js";
import { RateLimiter } from "../../infra/rate-limiter.js";
import { MeService } from "./me.service.js";
import { SelfLearnerService } from "./self-learner.service.js";
import { suggestNicknames } from "./nicknames.js";

@Controller()
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly limiter: RateLimiter,
    private readonly selfLearners: SelfLearnerService,
  ) {}

  @Get("me")
  @Operation("getMe")
  get(@CurrentPrincipal() principal: Principal): Promise<Schema<"Me">> {
    return this.me.me(principal.accountId);
  }

  @Patch("me")
  @Operation("updateMe")
  update(@CurrentPrincipal() principal: Principal, @Body() body: Schema<"UpdateMeRequest">): Promise<Schema<"Me">> {
    return this.me.update(principal, body);
  }

  // ── самостоятельное обучение (ADR 0022) ──

  @Get("me/login-card")
  @Operation("getMyLoginCard")
  loginCard(@CurrentPrincipal() principal: Principal): Promise<Schema<"LoginCard">> {
    return this.selfLearners.myCard(principal);
  }

  @Post("me/login-card")
  @HttpCode(201)
  @Operation("issueMyLoginCard")
  issueLoginCard(@CurrentPrincipal() principal: Principal, @ReqMeta() meta: RequestMeta): Promise<Schema<"LoginCard">> {
    return this.selfLearners.issueCard(principal, meta);
  }

  @Post("me/email")
  @HttpCode(200)
  @Operation("attachMyEmail")
  async attachEmail(@CurrentPrincipal() principal: Principal, @Body() body: Schema<"AttachEmailRequest">, @ReqMeta() meta: RequestMeta): Promise<Schema<"Me">> {
    await this.selfLearners.attachEmail(principal, body, meta);
    return this.me.me(principal.accountId);
  }

  @Post("me/class-join")
  @HttpCode(202)
  @Operation("requestClassJoin")
  classJoin(@CurrentPrincipal() principal: Principal, @Body() body: Schema<"ClassJoinRequest">, @ReqMeta() meta: RequestMeta): Promise<Schema<"ClassJoinTicket">> {
    return this.selfLearners.requestClassJoin(principal, body, meta);
  }

  @Get("me/class-join/:requestId")
  @Operation("getClassJoinStatus")
  classJoinStatus(@CurrentPrincipal() principal: Principal, @Param("requestId") requestId: string): Promise<Schema<"ClassJoinTicket">> {
    return this.selfLearners.classJoinStatus(principal, requestId);
  }

  /** Доступно без входа: ник выбирают до одобрения заявки по коду класса. Частота — по IP. */
  @Get("nicknames/suggest")
  @Operation("suggestNicknames")
  async suggest(@Query("count") count: number, @ReqMeta() meta: RequestMeta): Promise<Schema<"NicknameSuggestions">> {
    await this.limiter.consume(`nicknames:ip:${this.limiter.ipKey(meta.ip)}`, { max: 120, windowMs: 60_000 });
    return { items: suggestNicknames(count ?? 3) };
  }
}
