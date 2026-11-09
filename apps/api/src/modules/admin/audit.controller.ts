import { Controller, Get, Query } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { Operation } from "../../common/contract.js";
import { AuditService, type AuditQuery } from "./audit.service.js";

/** Журнал аудита: читают модератор и администратор (x-access в контракте, проверяет AuthGuard). */
@Controller("admin/audit-log")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Operation("listAuditLog")
  list(@Query() query: AuditQuery): Promise<Schema<"AuditLogPage">> {
    return this.audit.list(query);
  }
}
