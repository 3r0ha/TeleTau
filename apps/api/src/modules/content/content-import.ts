// Импорт курса из YAML (content/course/<course>/course.yaml, units/<unit>/unit.yaml, units/<unit>/lessons/<lesson>.yaml;
// формат — content/schema/*.schema.json, источники — content/sources.yaml) в таблицы модуля content: юниты, узлы тропы,
// упражнения с ключами ответов и источниками, словарь курса (words — слова new_words с переводом и записью), content_versions.
//
// Идемпотентно: та же `version` с тем же содержимым — без изменений (повторный запуск — доли секунды); та же `version`
// с другим содержимым — ошибка (поднимите version в course.yaml или запустите с --force); новая версия заменяет строки
// курса целиком в одной транзакции (на уроки и упражнения ссылаются только забеги и попытки — текстом, без внешних ключей).
// Строки с вердиктом носителя `native_rejected` не импортируются (CLAUDE.md, правило 6): отклонённый ответ убирается
// из принятых, упражнение без показываемых строк пропускается. Башкирский текст хранится в канонической форме
// @teletau/bashkir-text (`normalize`, правило 7). Полную проверку схемы делает scripts/check-content.mjs в `pnpm lint`;
// здесь — только то, без чего импорт невозможен.
//
// Запуск: `pnpm --filter @teletau/api content:import [--root <каталог с course/ и sources.yaml>] [--force]` (его вызывают
// `pnpm dev` и `pnpm e2e` после org:import). Как и directory-import.ts, файл запускается встроенным в Node удалением
// типов без сборки: только стираемый синтаксис TS и нет относительных импортов; из пакетов — собранный @teletau/bashkir-text.
// Сырой SQL по таблицам content (ADR 0014: файл принадлежит модулю content).
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { answerTokens, normalize } from "@teletau/bashkir-text";
import pg from "pg";
import { parse } from "yaml";

export type ReviewFlag = "needs_native_review" | "native_approved" | "native_rejected";
export type ShownReview = Exclude<ReviewFlag, "native_rejected">;

/** Источник строки для показа (контракт: SourceCitation). */
export interface Citation {
  title: string;
  url?: string;
  locator?: string;
  license?: string;
}

/** Копия записи на сайте (контракт: AudioFile). */
export interface AudioFileValue {
  url: string;
  type: string;
}

/**
 * Запись произношения (контракт: AudioClip). В YAML — ссылка на файл Wikimedia Commons (content/schema, Audio); клиентам
 * уходит путь к копии на нашем сайте: url — AAC (/audio/<id>.m4a, играют все платформы), files — AAC и Ogg (/audio/<id>.ogg:
 * оригинал Ogg Vorbis с Commons или Ogg Opus из записи в другом формате — WAV Lingua Libre).
 * Копии кладёт scripts/prepare-audio.mjs в apps/web/public/audio; <id> — первые 16 hex SHA-256 копии из content/audio.
 */
export interface AudioValue {
  url: string;
  files: AudioFileValue[];
  source: Citation;
}

export const AUDIO_M4A_TYPE = 'audio/mp4; codecs="mp4a.40.2"';
export const AUDIO_OGG_TYPE = 'audio/ogg; codecs="vorbis"';
export const AUDIO_OPUS_TYPE = 'audio/ogg; codecs="opus"';

/**
 * Тип Ogg-копии по имени копии в content/audio: оригинал Ogg с Commons (ogg, oga — Vorbis) лежит на сайте как есть,
 * запись в другом формате (WAV Lingua Libre) — в Ogg Opus. То же правило — scripts/lib/audio.mjs (isOggOriginal).
 */
export const audioOggType = (copyName: string): string => (/\.(ogg|oga)$/i.test(copyName) ? AUDIO_OGG_TYPE : AUDIO_OPUS_TYPE);

/**
 * Имя копии записи в content/audio по ссылке Commons: слово из имени файла («Ba-<слово>.ogg» или
 * «LL-Q13389 (bak)-<диктор>-<слово>.wav», в адресах upload.wikimedia.org пробел — «_») и расширение. То же правило —
 * scripts/lib/audio.mjs (check-content, prepare-audio).
 */
export function audioCopyName(url: string): string {
  const name = decodeURIComponent(url.split("/").pop() ?? "");
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const word = name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/^(?:Ba|BA)-/, "")
    .replace(/^LL-Q\d+[ _]\([a-z]+\)-[^-]+-/, "");
  return `${word}.${ext}`;
}

