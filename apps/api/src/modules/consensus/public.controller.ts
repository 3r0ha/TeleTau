import { Controller, Get, Inject, Query, Res } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { ufaDayNumber, ufaMidnight } from "@teletau/domain-rules";
import type { FastifyReply } from "fastify";
import { ReqMeta, type RequestMeta } from "../../common/auth.js";
import { Operation } from "../../common/contract.js";
import { ApiError } from "../../common/problem.js";
import { TtlCache } from "../../common/ttl-cache.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { RateLimiter, type Limit } from "../../infra/rate-limiter.js";
import { ConsensusService } from "./consensus.service.js";
import { csvTable } from "./public-csv.js";

/**
 * Запросов к витрине с одного IP в минуту. Ответы кешируются, поэтому лимит щедрый: лендинг рендерится сервером веба
 * с одного адреса на всех посетителей.
 */
export const PUBLIC_IP_LIMIT: Limit = { max: 600, windowMs: 60_000 };

/**
 * Публичная витрина без регистрации (x-access: anonymous): фраза дня (ТЗ §3.6), словарь (ТЗ §5), доска почёта (ТЗ §4.5).
 * Ответы одинаковы для всех — кеш процесса на PUBLIC_CACHE_SECONDS и `Cache-Control: public` для браузеров и прокси
 * (у фразы дня — до полуночи по Уфе: в течение суток пара не меняется); лимит запросов по IP. Valkey недоступен — лимит не мешает витрине.
 */
@Controller("public")
export class PublicController {
  private readonly cache = new TtlCache<unknown>();

  constructor(
    private readonly consensus: ConsensusService,
    private readonly limiter: RateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get("phrase-of-day")
  @Operation("getPhraseOfDay")
  async phraseOfDay(@ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) reply: FastifyReply): Promise<Schema<"PhraseOfDay">> {
    await this.limit(meta);
    const now = new Date();
    const day = ufaDayNumber(now);
    const untilMidnight = Math.max(1, Math.floor((ufaMidnight(day + 1).getTime() - now.getTime()) / 1000));
    const phrase = await this.cached(`phrase:${day}`, this.config.PUBLIC_CACHE_SECONDS, () => this.consensus.phraseOfDay(now));
    this.publicCache(reply, untilMidnight);
    return phrase;
  }

  /**
   * Публичный словарь (ТЗ §5): принятые пары без регистрации. CSV — как карточки PDF (ADR 0016 §4):
   * content-type через @Res, тело — возвратом, Fastify отдаёт строку как есть, без JSON-сериализации.
   */
  @Get("dictionary")
  @Operation("getPublicDictionary")
  async dictionary(
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query("status") status: Schema<"PublicDictionaryEntry">["status"] = "confirmed",
    @Query("format") format: "json" | "csv" = "json",
  ): Promise<Schema<"PublicDictionary"> | string> {
    await this.limit(meta);
    const dictionary = await this.cached(`dictionary:${status}`, this.config.PUBLIC_CACHE_SECONDS, () => this.consensus.publicDictionary(status));
    this.publicCache(reply, this.config.PUBLIC_CACHE_SECONDS);
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
  async leaderboard(
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query("period") period: Schema<"PublicLeaderboard">["period"] = "week",
  ): Promise<Schema<"PublicLeaderboard">> {
    await this.limit(meta);
    const board = await this.cached(`leaderboard:${period}`, this.config.PUBLIC_CACHE_SECONDS, () => this.consensus.publicLeaderboard(period));
    this.publicCache(reply, this.config.PUBLIC_CACHE_SECONDS);
    return board;
  }

  private cached<T>(key: string, seconds: number, compute: () => Promise<T>): Promise<T> {
    if (this.config.PUBLIC_CACHE_SECONDS === 0) return compute();
    return this.cache.get(key, seconds * 1000, compute) as Promise<T>;
  }

  /** Только у операций x-access: anonymous и только у успешного ответа (ошибки и остальные ответы API — no-store). */
  private publicCache(reply: FastifyReply, seconds: number): void {
    void reply.header("cache-control", `public, max-age=${seconds}`);
  }

  /** 429 — сверх лимита; Valkey недоступен (503) — витрина работает без лимита. */
  private async limit(meta: RequestMeta): Promise<void> {
    try {
      await this.limiter.consume(`public:ip:${this.limiter.ipKey(meta.ip)}`, PUBLIC_IP_LIMIT);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) throw e;
    }
  }
}
