import Fastify, { type FastifyInstance } from "fastify";
import type { LlmProvider } from "./providers/provider.js";

export const VERSION = "0.1.0";

export function buildServer(provider: LlmProvider): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get("/health", async () => ({ status: "ok", service: "ai-gateway", version: VERSION, provider: provider.name }));
  return app;
}