/** Id копии записи — как у scripts/prepare-audio.mjs: первые 16 hex SHA-256 содержимого. */
export const audioCopyId = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

/**
 * Слаг башкирской строки — имя синтезированной копии в content/audio/tts (TTS ≠ запись носителя):
 * NFC → нижний регистр → краевая пунктуация снята → пробелы в «-» → прочая пунктуация удалена.
 * Тот же алгоритм — ttsSlug в scripts/lib/audio.mjs; слаги собирает scripts/tts/collect-slugs.mjs.
 */
export function ttsSlug(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replace(/\s+/gu, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "");
}

/** Источник синтезированной озвучки в content/sources.yaml (модель Silero v5_cis_base_nostress, диктор bak_aigul). */
const TTS_SOURCE_REF = "silero-tts-v5-cis";

/** Локальная запись по id копии: AAC — основной адрес, затем Ogg (oggType — audioOggType). */
export function localAudio(id: string, source: Citation, oggType: string = AUDIO_OGG_TYPE): AudioValue {
  const m4a = `/audio/${id}.m4a`;
  return { url: m4a, files: [{ url: m4a, type: AUDIO_M4A_TYPE }, { url: `/audio/${id}.ogg`, type: oggType }], source };
}

export interface BaValue {
  text: string;
  review: ShownReview;
  /** Запись произношения носителем — тогда в уроке и словаре есть «Послушать». */
  audio?: AudioValue;
}

/**
 * Слово словаря курса: строка из new_words урока. id — ключ слова (wordKey): регистр и пунктуация не важны, поэтому
 * «Сәләм!» и «Сәләм.» — одно слово (первое по курсу). Перевод — ru той же строки, иначе русская сторона упражнения.
 */
export interface WordRow {
  id: string;
  position: number;
  text: string;
  review: ShownReview;
  translationRu: string;
  audio: AudioValue | null;
  sources: Citation[];
  /** Урок, где слово встретилось впервые. */
  lessonId: string;
}

export interface UnitRow {
  id: string;
  position: number;
  status: "open" | "locked";
  placeSlug: string;
  titleRu: string;
  titleBa: string | null;
  titleBaReview: ShownReview | null;
  titleBaSource: Citation | null;
  topicRu: string;
}

export interface LessonRow {
  id: string;
  unitId: string;
  position: number;
  kind: "lesson" | "help_language" | "place_test";
  titleRu: string;
  icon: string | null;
  duelCount: number | null;
  newWords: BaValue[];
}

/** Ключ ответа (только сервер): принятые варианты или индекс верного варианта; meaningRu — для листа обратной связи. */
export type AnswerKeyRow =
  | { kind: "accepted"; accepted: BaValue[]; meaningRu?: string }
  | { kind: "choice"; correct: number; meaningRu?: string }
  | { kind: "pairs" }
  | { kind: "none" };

export interface ExerciseRow {
  id: string;
  lessonId: string;
  position: number;
  type: "tiles_ru_ba" | "choice_ba_ru" | "free_ru_ba" | "duel" | "match_pairs";
  /**
   * Что видит ученик, без ключей: tiles — { promptRu, tiles }, choice — { prompt, optionsRu }, free — { promptRu }, duel — {},
   * pairs — { pairs: [{ ba, ru }] } (порядок — ключ; сервер перемешивает стороны в забеге и даёт им непрозрачные id).
   */
  payload: Record<string, unknown>;
  answerKey: AnswerKeyRow;
  review: ShownReview;
  sources: Citation[];
  duelRef: string | null;
}

export interface CourseBundle {
  courseId: string;
  version: number;
  /** SHA-256 канонического JSON всех файлов курса, реестра источников и состава синтеза (tts). */
  hash: string;
  units: UnitRow[];
  lessons: LessonRow[];
  exercises: ExerciseRow[];
  /** Словарь курса: слова new_words по порядку курса (без перевода слово в словарь не попадает). */
  words: WordRow[];
  /** Сколько упражнений и строк пропущено из-за native_rejected. */
  skipped: { exercises: number; strings: number };
}

/** Разобранные файлы курса (как их отдаёт yaml.parse): так разбор проверяется без диска. */
export interface CourseFiles {
  course: unknown;
  units: Record<string, unknown>;
  lessons: Record<string, unknown>;
  sources: unknown;
  /** Копии записей в <root>/audio: имя файла → id (audioCopyId). Нет копии записи из контента — ошибка импорта. */
  audio?: Record<string, string>;
  /** Синтез в <root>/audio/tts: слаг строки (ttsSlug) → id (audioCopyId). Фолбэк для строк без записи носителя. */
  tts?: Record<string, string>;
}

