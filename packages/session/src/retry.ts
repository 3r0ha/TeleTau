// Автоповтор короткого 429 (docs/07 §2 «Ошибки»): `Retry-After` ≤ 5 с означает, что сервер отклонил запрос
// только из-за попыток, которые ещё проверяются (ADR 0016). Отклонённый запрос ничего не создал, поэтому его
// можно молча повторить после паузы. Длинный 429 (неудачи исчерпаны) и другие ошибки не повторяются.
import { isShortRateLimit, type ApiProblem } from "./problem";

export interface ShortRetryOptions {
  /** Сколько раз повторить после первой попытки (по умолчанию 2). */
  retries?: number;
  /** Пауза, мс (для тестов). */
  sleep?: (ms: number) => Promise<void>;
  /** Случайная добавка к паузе, мс: повторы детей одного класса не совпадают по времени. */
  jitterMs?: number;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Выполнить запрос; на короткий 429 подождать `Retry-After` (+ немного) и повторить, не больше `retries` раз. */
export async function withShortRetry<T>(run: () => Promise<T>, { retries = 2, sleep = wait, jitterMs = 250 }: ShortRetryOptions = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (attempt >= retries || !isShortRateLimit(e)) throw e;
      await sleep(Math.max(1, (e as ApiProblem).retryAfter ?? 1) * 1000 + Math.floor(Math.random() * jitterMs));
    }
  }
}
