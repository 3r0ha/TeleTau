import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { CurrentPrincipal, type Principal } from "../../common/auth.js";
import { Operation } from "../../common/contract.js";
import { ConsensusService } from "./consensus.service.js";

@Controller("corpus")
export class ConsensusController {
  constructor(private readonly consensus: ConsensusService) {}

  @Get("duels")
  @Operation("listCorpusDuels")
  duels(@CurrentPrincipal() principal: Principal, @Query("limit") limit?: number): Promise<Schema<"CorpusDuelList">> {
    return this.consensus.listDuels(principal, limit ?? 3);
  }

  @Post("judgments")
  @HttpCode(201)
  @Operation("submitCorpusJudgment")
  judge(@CurrentPrincipal() principal: Principal, @Body() body: Schema<"JudgmentRequest">): Promise<Schema<"CorpusItemVotes">> {
    return this.consensus.submitJudgment(principal, body);
  }

  @Get("items/:id/votes")
  @Operation("getCorpusItemVotes")
  votes(@CurrentPrincipal() principal: Principal, @Param("id") id: string): Promise<Schema<"CorpusItemVotes">> {
    return this.consensus.itemVotes(principal, id);
  }

  @Get("my-cells")
  @Operation("listMyCorpusCells")
  cells(@CurrentPrincipal() principal: Principal, @Query("limit") limit?: number, @Query("cursor") cursor?: string): Promise<Schema<"MyCellsPage">> {
    return this.consensus.myCells(principal, limit ?? 50, cursor);
  }
}
