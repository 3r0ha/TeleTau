// Клиент служебных операций API для бота (ADR 0020): openapi-fetch по сгенерированным путям контракта — ручных DTO нет
// (CLAUDE.md, правило 1). Секрет сервиса — в X-Service-Token, у каждого запроса таймаут. 404 `chat_not_linked` — null
// (чат не привязан); сеть, 5xx, таймаут и отвергнутый секрет (401/403) — ApiUnavailableError: ядро ответит «попробуй позже».
import createClient from "openapi-fetch";
import type { paths, Schema } from "@teletau/contracts";
import { ApiUnavailableError, type ChatLink, type DailyDuel, type TeleTauApi } from "../core/ports.js";

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

  /** Неустранимый отказ: сеть/5xx/таймаут/секрет — ApiUnavailableError; 401/403 — с предупреждением один раз. */
  const fail = (status: number): never => {
    if ((status === 401 || status === 403) && !warned.has(status)) {
      warned.add(status);
      (o.warn ?? console.warn)(`bot: API отклонил служебный запрос (${status}) — проверьте, что BOT_SERVICE_TOKEN одинаковый у API и бота`);
    }
    throw new ApiUnavailableError(status);
  };

  /** Ответ → данные, null (404) или ApiUnavailableError. */
  const settle = <T>(r: { data?: T; response: Response }, allow404: boolean): T | null => {
    if (r.response.ok) return (r.data ?? null) as T | null;
    const status = r.response.status;
    if (allow404 && status === 404) return null;
    return fail(status);
  };

  /** Код Problem из тела ошибки (контракт: все 4xx — application/problem+json). */
  const problemCode = (body: unknown): string | undefined => (body as { code?: string } | undefined)?.code;

  return {
    async chat(chatId) {
      return settle<ChatLink>(await client.GET("/api/v1/telegram/bot/chats/{chatId}", { params: { path: { chatId } } }), true);
    },
    async redeemLinkCode(chatId, code) {
      // 404 code_not_found — код не найден/истёк/погашен: не ошибка связи, а «нет такого кода» (null).
      return settle<ChatLink>(await client.POST("/api/v1/telegram/bot/chats/link-code/redeem", { body: { code, chatId } }), true);
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
    async dailyDuel(chatId) {
      return settle<DailyDuel>(await client.POST("/api/v1/telegram/bot/chats/{chatId}/daily-duel", { params: { path: { chatId } } }), true);
    },
    async answerDuel(dialogId, choice) {
      // 409 уже разобран здесь: closed (диалог отменён/закрыт) и voted (за пару уже голосовали) — нормальный
      // сценарий устаревшей кнопки, а не недоступность API.
      const r = await client.POST("/api/v1/telegram/bot/dialogs/{dialogId}/answer", { params: { path: { dialogId } }, body: { choice } });
      if (r.response.ok) return { kind: "ok", replay: r.data?.replay === true };
      if (r.response.status === 404) return null;
      if (r.response.status === 409) return problemCode(r.data) === "already_voted" ? { kind: "voted" } : { kind: "closed" };
      return fail(r.response.status);
    },
    async cancelDaily(chatId) {
      return settle<{ cancelled: boolean }>(await client.POST("/api/v1/telegram/bot/chats/{chatId}/daily-duel/cancel", { params: { path: { chatId } } }), true);
    },
    async phraseOfDay() {
      // Публичная операция (x-access: anonymous) — привязка чата не нужна; ответ без pair — принятых пар ещё нет.
      return settle<Schema<"PhraseOfDay">>(await client.GET("/api/v1/public/phrase-of-day"), false)?.pair ?? null;
    },
  };
}
