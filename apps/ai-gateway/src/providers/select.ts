import type { GatewayConfig } from "../config.js";
import { MockProvider } from "./mock.js";
import type { LlmProvider } from "./provider.js";

export interface ProviderSelection {
  provider: LlmProvider;
  warning?: string;
}

/** Без ключа — мок. Провайдера GigaChat пока нет: ключ игнорируется с предупреждением. */
export function selectProvider(config: GatewayConfig): ProviderSelection {
  if (config.GIGACHAT_AUTH_KEY) {
    return {
      provider: new MockProvider(),
      warning: "GIGACHAT_AUTH_KEY задан, но провайдер GigaChat появится в M5 — используется мок",
    };
  }
  return { provider: new MockProvider() };
}
