// Реестр промптов (docs/04-ai-gigachat.md §4): каждая функция — каталог prompts/<feature>/, каждая версия — файл vN.md.
// Формат файла: шапка `ключ: значение` между строками `---` (id, version, temperature, max_tokens), затем секции
// `## <имя>` до следующего заголовка; текст до первой секции (комментарий) не используется. Идентификатор
// версии — `<feature>@v<N>`: его возвращает шлюз и по нему API кеширует ответы.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface PromptTemplate {
  /** `<feature>@v<N>`, например `explain_error@v1`. */
  promptId: string;
  feature: string;
  version: number;
  temperature?: number;
  maxTokens?: number;
  sections: ReadonlyMap<string, string>;
}

export interface PromptRegistry {
  get(promptId: string): PromptTemplate | undefined;
  /** Последняя версия функции. */
  latest(feature: string): PromptTemplate | undefined;
  ids(): string[];
}

/** Каталог prompts/ рядом с src/ и dist/ — путь одинаков при запуске из исходников и из сборки. */
export const PROMPTS_DIR = fileURLToPath(new URL("../prompts/", import.meta.url));

const FILE_RE = /^v([1-9]\d*)\.md$/;
const PLACEHOLDER_RE = /\{\{([a-zA-Z0-9_.]+)\}\}/g;

export class PromptFormatError extends Error {}

/** Разбор одного файла промпта; `feature` и `version` берутся из пути и сверяются с шапкой. */
export function parsePrompt(raw: string, feature: string, version: number, where = `${feature}/v${version}.md`): PromptTemplate {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0] !== "---") throw new PromptFormatError(`${where}: нет шапки ---`);
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new PromptFormatError(`${where}: шапка не закрыта ---`);
  const meta = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    if (!line.trim()) continue;
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!m) throw new PromptFormatError(`${where}: строка шапки «${line}» не вида ключ: значение`);
    meta.set(m[1]!, m[2]!.trim());
  }
  if (meta.get("id") !== feature) throw new PromptFormatError(`${where}: id должен совпадать с каталогом «${feature}»`);
  if (Number(meta.get("version")) !== version) throw new PromptFormatError(`${where}: version должна совпадать с именем файла (${version})`);

  const sections = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of lines.slice(end + 1)) {
    const header = /^## ([a-zA-Z0-9_.]+)\s*$/.exec(line);
    if (header) {
      if (sections.has(header[1]!)) throw new PromptFormatError(`${where}: секция «${header[1]}» повторяется`);
      current = [];
      sections.set(header[1]!, current);
    } else if (current) current.push(line);
  }
  const trimmed = new Map<string, string>();
  for (const [name, body] of sections) trimmed.set(name, body.join("\n").replace(/^\n+|\n+$/g, ""));

  const number = (key: string): number | undefined => {
    const v = meta.get(key);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new PromptFormatError(`${where}: ${key} — не число`);
    return n;
  };
  const temperature = number("temperature");
  const maxTokens = number("max_tokens");
  return {
    promptId: `${feature}@v${version}`,
    feature,
    version,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    sections: trimmed,
  };
}

/** Все промпты каталога: prompts/<feature>/vN.md. Ошибка формата — исключение при старте, а не на запросе. */
export function loadPromptRegistry(dir: string = PROMPTS_DIR): PromptRegistry {
  const byId = new Map<string, PromptTemplate>();
  for (const feature of readdirSync(dir, { withFileTypes: true })) {
    if (!feature.isDirectory()) continue;
    for (const file of readdirSync(join(dir, feature.name))) {
      const m = FILE_RE.exec(file);
      if (!m) continue;
      const prompt = parsePrompt(readFileSync(join(dir, feature.name, file), "utf8"), feature.name, Number(m[1]));
      byId.set(prompt.promptId, prompt);
    }
  }
  return {
    get: (promptId) => byId.get(promptId),
    latest: (feature) => [...byId.values()].filter((p) => p.feature === feature).sort((a, b) => b.version - a.version)[0],
    ids: () => [...byId.keys()].sort(),
  };
}

/** Текст секции; нет секции — ошибка промпта (обязательные секции проверяет функция при сборке). */
export function section(prompt: PromptTemplate, name: string): string {
  const text = prompt.sections.get(name);
  if (text === undefined) throw new PromptFormatError(`${prompt.promptId}: нет секции «${name}»`);
  return text;
}

/**
 * Подстановка `{{имя}}` за один проход: вставленные значения повторно не разбираются, поэтому `{{…}}` из ввода
 * ученика остаётся текстом. Неизвестная подстановка — ошибка промпта.
 */
export function render(template: string, values: Readonly<Record<string, string>>, where = "prompt"): string {
  return template.replace(PLACEHOLDER_RE, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new PromptFormatError(`${where}: нет значения для {{${name}}}`);
    return value;
  });
}
