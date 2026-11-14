// Озвучка со своего сайта: веб отдаёт записи произношения сам, без upload.wikimedia.org (на показе может не быть
// интернета; чужой сайт — лишняя зависимость). Источник — копии записей Commons в content/audio (их SHA-1 сверены
// с Commons, content/sources.yaml); ссылки на записи — поле audio.url в контенте курса. Строкам без записи
// носителя озвучку синтезирует scripts/tts (content/audio/tts/<слаг>.ogg, Silero) — импорт курса подставляет
// её как фолбэк, помеченный источником silero-tts-v5-cis.
//
//   node scripts/prepare-audio.mjs          — разложить записи в apps/web/public/audio и записать манифест
//   node scripts/prepare-audio.mjs --check  — проверить, что всё на месте и актуально (конвертер не нужен)
//
// Для каждой записи — два файла с именем по содержимому (первые 16 hex SHA-256 копии): <id>.m4a — AAC, его играют все
// платформы (iOS, Android, Safari), и <id>.ogg — для Ogg-оригинала (Vorbis, как на Commons, и TTS-копий из
// content/audio/tts) побайтная копия, для записи в другом формате (WAV Lingua Libre) — Ogg Opus. Кодирует встроенный в macOS afconvert (Opus — в CAF, контейнер
// Ogg собирает scripts/lib/ogg-opus.mjs) или ffmpeg, если он запускается; без конвертера файлы не создаются — --check
// это покажет.
// Пути к копиям отдаёт API (AudioClip.url = /audio/<id>.m4a, files — оба файла): тот же id считает импорт курса
// (apps/api/src/modules/content/content-import.ts, audioCopyId). Лишние файлы в public/audio удаляются.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { audioCopyPath, audioUrls, isOggOriginal } from "./lib/audio.mjs";
import { isInvokedDirectly } from "./lib/invoked.mjs";
import { cafOpusToOgg, isOggOpus } from "./lib/ogg-opus.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLIC_DIR = "apps/web/public/audio";

function yamlFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...yamlFiles(p));
    else if (/\.ya?ml$/.test(name)) out.push(p);
  }
  return out;
}

/** Озвучка курса: записи Commons (url → копия в content/audio) и синтез (content/audio/tts/<слаг>.ogg). */
export function collectClips(root = REPO) {
  const urls = new Set();
  for (const f of yamlFiles(join(root, "content/course"))) audioUrls(parse(readFileSync(f, "utf8")), urls);
  const clips = [];
  for (const url of [...urls].sort()) {
    const copy = audioCopyPath(url);
    const abs = join(root, copy);
    if (!existsSync(abs)) throw new Error(`${copy}: нет копии записи ${url} (проверка — node scripts/check-content.mjs)`);
    const id = createHash("sha256").update(readFileSync(abs)).digest("hex").slice(0, 16);
    clips.push({ url, copy, id });
  }
  // Синтез: имя файла — слаг строки курса без записи (scripts/tts); слаг проверяет check-content.mjs.
  const ttsDir = join(root, "content/audio/tts");
  if (existsSync(ttsDir))
    for (const name of readdirSync(ttsDir).sort()) {
      if (!/\.ogg$/i.test(name)) continue;
      const copy = `content/audio/tts/${name}`;
      clips.push({ url: null, copy, id: createHash("sha256").update(readFileSync(join(root, copy))).digest("hex").slice(0, 16) });
    }
  return clips;
}

const ok = (res, dst) => res.status === 0 && existsSync(dst) && statSync(dst).size > 0;

