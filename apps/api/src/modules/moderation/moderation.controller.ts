import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { CurrentPrincipal, ReqMeta, type Principal, type RequestMeta } from "../../common/auth.js";
import { Operation, type OperationQuery } from "../../common/contract.js";
import { VerificationService } from "./verification.service.js";

@Controller()
export class ModerationController {
  constructor(private readonly verifications: VerificationService) {}

  @Post("teacher/verification")
  @HttpCode(201)
  @Operation("submitTeacherVerification")
  submit(
    @CurrentPrincipal() principal: Principal,
    @Body() body: Schema<"TeacherVerificationRequest">,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Schema<"TeacherVerification">> {
    return this.verifications.submit(principal, body, meta);
  }

  @Get("teacher/verification")
  @Operation("getMyTeacherVerification")
  mine(@CurrentPrincipal() principal: Principal): Promise<Schema<"TeacherVerification">> {
    return this.verifications.mine(principal);
  }

  @Get("moderation/teacher-verifications")
  @Operation("listTeacherVerifications")
  list(@Query() query: OperationQuery<"listTeacherVerifications", "limit">): Promise<Schema<"TeacherVerificationPage">> {
    return this.verifications.list(query);
  }

  @Post("moderation/teacher-verifications/:id/approve")
  @HttpCode(200)
  @Operation("approveTeacherVerification")
  approve(@CurrentPrincipal() principal: Principal, @Param("id") id: string, @ReqMeta() meta: RequestMeta): Promise<Schema<"TeacherVerification">> {
    return this.verifications.approve(principal, id, meta);
  }

  @Post("moderation/teacher-verifications/:id/reject")
  @HttpCode(200)
  @Operation("rejectTeacherVerification")
  reject(
    @CurrentPrincipal() principal: Principal,
    @Param("id") id: string,
    @Body() body: Schema<"RejectTeacherVerificationRequest">,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Schema<"TeacherVerification">> {
    return this.verifications.reject(principal, id, body.reason, meta);
  }
}
