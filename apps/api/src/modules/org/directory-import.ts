// Импорт справочника районов и школ РБ (apps/api/data/rb-districts.csv, rb-schools.csv; методика —
// apps/api/data/rb-directory.README.md) и демо-записей `is_demo` в таблицы модуля org.
// Идемпотентно: районы — upsert по ОКТМО, школы-юрлица — по ИНН, филиалы и демо-школы (без ИНН) — по паре
// «район + наименование» без учёта регистра, «ё/е» и особых башкирских букв (свёртка @teletau/bashkir-text). Неизменённые строки не перезаписываются, поэтому повторный
// запуск занимает доли секунды. Записи, пропавшие из источника, не удаляются: на школы ссылаются классы.
//
// Запуск: `pnpm --filter @teletau/api org:import` (его вызывает `pnpm dev` после миграций). Файл запускается
// напрямую встроенным в Node ≥ 22.18 удалением типов, без сборки, — поэтому в нём только стираемый синтаксис TS
// и нет относительных импортов; из пакетов — только собранный @teletau/bashkir-text (`pnpm dev` и `pnpm e2e` собирают
// его перед импортом). Тексты из CSV приводятся к канонической форме этого пакета (CLAUDE.md, правило 7). Сырой SQL по таблицам org (ADR 0014: файл принадлежит модулю org).
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fold, normalize } from "@teletau/bashkir-text";
import pg from "pg";

export interface DistrictRow {
  oktmo: string;
  kind: "municipal_district" | "urban_okrug";
  nameRu: string;
  nameBa: string | null;
  source: string;
  isDemo: boolean;
}

export interface SchoolRow {
  districtOktmo: string;
  nameRu: string;
  shortNameRu: string;
  nameBa: string | null;
  inn: string | null;
  address: string | null;
  category: "city_large" | "city_small" | "rural" | "small_rural" | null;
  bashkirMedium: boolean | null;
  source: string;
  isDemo: boolean;
}

