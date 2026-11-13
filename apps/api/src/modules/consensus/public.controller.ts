import { Controller, Get, Query, Res } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import type { FastifyReply } from "fastify";
import { Operation } from "../../common/contract.js";
import { ConsensusService } from "./consensus.service.js";
import { csvTable } from "./public-csv.js";

/** Публичная витрина без регистрации (ТЗ §3.6): фраза дня — принятая пара корпуса для лендинга и бота. */
@Controller("public")
export class PublicController {
  constructor(private readonly consensus: ConsensusService) {}

  @Get("phrase-of-day")
  @Operation("getPhraseOfDay")
  phraseOfDay(): Promise<Schema<"PhraseOfDay">> {
    return this.consensus.phraseOfDay();
  }

  /**
   * Публичный словарь (ТЗ §5): принятые пары без регистрации. CSV — как карточки PDF (ADR 0016 §4):
   * content-type через @Res, тело — возвратом, Fastify отдаёт строку как есть, без JSON-сериализации.
   */
  @Get("dictionary")
  @Operation("getPublicDictionary")
  async dictionary(
    @Query("status") status: Schema<"PublicDictionaryEntry">["status"] = "confirmed",
    @Query("format") format: "json" | "csv" = "json",
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Schema<"PublicDictionary"> | string> {
    const dictionary = await this.consensus.publicDictionary(status);
    if (format !== "csv") return dictionary;
    // Колонки — как в описании операции; источники — названия (title) через запятую.
    void reply.header("content-type", "text/csv; charset=utf-8");
    return csvTable([
      ["fragmentId", "langPair", "translation", "textBa", "status", "confirmed", "sources"],
      ...dictionary.items.map((i) => [i.fragmentId, i.langPair, i.translation, i.textBa, i.status, i.confirmed, i.sources.map((s) => s.title).join(", ")]),
    ]);
  }

  /** Доска почёта (ТЗ §4.5): активные школы и классы за период — только агрегаты (правило 13). */
  @Get("leaderboard")
  @Operation("getPublicLeaderboard")
  leaderboard(@Query("period") period: Schema<"PublicLeaderboard">["period"] = "week"): Promise<Schema<"PublicLeaderboard">> {
    return this.consensus.publicLeaderboard(period);
  }
}
