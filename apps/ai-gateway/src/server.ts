import Fastify, { type FastifyInstance } from "fastify";
import { ExplainContext, buildExplainPrompt, validateExplainOutput } from "./explain.js";
import type { LlmProvider } from "./providers/provider.js";

export const VERSION = "0.2.0";

/**
 * Шлюз AI (docs/04-ai-gigachat.md §4). Единственная функция — объяснение ошибки (сценарий 1): API собирает
 * контекст без ПДн и вызывает POST /v1/explain-error. Шлюз строит промпт из реестра, зовёт провайдера и
 * валидирует вывод закрытым словарём. Недоступен провайдер или ответ не прошёл валидацию — 503, API
 * деградирует к шаблону (принцип «продукт работает без AI», docs/04 §2.5): шаблоны у API, не у шлюза.
 */
export function buildServer(provider: LlmProvider, opts: { token?: string } = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get("/health", async () => ({ status: "ok", service: "ai-gateway", version: VERSION, provider: provider.name }));

  app.post("/v1/explain-error", async (request, reply) => {
    if (opts.token && request.headers.authorization !== `Bearer ${opts.token}`) {
      reply.code(401);
      return { code: "unauthorized" };
    }
    const parsed = ExplainContext.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { code: "context_invalid", detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    }
    if (provider.name === "mock") {
      reply.code(503);
      return { code: "ai_unavailable" };
    }
    const prompt = buildExplainPrompt(parsed.data);
    try {
      const completion = await provider.complete({ promptId: "explain_error@v1", ...prompt });
      const validated = validateExplainOutput(completion.text, parsed.data);
      if (!validated.ok) {
        request.log.warn({ reason: validated.reason }, "ai-gateway: ответ не прошёл валидацию");
        reply.code(503);
        return { code: "ai_invalid", reason: validated.reason };
      }
      return { text: validated.text, model: provider.name, usage: completion.usage };
    } catch (e) {
      request.log.warn({ err: String(e) }, "ai-gateway: провайдер недоступен");
      reply.code(503);
      return { code: "ai_unavailable" };
    }
  });

  return app;
}
