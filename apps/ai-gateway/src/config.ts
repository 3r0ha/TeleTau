import { z } from "zod";

const Schema = z.object({
  AI_GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  GIGACHAT_AUTH_KEY: z.string().optional().transform((v) => (v ? v : undefined)),
});
export type GatewayConfig = z.infer<typeof Schema>;

export function loadConfig(env: Record<string, string | undefined>): GatewayConfig {
  const parsed = Schema.safeParse(env);
  if (!parsed.success) throw new Error(`Некорректная конфигурация ai-gateway:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
