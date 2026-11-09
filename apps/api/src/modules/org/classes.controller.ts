import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Query, Res } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import type { FastifyReply } from "fastify";
import { CurrentPrincipal, ReqMeta, type Principal, type RequestMeta } from "../../common/auth.js";
import { Operation } from "../../common/contract.js";
import { ClassesService } from "./classes.service.js";
import { JoinService } from "./join.service.js";

/** Имя файла PDF: ASCII-запасной вариант и UTF-8 (RFC 6266 / RFC 5987). */
function contentDisposition(title: string): string {
  const base = `teletau-cards-${title.replace(/[«»]/g, "").trim().replace(/\s+/g, "-")}.pdf`;
  const ascii = base.replace(/[^\x20-\x7e]/g, "").replace(/-+\./, ".").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(base)}`;
}

@Controller("classes")
export class ClassesController {
  constructor(
    private readonly classes: ClassesService,
    private readonly join: JoinService,
  ) {}

  @Post()
  @HttpCode(201)
  @Operation("createClass")
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() body: Schema<"CreateClassRequest">,
    @Headers("idempotency-key") key?: string,
  ): Promise<Schema<"ClassDetail">> {
    return this.classes.create(principal, body, key);
  }

  @Get()
  @Operation("listClasses")
  list(@CurrentPrincipal() principal: Principal): Promise<Schema<"ClassList">> {
    return this.classes.listMine(principal);
  }

  @Get(":id")
  @Operation("getClass")
  get(@CurrentPrincipal() principal: Principal, @Param("id") id: string): Promise<Schema<"ClassDetail">> {
    return this.classes.get(principal, id);
  }

  @Post(":id/seats")
  @HttpCode(201)
  @Operation("issueSeats")
  issue(
    @CurrentPrincipal() principal: Principal,
    @Param("id") id: string,
    @Body() body: Schema<"IssueSeatsRequest">,
    @ReqMeta() meta: RequestMeta,
    @Headers("idempotency-key") key?: string,
  ): Promise<Schema<"SeatIssueResult">> {
    return this.classes.issueSeats(principal, id, body.count, meta, key);
  }

  @Get(":id/cards.pdf")
  @Operation("getClassCardsPdf")
  async pdf(
    @CurrentPrincipal() principal: Principal,
    @Param("id") id: string,
    @Query("printJob") printJob: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const { pdf, title } = await this.classes.cardsPdf(principal, id, printJob);
    // В PDF — секреты карточек: не кешировать нигде (ADR 0016 §4).
    void reply.header("content-type", "application/pdf").header("content-disposition", contentDisposition(title)).header("cache-control", "no-store");
    return pdf;
  }

  @Post(":id/seats/:seat/reissue")
  @HttpCode(200)
  @Operation("reissueSeatCard")
  reissue(
    @CurrentPrincipal() principal: Principal,
    @Param("id") id: string,
    @Param("seat") seat: number,
    @ReqMeta() meta: RequestMeta,
    @Headers("idempotency-key") key?: string,
  ): Promise<Schema<"SeatIssueResult">> {
    return this.classes.reissue(principal, id, seat, meta, key);
  }

  @Post(":id/join-code")
  @HttpCode(201)
  @Operation("createClassJoinCode")
  joinCode(@CurrentPrincipal() principal: Principal, @Param("id") id: string, @ReqMeta() meta: RequestMeta): Promise<Schema<"JoinCode">> {
    return this.join.issueCode(principal, id, meta);
  }

  @Delete(":id/join-code")
  @HttpCode(204)
  @Operation("closeClassJoinCode")
  closeJoinCode(@CurrentPrincipal() principal: Principal, @Param("id") id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.join.closeCode(principal, id, meta);
  }

  @Get(":id/join-requests")
  @Operation("listClassJoinRequests")
  joinRequests(
    @CurrentPrincipal() principal: Principal,
    @Param("id") id: string,
    @Query("status") status?: Schema<"JoinRequestStatus">,
  ): Promise<Schema<"JoinRequestList">> {
    return this.join.list(principal, id, status);
  }

  @Post(":id/join-requests/:rid/approve")
  @HttpCode(200)
  @Operation("approveJoinRequest")
  approve(
    @CurrentPrincipal() principal: Principal,
    @Param("id") id: string,
    @Param("rid") rid: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Schema<"JoinRequest">> {
    return this.join.approve(principal, id, rid, meta);
  }

  @Post(":id/join-requests/:rid/reject")
  @HttpCode(200)
  @Operation("rejectJoinRequest")
  reject(
    @CurrentPrincipal() principal: Principal,
    @Param("id") id: string,
    @Param("rid") rid: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Schema<"JoinRequest">> {
    return this.join.reject(principal, id, rid, meta);
  }
}
