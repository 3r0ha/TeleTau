// Проверка границ модулей API (docs/06-architecture.md §3, CLAUDE.md правило 4, ADR 0014).
// Правила:
//  1. src/modules/A/** может импортировать из src/modules/B/** только B/index.ts.
//  2. src/infra, src/common, src/db, src/config не зависят от src/modules/** (никаких лазеек для реэкспорта).
//  3. Владение таблицами: Drizzle-схемы — только в src/modules/<m>/*.schema.ts (и schema.ts вне модулей запрещён);
//     index.ts модуля не реэкспортирует его схему — чужие модули работают через сервисы, а не через таблицы.
//  4. Транзитивно: из index.ts модуля схема не утекает и через промежуточные файлы
//     (`export * from`, `export {…} from`, «импорт, затем export { … }»),
//     а также через значение-псевдоним: `export const t = accounts`, `export const tables = { accounts }`,
//     `export const all = { ...schema }`, `export default accounts`. Выражения с вызовами
//     (`new Service(accounts)`, `make(accounts)`) не считаются утечкой — это сервис, а не таблица.
//  5. pgTable/pgSchema/pgEnum/pgView/pgTableCreator/… объявляются только в *.schema.ts (иначе таблицу можно
//     «спрятать» в любом файле); вне *.schema.ts эти функции нельзя и импортировать из drizzle-orm/pg-core —
//     даже под другим именем (`import { pgTable as table }`).
//  6. Нет циклических импортов.
// Это эвристика на регулярных выражениях: намеренный обход (вызов функции, возвращающей таблицу, и т. п.)
// ловится ревью и в рантайме — схемой и ролью Postgres на модуль (ADR 0014). Через компилятор TS проверка не идёт.
// Анализируются относительные импорты (import ... from "./x.js", export ... from, import("...")).
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const IMPORT_RE = /(?:import|export)\s[^"'`]*?from\s*["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)|import\s+["'](\.{1,2}\/[^"']+)["']/g;
const SHARED_DIRS = ["infra", "common", "db", "config"];
const REEXPORT_RE = /export\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*["'](\.{1,2}\/[^"']+)["']/g;
const NAMED_IMPORT_RE = /import\s+(?:type\s+)?(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+(\w+))?\s*from\s*["'](\.{1,2}\/[^"']+)["']/g;
const BARE_EXPORT_RE = /export\s*\{([^}]*)\}(?!\s*from)/g;
const DRIZZLE_DECL_FUNCS = ["pgTable", "pgSchema", "pgEnum", "pgView", "pgMaterializedView", "pgSequence", "pgTableCreator"];
const DRIZZLE_DECL_RE = new RegExp(`\\b(${DRIZZLE_DECL_FUNCS.join("|")})\\s*\\(`);
const PG_CORE_IMPORT_RE = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']drizzle-orm\/pg-core["']/g;
/** export const|let|var X = <выражение>; и export default <выражение>; (не class/function — это объявления сервисов). */
const EXPORT_VALUE_RE = /export\s+(?:default\s+(?!class\b|function\b|async\b|abstract\b)|(?:const|let|var)\s+[\w$]+\s*(?::[^=;]+)?=\s*)([^;]*);/g;
/** «Псевдоним» — только имена, обращения через точку, литералы объектов и массивов, spread; без вызовов и new. */
const ALIAS_EXPR_RE = /^[\s\w$.{}[\],:]*$/;

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const localNames = (list) =>
  list.split(",").map((x) => x.trim().split(/\s+as\s+/).pop()?.replace(/^type\s+/, "").trim()).filter(Boolean);