export interface Counts {
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface DirectoryImportResult {
  districts: Counts;
  schools: Counts;
  demo: boolean;
  ms: number;
}

/** Демо-район и демо-школы для тестов и показа (`is_demo = true`, не из официального справочника). */
export const DEMO_DISTRICT: DistrictRow = {
  oktmo: "demo-0001",
  kind: "municipal_district",
  nameRu: "Демо-район (для проверки)",
  nameBa: null,
  source: "demo",
  isDemo: true,
};

export const DEMO_SCHOOLS: SchoolRow[] = [1, 2, 3].map((n) => ({
  districtOktmo: DEMO_DISTRICT.oktmo,
  nameRu: `Демо-школа № ${n} (для проверки)`,
  shortNameRu: `Демо-школа № ${n}`,
  nameBa: null,
  inn: null,
  address: null,
  category: null,
  bashkirMedium: null,
  source: "demo",
  isDemo: true,
}));

/** Разбор CSV по RFC 4180: запятая, кавычки с удвоением, CRLF или LF. Первая строка — заголовок. */
export function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") records.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (quoted) throw new Error("CSV: незакрытая кавычка");
  if (field !== "" || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  const [header, ...rest] = records;
  if (!header) return [];
  return rest.map((r, n) => {
    if (r.length !== header.length) throw new Error(`CSV: в записи ${n + 2} ${r.length} полей вместо ${header.length}`);
    return Object.fromEntries(header.map((h, i) => [h, r[i]!]));
  });
}

/**
 * «Нет значения» в источнике: пустая строка, одни пробелы или заглушка без букв и цифр («-», «—», «_»). В реестре
 * у 91 филиала краткое наименование — «-», у одного — «_»; без этого заглушка попала бы в выбор школы, кабинет
 * учителя и PDF карточек.
 */
export const isMissingCsvValue = (v: string | undefined): boolean => v === undefined || !/[\p{L}\p{N}]/u.test(v);
const nullable = (v: string | undefined): string | null => (isMissingCsvValue(v) ? null : v!);
/** Текстовое поле CSV в канонической форме @teletau/bashkir-text (NFC, двойники, пробелы); пустое или прочерк — null. */
const csvText = (v: string | undefined): string | null => (isMissingCsvValue(v) ? null : nullable(normalize(v!)));

export function parseDistricts(text: string): DistrictRow[] {
  return parseCsv(text).map((r) => {
    if (r["kind"] !== "municipal_district" && r["kind"] !== "urban_okrug") throw new Error(`districts: неизвестный kind «${r["kind"]}»`);
    const nameRu = csvText(r["name_ru"]);
    if (!nameRu) throw new Error(`districts: у ОКТМО ${r["oktmo"]} нет наименования`);
    return { oktmo: r["oktmo"]!, kind: r["kind"], nameRu, nameBa: csvText(r["name_ba"]), source: r["source"]!, isDemo: false };
  });
}

export function parseSchools(text: string): SchoolRow[] {
  return parseCsv(text).map((r) => {
    const category = nullable(r["category"]);
    if (category && !["city_large", "city_small", "rural", "small_rural"].includes(category)) throw new Error(`schools: неизвестная category «${category}»`);
    const medium = nullable(r["bashkir_medium"]);
    const nameRu = csvText(r["name_ru"]);
    if (!nameRu) throw new Error(`schools: у записи «${r["inn"] ?? r["source"]}» нет наименования`);
    return {
      districtOktmo: r["district_oktmo"]!,
      nameRu,
      shortNameRu: csvText(r["short_name_ru"]) ?? nameRu,
      nameBa: csvText(r["name_ba"]),
      inn: nullable(r["inn"]),
      address: csvText(r["address"]),
      category: category as SchoolRow["category"],
      bashkirMedium: medium === null ? null : medium === "true" || medium === "1",
      source: r["source"]!,
      isDemo: false,
    };
  });
}

/**
 * Ключ сравнения наименований — свёртка @teletau/bashkir-text (правило 7): без учёта регистра, «ё/е», особых
 * башкирских букв (ҡ/к, ә/а, …), невидимых символов, двойников и лишних пробелов.
 */
export const nameKey = (s: string): string => fold(s);

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

const DATA_DIR = new URL("../../../data/", import.meta.url);

export function readDirectory(dataDir: URL = DATA_DIR): { districts: DistrictRow[]; schools: SchoolRow[] } {
  return {
    districts: parseDistricts(readFileSync(new URL("rb-districts.csv", dataDir), "utf8")),
    schools: parseSchools(readFileSync(new URL("rb-schools.csv", dataDir), "utf8")),
  };
}

const counts = (rows: Array<{ inserted: boolean }>, total: number): Counts => {
  const inserted = rows.filter((r) => r.inserted).length;
  return { inserted, updated: rows.length - inserted, unchanged: total - rows.length };
};

const SCHOOL_FIELDS = ["district_id", "name_ru", "short_name_ru", "name_ba", "address", "category", "bashkir_medium", "source", "is_demo"] as const;
const changed = (alias: string) =>
  `(${SCHOOL_FIELDS.map((f) => `schools.${f}`).join(", ")}) IS DISTINCT FROM (${SCHOOL_FIELDS.map((f) => `${alias}.${f}`).join(", ")})`;

/**
 * Импорт в одной транзакции под рекомендательной блокировкой (параллельные запуски выполняются по очереди).
 * `demo` — добавить демо-район и демо-школы (по умолчанию — вне production).
 */
export async function importDirectory(
  pool: pg.Pool,
  options: { demo?: boolean; directory?: { districts: DistrictRow[]; schools: SchoolRow[] } } = {},
): Promise<DirectoryImportResult> {
  const started = Date.now();
  const demo = options.demo ?? process.env["NODE_ENV"] !== "production";
  const source = options.directory ?? readDirectory();
  const districts = [...source.districts, ...(demo ? [DEMO_DISTRICT] : [])];
  const schools = [...source.schools, ...(demo ? DEMO_SCHOOLS : [])];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('teletau:org:directory-import'))");

    const d = await client.query<{ inserted: boolean }>(
      `INSERT INTO districts (id, oktmo, kind, name_ru, name_ba, source, is_demo)
       SELECT * FROM unnest($1::uuid[], $2::text[], $3::org_district_kind[], $4::text[], $5::text[], $6::text[], $7::bool[])
       ON CONFLICT (oktmo) DO UPDATE SET kind = EXCLUDED.kind, name_ru = EXCLUDED.name_ru, name_ba = EXCLUDED.name_ba,
         source = EXCLUDED.source, is_demo = EXCLUDED.is_demo, updated_at = now()
       WHERE (districts.kind, districts.name_ru, districts.name_ba, districts.source, districts.is_demo)
         IS DISTINCT FROM (EXCLUDED.kind, EXCLUDED.name_ru, EXCLUDED.name_ba, EXCLUDED.source, EXCLUDED.is_demo)
       RETURNING (xmax = 0) AS inserted`,
      [
        districts.map(() => uuidv7()),
        districts.map((r) => r.oktmo),
        districts.map((r) => r.kind),
        districts.map((r) => r.nameRu),
        districts.map((r) => r.nameBa),
        districts.map((r) => r.source),
        districts.map((r) => r.isDemo),
      ],
    );

