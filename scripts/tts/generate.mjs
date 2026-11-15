// Синтез башкирской озвучки строк курса — content/audio/tts/<слаг>.ogg (Ogg Vorbis, 24 кГц, моно).
//
// Вход — манифест scripts/tts/collect-slugs.mjs (JSON {слаг: текст}): слаги строк курса без записи носителя.
// Модель Silero v5_cis_base_nostress (диктор bak_aigul, MIT — LICENSE_CIS в репозитории модели) исполняется
// на JavaScript (scripts/tts/silero.mjs) прямо из исходного пакета .pt; синтез ≠ запись носителя: клиенты видят
// происхождение в источнике silero-tts-v5-cis (content/sources.yaml). Подробности — scripts/tts/README.md.
//
// Запуск (из корня репозитория):
//   node scripts/tts/collect-slugs.mjs > manifest.json
//   node scripts/tts/generate.mjs manifest.json            # существующие файлы не трогает
//   node scripts/tts/generate.mjs manifest.json --force    # перегенерировать всё
// Ключи: --out <каталог> (по умолчанию content/audio/tts), --model <файл .pt> (по умолчанию — кеш, см. modelPath),
// --jobs <n> (параллельные потоки, по умолчанию до 4).
//
// Дальше файлы подхватывает пайплайн озвучки: check-content.mjs (проверка слагов), prepare-audio.mjs
// (копии в apps/web/public/audio), content-import.ts (фолбэк «Послушать» для строк без записи).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { createOggEncoder } from "wasm-media-encoders";
import { isInvokedDirectly } from "../lib/invoked.mjs";
import { SILERO_MODEL, SileroTTS } from "./silero.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const SPEAKER = "bak_aigul";
export const SAMPLE_RATE = 24000;
// Качество VBR 4 (libvorbis 0,4) — номинальный битрейт 45 111 бит/с на 24 кГц моно, как у файлов в content/audio/tts.
export const VORBIS_QUALITY = 4;
const MIN_SECONDS = 0.2; // короче — подозрительно, вероятно пустой синтез

/** Кеш модели вне репозитория: $TELETAU_TTS_CACHE или ~/.cache/teletau/tts. */
export function modelPath(env = process.env) {
  const dir = env.TELETAU_TTS_CACHE || join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "teletau", "tts");
  return join(dir, `${SILERO_MODEL.id}.pt`);
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Пакет модели: из кеша или скачивается; SHA-256 сверяется всегда. */
async function ensureModel(path) {
  if (!existsSync(path)) {
    console.error(`tts: скачиваю ${SILERO_MODEL.url} → ${path}`);
    const res = await fetch(SILERO_MODEL.url);
    if (!res.ok) throw new Error(`модель не скачалась: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha256(buf) !== SILERO_MODEL.sha256) throw new Error("скачанная модель не совпала по SHA-256");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.part`, buf);
    renameSync(`${path}.part`, path);
    return buf;
  }
  const buf = readFileSync(path);
  if (sha256(buf) !== SILERO_MODEL.sha256) throw new Error(`${path}: не тот файл модели (SHA-256 не совпал)`);
  return buf;
}

/** PCM [-1, 1] → Ogg Vorbis (моно). */
export async function encodeVorbis(pcm, sampleRate = SAMPLE_RATE, encoder) {
  const enc = encoder ?? (await createOggEncoder());
  enc.configure({ channels: 1, sampleRate, vbrQuality: VORBIS_QUALITY });
  const head = enc.encode([pcm]).slice(); // буферы кодера переиспользуются — копировать до следующего вызова
  const tail = enc.finalize().slice();
  return Buffer.concat([head, tail]);
}

/** Одна строка: синтез → проверка длины → Ogg Vorbis. */
async function render(tts, encoder, text) {
  const pcm = tts.synthesize(text, { speaker: SPEAKER, sampleRate: SAMPLE_RATE });
  if (pcm.length < MIN_SECONDS * SAMPLE_RATE) throw new Error(`пустой синтез (${(pcm.length / SAMPLE_RATE).toFixed(2)} с)`);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-1, Math.min(1, pcm[i]));
  return encodeVorbis(pcm, SAMPLE_RATE, encoder);
}

/** Поток синтеза: модель загружается один раз, строки приходят сообщениями. */
async function workerMain() {
  const { model } = workerData.teletauTts;
  const tts = new SileroTTS(Buffer.from(model.buffer, model.byteOffset, model.byteLength));
  const encoder = await createOggEncoder();
  parentPort.on("message", async ({ slug, text }) => {
    try {
      parentPort.postMessage({ slug, ogg: await render(tts, encoder, text) });
    } catch (e) {
      parentPort.postMessage({ slug, error: e instanceof Error ? e.message : String(e) });
    }
  });
  parentPort.postMessage({ ready: true });
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { force: { type: "boolean" }, out: { type: "string" }, model: { type: "string" }, jobs: { type: "string" } },
  });
  if (positionals.length !== 1) {
    console.error("использование: node scripts/tts/generate.mjs manifest.json [--force] [--out <каталог>] [--model <файл .pt>] [--jobs <n>]");
    return 2;
  }
  const items = Object.entries(JSON.parse(readFileSync(positionals[0], "utf8"))).sort(([a], [b]) => a.localeCompare(b));
  if (!items.length) {
    console.error("манифест пуст — синтезировать нечего");
    return 1;
  }
  const outDir = resolve(values.out ?? join(REPO, "content/audio/tts"));
  mkdirSync(outDir, { recursive: true });
  const todo = items.filter(([slug]) => values.force || !existsSync(join(outDir, `${slug}.ogg`)));
  const skipped = items.length - todo.length;
  const started = Date.now();
  let done = 0;
  let failed = 0;
  if (todo.length) {
    const model = await ensureModel(values.model ? resolve(values.model) : modelPath());
    const jobs = Math.max(1, Math.min(todo.length, Number(values.jobs) || Math.min(4, availableParallelism())));
    const shared = new Uint8Array(new SharedArrayBuffer(model.length));
    shared.set(model);
    const queue = [...todo];
    await Promise.all(
      Array.from({ length: jobs }, () => {
        const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { teletauTts: { model: shared } } });
        return new Promise((resolveWorker, reject) => {
          const next = () => {
            const item = queue.shift();
            if (!item) return void worker.terminate().then(() => resolveWorker());
            worker.postMessage({ slug: item[0], text: item[1] });
          };
          worker.on("message", (msg) => {
            if (msg.ready) return next();
            const text = todo.find(([s]) => s === msg.slug)?.[1];
            if (msg.error) {
              failed++;
              console.error(`  FAIL «${text}» (${msg.slug}): ${msg.error}`);
            } else {
              writeFileSync(join(outDir, `${msg.slug}.ogg`), Buffer.from(msg.ogg));
              done++;
            }
            next();
          });
          worker.on("error", reject);
        });
      }),
    );
  }
  const where = relative(REPO, outDir) || outDir;
  console.log(
    `tts: строк ${items.length}, синтезировано ${done}, пропущено (уже есть) ${skipped}, ошибок ${failed} ` +
      `за ${Math.round((Date.now() - started) / 1000)} с → ${where.startsWith("..") ? outDir : where}`,
  );
  return failed ? 1 : 0;
}

if (!isMainThread && workerData?.teletauTts) await workerMain();
else if (isInvokedDirectly(import.meta.url)) process.exitCode = await main();
