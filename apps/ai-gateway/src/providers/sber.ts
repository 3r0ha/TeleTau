// Провайдер GigaChat — API Сбера (docs/04-ai-gigachat.md §4; схема — как в research/02 §A):
// Authorization key (Basic) → OAuth-токен на 30 минут (кеш ~25 минут) → POST /chat/completions.
// Корень НУЦ Минцифры передаётся в undici Agent как дополнительный CA — проверку TLS не отключаем.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Agent, fetch as undiciFetch } from "undici";
import type { GatewayConfig } from "../config.js";
import type { CompletionRequest, CompletionResult, LlmProvider } from "./provider.js";

export class SberProvider implements LlmProvider {
  readonly name = "gigachat-sber";
  private token: { value: string; expiresAt: number } | null = null;
  private readonly dispatcher: Agent;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: GatewayConfig) {
    const ca = config.GIGACHAT_CA_FILE ? readFileSync(config.GIGACHAT_CA_FILE) : undefined;
    this.dispatcher = new Agent({ connect: { ca } });
    this.model = config.GIGACHAT_MODEL;
    this.timeoutMs = config.GIGACHAT_TIMEOUT_MS;
  }

  private async accessToken(): Promise<string> {
    // Запас 5 минут: до истечения токен перевыпрашивать нечего.
    if (this.token && this.token.expiresAt - Date.now() > 5 * 60_000) return this.token.value;
    const res = await undiciFetch(this.config.GIGACHAT_AUTH_URL, {
      method: "POST",
      dispatcher: this.dispatcher,
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        Authorization: `Basic ${this.config.GIGACHAT_AUTH_KEY}`,
        RqUID: randomUUID(),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: `scope=${encodeURIComponent(this.config.GIGACHAT_SCOPE)}`,
    });
    if (!res.ok) throw new Error(`GigaChat OAuth: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_at: number };
    this.token = { value: body.access_token, expiresAt: body.expires_at * 1000 };
    return body.access_token;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const token = await this.accessToken();
    const res = await undiciFetch(`${this.config.GIGACHAT_BASE_URL}/chat/completions`, {
      method: "POST",
      dispatcher: this.dispatcher,
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        // Системное сообщение — одно и первым (требование API Сбера), температура низкая: объяснение повторяемо.
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        temperature: 0.2,
        max_tokens: 300,
      }),
    });
    if (res.status === 401) this.token = null;
    if (!res.ok) throw new Error(`GigaChat: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = body.choices?.[0]?.message?.content ?? "";
    return {
      text,
      usage: { inputTokens: Number(body.usage?.prompt_tokens ?? 0), outputTokens: Number(body.usage?.completion_tokens ?? 0) },
    };
  }
}
