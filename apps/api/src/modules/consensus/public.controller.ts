import { Controller, Get } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { Operation } from "../../common/contract.js";
import { ConsensusService } from "./consensus.service.js";

/** Публичная витрина без регистрации (ТЗ §3.6): фраза дня — принятая пара корпуса для лендинга и бота. */
@Controller("public")
export class PublicController {
  constructor(private readonly consensus: ConsensusService) {}

  @Get("phrase-of-day")
  @Operation("getPhraseOfDay")
  phraseOfDay(): Promise<Schema<"PhraseOfDay">> {
    return this.consensus.phraseOfDay();
  }
}
