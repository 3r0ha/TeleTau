/** Абстракция LLM-провайдера (docs/04-ai-gigachat.md §4). Реализации: мок, GigaChat Cloud.ru / API Сбера. */
export interface CompletionRequest {
  /** Идентификатор промпта из реестра prompts/<feature>/vN.yaml */
  promptId: string;
  system: string;
  user: string;
}

export interface CompletionResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LlmProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}