/** Реестр источников и копии записей — то, на что ссылаются строки курса. */
type Sources = Map<string, SourceInfo> & { audio?: ReadonlyMap<string, string>; tts?: ReadonlyMap<string, string> };

// ── разбор ──

class ContentError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function obj(v: unknown, where: string): Obj {
  if (!isObj(v)) throw new ContentError(`${where}: ожидался объект`);
  return v;
}
function str(o: Obj, key: string, where: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) throw new ContentError(`${where}: нет строки «${key}»`);
  return v;
}
const optStr = (o: Obj, key: string): string | undefined => (typeof o[key] === "string" && o[key] !== "" ? (o[key] as string) : undefined);
function int(o: Obj, key: string, where: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isInteger(v)) throw new ContentError(`${where}: нет целого «${key}»`);
  return v;
}
function arr(o: Obj, key: string, where: string): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) throw new ContentError(`${where}: нет списка «${key}»`);
  return v;
}
const REVIEWS: ReadonlySet<string> = new Set(["needs_native_review", "native_approved", "native_rejected"]);

interface SourceInfo {
  title: string;
  url?: string;
  edition?: string;
  license?: string;
}

function readSources(raw: unknown): Map<string, SourceInfo> {
  const list = arr(obj(raw, "sources.yaml"), "sources", "sources.yaml");
  const out = new Map<string, SourceInfo>();
  list.forEach((s, i) => {
    const o = obj(s, `sources.yaml: sources[${i}]`);
    const id = str(o, "id", `sources.yaml: sources[${i}]`);
    const url = optStr(o, "url");
    const edition = optStr(o, "edition");
    const license = optStr(o, "license");
    out.set(id, { title: str(o, "title", `sources.yaml: ${id}`), ...(url ? { url } : {}), ...(edition ? { edition } : {}), ...(license ? { license } : {}) });
  });
  return out;
}

/** Башкирская строка YAML (BaText) → текст в канонической форме, статус и источник для показа. */
interface BaParsed {
  text: string;
  ru?: string;
  review: ReviewFlag;
  source: Citation;
  audio?: AudioValue;
}

function citation(raw: unknown, sources: Map<string, SourceInfo>, where: string): Citation {
  const o = obj(raw, `${where}.source`);
  const ref = str(o, "ref", `${where}.source`);
  const src = sources.get(ref);
  if (!src) throw new ContentError(`${where}.source: источника «${ref}» нет в content/sources.yaml`);
  const page = typeof o["page"] === "number" || typeof o["page"] === "string" ? String(o["page"]) : undefined;
  const locator = [page ? `с. ${page}` : undefined, optStr(o, "locator")].filter(Boolean).join(", ");
  const url = optStr(o, "url") ?? src.url;
  return { title: src.title, ...(url ? { url } : {}), ...(locator ? { locator } : {}), ...(src.license ? { license: src.license } : {}) };
}

const AUDIO_URL = /^https:\/\/upload\.wikimedia\.org\/\S+$/u;

function audioOf(raw: unknown, sources: Sources, where: string): AudioValue | undefined {
  if (raw === undefined) return undefined;
  const o = obj(raw, where);
  const url = str(o, "url", where);
  if (!AUDIO_URL.test(url)) throw new ContentError(`${where}: запись — только файл Wikimedia Commons (https://upload.wikimedia.org/…)`);
  const source = citation(o["source"], sources, where);
  const license = optStr(o, "license");
  const name = audioCopyName(url);
  const id = sources.audio?.get(name.normalize("NFC"));
  if (!id) throw new ContentError(`${where}: нет копии записи content/audio/${name}`);
  return localAudio(id, license ? { ...source, license } : source, audioOggType(name));
}

/**
 * Синтезированная озвучка строки (фолбэк, когда записи носителя нет): копия content/audio/tts/<слаг>.ogg
 * (Silero, scripts/tts). Происхождение честно видно в источнике (silero-tts-v5-cis в sources.yaml):
 * синтез — не запись носителя. Строки с записью носителя синтезом не подменяются.
 */
function ttsAudio(text: string, sources: Sources, where: string): AudioValue | undefined {
  const id = sources.tts?.get(ttsSlug(text));
  if (id === undefined) return undefined;
  const src = sources.get(TTS_SOURCE_REF);
  if (!src) throw new ContentError(`${where}: нет источника «${TTS_SOURCE_REF}» в sources.yaml (синтез озвучки)`);
  const source: Citation = {
    title: src.title,
    ...(src.url ? { url: src.url } : {}),
    ...(src.license ? { license: src.license } : {}),
  };
  return localAudio(id, source, AUDIO_OGG_TYPE);
}

