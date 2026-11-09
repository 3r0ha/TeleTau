import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { CurrentPrincipal, type Principal } from "../../common/auth.js";
import { Operation } from "../../common/contract.js";
import { AssignmentsService } from "./assignments.service.js";

@Controller("classes")
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get(":id/assignments")
  @Operation("listClassAssignments")
  list(@CurrentPrincipal() principal: Principal, @Param("id") id: string): Promise<Schema<"ClassAssignments">> {
    return this.assignments.list(principal, id);
  }

  @Post(":id/assignments")
  @HttpCode(201)
  @Operation("createClassAssignment")
  create(
    @CurrentPrincipal() principal: Principal,
    @Param("id") id: string,
    @Body() body: Schema<"CreateAssignmentRequest">,
    @Headers("idempotency-key") key?: string,
  ): Promise<Schema<"ClassAssignment">> {
    return this.assignments.create(principal, id, body, key);
  }

  @Delete(":id/assignments/:assignmentId")
  @HttpCode(204)
  @Operation("cancelClassAssignment")
  cancel(@CurrentPrincipal() principal: Principal, @Param("id") id: string, @Param("assignmentId") assignmentId: string): Promise<void> {
    return this.assignments.cancel(principal, id, assignmentId);
  }
}
