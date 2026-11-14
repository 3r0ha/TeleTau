import { z } from "zod";

const Schema = z.object({
  AI_GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  /** Только локальные адреса по умолчанию: шлюз внутренний, наружу его не публикуем (ufw, deploy.md). */
  AI_GATEWAY_HOST: z.string().default("127.0.0.1"),
  /** Общий секрет API ↔ шлюз (заголовок Authorization: Bearer). Не задан — шлюз проверять нечего (localhost). */
  AI_GATEWAY_TOKEN: z.string().optional().transform((v) => (v ? v : undefined)),
  // GigaChat — API Сбера (docs/research/02-ai-and-language-tech.md §A: OAuth, токен 30 минут, корень НУЦ).
  GIGACHAT_AUTH_KEY: z.string().optional().transform((v) => (v ? v : undefined)),
  GIGACHAT_SCOPE: z.string().default("GIGACHAT_API_PERS"),
  GIGACHAT_BASE_URL: z.string().default("https://api.giga.chat/v1"),
  GIGACHAT_AUTH_URL: z.string().default("https://ngw.devices.sberbank.ru:9443/api/v2/oauth"),
  /** Корневой сертификат НУЦ Минцифры для TLS к GigaChat (не в git; скачать — Госуслуги, deploy.md). */
  GIGACHAT_CA_FILE: z.string().optional().transform((v) => (v ? v : undefined)),
  GIGACHAT_MODEL: z.string().default("GigaChat-2-Pro"),
  GIGACHAT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
});
export type GatewayConfig = z.infer<typeof Schema>;

export function loadConfig(env: Record<string, string | undefined>): GatewayConfig {
  const parsed = Schema.safeParse(env);
  if (!parsed.success) throw new Error(`Некорректная конфигурация ai-gateway:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
