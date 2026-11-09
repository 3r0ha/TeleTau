export interface ThrottleOptions {
  /** Куда писать (console.warn, Nest Logger и т. п.). */
  write: (message: string) => void;
  /** Не чаще одного сообщения на пару (источник, код ошибки) за этот интервал. */
  intervalMs?: number;
  now?: () => number;
}

export type ErrorReporter = (source: string, error: unknown) => void;

const CREDENTIALS_IN_URL = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;

/** Убирает логин и пароль из встречающихся в тексте URL. */
function redact(text: string): string {
  return text.replace(CREDENTIALS_IN_URL, "$1***@");
}

/**
 * Логгер ошибок инфраструктуры (Postgres, Valkey, очереди) с троттлингом:
 * при недоступной зависимости клиенты шлют десятки ошибок в секунду — в лог попадает одна
 * на (источник, код) за интервал плюс счётчик подавленных. В сообщении нет учётных данных.
 */
export function createThrottledErrorLogger(options: ThrottleOptions): ErrorReporter {
  const interval = options.intervalMs ?? 30_000;
  const now = options.now ?? Date.now;
  const state = new Map<string, { last: number; suppressed: number }>();

  return (source, error) => {
    const err = error instanceof Error ? error : new Error(String(error));
    const code = (err as { code?: unknown }).code;
    const key = `${source}:${typeof code === "string" || typeof code === "number" ? code : err.name}`;
    const t = now();
    const entry = state.get(key);
    if (entry && t - entry.last < interval) {
      entry.suppressed++;
      return;
    }
    const suppressed = entry?.suppressed ?? 0;
    state.set(key, { last: t, suppressed: 0 });
    const tail = suppressed > 0 ? ` (подавлено повторов: ${suppressed})` : "";
    options.write(`${source}: ${code ?? err.name}: ${redact(err.message)}${tail}`);
  };
}
