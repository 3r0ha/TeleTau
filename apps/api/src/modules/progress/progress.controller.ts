import { Controller, Get, Param } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { CurrentPrincipal, type Principal } from "../../common/auth.js";
import { Operation } from "../../common/contract.js";
import { ProgressService } from "./progress.service.js";

@Controller()
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  @Get("me/progress")
  @Operation("getMyProgress")
  mine(@CurrentPrincipal() principal: Principal): Promise<Schema<"MyProgress">> {
    return this.progress.myProgress(principal);
  }

  @Get("classes/:id/seats/:seat/progress")
  @Operation("getSeatProgress")
  seat(@CurrentPrincipal() principal: Principal, @Param("id") id: string, @Param("seat") seat: string): Promise<Schema<"SeatProgressCard">> {
    return this.progress.seatProgress(principal, id, Number(seat));
  }

  @Get("classes/:id/progress")
  @Operation("getClassProgress")
  ofClass(@CurrentPrincipal() principal: Principal, @Param("id") id: string): Promise<Schema<"ClassProgress">> {
    return this.progress.classProgress(principal, id);
  }
}