function baText(raw: unknown, sources: Sources, where: string): BaParsed {
  const o = obj(raw, where);
  const review = str(o, "review", where);
  if (!REVIEWS.has(review)) throw new ContentError(`${where}: неизвестный статус проверки «${review}»`);
  const ru = optStr(o, "ru");
  const text = normalize(str(o, "ba", where));
  // Запись носителя (content/audio); если её нет — синтезированная копия (content/audio/tts), помеченный фолбэк.
  const audio = audioOf(o["audio"], sources, `${where}.audio`) ?? ttsAudio(text, sources, where);
  return {
    text,
    review: review as ReviewFlag,
    source: citation(o["source"], sources, where),
    ...(ru ? { ru } : {}),
    ...(audio ? { audio } : {}),
  };
}

const shown = (b: BaParsed): b is BaParsed & { review: ShownReview } => b.review !== "native_rejected";
/** Худший статус проверки среди показываемых строк. */
const worst = (items: readonly { review: ShownReview }[]): ShownReview => (items.some((i) => i.review === "needs_native_review") ? "needs_native_review" : "native_approved");
const uniqueSources = (items: readonly Citation[]): Citation[] => {
  const seen = new Map<string, Citation>();
  for (const c of items) seen.set(JSON.stringify(c), c);
  return [...seen.values()];
};

/** Плитки ответа — слова строки без пунктуации по краям слова (content/schema/lesson.schema.json, TilesRuBa). */
export function tileWords(text: string): string[] {
  return text
    .split(/\s+/u)
    .map((w) => w.replace(/^\p{P}+|\p{P}+$/gu, ""))
    .filter((w) => w.length > 0);
}

/** Ключ слова словаря: слова answerTokens (как сравнивает проверка ответа) через пробел. */
export function wordKey(text: string): string {
  return answerTokens(text).join(" ");
}

