// Слаги башкирских строк курса без записи носителя — вход для генерации синтезированной озвучки
// (scripts/tts/generate.py). Печатает JSON {слаг: текст} в stdout:
//
//   node scripts/tts/collect-slugs.mjs > manifest.json
//
// Слаг — ttsSlug из scripts/lib/audio.mjs от normalize(ba); строка с записью носителя (audio) исключается:
// у неё кнопка «Послушать» уже есть, синтез не подменяет запись. Отклонённые носителем (native_rejected)
// строки не показываются — синтезировать их бессмысленно. Слаг = имя файла content/audio/tts/<слаг>.ogg:
// файлы и есть манифест, YAML курса не меняется. Проверку слага и сирот делает scripts/check-content.mjs.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";
import { ttsSlug } from "../lib/audio.mjs";

const REPO = dirname(fileURLToPath(import.meta.url)) + "/../..";

/** Разобранные YAML курса (content/course, любая вложенность). */
function yamlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...yamlFiles(p));
    else if (/\.ya?ml$/.test(name)) out.push(p);
  }
  return out;
}

/** normalize из @teletau/bashkir-text — как импорт курса (сборка: pnpm --filter @teletau/bashkir-text build). */
async function loadNormalize() {
  const dist = join(REPO, "packages/bashkir-text/dist/index.js");
  const { normalize } = await import(pathToFileURL(dist).href);
  return normalize;
}

const native = new Set(); // слаги строк, у которых есть запись носителя
const out = new Map(); // слаг → текст для синтеза

function visit(data, normalize) {
  if (Array.isArray(data)) {
    for (const x of data) visit(x, normalize);
    return;
  }
  if (!data || typeof data !== "object") return;
  if (typeof data.ba === "string" && data.review !== "native_rejected") {
    const slug = ttsSlug(normalize(data.ba));
    if (data.audio && typeof data.audio === "object") native.add(slug);
    else if (!native.has(slug)) out.set(slug, normalize(data.ba));
  }
  for (const v of Object.values(data)) visit(v, normalize);
}

const normalize = await loadNormalize();
for (const f of yamlFiles(join(REPO, "content/course"))) visit(parse(readFileSync(f, "utf8")), normalize);
for (const slug of native) out.delete(slug);

console.log(JSON.stringify(Object.fromEntries([...out.entries()].sort(([a], [b]) => a.localeCompare(b, "ru"))), null, 0));
