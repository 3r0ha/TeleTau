// Клиент служебных операций API для бота (ADR 0020): openapi-fetch по сгенерированным путям контракта — ручных DTO нет
// (CLAUDE.md, правило 1). Секрет сервиса — в X-Service-Token, у каждого запроса таймаут. 404 `chat_not_linked` — null
// (чат не привязан); сеть, 5xx, таймаут и отвергнутый секрет (401/403) — ApiUnavailableError: ядро ответит «попробуй позже».
import createClient from "openapi-fetch";
import type { paths } from "@teletau/contracts";
import { ApiUnavailableError, type ChatLink, type TeleTauApi } from "../core/ports.js";

export const API_TIMEOUT_MS = 10_000;

export interface ApiOptions {
  baseUrl: string;
  serviceToken: string;
  timeoutMs?: number;
  /** Подмена fetch в тестах. */
  fetch?: (request: Request) => Promise<Response>;
  /** Сообщение о проблеме конфигурации (например, API не принял секрет) — один раз на причину. */
  warn?: (line: string) => void;
}

export function createTeleTauApi(o: ApiOptions): TeleTauApi {
  const timeoutMs = o.timeoutMs ?? API_TIMEOUT_MS;
  const doFetch = o.fetch ?? ((r: Request) => fetch(r));
  const warned = new Set<number>();
  const client = createClient<paths>({
    baseUrl: o.baseUrl.replace(/\/+$/, ""),
    headers: { "x-service-token": o.serviceToken },
    fetch: async (request) => {
      try {
        return await doFetch(new Request(request, { signal: AbortSignal.timeout(timeoutMs) }));
      } catch {
        throw new ApiUnavailableError();
      }
    },
  });

  /** Ответ → данные, null (404) или ApiUnavailableError. */
  const settle = <T>(r: { data?: T; response: Response }, allow404: boolean): T | null => {
    if (r.response.ok) return (r.data ?? null) as T | null;
    const status = r.response.status;
    if (allow404 && status === 404) return null;
    if ((status === 401 || status === 403) && !warned.has(status)) {
      warned.add(status);
      (o.warn ?? console.warn)(`bot: API отклонил служебный запрос (${status}) — проверьте, что BOT_SERVICE_TOKEN одинаковый у API и бота`);
    }
    throw new ApiUnavailableError(status);
  };

  return {
    async chat(chatId) {
      return settle<ChatLink>(await client.GET("/api/v1/telegram/bot/chats/{chatId}", { params: { path: { chatId } } }), true);
    },
    async setReminders(chatId, update) {
      return settle<ChatLink>(await client.PUT("/api/v1/telegram/bot/chats/{chatId}/reminders", { params: { path: { chatId } }, body: update }), true);
    },
    async unlink(chatId) {
      settle(await client.DELETE("/api/v1/telegram/bot/chats/{chatId}", { params: { path: { chatId } } }), true);
    },
    async claimReminders() {
      const batch = settle(await client.POST("/api/v1/telegram/bot/reminders/claim", {}), false);
      return (batch?.items ?? []).map((i) => i.chatId);
    },
  };
}
