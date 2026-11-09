// Правило контракта: схемы, достижимые из ответов, не закрываются `additionalProperties: false`.
// Иначе строгие клиенты (swift-openapi-generator и т. п.) перестанут разбирать ответ, как только сервер
// добавит поле, — а правило docs/07-data-and-api.md §5 «поля только добавляются» обещает совместимость.
// Для тел запросов закрытые схемы допустимы и полезны.

/** @returns {string[]} JSON-указатели схем ответов с additionalProperties:false */
export function findClosedResponseSchemas(spec) {
  const found = new Set();
  const visited = new Set();

  const resolveRef = (ref) => {
    if (!ref.startsWith("#/")) return undefined;
    return ref
      .slice(2)
      .split("/")
      .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
      .reduce((node, key) => (node == null ? undefined : node[key]), spec);
  };

  const walk = (schema, pointer) => {
    if (!schema || typeof schema !== "object") return;
    if (typeof schema.$ref === "string") {
      if (visited.has(schema.$ref)) return;
      visited.add(schema.$ref);
      walk(resolveRef(schema.$ref), schema.$ref);
      return;
    }
    if (schema.additionalProperties === false) found.add(pointer);
    for (const [name, sub] of Object.entries(schema.properties ?? {})) walk(sub, `${pointer}/properties/${name}`);
    if (schema.items) walk(schema.items, `${pointer}/items`);
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      walk(schema.additionalProperties, `${pointer}/additionalProperties`);
    }
    for (const key of ["allOf", "oneOf", "anyOf"]) {
      (schema[key] ?? []).forEach((sub, i) => walk(sub, `${pointer}/${key}/${i}`));
    }
  };

  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(item ?? {})) {
      for (const [status, response] of Object.entries(op?.responses ?? {})) {
        const resolved = typeof response?.$ref === "string" ? resolveRef(response.$ref) : response;
        for (const [media, content] of Object.entries(resolved?.content ?? {})) {
          walk(content.schema, `#/paths/${path}/${method}/responses/${status}/content/${media}/schema`);
        }
      }
    }
  }
  return [...found];
}
