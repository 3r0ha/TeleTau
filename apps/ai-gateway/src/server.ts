import { createHash, timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { EXPLAIN_FEATURE, ExplainContext, assertExplainPrompt, buildExplainPrompt, validateExplainOutput } from "./explain.js";
import { CircuitBreaker, DailyBudget } from "./guards.js";
import { loadPromptRegistry, type PromptRegistry } from "./prompts.js";
import type { LlmProvider } from "./providers/provider.js";

export const VERSION = "0.3.0";

/** Значения по умолчанию — как в config.ts (тесты и запуск без явных настроек). */
export const DEFAULT_DAILY_CALLS = 2000;
export const DEFAULT_BREAKER = { failures: 5, cooldownMs: 60_000 } as const;

export interface GatewayOptions {
  /** Общий секрет API ↔ шлюз (Authorization: Bearer). */
  token?: string;
  /** Журнал Fastify: false — выключен (тесты), иначе уровень. По умолчанию — info. */
  logger?: false | { level: string; stream?: { write(line: string): void } };
  prompts?: PromptRegistry;
  budget?: DailyBudget;
  breaker?: CircuitBreaker;
}

/** Секрет сравнивается за постоянное время: хеши одинаковой длины, timingSafeEqual. */
function bearerMatches(header: string | undefined, token: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
  const got = digest(header ?? "");
  const want = digest(`Bearer ${token}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Журнал без тел: метод, шаблон маршрута и статус. Тела запросов и ответов (контекст, ввод ученика, текст модели)
 * не пишутся никогда; причины отказов — кодами.
 */
function loggerOptions(logger: GatewayOptions["logger"]): FastifyServerOptions["logger"] {
  if (logger === false) return false;
  return {
    level: logger?.level ?? "info",
    ...(logger?.stream ? { stream: logger.stream } : {}),
    serializers: {
      req: (req: { method?: string; routeOptions?: { url?: string }; url?: string }) => ({ method: req.method, url: req.routeOptions?.url ?? req.url?.split("?")[0] }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
  };
}

/**
 * Шлюз AI (docs/04-ai-gigachat.md §4). Единственная функция — объяснение ошибки (сценарий 1): API собирает
 * контекст без ПДн и вызывает POST /v1/explain-error. Шлюз берёт промпт из реестра (prompts/), вычищает ПДн и
 * изолирует ввод ученика, соблюдает дневной бюджет и предохранитель, зовёт провайдера и валидирует вывод
 * (безопасность, закрытый словарь). Недоступен провайдер, исчерпан бюджет или ответ не прошёл валидацию — 503,
 * API деградирует к шаблону (принцип «продукт работает без AI», docs/04 §2.5): шаблоны у API, не у шлюза.
 */
export function buildServer(provider: LlmProvider, opts: GatewayOptions = {}): FastifyInstance {
  const prompts = opts.prompts ?? loadPromptRegistry();
  const latest = prompts.latest(EXPLAIN_FEATURE);
  if (!latest) throw new Error(`ai-gateway: в реестре нет промпта ${EXPLAIN_FEATURE}`);
  for (const id of prompts.ids()) {
    const p = prompts.get(id)!;
    if (p.feature === EXPLAIN_FEATURE) assertExplainPrompt(p);
  }
  const budget = opts.budget ?? new DailyBudget(DEFAULT_DAILY_CALLS);
  const breaker = opts.breaker ?? new CircuitBreaker(DEFAULT_BREAKER.failures, DEFAULT_BREAKER.cooldownMs);

  const app = Fastify({ logger: loggerOptions(opts.logger) });
  app.get("/health", async () => ({ status: "ok", service: "ai-gateway", version: VERSION, provider: provider.name, prompts: prompts.ids() }));

  app.post("/v1/explain-error", async (request, reply) => {
    if (opts.token && !bearerMatches(request.headers.authorization, opts.token)) {
      request.log.warn({ code: "unauthorized" }, "explain-error rejected");
      reply.code(401);
      return { code: "unauthorized" };
    }
    const parsed = ExplainContext.safeParse(request.body);
    if (!parsed.success) {
      // Путь и сообщение схемы — без значений полей.
      const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      request.log.warn({ code: "context_invalid" }, "explain-error rejected");
      reply.code(400);
      return { code: "context_invalid", detail };
    }
    const prompt = parsed.data.promptId === undefined ? latest : prompts.get(parsed.data.promptId);
    if (!prompt || prompt.feature !== EXPLAIN_FEATURE) {
      request.log.warn({ code: "prompt_unknown" }, "explain-error rejected");
      reply.code(400);
      return { code: "prompt_unknown" };
    }
    if (provider.name === "mock") {
      reply.code(503);
      return { code: "ai_unavailable" };
    }
    if (!breaker.allow()) {
      request.log.warn({ code: "ai_unavailable", reason: "breaker_open", promptId: prompt.promptId }, "explain-error rejected");
      reply.code(503);
      return { code: "ai_unavailable" };
    }
    if (!budget.take()) {
      request.log.warn({ code: "ai_budget_exhausted", promptId: prompt.promptId }, "explain-error rejected");
      reply.code(503);
      return { code: "ai_budget_exhausted" };
    }
    const built = buildExplainPrompt(parsed.data, prompt);
    let completion;
    try {
      completion = await provider.complete({
        promptId: prompt.promptId,
        ...built,
        ...(prompt.temperature !== undefined ? { temperature: prompt.temperature } : {}),
        ...(prompt.maxTokens !== undefined ? { maxTokens: prompt.maxTokens } : {}),
      });
      breaker.success();
    } catch (e) {
      breaker.failure();
      request.log.warn({ code: "ai_unavailable", reason: "provider_error", err: e instanceof Error ? e.message : "unknown", promptId: prompt.promptId }, "explain-error rejected");
      reply.code(503);
      return { code: "ai_unavailable" };
    }
    const validated = validateExplainOutput(completion.text, parsed.data);
    if (!validated.ok) {
      request.log.warn({ code: "ai_invalid", reason: validated.reason, promptId: prompt.promptId }, "explain-error rejected");
      reply.code(503);
      return { code: "ai_invalid", reason: validated.reason };
    }
    request.log.info({ promptId: prompt.promptId, usage: completion.usage }, "explain-error ok");
    return { text: validated.text, model: provider.name, promptId: prompt.promptId, usage: completion.usage };
  });

  return app;
}
