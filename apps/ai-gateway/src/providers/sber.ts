// Провайдер GigaChat — API Сбера (docs/04-ai-gigachat.md §4; схема — как в research/02 §A):
// Authorization key (Basic) → OAuth-токен на 30 минут → POST /chat/completions.
// Токен кешируется до срока с запасом; параллельные запросы ждут одно получение токена. На 401 модели — один
// повтор со свежим токеном. Дедлайн один на весь вызов (токен + запрос + повтор) — GIGACHAT_TIMEOUT_MS.
// Корень НУЦ Минцифры передаётся в undici Agent как дополнительный CA — проверку TLS не отключаем.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Agent, fetch as undiciFetch } from "undici";
import type { GatewayConfig } from "../config.js";
import { ProviderError, type CompletionRequest, type CompletionResult, type LlmProvider } from "./provider.js";

export type FetchFn = typeof undiciFetch;

export interface SberDeps {
  fetch?: FetchFn;
  now?: () => number;
}

/** Токен перевыпрашивается заранее: за 5 минут до срока. */
const TOKEN_MARGIN_MS = 5 * 60_000;
/** `expires_at` OAuth — Unix-время в миллисекундах; значение меньше этого порога — секунды. */
const SECONDS_EPOCH_LIMIT = 1e12;

/** Промис с дедлайном: сигнал сработал раньше — отказ с причиной сигнала (исходный промис продолжает жить). */
function withDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason as Error);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export class SberProvider implements LlmProvider {
  readonly name = "gigachat-sber";
  private token: { value: string; expiresAt: number } | null = null;
  private pendingToken: Promise<string> | null = null;
  private readonly dispatcher: Agent;
  private readonly fetch: FetchFn;
  private readonly now: () => number;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: GatewayConfig,
    deps: SberDeps = {},
  ) {
    const ca = config.GIGACHAT_CA_FILE ? readFileSync(config.GIGACHAT_CA_FILE) : undefined;
    this.dispatcher = new Agent({ connect: { ca } });
    this.fetch = deps.fetch ?? undiciFetch;
    this.now = deps.now ?? Date.now;
    this.model = config.GIGACHAT_MODEL;
    this.timeoutMs = config.GIGACHAT_TIMEOUT_MS;
  }

  /** Действующий токен или одно общее получение нового для всех ждущих запросов. */
  private accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - this.now() > TOKEN_MARGIN_MS) return Promise.resolve(this.token.value);
    if (!this.pendingToken) {
      const pending = this.fetchToken().finally(() => {
        if (this.pendingToken === pending) this.pendingToken = null;
      });
      // Ждущий запрос мог уйти по своему дедлайну: отказ получения токена без слушателей не должен быть необработанным.
      pending.catch(() => undefined);
      this.pendingToken = pending;
    }
    return this.pendingToken;
  }

  private async fetchToken(): Promise<string> {
    const res = await this.fetch(this.config.GIGACHAT_AUTH_URL, {
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
    if (!res.ok) {
      await res.arrayBuffer().catch(() => undefined);
      throw new ProviderError(`GigaChat OAuth: HTTP ${res.status}`, res.status);
    }
    const body = (await res.json()) as { access_token?: unknown; expires_at?: unknown };
    if (typeof body.access_token !== "string" || !body.access_token || typeof body.expires_at !== "number") {
      throw new ProviderError("GigaChat OAuth: ответ без токена");
    }
    const expiresAt = body.expires_at < SECONDS_EPOCH_LIMIT ? body.expires_at * 1000 : body.expires_at;
    this.token = { value: body.access_token, expiresAt };
    return body.access_token;
  }

  private chat(request: CompletionRequest, token: string, signal: AbortSignal) {
    return this.fetch(`${this.config.GIGACHAT_BASE_URL}/chat/completions`, {
      method: "POST",
      dispatcher: this.dispatcher,
      signal,
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
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 300,
      }),
    });
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const deadline = AbortSignal.timeout(this.timeoutMs);
    let token = await withDeadline(this.accessToken(), deadline);
    let res = await this.chat(request, token, deadline);
    if (res.status === 401) {
      // Токен отозван раньше срока: один повтор со свежим.
      await res.arrayBuffer().catch(() => undefined);
      if (this.token?.value === token) this.token = null;
      token = await withDeadline(this.accessToken(), deadline);
      res = await this.chat(request, token, deadline);
      if (res.status === 401 && this.token?.value === token) this.token = null;
    }
    if (!res.ok) {
      await res.arrayBuffer().catch(() => undefined);
      throw new ProviderError(`GigaChat: HTTP ${res.status}`, res.status);
    }
    const body = (await withDeadline(res.json(), deadline)) as {
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