/** Канонический JSON: ключи объектов по алфавиту — хеш не зависит от порядка ключей в YAML. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (isObj(v))
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical(v[k])]),
    );
  return v;
}

/** Строки таблиц из разобранных файлов курса. */
export function buildCourse(files: CourseFiles): CourseBundle {
  const sources: Sources = Object.assign(readSources(files.sources), {
    audio: new Map(Object.entries(files.audio ?? {})),
    tts: new Map(Object.entries(files.tts ?? {})),
  });
  const course = obj(files.course, "course.yaml");
  const courseId = str(course, "id", "course.yaml");
  const version = int(course, "version", "course.yaml");
  if (version < 1) throw new ContentError("course.yaml: version должна быть ≥ 1");
  const unitIds = arr(course, "units", "course.yaml").map((u, i) => {
    if (typeof u !== "string") throw new ContentError(`course.yaml: units[${i}] — не строка`);
    return u;
  });
  const skipped = { exercises: 0, strings: 0 };
  const units: UnitRow[] = [];
  const lessons: LessonRow[] = [];
  const exercises: ExerciseRow[] = [];
  const words = new Map<string, WordRow>();
  const nodeIds = new Set<string>();
  const exerciseIds = new Set<string>();

  unitIds.forEach((unitId, ui) => {
    const where = `units/${unitId}/unit.yaml`;
    const unit = obj(files.units[unitId], where);
    if (str(unit, "id", where) !== unitId) throw new ContentError(`${where}: id не совпадает с каталогом`);
    const status = str(unit, "status", where);
    if (status !== "open" && status !== "locked") throw new ContentError(`${where}: status — open или locked`);
    const place = obj(unit["place"], `${where}.place`);
    let titleBa: BaParsed | undefined = place["title_ba"] !== undefined ? baText(place["title_ba"], sources, `${where}.place.title_ba`) : undefined;
    if (titleBa && !shown(titleBa)) {
      skipped.strings++;
      titleBa = undefined;
    }
    units.push({
      id: unitId,
      position: ui + 1,
      status,
      placeSlug: str(place, "slug", `${where}.place`),
      titleRu: str(place, "title_ru", `${where}.place`),
      titleBa: titleBa?.text ?? null,
      titleBaReview: titleBa ? (titleBa.review as ShownReview) : null,
      titleBaSource: titleBa?.source ?? null,
      topicRu: str(unit, "topic_ru", where),
    });

    arr(unit, "nodes", where).forEach((rawNode, ni) => {
      const nWhere = `${where}: nodes[${ni}]`;
      const node = obj(rawNode, nWhere);
      const id = str(node, "id", nWhere);
      if (nodeIds.has(id)) throw new ContentError(`${nWhere}: узел «${id}» уже есть в курсе`);
      nodeIds.add(id);
      const kind = str(node, "kind", nWhere);
      if (kind !== "lesson" && kind !== "help_language" && kind !== "place_test") throw new ContentError(`${nWhere}: неизвестный вид узла «${kind}»`);
      const icon = optStr(node, "icon") ?? null;
      if (kind === "help_language") {
        lessons.push({ id, unitId, position: ni + 1, kind, titleRu: optStr(node, "title_ru") ?? "Помоги языку", icon, duelCount: int(node, "duels", nWhere), newWords: [] });
        return;
      }
      const lessonRaw = files.lessons[id];
      if (status === "locked" || lessonRaw === undefined) {
        if (status === "open") throw new ContentError(`${nWhere}: нет файла урока units/${unitId}/lessons/${id}.yaml`);
        lessons.push({ id, unitId, position: ni + 1, kind, titleRu: str(node, "title_ru", nWhere), icon, duelCount: null, newWords: [] });
        return;
      }
      const lWhere = `units/${unitId}/lessons/${id}.yaml`;
      const lesson = obj(lessonRaw, lWhere);
      if (str(lesson, "id", lWhere) !== id) throw new ContentError(`${lWhere}: id не совпадает с именем файла`);
      if (str(lesson, "unit", lWhere) !== unitId) throw new ContentError(`${lWhere}: unit не совпадает с каталогом`);
      if (str(lesson, "kind", lWhere) !== kind) throw new ContentError(`${lWhere}: kind не совпадает с узлом в unit.yaml`);

      const strings = new Map<string, ShownReview>();
      /** Строки урока по тексту: перевод, запись и источник для словаря (первая строка с переводом). */
      const meanings = new Map<string, StringInfo>();
      const lessonExercises: ExerciseRow[] = [];
      arr(lesson, "exercises", lWhere).forEach((rawEx, ei) => {
        const eWhere = `${lWhere}: exercises[${ei}]`;
        const ex = obj(rawEx, eWhere);
        const exId = str(ex, "id", eWhere);
        if (exerciseIds.has(exId)) throw new ContentError(`${eWhere}: упражнение «${exId}» уже есть в курсе`);
        exerciseIds.add(exId);
        const row = buildExercise(ex, exId, id, sources, eWhere, skipped);
        if (!row) {
          skipped.exercises++;
          return;
        }
        const { strings: rowStrings, ...exercise } = row;
        lessonExercises.push({ ...exercise, position: lessonExercises.length + 1 });
        for (const s of rowStrings) {
          strings.set(s.text, strings.get(s.text) === "needs_native_review" ? "needs_native_review" : s.review);
          const known = meanings.get(s.text);
          if (!known || (!known.ru && s.ru)) meanings.set(s.text, { ...s, audio: s.audio ?? known?.audio });
          else if (!known.audio && s.audio) meanings.set(s.text, { ...known, audio: s.audio });
        }
      });
      exercises.push(...lessonExercises);
      const newWords = (Array.isArray(lesson["new_words"]) ? lesson["new_words"] : []).flatMap((w): BaValue[] => {
        if (typeof w !== "string") return [];
        const text = normalize(w);
        const review = strings.get(text);
        const audio = meanings.get(text)?.audio;
        return review ? [{ text, review, ...(audio ? { audio } : {}) }] : [];
      });
      for (const w of newWords) {
        const key = wordKey(w.text);
        const info = meanings.get(w.text);
        if (!key) continue;
        const known = words.get(key);
        if (known) {
          // То же слово в другом уроке: запись — первая найденная, проверка — худшая.
          if (!known.audio && w.audio) known.audio = w.audio;
          if (w.review === "needs_native_review") known.review = "needs_native_review";
          continue;
        }
        if (!info?.ru) continue;
        words.set(key, { id: key, position: words.size + 1, text: w.text, review: w.review, translationRu: info.ru, audio: w.audio ?? null, sources: [info.source], lessonId: id });
      }
      lessons.push({ id, unitId, position: ni + 1, kind, titleRu: str(lesson, "title_ru", lWhere), icon, duelCount: null, newWords });
    });
  });

  const hash = createHash("sha256")
    // tts входит в хеш: состав синтеза меняет курс (кнопка «Послушать»), без смены version импорт не сработает
    .update(JSON.stringify(canonical({ course: files.course, units: files.units, lessons: files.lessons, sources: files.sources, tts: files.tts ?? {} })))
    .digest("hex");
  return { courseId, version, hash, units, lessons, exercises, words: [...words.values()], skipped };
}

