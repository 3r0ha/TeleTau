// Правила доступа в контракте (ADR 0017): у каждой операции есть `x-access`, и коды ответов с ним согласованы.
// Это «строка матрицы авторизации» на стороне контракта; тест API (матрица аноним / чужая роль / чужой ресурс)
// сверяет реализацию с этими же операциями.
//  • x-access.roles — непустой список из ROLES; x-access.policy — из POLICIES (если задана);
//  • `security: []` ⇔ roles = [anonymous]; необязательный вход (`security: [{}, …]`) ⇔ roles содержит anonymous и что-то ещё;
//  • закрытая операция объявляет 401; операция с ограничением по роли или политике — 403;
//  • операция с параметрами пути — 404; с телом запроса — 422;
//  • все ответы 4xx/5xx и default (кроме health) — application/problem+json;
//  • роль `service` (служебный вызов сервиса проекта, ADR 0020) — только одна и только со `security: [{ serviceToken: [] }]`;
//    схема serviceToken — только у роли service (секрет сервиса не открывает операции пользователей и наоборот).

export const ROLES = ["anonymous", "any", "student", "adult", "teacher", "moderator", "admin", "ministry", "fund", "service"];
/** Схема секрета сервиса (components.securitySchemes) — только для роли service. */
export const SERVICE_SCHEME = "serviceToken";
export const POLICIES = ["self", "class-teacher", "class-member", "consent-owner", "poll-token"];
const METHODS = ["get", "put", "post", "delete", "patch", "options", "head", "trace"];

/** @returns {string[]} описания нарушений */
export function findAccessViolations(spec) {
  const out = [];
  const resolve = (node) => {
    if (typeof node?.$ref !== "string" || !node.$ref.startsWith("#/")) return node;
    return node.$ref
      .slice(2)
      .split("/")
      .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
      .reduce((n, k) => (n == null ? undefined : n[k]), spec);
  };

  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of METHODS) {
      const op = item?.[method];
      if (!op) continue;
      const where = `${method.toUpperCase()} ${path} (${op.operationId ?? "без operationId"})`;
      const access = op["x-access"];
      const roles = access?.roles;
      if (!Array.isArray(roles) || roles.length === 0) {
        out.push(`${where}: нет x-access.roles`);
        continue;
      }
      for (const r of roles) if (!ROLES.includes(r)) out.push(`${where}: неизвестная роль «${r}»`);
      if (access.policy !== undefined && !POLICIES.includes(access.policy)) out.push(`${where}: неизвестная политика «${access.policy}»`);

      const security = op.security ?? spec.security ?? [];
      const anonymousAllowed = security.length === 0 || security.some((s) => Object.keys(s).length === 0);
      const publicOnly = security.length === 0;
      if (roles.includes("anonymous") !== anonymousAllowed) {
        out.push(`${where}: x-access.roles ${roles.includes("anonymous") ? "разрешает" : "не разрешает"} anonymous, а security — наоборот`);
      }
      if (publicOnly && roles.length !== 1) out.push(`${where}: security: [] — значит, roles = [anonymous]`);
      const serviceScheme = security.some((s) => Object.prototype.hasOwnProperty.call(s, SERVICE_SCHEME));
      if (roles.includes("service")) {
        if (roles.length !== 1) out.push(`${where}: роль service не сочетается с другими ролями`);
        if (security.length !== 1 || Object.keys(security[0]).join() !== SERVICE_SCHEME) {
          out.push(`${where}: роль service — значит, security: [{ ${SERVICE_SCHEME}: [] }]`);
        }
      } else if (serviceScheme) {
        out.push(`${where}: ${SERVICE_SCHEME} — только у роли service`);
      }

      const responses = op.responses ?? {};
      const has = (code) => Object.prototype.hasOwnProperty.call(responses, code);
      const restricted = roles.some((r) => !["anonymous", "any"].includes(r)) || (access.policy && access.policy !== "self");
      if (!anonymousAllowed && !has("401")) out.push(`${where}: закрытая операция без ответа 401`);
      if (!anonymousAllowed && restricted && !has("403")) out.push(`${where}: ограничение по роли или политике без ответа 403`);
      const pathParams = [...(item.parameters ?? []), ...(op.parameters ?? [])].map(resolve).filter((p) => p?.in === "path");
      if (pathParams.length > 0 && !has("404")) out.push(`${where}: параметры пути без ответа 404`);
      if (op.requestBody && !has("422")) out.push(`${where}: тело запроса без ответа 422`);

      for (const [code, raw] of Object.entries(responses)) {
        if (!(code === "default" || /^[45]/.test(code)) || path.endsWith("/health")) continue;
        const content = resolve(raw)?.content ?? {};
        if (!content["application/problem+json"]) out.push(`${where}: ответ ${code} не в формате application/problem+json`);
      }
    }
  }
  return out;
}
