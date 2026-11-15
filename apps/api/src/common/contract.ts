// Контракт как источник правды во время выполнения (CLAUDE.md, правило 1; ADR 0002, 0017).
// Каждый обработчик помечен @Operation("<operationId>"): из openapi.yaml (его JSON-копии в @teletau/contracts)
// берутся схемы запроса для валидации Fastify/ajv и правило доступа x-access для AuthGuard. Ручных DTO нет:
// если операции нет в контракте, приложение не запустится.
import { createRequire } from "node:module";
import { applyDecorators, SetMetadata } from "@nestjs/common";
import { RouteConfig, RouteSchema } from "@nestjs/platform-fastify";
import type { OperationId, operations } from "@teletau/contracts";
import type { FastifySchema } from "fastify";

type JsonSchema = Record<string, unknown>;

/**
 * Query-параметры операции — типом из контракта, без ручных DTO. `Defaults` — параметры со значением по умолчанию
 * в контракте: ajv подставляет их до обработчика (useDefaults), поэтому в обработчике они всегда есть.
 */
export type OperationQuery<Op extends OperationId, Defaults extends keyof NonNullable<operations[Op]["parameters"]["query"]> = never> = NonNullable<
  operations[Op]["parameters"]["query"]
> &
  Required<Pick<NonNullable<operations[Op]["parameters"]["query"]>, Defaults>>;

/** Роли x-access (packages/contracts/scripts/access-rules.mjs). */
export type AccessRole = "anonymous" | "any" | "student" | "adult" | "teacher" | "moderator" | "admin" | "ministry" | "fund" | "service";
export type AccessPolicy = "self" | "class-teacher" | "class-member" | "consent-owner" | "poll-token";

interface OpenApiParameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required?: boolean;
  schema?: JsonSchema;
}

interface OpenApiOperation {
  operationId: string;
  parameters?: unknown[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: JsonSchema }> };
  security?: Array<Record<string, unknown>>;
  "x-access"?: { roles: AccessRole[]; policy?: AccessPolicy };
  responses?: Record<string, unknown>;
}

export interface OpenApiDocument {
  paths: Record<string, Record<string, unknown>>;
  components: Record<string, Record<string, unknown>>;
  security?: Array<Record<string, unknown>>;
}

export interface ContractOperation {
  id: OperationId;
  method: string;
  /** Путь как в контракте: `/api/v1/classes/{id}`. */
  path: string;
  access: { roles: AccessRole[]; policy?: AccessPolicy };
  /** Параметры пути — для матрицы авторизации. */
  pathParams: string[];
  hasBody: boolean;
  responses: string[];
  schema: FastifySchema;
}

export const contract = createRequire(import.meta.url)("@teletau/contracts/openapi.json") as OpenApiDocument;

const METHODS = ["get", "put", "post", "delete", "patch"];

/** Разрешает `$ref` на `#/components/…` рекурсивно (схемы контракта без циклов). */
function deref(node: unknown, seen: string[] = []): unknown {
  if (Array.isArray(node)) return node.map((n) => deref(n, seen));
  if (node === null || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;
  const ref = obj["$ref"];
  if (typeof ref === "string") {
    if (!ref.startsWith("#/") || seen.includes(ref)) throw new Error(`contract: неподдерживаемая ссылка ${ref}`);
    const target = ref
      .slice(2)
      .split("/")
      .reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], contract);
    if (target === undefined) throw new Error(`contract: ссылка ${ref} не найдена`);
    const siblings = Object.fromEntries(Object.entries(obj).filter(([k]) => k !== "$ref"));
    return { ...(deref(target, [...seen, ref]) as object), ...(deref(siblings, seen) as object) };
  }
  // `discriminator` у `oneOf` — подсказка генераторам клиентов (Swift, Kotlin): ajv в строгом режиме его не знает,
  // а `mapping` не поддерживает вовсе. Вид проверяет сам `oneOf` — у каждого варианта `type` с единственным значением.
  const entries = Object.entries(obj).filter(([k]) => !(k === "discriminator" && "oneOf" in obj));
  return Object.fromEntries(entries.map(([k, v]) => [k, deref(v, seen)]));
}

function objectSchema(params: OpenApiParameter[], lowerCase = false): JsonSchema | undefined {
  if (params.length === 0) return undefined;
  const name = (p: OpenApiParameter) => (lowerCase ? p.name.toLowerCase() : p.name);
  return {
    type: "object",
    properties: Object.fromEntries(params.map((p) => [name(p), p.schema ?? {}])),
    required: params.filter((p) => p.required).map(name),
  };
}

function buildOperations(): Map<string, ContractOperation> {
  const out = new Map<string, ContractOperation>();
  for (const [path, item] of Object.entries(contract.paths)) {
    for (const method of METHODS) {
      const raw = item[method] as OpenApiOperation | undefined;
      if (!raw) continue;
      const op = deref(raw) as OpenApiOperation;
      const access = op["x-access"];
      if (!access) throw new Error(`contract: у ${op.operationId} нет x-access`);
      const params = [...((item["parameters"] as unknown[] | undefined) ?? []), ...(raw.parameters ?? [])].map(
        (p) => deref(p) as OpenApiParameter,
      );
      const of = (where: OpenApiParameter["in"]) => params.filter((p) => p.in === where);
      const body = op.requestBody?.content?.["application/json"]?.schema;
      const schema: FastifySchema = {};
      if (body) schema.body = body;
      const query = objectSchema(of("query"));
      if (query) schema.querystring = query;
      const pathSchema = objectSchema(of("path"));
      if (pathSchema) schema.params = pathSchema;
      const headers = objectSchema(of("header"), true);
      if (headers) schema.headers = headers;
      out.set(op.operationId, {
        id: op.operationId as OperationId,
        method: method.toUpperCase(),
        path,
        access,
        pathParams: of("path").map((p) => p.name),
        hasBody: Boolean(op.requestBody),
        responses: Object.keys(op.responses ?? {}),
        schema,
      });
    }
  }
  return out;
}

const operations = buildOperations();

/** Все операции контракта (для матрицы авторизации и проверки маршрутов). */
export const contractOperations = (): ContractOperation[] => [...operations.values()];

export function getOperation(id: OperationId): ContractOperation {
  const op = operations.get(id);
  if (!op) throw new Error(`contract: операции ${id} нет в openapi.yaml`);
  return op;
}

export const OPERATION_ID = "teletau:operationId";

/** operationId маршрута в конфиге Fastify: по нему контроль доступа срабатывает в onRequest — до разбора и проверки тела. */
export interface TeleTauRouteConfig {
  operationId?: OperationId;
}

/**
 * Связывает обработчик с операцией контракта: operationId для контроля доступа (x-access) — в метаданных Nest
 * и в конфиге маршрута Fastify, схема запроса — для валидации Fastify (тело, query, путь, заголовки).
 */
export function Operation(id: OperationId): MethodDecorator {
  const op = getOperation(id);
  return applyDecorators(SetMetadata(OPERATION_ID, id), RouteConfig({ operationId: id } satisfies TeleTauRouteConfig), RouteSchema(op.schema));
}
