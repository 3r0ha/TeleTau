import { ConsoleLogger, type LogLevel } from "@nestjs/common";
import { REDACTED_KEYS, redact, redactString } from "./redact.js";

/**
 * Логгер API: ConsoleLogger Nest с фильтром секретов (ADR 0015 §5).
 * Объекты маскируются по ключам (встроенный redact Nest + свой проход), а итоговая строка, стек и JSON —
 * по шаблонам: так в лог не попадает e-mail, refresh/access-токен, полезная нагрузка QR, даже внутри текста ошибки.
 */
export class RedactingLogger extends ConsoleLogger {
  constructor(context = "TeleTau") {
    super(context, { redact: [...REDACTED_KEYS], colors: !process.env["NO_COLOR"] && process.stdout.isTTY === true });
  }

  protected override formatMessage(
    logLevel: LogLevel,
    message: unknown,
    pidMessage: string,
    formattedLogLevel: string,
    contextMessage: string,
    timestampDiff: string,
    params?: Record<string, unknown>,
  ): string {
    const safeParams = params ? (redact(params) as Record<string, unknown>) : params;
    return redactString(super.formatMessage(logLevel, redact(message), pidMessage, formattedLogLevel, contextMessage, timestampDiff, safeParams));
  }

  /** Nest вызывает его и без стека (`logger.error("…")`) — тогда печатать нечего. */
  protected override printStackTrace(stack?: string): void {
    if (!stack) return;
    super.printStackTrace(redactString(stack));
  }

  protected override stringifyJsonLogObject(logObject: Record<string, unknown>): string {
    return redactString(super.stringifyJsonLogObject(redact(logObject) as Record<string, unknown>));
  }
}