    const ids = new Map((await client.query<{ id: string; oktmo: string }>("SELECT id, oktmo FROM districts")).rows.map((r) => [r.oktmo, r.id]));
    const districtId = (s: SchoolRow) => {
      const id = ids.get(s.districtOktmo);
      if (!id) throw new Error(`schools: район с ОКТМО ${s.districtOktmo} не найден («${s.shortNameRu}»)`);
      return id;
    };
    const columns = (rows: SchoolRow[]) => [
      rows.map((r) => districtId(r)),
      rows.map((r) => r.nameRu),
      rows.map((r) => r.shortNameRu),
      rows.map((r) => r.nameBa),
      rows.map((r) => r.address),
      rows.map((r) => r.category),
      rows.map((r) => r.bashkirMedium),
      rows.map((r) => r.source),
      rows.map((r) => r.isDemo),
    ];
    const UNNEST = "unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::org_school_category[], $8::bool[], $9::text[], $10::bool[]";

    // Юрлица — по ИНН.
    const withInn = schools.filter((s) => s.inn);
    const a = await client.query<{ inserted: boolean }>(
      `INSERT INTO schools (id, district_id, name_ru, short_name_ru, name_ba, address, category, bashkir_medium, source, is_demo, inn)
       SELECT * FROM ${UNNEST}, $11::text[])
       ON CONFLICT (inn) WHERE inn IS NOT NULL DO UPDATE SET
         ${SCHOOL_FIELDS.map((f) => `${f} = EXCLUDED.${f}`).join(", ")}, updated_at = now()
       WHERE ${changed("EXCLUDED")}
       RETURNING (xmax = 0) AS inserted`,
      [withInn.map(() => uuidv7()), ...columns(withInn), withInn.map((r) => r.inn)],
    );

    // Филиалы и демо-школы — по «район + наименование».
    const existing = new Map(
      (await client.query<{ id: string; district_id: string; name_ru: string }>("SELECT id, district_id, name_ru FROM schools WHERE inn IS NULL")).rows.map(
        (r) => [`${r.district_id}|${nameKey(r.name_ru)}`, r.id],
      ),
    );
    const branches = schools.filter((s) => !s.inn);
    const keyed = new Map<string, SchoolRow>();
    for (const s of branches) keyed.set(`${districtId(s)}|${nameKey(s.nameRu)}`, s);
    const fresh = [...keyed].filter(([k]) => !existing.has(k)).map(([, s]) => s);
    const known = [...keyed].filter(([k]) => existing.has(k));
    const ins = await client.query<{ inserted: boolean }>(
      `INSERT INTO schools (id, district_id, name_ru, short_name_ru, name_ba, address, category, bashkir_medium, source, is_demo)
       SELECT * FROM ${UNNEST}) RETURNING true AS inserted`,
      [fresh.map(() => uuidv7()), ...columns(fresh)],
    );
    const knownRows = known.map(([, s]) => s);
    const upd = await client.query<{ inserted: boolean }>(
      `UPDATE schools SET ${SCHOOL_FIELDS.map((f) => `${f} = u.${f}`).join(", ")}, updated_at = now()
       FROM ${UNNEST}) AS u(id, ${SCHOOL_FIELDS.join(", ")})
       WHERE schools.id = u.id AND ${changed("u")}
       RETURNING false AS inserted`,
      [known.map(([k]) => existing.get(k)!), ...columns(knownRows)],
    );

    await client.query("COMMIT");
    return {
      districts: counts(d.rows, districts.length),
      schools: counts([...a.rows, ...ins.rows, ...upd.rows], withInn.length + keyed.size),
      demo,
      ms: Date.now() - started,
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const demo = process.argv.includes("--no-demo") ? false : process.argv.includes("--demo") ? true : undefined;
  const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL"] ?? "postgres://teletau:teletau@localhost:15432/teletau", max: 1 });
  try {
    const r = await importDirectory(pool, { demo });
    const fmt = (c: Counts) => `+${c.inserted} ~${c.updated} =${c.unchanged}`;
    console.log(`org:import: районы ${fmt(r.districts)}, школы ${fmt(r.schools)}${r.demo ? " (с демо-школами)" : ""} за ${r.ms} мс`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e: unknown) => {
    console.error(`org:import: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}

export const DIRECTORY_IMPORT_FILE = fileURLToPath(import.meta.url);
