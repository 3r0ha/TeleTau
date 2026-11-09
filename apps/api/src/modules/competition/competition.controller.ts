import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { CurrentPrincipal, type Principal } from "../../common/auth.js";
import { Operation } from "../../common/contract.js";
import { CompetitionService } from "./competition.service.js";

@Controller()
export class CompetitionController {
  constructor(private readonly competition: CompetitionService) {}

  @Get("leagues/current")
  @Operation("getCurrentLeague")
  current(@CurrentPrincipal() principal: Principal): Promise<Schema<"LeagueStanding">> {
    return this.competition.currentLeague(principal);
  }

  @Post("leagues/result-seen")
  @HttpCode(204)
  @Operation("markLeagueResultSeen")
  resultSeen(@CurrentPrincipal() principal: Principal, @Body() body: Schema<"LeagueResultSeenRequest">): Promise<void> {
    return this.competition.markResultSeen(principal, body);
  }

  @Get("classes/:id/hive")
  @Operation("getClassHive")
  hive(@CurrentPrincipal() principal: Principal, @Param("id") id: string): Promise<Schema<"ClassHive">> {
    return this.competition.classHive(principal, id);
  }
}
