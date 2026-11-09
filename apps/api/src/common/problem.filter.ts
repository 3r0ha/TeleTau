import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Problem } from "@teletau/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { describeError, stackFrames } from "./errors.js";
import { ApiError, problemTitle, type FieldError } from "./problem.js";

/** Ошибка проверки схемы Fastify/ajv (route schema из контракта). */
interface FastifyValidationError {
  validation: Array<{ instancePath?: string; keyword?: string; message?: string; params?: Record<string, unknown> }>;
  validationContext?: string;
}

const FORMAT_DETAIL: Record<string, string> = {
  uuid: "Неверный идентификатор",
  email: "Неверный адрес e-mail",
  "date-time": "Неверные дата и время",
  date: "Неверная дата — нужен формат ГГГГ-ММ-ДД",
  uri: "Неверный адрес",
  "uri-reference": "Неверный адрес",
};

const TYPE_DETAIL: Record<string, string> = {
  integer: "Нужно целое число",
  number: "Нужно число",
  string: "Нужна строка",
  boolean: "Нужно true или false",
  object: "Нужен объект",
  array: "Нужен список",
};

/** Понятное человеку описание ошибки ajv на русском: клиенты показывают `errors[].detail` как есть. */
export function validationDetail(v: FastifyValidationError["validation"][number]): string {
  const p = v.params ?? {};
  const limit = p["limit"];
  switch (v.keyword) {
    case "required":
      return "Обязательное поле";
    case "additionalProperties":
      return "Лишнее поле — его нет в описании запроса";
    case "format":
      return FORMAT_DETAIL[String(p["format"])] ?? "Неверный формат";
    case "type":
      return TYPE_DETAIL[String(p["type"])] ?? "Неверный тип значения";
    case "minLength":
      return `Не короче ${String(limit)} символов`;
    case "maxLength":
      return `Не длиннее ${String(limit)} символов`;
    case "minimum":
    case "exclusiveMinimum":
      return `Не меньше ${String(limit)}`;
    case "maximum":
    case "exclusiveMaximum":
      return `Не больше ${String(limit)}`;
    case "minItems":
      return `Не меньше ${String(limit)} элементов`;
    case "maxItems":
      return `Не больше ${String(limit)} элементов`;
    case "uniqueItems":
      return "Значения не должны повторяться";
    case "minProperties":
      return "Нужно хотя бы одно поле";
    case "enum":
    case "const":
      return "Недопустимое значение";
    case "pattern":
      return "Неверный формат";
    default:
      return "Неверное значение";
  }
}

const isValidationError = (e: unknown): e is FastifyValidationError =>
  typeof e === "object" && e !== null && Array.isArray((e as { validation?: unknown }).validation);

/** Статус ошибки уровня Fastify (FST_ERR_CTP_*, слишком большое тело и т. п.). */
const fastifyStatus = (e: unknown): number | undefined => {
  const s = (e as { statusCode?: unknown } | null)?.statusCode;
  return typeof s === "number" && s >= 400 && s < 600 ? s : undefined;
};

/**
 * Код Problem для встроенных исключений Nest и ошибок Fastify — по статусу. Заголовок берётся по коду
 * (по-русски), а текст исключения (`Cannot GET /api/v1/nope`, сообщения Fastify) наружу не уходит.
 */
export function builtinCode(status: number): string {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404 || status === 405) return "not_found";
  if (status === 413) return "payload_too_large";
  if (status === 429) return "rate_limited";
  if (status === 503) return "service_unavailable";
  if (status >= 500) return "internal";
  return "bad_request";
}

/** JSON Pointer поля: тело — `/field`, остальное — `#/query/<имя>`, `#/path/<имя>`, `#/header/<имя>` (контракт, FieldError). */
export function validationErrors(e: FastifyValidationError): FieldError[] {
  const part = { body: "", querystring: "#/query", params: "#/path", headers: "#/header" }[e.validationContext ?? "body"] ?? "";
  return e.validation.map((v) => {
    const missing = v.params?.["missingProperty"] ?? v.params?.["additionalProperty"];
    const path = `${v.instancePath ?? ""}${typeof missing === "string" ? `/${missing}` : ""}`;
    return { pointer: part ? `${part}${path || ""}` : path || "/", detail: validationDetail(v) };
  });
}

/** Все ошибки API — в формате RFC 9457 (application/problem+json). Детали внутренних ошибок наружу не уходят. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const problem = this.toProblem(exception, request);
    if (problem.status >= 500 && problem.code === "internal") {
      // Только безопасное описание: у ошибок БД — SQLSTATE, ограничение и операция, без текста и параметров.
      const route = `${request.method} ${request.routeOptions?.url ?? "(no route)"}`;
      this.logger.error(`${route} → 500: ${describeError(exception)}`, stackFrames(exception));
    }
    if (exception instanceof ApiError && exception.retryAfterSeconds) void reply.header("retry-after", String(exception.retryAfterSeconds));
    void reply.status(problem.status).header("content-type", "application/problem+json").header("cache-control", "no-store").send(problem);
  }

  private toProblem(exception: unknown, request: FastifyRequest): Problem & { status: number } {
    const base = { type: "about:blank", instance: request.url };
    if (exception instanceof ApiError) {
      return {
        ...base,
        title: problemTitle(exception.code),
        status: exception.status,
        code: exception.code,
        ...(exception.detail ? { detail: exception.detail } : {}),
        ...(exception.errors?.length ? { errors: exception.errors } : {}),
      };
    }
    if (isValidationError(exception)) {
      return { ...base, title: problemTitle("validation_failed"), status: 422, code: "validation_failed", errors: validationErrors(exception) };
    }
    if (exception instanceof HttpException) {
      // Неизвестный маршрут (Nest: «Cannot GET …») и прочие встроенные исключения: только статус и русский заголовок.
      const status = exception.getStatus() === 405 ? 404 : exception.getStatus();
      const code = builtinCode(status);
      return { ...base, title: problemTitle(code), status, code };
    }
    const fst = fastifyStatus(exception);
    if (fst && fst < 500) {
      // Тело не разобрано, неверный тип содержимого и т. п. — по контракту это 400 (BadRequest); 413 остаётся 413.
      const status = fst === 413 ? 413 : 400;
      const code = builtinCode(status);
      return { ...base, title: problemTitle(code), status, code };
    }
    return { ...base, title: problemTitle("internal"), status: HttpStatus.INTERNAL_SERVER_ERROR, code: "internal" };
  }
}
