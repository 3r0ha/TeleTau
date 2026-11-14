// Импорт дуэлей «Помоги языку» из content/corpus/duels/*.yaml (схема — content/schema/duels.schema.json) в таблицы
// модуля corpus: исходник → source_items (по external_id = id дуэли; для пары ba-kz — казахский текст в том же поле
// ru YAML и параметр lang = "kz"), два башкирских варианта → variants (origin = import, source_ref с названием
// и лицензией источника из content/sources.yaml).
//
// Идемпотентно: неизменённые строки не перезаписываются, повторный запуск ничего не меняет. Голоса (judgments)
// ссылаются на варианты, поэтому набор вариантов уже загруженной дуэли менять нельзя: другой текст варианта
// (после toComparable) — ошибка «заведите новую дуэль с новым id» (id дуэли не переиспользуется, duels.schema.json).
// Можно менять русскую фразу, источники, raw и вердикт носителя: native_rejected прячет вариант (дуэль уходит из пула).
// Новая дуэль с отклонённым вариантом не загружается вовсе (правило 6: отклонённые строки не показываются).
//
// Башкирский текст не меняется и не «исправляется»: ba должен совпадать с normalize(ba) (правило 7) — иначе ошибка;
// полную проверку контента делает scripts/check-content.mjs (pnpm lint).
//
// Запуск: `pnpm --filter @teletau/api corpus:import [--dir <каталог дуэлей>] [--sources <sources.yaml>]` (его вызывают
// `pnpm dev` и `pnpm e2e` после org:import). Как directory-import.ts, файл запускается встроенным в Node удалением
// типов: только стираемый синтаксис TS, без относительных импортов; из пакетов — собранный @teletau/bashkir-text.
// Сырой SQL по таблицам corpus (ADR 0014: файл принадлежит модулю corpus).
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalize, toComparable } from "@teletau/bashkir-text";
import pg from "pg";
import { parse } from "yaml";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
export const DEFAULT_DUELS_DIR = join(ROOT, "content/corpus/duels");
export const DEFAULT_SOURCES_FILE = join(ROOT, "content/sources.yaml");

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KINDS = new Set(["word", "phrase", "sentence"]);
const REVIEWS = new Set(["needs_native_review", "native_approved", "native_rejected"]);

export type Review = "needs_native_review" | "native_approved" | "native_rejected";

export interface SourceInfo {
  id: string;
  title: string;
  license: string;
}

/** source_ref в базе: ссылка из YAML + название и лицензия источника (для SourceCitation без чтения YAML в API). */
export interface StoredSourceRef {
  ref: string;
  url?: string;
  page?: string | number;
  locator: string;
  title: string;
  license: string;
}

export interface DuelVariantRow {
  text: string;
  textNorm: string;
  raw: string | null;
  review: Review;
  sourceRef: StoredSourceRef;
}

export interface DuelRow {
  externalId: string;
  unitId: string;
  file: string;
  ru: string;
  ruNorm: string;
  kind: "word" | "phrase" | "sentence";
  domain: string | null;
  sourceRef: StoredSourceRef | null;
  variants: [DuelVariantRow, DuelVariantRow];
}

