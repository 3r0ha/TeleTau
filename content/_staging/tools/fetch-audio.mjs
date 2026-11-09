// Скачивает записи произношения с Wikimedia Commons в content/audio/<слово>.<расширение> и сверяет SHA-1 с API.
// Источник сведений — cache/commons/info.json (commons-info.mjs). Синтеза речи нет: только файлы людей с Commons.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const STAGING = fileURLToPath(new URL("..", import.meta.url));
const OUT = fileURLToPath(new URL("../../audio/", import.meta.url));
const info = JSON.parse(readFileSync(`${STAGING}cache/commons/info.json`, "utf8"));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Слово из имени файла Commons: «File:Ba-бал.oga» → «бал», «File:LL-Q13389 (bak)-Bababashqort-бар.wav» → «бар». */
export const wordOf = (title) => title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "").replace(/^(?:Ba|BA)-/, "").replace(/^LL-Q\d+ \([a-z]+\)-[^-]+-/, "");
// Только слова, которые есть в курсе отдельной строкой (список — аргументы командной строки).
const ONLY = new Set(process.argv.slice(2));
for (const [title, r] of Object.entries(info)) {
  if (ONLY.size && !ONLY.has(wordOf(title).toLowerCase())) continue;
  const url = (r.url ?? "").split("?")[0];
  if (!/\.(ogg|oga|wav)$/i.test(url)) continue; // Ogg Vorbis из Category:Bashkir pronunciation и WAV Lingua Libre
  const ext = url.split(".").pop().toLowerCase();
  const file = `${OUT}${wordOf(title)}.${ext}`;
  if (existsSync(file) && createHash("sha1").update(readFileSync(file)).digest("hex") === r.sha1) continue;
  let buf;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "TeleTauContentResearch/0.1 (hackathon content research; low-volume)" } });
    buf = Buffer.from(await res.arrayBuffer());
    const sha1 = createHash("sha1").update(buf).digest("hex");
    if (res.ok && sha1 === r.sha1) break;
    if (attempt >= 4) throw new Error(`${title}: HTTP ${res.status}, SHA-1 ${sha1} ≠ ${r.sha1}`);
    // 429: сервер просит подождать (Retry-After, обычно 600 с) — ждём, сколько просит, плюс запас.
    const wait = Number(res.headers.get("retry-after") ?? 30);
    console.log(`${title}: HTTP ${res.status}, жду ${wait} с`);
    await sleep((wait + 15) * 1000);
  }
  writeFileSync(file, buf);
  console.log("saved", file.slice(OUT.length), buf.length);
  await sleep(15000);
}
