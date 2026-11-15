// Публичная витрина без входа — правила без базы: кеш процесса и Cache-Control у фразы дня, словаря и доски почёта,
// устойчивость фразы дня в течение суток, «ёлочки» в названиях из справочника.
import type { Schema } from "@teletau/contracts";
import { describe, expect, it } from "vitest";
import { typographicQuotes } from "../src/common/text.js";
import { TtlCache } from "../src/common/ttl-cache.js";
import type { AppConfig } from "../src/config/config.js";
import type { RateLimiter } from "../src/infra/rate-limiter.js";
import { ConsensusService } from "../src/modules/consensus/consensus.service.js";
import { PublicController } from "../src/modules/consensus/public.controller.js";
import type { FastifyReply } from "fastify";

describe("typographicQuotes", () => {
  it("прямые кавычки названия — «ёлочками», вложенные тоже; без кавычек — без изменений", () => {
    expect(typographicQuotes('АНОО "Центр образования"')).toBe("АНОО «Центр образования»");
    expect(typographicQuotes('МБОУ "Гимназия им. Т. Кусимова" с. Аскарово')).toBe("МБОУ «Гимназия им. Т. Кусимова» с. Аскарово");
    expect(typographicQuotes('ГБОУ "Лицей "Содружество""')).toBe("ГБОУ «Лицей «Содружество»»");
    expect(typographicQuotes("МБОУ СОШ № 1")).toBe("МБОУ СОШ № 1");
  });
});

describe("TtlCache", () => {
  it("в пределах срока — один расчёт и для параллельных промахов; после срока — новый; ошибка не кешируется", async () => {
    let now = 0;
    let calls = 0;
    const cache = new TtlCache<number>(8, () => now);
    const compute = async () => ++calls;
    expect(await Promise.all([cache.get("k", 1000, compute), cache.get("k", 1000, compute)])).toEqual([1, 1]);
    now = 999;
    expect(await cache.get("k", 1000, compute)).toBe(1);
    now = 1000;
    expect(await cache.get("k", 1000, compute)).toBe(2);
    await expect(cache.get("bad", 1000, () => Promise.reject(new Error("db")))).rejects.toThrow("db");
    expect(await cache.get("bad", 1000, compute)).toBe(3);
  });
});

describe("PublicController: кеш и Cache-Control", () => {
  const dictionary: Schema<"PublicDictionary"> = { generatedAt: "2026-11-15T00:00:00.000Z", langPair: "ba-ru", items: [] };
  const setup = (seconds: number) => {
    const calls = { dictionary: 0, leaderboard: 0, phrase: 0 };
    const consensus = {
      publicDictionary: async () => (calls.dictionary++, dictionary),
      publicLeaderboard: async (period: string) => (calls.leaderboard++, { period }),
      phraseOfDay: async () => (calls.phrase++, { date: "2026-11-15" }),
    } as unknown as ConsensusService;
    const limiter = { consume: async () => undefined, ipKey: (ip: string) => ip } as unknown as RateLimiter;
    const controller = new PublicController(consensus, limiter, { PUBLIC_CACHE_SECONDS: seconds } as AppConfig);
    const headers = new Map<string, string>();
    const reply = { header: (k: string, v: string) => (headers.set(k, v), reply) } as unknown as FastifyReply;
    const meta = { ip: "203.0.113.5", requestId: "r", userAgent: "" } as never;
    return { controller, calls, headers, reply, meta };
  };

  it("словарь и доска: повтор в пределах минуты — из кеша; заголовок public, max-age=60", async () => {
    const { controller, calls, headers, reply, meta } = setup(60);
    await controller.dictionary(meta, reply, "confirmed", "json");
    await controller.dictionary(meta, reply, "confirmed", "csv");
    await controller.leaderboard(meta, reply, "week");
    await controller.leaderboard(meta, reply, "week");
    await controller.leaderboard(meta, reply, "day");
    expect(calls).toMatchObject({ dictionary: 1, leaderboard: 2 });
    expect(headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("фраза дня: Cache-Control до полуночи по Уфе (не больше суток)", async () => {
    const { controller, headers, reply, meta } = setup(60);
    await controller.phraseOfDay(meta, reply);
    const maxAge = Number(/^public, max-age=(\d+)$/.exec(headers.get("cache-control") ?? "")?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(86_400);
  });

  it("PUBLIC_CACHE_SECONDS=0 — без кеша процесса", async () => {
    const { controller, calls, reply, meta } = setup(0);
    await controller.leaderboard(meta, reply, "week");
    await controller.leaderboard(meta, reply, "week");
    expect(calls.leaderboard).toBe(2);
  });
});

describe("фраза дня: пара, принятая днём, не меняет выбор до полуночи по Уфе", () => {
  const pair = (variantId: string, decidedAt: string): Schema<"FundPair"> =>
    ({ itemId: variantId, variantId, sourceRu: `ru-${variantId}`, langPair: "ba-ru", kind: "phrase", textBa: `ba-${variantId}`, sources: [], main: true, decidedAt }) as unknown as Schema<"FundPair">;
  const serviceWith = (items: Schema<"FundPair">[]) => {
    const svc = Object.create(ConsensusService.prototype) as ConsensusService;
    svc.fundDictionary = async () => ({ generatedAt: "", items });
    return svc;
  };

  it("в каждые из 30 суток пара, принятая в эти сутки в 12:00 по Уфе, во фразу дня не попадает", async () => {
    const old = [pair("00000000-0000-4000-8000-000000000001", "2026-10-01T00:00:00.000Z"), pair("00000000-0000-4000-8000-000000000002", "2026-10-01T00:00:00.000Z")];
    for (let d = 0; d < 30; d++) {
      const day = new Date(Date.UTC(2026, 10, 1 + d));
      const noonUfa = new Date(day.getTime() + 7 * 3_600_000).toISOString();
      const evening = new Date(day.getTime() + 14 * 3_600_000);
      const fresh = pair("00000000-0000-4000-8000-000000000003", noonUfa);
      const before = await serviceWith(old).phraseOfDay(evening);
      const after = await serviceWith([...old, fresh]).phraseOfDay(evening);
      expect(after.pair?.textBa).toBe(before.pair?.textBa);
      expect(after.pair?.textBa).not.toBe(fresh.textBa);
    }
  });

  it("пока пар, принятых до начала суток, нет — выбор из всех принятых", async () => {
    const only = pair("00000000-0000-4000-8000-000000000009", "2026-11-15T07:00:00.000Z");
    const res = await serviceWith([only]).phraseOfDay(new Date("2026-11-15T14:00:00.000Z"));
    expect(res.pair?.textBa).toBe(only.textBa);
  });
});
