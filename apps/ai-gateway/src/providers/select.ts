import type { GatewayConfig } from "../config.js";
import { MockProvider } from "./mock.js";
import { SberProvider } from "./sber.js";
import type { LlmProvider } from "./provider.js";

export interface ProviderSelection {
  provider: LlmProvider;
  warning?: string;
}

/** С ключом Сбера — живой GigaChat; без ключа — мок (шлюз отвечает 503 на AI-запросы, API деградирует к шаблонам). */
export function selectProvider(config: GatewayConfig): ProviderSelection {
  if (config.GIGACHAT_AUTH_KEY) return { provider: new SberProvider(config) };
  return {
    provider: new MockProvider(),
    warning: "GIGACHAT_AUTH_KEY не задан — ai-gateway работает без GigaChat (объяснения ошибок будут шаблонными)",
  };
}
