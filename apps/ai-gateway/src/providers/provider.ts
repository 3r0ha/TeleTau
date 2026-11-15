/** Абстракция LLM-провайдера (docs/04-ai-gigachat.md §4). Реализации: мок, GigaChat Cloud.ru / API Сбера. */
export interface CompletionRequest {
  /** Идентификатор промпта из реестра prompts/<feature>/vN.md (`explain_error@v1`). */
  promptId: string;
  system: string;
  user: string;
  /** Параметры генерации из шапки промпта; нет — значения провайдера. */
  temperature?: number;
  maxTokens?: number;
}

export interface CompletionResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LlmProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

/** Сбой провайдера: в сообщении только статус и этап, без тел ответов (в них может быть эхо промпта). */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
