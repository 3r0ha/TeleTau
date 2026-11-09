import Fastify, { type FastifyInstance } from "fastify";

export const VERSION = "0.1.0";
/** Возможности consensus-em, bradley-terry, simulator пока не реализованы. */
export const CAPABILITIES: readonly string[] = [];

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get("/health", async () => ({ status: "ok", service: "ml-worker", version: VERSION, capabilities: CAPABILITIES }));
  return app;
}
