// Контракт API для страницы документации: JSON-копия openapi.yaml из @teletau/contracts (OpenAPI 3.1).
// Типы — только та часть OpenAPI, которую страница показывает.
import raw from "@teletau/contracts/openapi.json";

export interface SchemaObject {
  $ref?: string;
  type?: string | string[];
  format?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  "x-extensible-enum"?: unknown[];
  const?: unknown;
  default?: unknown;
  items?: SchemaObject;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  additionalProperties?: boolean | SchemaObject;
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  allOf?: SchemaObject[];
  discriminator?: { propertyName: string; mapping?: Record<string, string> };
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minProperties?: number;
  uniqueItems?: boolean;
  pattern?: string;
}

export interface Parameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: SchemaObject;
}

export interface MediaType {
  schema?: SchemaObject;
}

export interface ResponseObject {
  description: string;
  content?: Record<string, MediaType>;
}

export interface RequestBody {
  required?: boolean;
  description?: string;
  content: Record<string, MediaType>;
}

export interface Access {
  roles: string[];
  policy?: string;
}

export interface Operation {
  tags?: string[];
  operationId: string;
  summary?: string;
  description?: string;
  security?: Record<string, string[]>[];
  "x-access"?: Access;
  parameters?: (Parameter | Ref)[];
  requestBody?: RequestBody | Ref;
  responses: Record<string, ResponseObject | Ref>;
}

type Ref = { $ref: string };

interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string; summary?: string; description?: string };
  tags?: { name: string; description?: string }[];
  paths: Record<string, Partial<Record<Method, Operation>>>;
  components: {
    schemas: Record<string, SchemaObject>;
    parameters: Record<string, Parameter>;
    responses: Record<string, ResponseObject>;
  };
}

export const spec = raw as unknown as OpenApiDoc;

export const METHODS = ["get", "post", "put", "patch", "delete"] as const;
export type Method = (typeof METHODS)[number];

export interface Endpoint {
  method: Method;
  path: string;
  op: Operation;
}

const isRef = (value: object): value is Ref => "$ref" in value;

/** Имя схемы по ссылке `#/components/schemas/Имя`. */
export const refName = (ref: string): string => ref.slice(ref.lastIndexOf("/") + 1);

/** Якорь схемы на странице. */
export const schemaAnchor = (name: string): string => `s-${name}`;

export function parameterOf(p: Parameter | Ref): Parameter {
  return isRef(p) ? (spec.components.parameters[refName(p.$ref)] as Parameter) : p;
}

export function requestBodyOf(op: Operation): RequestBody | undefined {
  return op.requestBody && !isRef(op.requestBody) ? op.requestBody : undefined;
}

/** Ответ операции; общий ответ из components.responses — с его именем (BadRequest, Unauthorized…). */
export function responseOf(r: ResponseObject | Ref): { response: ResponseObject; shared?: string } {
  if (!isRef(r)) return { response: r };
  const shared = refName(r.$ref);
  return { response: spec.components.responses[shared] as ResponseObject, shared };
}

/** Все операции в порядке путей контракта. */
export const endpoints: Endpoint[] = Object.entries(spec.paths).flatMap(([path, item]) =>
  METHODS.flatMap((method) => {
    const op = item[method];
    return op ? [{ method, path, op }] : [];
  }),
);

export function endpointById(operationId: string): Endpoint {
  const found = endpoints.find((e) => e.op.operationId === operationId);
  if (!found) throw new Error(`В контракте нет операции ${operationId}`);
  return found;
}

/** Операции по тегам — в порядке тегов контракта; операция без тега — в группе «other». */
export function endpointsByTag(): { name: string; description?: string; endpoints: Endpoint[] }[] {
  const tags = [...(spec.tags ?? [])];
  const known = new Set(tags.map((t) => t.name));
  if (endpoints.some((e) => !e.op.tags?.some((t) => known.has(t)))) tags.push({ name: "other" });
  return tags
    .map((tag) => ({
      ...tag,
      endpoints: endpoints.filter((e) => (e.op.tags?.find((t) => known.has(t)) ?? "other") === tag.name),
    }))
    .filter((group) => group.endpoints.length > 0);
}

/**
 * Код ответа для каждого общего ответа (components.responses) — по тому, под каким кодом его подключают операции:
 * Unauthorized → 401, Unexpected → default.
 */
export function sharedResponseCodes(): { name: string; code: string; response: ResponseObject }[] {
  const codes = new Map<string, string>();
  for (const { op } of endpoints) {
    for (const [code, r] of Object.entries(op.responses)) {
      if (isRef(r) && !codes.has(refName(r.$ref))) codes.set(refName(r.$ref), code);
    }
  }
  return Object.entries(spec.components.responses)
    .flatMap(([name, response]) => {
      const code = codes.get(name);
      return code ? [{ name, code, response }] : [];
    })
    .sort((a, b) => codeOrder(a.code) - codeOrder(b.code));
}

/** Порядок кодов: числа по возрастанию, default — в конце. */
export const codeOrder = (code: string): number => (/^\d+$/.test(code) ? Number(code) : 1000);
