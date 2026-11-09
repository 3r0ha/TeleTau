import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { CurrentPrincipal, ReqMeta, type Principal, type RequestMeta } from "../../common/auth.js";
import { Operation } from "../../common/contract.js";
import { ConsentService } from "./consent.service.js";
import type { LegalDocumentKind } from "./legal-texts.js";

@Controller()
export class ConsentController {
  constructor(private readonly consents: ConsentService) {}

  @Get("legal-documents/current")
  @Operation("listCurrentLegalDocuments")
  current(@Query("kind") kind?: LegalDocumentKind): Promise<Schema<"LegalDocumentList">> {
    return this.consents.listCurrent(kind);
  }

  @Get("legal-documents/:kind/:version")
  @Operation("getLegalDocument")
  text(@Param("kind") kind: LegalDocumentKind, @Param("version") version: string): Promise<Schema<"LegalDocumentText">> {
    return this.consents.documentText(kind, version);
  }

  @Post("consents")
  @HttpCode(201)
  @Operation("acceptConsents")
  accept(
    @CurrentPrincipal() principal: Principal,
    @Body() body: Schema<"AcceptConsentsRequest">,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Schema<"ConsentList">> {
    return this.consents.accept(principal, body.documentIds, meta);
  }

  @Post("classes/:id/seats/:seat/paper-consent")
  @HttpCode(201)
  @Operation("recordPaperConsent")
  paper(
    @CurrentPrincipal() principal: Principal,
    @Param("id") classId: string,
    @Param("seat") seat: number,
    @Body() body: Schema<"PaperConsentRequest">,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Schema<"Consent">> {
    return this.consents.recordPaper(principal, classId, seat, body ?? {}, meta);
  }

  @Post("consents/:id/revoke")
  @HttpCode(200)
  @Operation("revokeConsent")
  revoke(@CurrentPrincipal() principal: Principal, @Param("id") id: string, @ReqMeta() meta: RequestMeta): Promise<Schema<"Consent">> {
    return this.consents.revoke(principal, id, meta);
  }
}