export interface Counts {
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface DuelsImportResult {
  files: number;
  items: Counts & { skipped: number };
  variants: Counts;
  ms: number;
}

export interface DuelsImportOptions {
  dir?: string;
  sourcesFile?: string;
  /** Язык исходников: `ru` (пара ba-ru, по умолчанию) или `kz` (пара ba-kz — демо-корпус ТелеТау). */
  lang?: "ru" | "kz";
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** UUIDv7 (как src/common/uuidv7.ts — относительные импорты здесь недоступны). */
function uuidv7(now: number = Date.now()): string {
  const b = randomBytes(16);
  const ms = BigInt(now);
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** JSON с упорядоченными ключами — сравнение jsonb из базы с вычисленным значением. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (isObject(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Реестр источников content/sources.yaml: id → название и лицензия. */
export function parseSources(text: string): Map<string, SourceInfo> {
  const doc = parse(text) as unknown;
  const list = isObject(doc) ? doc["sources"] : undefined;
  if (!Array.isArray(list)) throw new Error("sources.yaml: нет списка sources");
  const out = new Map<string, SourceInfo>();
  for (const s of list) {
    if (!isObject(s) || !nonEmpty(s["id"]) || !nonEmpty(s["title"]) || !nonEmpty(s["license"])) {
      throw new Error(`sources.yaml: у источника нет id, title или license: ${JSON.stringify(s)}`);
    }
    out.set(s["id"], { id: s["id"], title: s["title"], license: s["license"] });
  }
  return out;
}

function sourceRef(raw: unknown, sources: Map<string, SourceInfo>, where: string, errors: string[]): StoredSourceRef | null {
  if (!isObject(raw) || !nonEmpty(raw["ref"]) || !nonEmpty(raw["locator"])) {
    errors.push(`${where}: source — нужны ref и locator`);
    return null;
  }
  const url = raw["url"];
  const page = raw["page"];
  if (!nonEmpty(url) && !(typeof page === "number" || nonEmpty(page))) {
    errors.push(`${where}: source — нужен url или page`);
    return null;
  }
  const info = sources.get(raw["ref"]);
  if (!info) {
    errors.push(`${where}: источника «${raw["ref"]}» нет в content/sources.yaml`);
    return null;
  }
  return {
    ref: info.id,
    ...(nonEmpty(url) ? { url } : {}),
    ...(typeof page === "number" || nonEmpty(page) ? { page } : {}),
    locator: raw["locator"],
    title: info.title,
    license: info.license,
  };
}

/**
 * Разбор файлов дуэлей в строки импорта. Ошибки собираются все сразу и бросаются одним исключением:
 * импорт либо загружает всё, либо ничего.
 */
export function parseDuelFiles(files: ReadonlyArray<{ name: string; text: string }>, sources: Map<string, SourceInfo>): DuelRow[] {
  const errors: string[] = [];
  const out: DuelRow[] = [];
  const seen = new Map<string, string>();
  for (const file of files) {
    let doc: unknown;
    try {
      doc = parse(file.text) as unknown;
    } catch (e) {
      errors.push(`${file.name}: YAML не разобран — ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (!isObject(doc) || typeof doc["unit"] !== "string" || !SLUG.test(doc["unit"]) || !Array.isArray(doc["duels"])) {
      errors.push(`${file.name}: нужны unit (slug) и список duels`);
      continue;
    }
    const unitId = doc["unit"];
    doc["duels"].forEach((d: unknown, i: number) => {
      const at = `${file.name}: duels[${i}]`;
      if (!isObject(d) || typeof d["id"] !== "string" || !SLUG.test(d["id"])) {
        errors.push(`${at}: нужен id (slug)`);
        return;
      }
      const id = d["id"];
      const where = `${file.name}: дуэль ${id}`;
      const dup = seen.get(id);
      if (dup) errors.push(`${where}: id уже есть в ${dup}`);
      seen.set(id, file.name);
      if (!nonEmpty(d["ru"])) errors.push(`${where}: нет ru`);
      if (typeof d["kind"] !== "string" || !KINDS.has(d["kind"])) errors.push(`${where}: kind — word, phrase или sentence`);
      const domain = d["domain"];
      if (domain !== undefined && (typeof domain !== "string" || !SLUG.test(domain))) errors.push(`${where}: domain — slug`);
      const ruSource = d["ru_source"] === undefined ? null : sourceRef(d["ru_source"], sources, `${where}, ru_source`, errors);
      const vs = d["variants"];
      if (!Array.isArray(vs) || vs.length !== 2) {
        errors.push(`${where}: нужно ровно два варианта`);
        return;
      }
      const rows: DuelVariantRow[] = [];
      vs.forEach((v: unknown, j: number) => {
        const vat = `${where}, variants[${j}]`;
        if (!isObject(v) || !nonEmpty(v["ba"])) {
          errors.push(`${vat}: нет ba`);
          return;
        }
        const ba = v["ba"];
        if (normalize(ba) !== ba) errors.push(`${vat}: ba не в канонической форме normalize() (правило 7) — запись источника кладётся в raw`);
        const raw = v["raw"];
        if (raw !== undefined && !nonEmpty(raw)) errors.push(`${vat}: raw — непустая строка`);
        const review = v["review"];
        if (typeof review !== "string" || !REVIEWS.has(review)) errors.push(`${vat}: review — needs_native_review, native_approved или native_rejected`);
        const ref = sourceRef(v["source"], sources, vat, errors);
        if (!ref) return;
        rows.push({ text: ba, textNorm: toComparable(ba), raw: nonEmpty(raw) ? raw : null, review: review as Review, sourceRef: ref });
      });
      if (rows.length !== 2) return;
      if (rows[0]!.textNorm === rows[1]!.textNorm) errors.push(`${where}: варианты совпадают после toComparable — это не дуэль`);
      out.push({
        externalId: id,
        unitId,
        file: file.name,
        ru: String(d["ru"]).trim(),
        ruNorm: toComparable(String(d["ru"])),
        kind: d["kind"] as DuelRow["kind"],
        domain: typeof domain === "string" ? domain : null,
        sourceRef: ruSource,
        variants: [rows[0]!, rows[1]!],
      });
    });
  }
  if (errors.length > 0) throw new Error(`content/corpus/duels: ${errors.length} ошибок\n  ${errors.join("\n  ")}`);
  return out;
}

/** Файлы дуэлей каталога (по имени); каталога нет — пустой список (контент ещё не собран). */
export function readDuelFiles(dir: string): Array<{ name: string; text: string }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}

interface ItemDbRow {
  id: string;
  external_id: string;
  text: string;
  text_norm: string;
  kind: string;
  domain: string | null;
  unit_id: string | null;
  source_ref: unknown;
}

interface VariantDbRow {
  id: string;
  source_item_id: string;
  text: string;
  text_norm: string;
  raw: string | null;
  review: Review;
  source_ref: unknown;
}

/** Загружает дуэли в одной транзакции. Пустой каталог — ничего не делает. */
export async function importDuels(pool: pg.Pool, options: DuelsImportOptions = {}): Promise<DuelsImportResult> {
  const started = Date.now();
  const lang = options.lang ?? "ru";
  const files = readDuelFiles(options.dir ?? DEFAULT_DUELS_DIR);
  const result: DuelsImportResult = {
    files: files.length,
    items: { inserted: 0, updated: 0, unchanged: 0, skipped: 0 },
    variants: { inserted: 0, updated: 0, unchanged: 0 },
    ms: 0,
  };
  if (files.length === 0) {
    result.ms = Date.now() - started;
    return result;
  }
  const duels = parseDuelFiles(files, parseSources(readFileSync(options.sourcesFile ?? DEFAULT_SOURCES_FILE, "utf8")));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Параллельный запуск (pnpm dev и pnpm e2e разом) ждёт первый, а не падает на уникальном индексе.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('corpus:import'))");
    const existing = new Map(
      (
        await client.query<ItemDbRow>(
          "SELECT id, external_id, text, text_norm, kind::text AS kind, domain, unit_id, source_ref FROM source_items WHERE external_id = ANY($1::text[])",
          [duels.map((d) => d.externalId)],
        )
      ).rows.map((r) => [r.external_id, r]),
    );
    const variantsByItem = new Map<string, VariantDbRow[]>();
    if (existing.size > 0) {
      const { rows } = await client.query<VariantDbRow>(
        "SELECT id, source_item_id, text, text_norm, raw, review::text AS review, source_ref FROM variants WHERE source_item_id = ANY($1::uuid[])",
        [[...existing.values()].map((r) => r.id)],
      );
      for (const v of rows) variantsByItem.set(v.source_item_id, [...(variantsByItem.get(v.source_item_id) ?? []), v]);
    }

    for (const d of duels) {
      const item = existing.get(d.externalId);
      if (!item) {
        if (d.variants.some((v) => v.review === "native_rejected")) {
          result.items.skipped += 1;
          continue;
        }
        const id = uuidv7();
        await client.query(
          "INSERT INTO source_items (id, external_id, lang, text, text_norm, kind, domain, unit_id, source_ref) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
          [id, d.externalId, lang, d.ru, d.ruNorm, d.kind, d.domain, d.unitId, d.sourceRef === null ? null : JSON.stringify(d.sourceRef)],
        );
        for (const v of d.variants) {
          await client.query(
            "INSERT INTO variants (id, source_item_id, lang, text, text_norm, raw, origin, source_ref, review) VALUES ($1, $2, 'ba', $3, $4, $5, 'import', $6, $7)",
            [uuidv7(), id, v.text, v.textNorm, v.raw, JSON.stringify(v.sourceRef), v.review],
          );
        }
        result.items.inserted += 1;
        result.variants.inserted += 2;
        continue;
      }

      const current = variantsByItem.get(item.id) ?? [];
      const want = new Set(d.variants.map((v) => v.textNorm));
      if (current.length !== 2 || current.some((v) => !want.has(v.text_norm))) {
        throw new Error(
          `${d.file}: дуэль ${d.externalId} уже загружена с другими вариантами, а на варианты ссылаются голоса — ` +
            "id дуэли не переиспользуется: заведите новую дуэль с новым id (content/schema/duels.schema.json)",
        );
      }
      const itemChanged =
        item.text !== d.ru ||
        item.text_norm !== d.ruNorm ||
        item.kind !== d.kind ||
        item.domain !== d.domain ||
        item.unit_id !== d.unitId ||
        stableJson(item.source_ref) !== stableJson(d.sourceRef);
      if (itemChanged) {
        await client.query(
          "UPDATE source_items SET text = $2, text_norm = $3, kind = $4, domain = $5, unit_id = $6, source_ref = $7, updated_at = now() WHERE id = $1",
          [item.id, d.ru, d.ruNorm, d.kind, d.domain, d.unitId, d.sourceRef === null ? null : JSON.stringify(d.sourceRef)],
        );
        result.items.updated += 1;
      } else {
        result.items.unchanged += 1;
      }
      for (const v of d.variants) {
        const row = current.find((c) => c.text_norm === v.textNorm)!;
        const changed = row.text !== v.text || row.raw !== v.raw || row.review !== v.review || stableJson(row.source_ref) !== stableJson(v.sourceRef);
        if (!changed) {
          result.variants.unchanged += 1;
          continue;
        }
        await client.query("UPDATE variants SET text = $2, raw = $3, review = $4, source_ref = $5, updated_at = now() WHERE id = $1", [
          row.id,
          v.text,
          v.raw,
          v.review,
          JSON.stringify(v.sourceRef),
        ]);
        result.variants.updated += 1;
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  result.ms = Date.now() - started;
  return result;
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const dir = argValue("--dir");
  const sources = argValue("--sources");
  const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL"] ?? "postgres://teletau:teletau@localhost:15432/teletau", max: 1 });
  try {
    const r = await importDuels(pool, { ...(dir ? { dir: resolve(dir) } : {}), ...(sources ? { sourcesFile: resolve(sources) } : {}) });
    if (r.files === 0) {
      console.log("corpus:import: файлов дуэлей нет (content/corpus/duels/*.yaml) — пропускаю");
      return;
    }
    const fmt = (c: Counts) => `+${c.inserted} ~${c.updated} =${c.unchanged}`;
    const skipped = r.items.skipped ? `, пропущено с отклонённым вариантом ${r.items.skipped}` : "";
    console.log(`corpus:import: файлов ${r.files}, исходники ${fmt(r.items)}${skipped}, варианты ${fmt(r.variants)} за ${r.ms} мс`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e: unknown) => {
    console.error(`corpus:import: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