/** Башкирская строка упражнения для словаря: перевод (свой ru или русская сторона упражнения) и источник. */
interface StringInfo extends BaValue {
  ru?: string;
  source: Citation;
}

type ExerciseDraft = Omit<ExerciseRow, "position"> & { strings: StringInfo[] };

function buildExercise(ex: Obj, id: string, lessonId: string, sources: Map<string, SourceInfo>, where: string, skipped: { strings: number }): ExerciseDraft | undefined {
  const type = str(ex, "type", where);
  const keep = (items: BaParsed[]) => {
    const ok = items.filter(shown);
    skipped.strings += items.length - ok.length;
    return ok;
  };
  const value = (b: BaParsed & { review: ShownReview }): BaValue => ({ text: b.text, review: b.review, ...(b.audio ? { audio: b.audio } : {}) });
  /** Строка для словаря: перевод — свой ru, иначе русская сторона упражнения (fallbackRu). */
  const info = (b: BaParsed & { review: ShownReview }, fallbackRu?: string): StringInfo => {
    const ru = b.ru ?? fallbackRu;
    return { ...value(b), source: b.source, ...(ru ? { ru } : {}) };
  };
  switch (type) {
    case "tiles_ru_ba": {
      const [answer] = keep([baText(ex["answer"], sources, `${where}.answer`)]);
      if (!answer) return undefined;
      const distractors = keep(arr(ex, "distractors", where).map((d, i) => baText(d, sources, `${where}.distractors[${i}]`)));
      const tiles = [...tileWords(answer.text), ...distractors.flatMap((d) => tileWords(d.text))];
      const all = [answer, ...distractors];
      return {
        id,
        lessonId,
        type,
        payload: { promptRu: str(ex, "prompt_ru", where), tiles },
        answerKey: { kind: "accepted", accepted: [value(answer)], ...(answer.ru ? { meaningRu: answer.ru } : {}) },
        review: worst(all),
        sources: uniqueSources(all.map((b) => b.source)),
        duelRef: null,
        strings: [info(answer, str(ex, "prompt_ru", where)), ...distractors.map((d) => info(d))],
      };
    }
    case "choice_ba_ru": {
      const [prompt] = keep([baText(ex["prompt"], sources, `${where}.prompt`)]);
      if (!prompt) return undefined;
      const optionsRu = arr(ex, "options_ru", where).map((o, i) => {
        if (typeof o !== "string" || o === "") throw new ContentError(`${where}.options_ru[${i}]: не строка`);
        return o;
      });
      const correct = int(ex, "correct", where);
      if (correct < 0 || correct >= optionsRu.length) throw new ContentError(`${where}: correct вне options_ru`);
      return {
        id,
        lessonId,
        type,
        payload: { prompt: value(prompt), optionsRu },
        answerKey: { kind: "choice", correct, meaningRu: prompt.ru ?? optionsRu[correct]! },
        review: prompt.review,
        sources: [prompt.source],
        duelRef: null,
        strings: [info(prompt, optionsRu[correct])],
      };
    }
    case "free_ru_ba": {
      const answers = keep(arr(ex, "answers", where).map((a, i) => baText(a, sources, `${where}.answers[${i}]`)));
      if (answers.length === 0) return undefined;
      const meaningRu = answers.find((a) => a.ru)?.ru;
      return {
        id,
        lessonId,
        type,
        payload: { promptRu: str(ex, "prompt_ru", where) },
        answerKey: { kind: "accepted", accepted: answers.map(value), ...(meaningRu ? { meaningRu } : {}) },
        review: worst(answers),
        sources: uniqueSources(answers.map((a) => a.source)),
        duelRef: null,
        strings: answers.map((a) => info(a, str(ex, "prompt_ru", where))),
      };
    }
    case "match_pairs": {
      const pairs = keep(arr(ex, "pairs", where).map((p, i) => baText(p, sources, `${where}.pairs[${i}]`)));
      // Отклонённая носителем пара просто убирается; меньше двух пар — соединять нечего.
      if (pairs.length < 2) return undefined;
      for (const [i, p] of pairs.entries()) if (!p.ru) throw new ContentError(`${where}.pairs[${i}]: у пары нет ru — перевода из источника`);
      return {
        id,
        lessonId,
        type,
        payload: { pairs: pairs.map((p) => ({ ba: value(p), ru: p.ru! })) },
        answerKey: { kind: "pairs" },
        review: worst(pairs),
        sources: uniqueSources(pairs.map((p) => p.source)),
        duelRef: null,
        strings: pairs.map((p) => info(p)),
      };
    }
    case "duel":
      return { id, lessonId, type, payload: {}, answerKey: { kind: "none" }, review: "needs_native_review", sources: [], duelRef: optStr(ex, "duel") ?? null, strings: [] };
    default:
      throw new ContentError(`${where}: неизвестный тип упражнения «${type}»`);
  }
}

