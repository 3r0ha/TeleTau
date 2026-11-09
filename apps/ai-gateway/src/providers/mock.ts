import type { CompletionRequest, CompletionResult, LlmProvider } from "./provider.js";

/** Детерминированный провайдер для разработки и тестов: не ходит в сеть и не тратит токены. */
export class MockProvider implements LlmProvider {
  readonly name = "mock";

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const text = JSON.stringify({ promptId: request.promptId, echo: request.user.slice(0, 200) });
    return { text, usage: { inputTokens: request.system.length + request.user.length, outputTokens: text.length } };
  }
}