/** Ogg Opus через afconvert: он пишет Opus только в CAF, страницы Ogg собираются здесь (serial — из id записи). */
function afconvertOpus(src, dst, id) {
  const tmp = mkdtempSync(join(tmpdir(), "teletau-audio-"));
  try {
    const caf = join(tmp, "clip.caf");
    const res = spawnSync("afconvert", ["-f", "caff", "-d", "opus@48000", "-b", "48000", src, caf], { stdio: "pipe" });
    if (!ok(res, caf)) return false;
    writeFileSync(dst, cafOpusToOgg(readFileSync(caf), { serial: parseInt(id.slice(0, 8), 16) }));
    return true;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Конвертер в AAC и Ogg Opus: встроенный afconvert macOS или ffmpeg — только если запускается. */
function converter() {
  const works = (cmd, args) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
  // afconvert -h завершается с кодом 1 — проверяем сам файл (он есть в каждой macOS).
  if (process.platform === "darwin" && existsSync("/usr/bin/afconvert"))
    return {
      m4a: (src, dst) => ok(spawnSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "64000", src, dst], { stdio: "pipe" }), dst),
      opus: afconvertOpus,
    };
  if (works("ffmpeg", ["-hide_banner", "-version"])) {
    const ffmpeg = (src, dst, codec) => ok(spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", src, ...codec, "-map_metadata", "-1", dst], { stdio: "pipe" }), dst);
    return { m4a: (src, dst) => ffmpeg(src, dst, ["-c:a", "aac", "-b:a", "64k"]), opus: (src, dst) => ffmpeg(src, dst, ["-c:a", "libopus", "-b:a", "48k", "-f", "ogg"]) };
  }
  return null;
}

/** Ogg-копия на месте: у Ogg-оригинала — та же байт в байт, у остальных — Ogg Opus. */
function oggReady(root, c, ogg) {
  if (!existsSync(ogg)) return false;
  return isOggOriginal(c.copy) ? readFileSync(ogg).equals(readFileSync(join(root, c.copy))) : isOggOpus(readFileSync(ogg));
}

export function prepare(root = REPO, log = console.log) {
  const clips = collectClips(root);
  const dir = join(root, PUBLIC_DIR);
  mkdirSync(dir, { recursive: true });
  const convert = converter();
  let copied = 0;
  let converted = 0;
  const missingM4a = [];
  const missingOgg = [];
  for (const c of clips) {
    const src = join(root, c.copy);
    const ogg = join(dir, `${c.id}.ogg`);
    if (!oggReady(root, c, ogg)) {
      if (isOggOriginal(c.copy)) {
        copyFileSync(src, ogg);
        copied++;
      } else if (convert?.opus(src, ogg, c.id) && isOggOpus(readFileSync(ogg))) converted++;
      else {
        rmSync(ogg, { force: true });
        missingOgg.push(c.copy);
      }
    }
    const m4a = join(dir, `${c.id}.m4a`);
    if (!existsSync(m4a) || statSync(m4a).size === 0) {
      if (convert?.m4a(src, m4a)) converted++;
      else {
        rmSync(m4a, { force: true });
        missingM4a.push(c.copy);
      }
    }
  }
  const keep = new Set(clips.flatMap((c) => [`${c.id}.ogg`, `${c.id}.m4a`]));
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!keep.has(name)) {
      rmSync(join(dir, name), { force: true });
      removed++;
    }
  }
  log(`prepare-audio: записей ${clips.length}; скопировано ${copied}, закодировано ${converted}, удалено лишних ${removed} → ${PUBLIC_DIR}`);
  if (missingM4a.length) log(`prepare-audio: ПРЕДУПРЕЖДЕНИЕ — нет конвертера в AAC, m4a не созданы (${missingM4a.length}): Safari и iOS будут без «Послушать»`);
  if (missingOgg.length) log(`prepare-audio: ПРЕДУПРЕЖДЕНИЕ — нет конвертера в Ogg Opus, ogg не созданы (${missingOgg.length}): ${missingOgg.join(", ")}`);
  return { clips: clips.length, copied, converted, removed, missingM4a, missingOgg };
}

/** Ошибки актуальности: копии и m4a на месте, лишних файлов нет. */
export function check(root = REPO) {
  const errors = [];
  const clips = collectClips(root);
  const dir = join(root, PUBLIC_DIR);
  for (const c of clips) {
    const ogg = join(dir, `${c.id}.ogg`);
    if (!oggReady(root, c, ogg)) errors.push(`${relative(root, ogg)}: нет ${isOggOriginal(c.copy) ? "копии" : "Ogg Opus-версии"} ${c.copy}`);
    const m4a = join(dir, `${c.id}.m4a`);
    if (!existsSync(m4a) || statSync(m4a).size === 0) errors.push(`${relative(root, m4a)}: нет AAC-версии ${c.copy}`);
  }
  const keep = new Set(clips.flatMap((c) => [`${c.id}.ogg`, `${c.id}.m4a`]));
  if (existsSync(dir)) for (const name of readdirSync(dir)) if (!keep.has(name)) errors.push(`${PUBLIC_DIR}/${name}: лишний файл`);
  return errors;
}

if (isInvokedDirectly(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const errors = check();
    if (errors.length) {
      console.error(`prepare-audio --check: ${errors.length} проблем(ы):\n  ${errors.join("\n  ")}\nЗапустите: pnpm audio (на macOS — встроенный afconvert)`);
      process.exit(1);
    }
    console.log("prepare-audio --check: озвучка веба актуальна");
  } else {
    prepare();
  }
}