// ── чтение с диска ──

const DEFAULT_ROOT = fileURLToPath(new URL("../../../../../content/", import.meta.url));

const readYaml = (path: string): unknown => parse(readFileSync(path, "utf8"));
const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();
const isFile = (p: string) => existsSync(p) && statSync(p).isFile();

/** Все курсы каталога `<root>/course/*` (у каждого — course.yaml) с реестром `<root>/sources.yaml`. */
export function readContent(root: string = DEFAULT_ROOT): CourseFiles[] {
  const courseRoot = join(root, "course");
  if (!isDir(courseRoot)) return [];
  const dirs = readdirSync(courseRoot)
    .sort()
    .map((d) => join(courseRoot, d))
    .filter((d) => existsSync(join(d, "course.yaml")));
  if (dirs.length === 0) return [];
  const sources = readYaml(join(root, "sources.yaml"));
  const audioDir = join(root, "audio");
  const audio: Record<string, string> = {};
  // каталог tts внутри audio — отдельная карта ниже, файлы не смешиваются
  if (isDir(audioDir))
    for (const f of readdirSync(audioDir).sort())
      if (isFile(join(audioDir, f))) audio[f.normalize("NFC")] = audioCopyId(readFileSync(join(audioDir, f)));
  const ttsDir = join(root, "audio/tts");
  const tts: Record<string, string> = {};
  if (isDir(ttsDir))
    for (const f of readdirSync(ttsDir).sort()) if (/\.ogg$/i.test(f)) tts[f.replace(/\.ogg$/i, "").normalize("NFC")] = audioCopyId(readFileSync(join(ttsDir, f)));
  return dirs.map((dir) => {
    const course = readYaml(join(dir, "course.yaml"));
    const units: Record<string, unknown> = {};
    const lessons: Record<string, unknown> = {};
    const unitList = isObj(course) && Array.isArray(course["units"]) ? course["units"] : [];
    for (const unitId of unitList) {
      if (typeof unitId !== "string") continue;
      const unitDir = join(dir, "units", unitId);
      const unitFile = join(unitDir, "unit.yaml");
      if (!existsSync(unitFile)) throw new ContentError(`нет файла ${unitFile}`);
      units[unitId] = readYaml(unitFile);
      const lessonDir = join(unitDir, "lessons");
      if (!isDir(lessonDir)) continue;
      for (const f of readdirSync(lessonDir).sort()) if (f.endsWith(".yaml")) lessons[f.slice(0, -".yaml".length)] = readYaml(join(lessonDir, f));
    }
    return { course, units, lessons, sources, audio, tts };
  });
}

// ── запись в базу ──

export interface CourseImportResult {
  courseId: string;
  version: number;
  status: "imported" | "unchanged";
  units: number;
  lessons: number;
  exercises: number;
  words: number;
  skipped: { exercises: number; strings: number };
}

