import { Controller, Get } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { Operation } from "../../common/contract.js";
import { ConsensusService } from "./consensus.service.js";

/** Словарь для Фонда (ADR 0023): принятые пары с голосами по группам — только для роли fund. */
@Controller("fund")
export class FundController {
  constructor(private readonly consensus: ConsensusService) {}

  @Get("dictionary")
  @Operation("getFundDictionary")
  dictionary(): Promise<Schema<"FundDictionary">> {
    return this.consensus.fundDictionary();
  }
}