/** @param {Map<string,string>} files  ключ — путь относительно корня пакета (posix), значение — исходник */
export function findViolations(files) {
  const toPosix = (p) => p.split(sep).join("/");
  const resolveSpec = (file, spec) => {
    let target = toPosix(join(dirname(file), spec)).replace(/\.js$/, ".ts");
    if (!files.has(target) && files.has(`${target}/index.ts`)) target = `${target}/index.ts`;
    return target;
  };
  const graph = new Map();
  /** Рёбра реэкспорта: через них имена из target становятся видны снаружи file. */
  const reexports = new Map();
  for (const [file, raw] of files) {
    const source = stripComments(raw);
    const edges = new Set();
    for (const m of source.matchAll(REEXPORT_RE)) edges.add(resolveSpec(file, m[1]));
    const imported = new Map();
    for (const m of source.matchAll(NAMED_IMPORT_RE)) {
      const target = resolveSpec(file, m[4]);
      const names = [m[1], m[3], ...(m[2] ? localNames(m[2]) : [])].filter(Boolean);
      for (const n of names) imported.set(n, target);
    }
    for (const m of source.matchAll(BARE_EXPORT_RE)) {
      for (const item of m[1].split(",")) {
        const local = item.trim().split(/\s+as\s+/)[0]?.replace(/^type\s+/, "").trim();
        if (local && imported.has(local)) edges.add(imported.get(local));
      }
    }
    for (const m of source.matchAll(EXPORT_VALUE_RE)) {
      const expr = m[1].replace(/\.\.\./g, " ");
      if (/\bnew\b/.test(expr) || !ALIAS_EXPR_RE.test(expr)) continue;
      for (const id of expr.match(/[A-Za-z_$][\w$]*/g) ?? []) if (imported.has(id)) edges.add(imported.get(id));
    }
    reexports.set(file, edges);
  }
  for (const [file, source] of files) {
    const deps = [];
    for (const m of source.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3];
      let target = toPosix(join(dirname(file), spec)).replace(/\.js$/, ".ts");
      if (!files.has(target) && files.has(`${target}/index.ts`)) target = `${target}/index.ts`;
      deps.push(target);
    }
    graph.set(file, deps);
  }

  const violations = [];
  const moduleOf = (p) => /^src\/modules\/([^/]+)\//.exec(p)?.[1];
  const isSchema = (p) => /(^|\/)[^/]*\.?schema\.ts$/.test(p);

  for (const file of files.keys()) {
    if (isSchema(file) && !/^src\/modules\/[^/]+\/[^/]+\.schema\.ts$/.test(file)) {
      violations.push(`${file}: Drizzle-схема вне модуля — таблицы принадлежат модулям (src/modules/<m>/<m>.schema.ts)`);
    }
  }

  for (const [file, raw] of files) {
    if (isSchema(file)) continue;
    const source = stripComments(raw);
    const decl = DRIZZLE_DECL_RE.exec(source);
    if (decl) violations.push(`${file}: ${decl[1]}( вне *.schema.ts — таблицы Drizzle объявляются только в src/modules/<m>/<m>.schema.ts`);
    for (const m of source.matchAll(PG_CORE_IMPORT_RE)) {
      if (m[1]) continue; // import type { … } — только типы
      for (const item of m[2].split(",")) {
        const [orig, alias] = item.trim().replace(/^type\s+/, "").split(/\s+as\s+/).map((x) => x?.trim());
        if (!item.trim().startsWith("type ") && DRIZZLE_DECL_FUNCS.includes(orig)) {
          violations.push(`${file}: импорт ${orig}${alias ? ` (как ${alias})` : ""} из drizzle-orm/pg-core вне *.schema.ts — таблицы объявляются только в src/modules/<m>/<m>.schema.ts`);
        }
      }
    }
  }

  for (const index of files.keys()) {
    const m = /^src\/modules\/([^/]+)\/index\.ts$/.exec(index);
    if (!m) continue;
    const seen = new Map([[index, [index]]]);
    const queue = [index];
    while (queue.length) {
      const cur = queue.shift();
      for (const next of reexports.get(cur) ?? []) {
        if (seen.has(next)) continue;
        const chain = [...seen.get(cur), next];
        seen.set(next, chain);
        if (isSchema(next) && chain.length > 2) {
          violations.push(`${chain.join(" → ")}: index.ts реэкспортирует схему модуля «${m[1]}» через ${chain.slice(1, -1).join(" → ")} — таблицы не выходят за пределы модуля`);
        }
        if (files.has(next)) queue.push(next);
      }
    }
  }

  for (const [from, deps] of graph) {
    const a = moduleOf(from);
    const shared = SHARED_DIRS.find((d) => from.startsWith(`src/${d}/`));
    for (const to of deps) {
      const b = moduleOf(to);
      if (a && b && a !== b && to !== `src/modules/${b}/index.ts`) {
        violations.push(`${from} → ${to}: импорт внутренностей модуля «${b}» (только src/modules/${b}/index.ts)`);
      }
      if (shared && b) {
        violations.push(`${from} → ${to}: src/${shared} не должна зависеть от модулей`);
      }
      if (a && from === `src/modules/${a}/index.ts` && moduleOf(to) === a && isSchema(to)) {
        violations.push(`${from} → ${to}: index.ts реэкспортирует схему модуля «${a}» — таблицы не выходят за пределы модуля`);
      }
    }
  }

  const state = new Map(); // 1 — в стеке, 2 — пройден
  const stack = [];
  const visit = (node) => {
    state.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) continue;
      if (state.get(next) === 1) {
        violations.push(`цикл: ${[...stack.slice(stack.indexOf(next)), next].join(" → ")}`);
      } else if (!state.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const node of graph.keys()) if (!state.has(node)) visit(node);
  return violations;
}

function collect(root, dir, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(root, full, out);
    else if (full.endsWith(".ts")) out.set(relative(root, full).split(sep).join("/"), readFileSync(full, "utf8"));
  }
  return out;
}

// «Запущен как скрипт»: сравниваем реальные пути — устойчиво к пробелам и кириллице и к симлинкам.
const invokedDirectly = () => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};
if (invokedDirectly()) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const violations = findViolations(collect(root, join(root, "src"), new Map()));
  if (violations.length) {
    console.error(`Нарушены границы модулей (${violations.length}):\n  ${violations.join("\n  ")}`);
    process.exit(1);
  }
  console.log("api: границы модулей соблюдены");
}