/** UUIDv7 (RFC 9562) — как src/common/uuidv7.ts (здесь копия: файл не имеет относительных импортов). */
function uuidv7(): string {
  const b = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const json = (v: unknown) => JSON.stringify(v);

/** Импорт одного курса в транзакции (рекомендательная блокировка — параллельные импорты идут по очереди). */
export async function importCourse(pool: pg.Pool, bundle: CourseBundle, opts: { force?: boolean } = {}): Promise<CourseImportResult> {
  const result = (status: CourseImportResult["status"]): CourseImportResult => ({
    courseId: bundle.courseId,
    version: bundle.version,
    status,
    units: bundle.units.length,
    lessons: bundle.lessons.length,
    exercises: bundle.exercises.length,
    words: bundle.words.length,
    skipped: bundle.skipped,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`teletau:content-import:${bundle.courseId}`]);
    const versions = await client.query<{ version: number; content_hash: string }>(
      "SELECT version, content_hash FROM content_versions WHERE course_id = $1 ORDER BY version DESC",
      [bundle.courseId],
    );
    const same = versions.rows.find((r) => r.version === bundle.version);
    const latest = versions.rows[0]?.version;
    if (same && same.content_hash !== bundle.hash && !opts.force) {
      throw new ContentError(`курс ${bundle.courseId}: версия ${bundle.version} уже загружена с другим содержимым — поднимите version в course.yaml (или --force)`);
    }
    if (latest !== undefined && bundle.version < latest && !opts.force) {
      throw new ContentError(`курс ${bundle.courseId}: версия ${bundle.version} ниже загруженной ${latest}`);
    }
    if (same && same.content_hash === bundle.hash && latest === bundle.version && !opts.force) {
      await client.query("COMMIT");
      return result("unchanged");
    }

    // Новая версия заменяет строки курса целиком (каскад units → lessons → exercises).
    await client.query("DELETE FROM units WHERE course_id = $1", [bundle.courseId]);
    await client.query("DELETE FROM words WHERE course_id = $1", [bundle.courseId]);
    const v = bundle.version;
    for (const u of bundle.units) {
      await client.query(
        `INSERT INTO units (id, course_id, position, status, place_slug, title_ru, title_ba, title_ba_review, title_ba_source, topic_ru, content_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
        [u.id, bundle.courseId, u.position, u.status, u.placeSlug, u.titleRu, u.titleBa, u.titleBaReview, u.titleBaSource ? json(u.titleBaSource) : null, u.topicRu, v],
      );
    }
    for (const l of bundle.lessons) {
      await client.query(
        `INSERT INTO lessons (id, unit_id, position, kind, title_ru, icon, duel_count, new_words, content_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
        [l.id, l.unitId, l.position, l.kind, l.titleRu, l.icon, l.duelCount, json(l.newWords), v],
      );
    }
    for (const e of bundle.exercises) {
      await client.query(
        `INSERT INTO exercises (id, lesson_id, position, type, payload, answer_key, review, sources, duel_ref, content_version)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9, $10)`,
        [e.id, e.lessonId, e.position, e.type, json(e.payload), json(e.answerKey), e.review, json(e.sources), e.duelRef, v],
      );
    }
    for (const w of bundle.words) {
      await client.query(
        `INSERT INTO words (course_id, id, position, text, review, translation_ru, audio, sources, lesson_id, content_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)`,
        [bundle.courseId, w.id, w.position, w.text, w.review, w.translationRu, w.audio ? json(w.audio) : null, json(w.sources), w.lessonId, v],
      );
    }
    if (same) {
      await client.query("UPDATE content_versions SET content_hash = $3, imported_at = now() WHERE course_id = $1 AND version = $2", [bundle.courseId, v, bundle.hash]);
    } else {
      await client.query("INSERT INTO content_versions (id, course_id, version, content_hash) VALUES ($1, $2, $3, $4)", [uuidv7(), bundle.courseId, v, bundle.hash]);
    }
    await client.query("COMMIT");
    return result("imported");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Импорт всех курсов каталога (нет курсов — пустой список). */
export async function importContent(pool: pg.Pool, opts: { root?: string; force?: boolean } = {}): Promise<CourseImportResult[]> {
  const out: CourseImportResult[] = [];
  for (const files of readContent(opts.root)) out.push(await importCourse(pool, buildCourse(files), { force: opts.force }));
  return out;
}

async function main(): Promise<void> {
  const rootArg = process.argv.indexOf("--root");
  const root = rootArg >= 0 && process.argv[rootArg + 1] ? resolve(process.argv[rootArg + 1]!) : DEFAULT_ROOT;
  const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL"] ?? "postgres://teletau:teletau@localhost:15432/teletau", max: 1 });
  try {
    const results = await importContent(pool, { root, force: process.argv.includes("--force") });
    if (results.length === 0) console.log(`content:import: курсов нет (${join(root, "course")}/*/course.yaml) — пропуск`);
    for (const r of results) {
      const skipped = r.skipped.exercises || r.skipped.strings ? `; отклонено носителем: упражнений ${r.skipped.exercises}, строк ${r.skipped.strings}` : "";
      const what = r.status === "unchanged" ? "без изменений" : "загружен";
      console.log(`content:import: курс ${r.courseId} v${r.version} ${what} — юнитов ${r.units}, узлов ${r.lessons}, упражнений ${r.exercises}, слов ${r.words}${skipped}`);
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e: unknown) => {
    console.error(`content:import: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
