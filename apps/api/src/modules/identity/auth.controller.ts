import { Body, Controller, Get, Headers, HttpCode, Param, Post } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { CurrentPrincipal, ReqMeta, type Principal, type RequestMeta } from "../../common/auth.js";
import { Operation } from "../../common/contract.js";
import { MeService } from "./me.service.js";
import { OtpService } from "./otp.service.js";
import { SelfLearnerService } from "./self-learner.service.js";
import { SessionsService, type SessionTokens } from "./sessions.service.js";
import { StudentLoginService } from "./student-login.service.js";

type AuthSession = Schema<"AuthSession">;

@Controller("auth")
export class AuthController {
  constructor(
    private readonly students: StudentLoginService,
    private readonly otp: OtpService,
    private readonly sessions: SessionsService,
    private readonly me: MeService,
    private readonly selfLearners: SelfLearnerService,
  ) {}

  private async session(tokens: SessionTokens, accountId: string): Promise<AuthSession> {
    return { ...tokens, account: await this.me.me(accountId) };
  }

  @Post("qr")
  @HttpCode(200)
  @Operation("loginWithQrCard")
  async qr(@Body() body: Schema<"QrLoginRequest">, @ReqMeta() meta: RequestMeta): Promise<AuthSession> {
    const s = await this.students.loginWithQr(body, meta);
    return this.session(s.tokens, s.accountId);
  }

  /** «Учусь сам» (ADR 0022): аккаунт без ПДн — ник и возрастной диапазон. */
  @Post("self")
  @HttpCode(201)
  @Operation("createSelfLearner")
  async self(@Body() body: Schema<"SelfSignupRequest">, @ReqMeta() meta: RequestMeta): Promise<AuthSession> {
    const s = await this.selfLearners.signup(body, meta);
    return this.session(s.tokens, s.accountId);
  }

  /** Вход по личной карточке самостоятельного ученика (TP1, ADR 0022). */
  @Post("login-card")
  @HttpCode(200)
  @Operation("loginWithLoginCard")
  async loginCard(@Body() body: Schema<"LoginCardLoginRequest">, @ReqMeta() meta: RequestMeta): Promise<AuthSession> {
    const s = await this.selfLearners.loginWithCard(body, meta);
    return this.session(s.tokens, s.accountId);
  }

  @Post("class-code")
  @HttpCode(202)
  @Operation("requestClassCodeLogin")
  classCode(@Body() body: Schema<"ClassCodeLoginRequest">, @ReqMeta() meta: RequestMeta): Promise<Schema<"ClassCodeLoginTicket">> {
    return this.students.requestByClassCode(body, meta);
  }

  @Get("class-code/:requestId")
  @Operation("getClassCodeLoginStatus")
  async classCodeStatus(
    @Param("requestId") requestId: string,
    @Headers("x-poll-token") pollToken: string,
    @ReqMeta() meta: RequestMeta,
    @Headers("x-device-install-id") deviceInstallId?: string,
  ): Promise<Schema<"ClassCodeLoginStatus">> {
    const r = await this.students.poll(requestId, pollToken, deviceInstallId, meta);
    return {
      requestId,
      status: r.status,
      expiresAt: r.expiresAt.toISOString(),
      pollIntervalSeconds: r.pollIntervalSeconds,
      ...(r.session ? { session: await this.session(r.session.tokens, r.session.accountId) } : {}),
    };
  }

  @Post("otp/request")
  @HttpCode(202)
  @Operation("requestEmailOtp")
  otpRequest(@Body() body: Schema<"OtpRequest">, @ReqMeta() meta: RequestMeta): Promise<Schema<"OtpChallenge">> {
    return this.otp.request(body.email, meta);
  }

  @Post("otp/verify")
  @HttpCode(200)
  @Operation("verifyEmailOtp")
  async otpVerify(@Body() body: Schema<"OtpVerifyRequest">, @ReqMeta() meta: RequestMeta): Promise<AuthSession> {
    const account = await this.otp.verify(body, meta);
    const tokens = await this.sessions.start({ accountId: account.id, kind: account.kind, roles: account.roles }, body.device);
    return this.session(tokens, account.id);
  }

  @Post("refresh")
  @HttpCode(200)
  @Operation("refreshSession")
  async refresh(@Body() body: Schema<"RefreshRequest">, @ReqMeta() meta: RequestMeta): Promise<AuthSession> {
    const { tokens, accountId } = await this.sessions.refresh(body.refreshToken, body.deviceInstallId, meta);
    return this.session(tokens, accountId);
  }

  @Post("logout")
  @HttpCode(204)
  @Operation("logout")
  async logout(@CurrentPrincipal() principal: Principal, @Body() body: Schema<"LogoutRequest">): Promise<void> {
    await this.sessions.logout(principal, body?.allDevices ?? false);
  }
}
