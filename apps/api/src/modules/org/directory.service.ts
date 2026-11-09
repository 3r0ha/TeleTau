import { Inject, Injectable } from "@nestjs/common";
import { FOLD_MAP } from "@teletau/bashkir-text";
import type { Schema } from "@teletau/contracts";
import { and, asc, eq, inArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { decodeCursor, encodeCursor, OffsetCursor } from "../../common/cursor.js";
import type { Db } from "../../db/database.js";
import { DB } from "../../infra/tokens.js";
import { nameKey } from "./directory-import.js";
import { districts, schools } from "./org.schema.js";

type SchoolRow = typeof schools.$inferSelect;
export type SchoolRef = Schema<"SchoolRef">;

const toSchool = (s: SchoolRow): Schema<"School"> => ({
  id: s.id,
  districtId: s.districtId,
  nameRu: s.nameRu,
  shortNameRu: s.shortNameRu,
  ...(s.nameBa ? { nameBa: s.nameBa } : {}),
  ...(s.address ? { address: s.address } : {}),
  ...(s.category ? { category: s.category } : {}),
  ...(s.bashkirMedium !== null ? { bashkirMedium: s.bashkirMedium } : {}),
  isDemo: s.isDemo,
});

export const toSchoolRef = (s: Pick<SchoolRow, "id" | "shortNameRu" | "districtId" | "isDemo">): SchoolRef => ({
  id: s.id,
  shortNameRu: s.shortNameRu,
  districtId: s.districtId,
  isDemo: s.isDemo,
});

/**
 * Порт свёртки @teletau/bashkir-text в SQL (её таблица FOLD_MAP): ҡ→к, ә→а, …, ё→е — после lower(). Эти же строки
 * зашиты в SQL-функцию `org_search_fold` (миграция 0004); совпадение проверяют тесты (directory-search.test.ts,
 * m1-round2.test.ts), при изменении FOLD_MAP нужна новая миграция функции и индексов.
 */
export const FOLD_FROM = [...FOLD_MAP.keys()].map((cp) => String.fromCodePoint(cp)).join("");
export const FOLD_TO = [...FOLD_MAP.values()].map((cp) => String.fromCodePoint(cp)).join("");

/** Ключ поиска школы: свёртка (nameKey) и «№ 1» = «№1». В SQL — `org_search_fold(столбец)`. */
export const searchKey = (s: string): string => nameKey(s).replace(/№\s*/g, "№");

/**
 * Ключ поиска столбца в SQL. Выражение совпадает с выражением триграммных GIN-индексов
 * `schools_*_fold_trgm_idx` (миграция 0004), поэтому LIKE и `<%` идут по индексу, а не перебором.
 */
const norm = (column: AnyColumn) => sql`org_search_fold(${column})`;
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Справочник районов и школ РБ (модуль org). */
@Injectable()
export class DirectoryService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Районы и городские округа: сначала городские округа, затем районы, по алфавиту; демо-район — в конце.
   * `nameBa` не отдаётся: названия из башкирской Википедии ждут проверки носителем (docs/native-review-queue.md, № 16).
   */
  async listDistricts(): Promise<Schema<"DistrictList">> {
    const rows = await this.db
      .select()
      .from(districts)
      .orderBy(asc(districts.isDemo), sql`${districts.kind} DESC`, sql`${districts.nameRu} COLLATE "ba_tailored"`);
    return { items: rows.map((d) => ({ id: d.id, oktmo: d.oktmo, nameRu: d.nameRu, kind: d.kind })) };
  }

  /**
   * Поиск школ: по району и части названия (полного или краткого) без учёта регистра, «ё/е» и особых башкирских
   * букв (свёртка @teletau/bashkir-text: «Ҡ» находится и по «К»); при опечатке —
   * нечёткое совпадение по триграммам (pg_trgm, word_similarity). Курсор — позиция в стабильной сортировке.
   */
  async searchSchools(q: { district?: string; q?: string; cursor?: string; limit: number }): Promise<Schema<"SchoolPage">> {
    const offset = decodeCursor(q.cursor, OffsetCursor)?.o ?? 0;
    const rows = await this.searchQuery(q, offset);
    return {
      items: rows.slice(0, q.limit).map(toSchool),
      ...(rows.length > q.limit ? { nextCursor: encodeCursor({ o: offset + q.limit }) } : {}),
    };
  }

  /**
   * Запрос поиска (отдельно — чтобы тест проверил его план через EXPLAIN). Условия индексируемы: LIKE '%…%' и
   * `<%` (word_similarity ≥ pg_trgm.word_similarity_threshold, 0,6 по умолчанию) по выражению индекса.
   */
  searchQuery(q: { district?: string; q?: string; limit: number }, offset = 0) {
    const where: SQL[] = [];
    if (q.district) where.push(eq(schools.districtId, q.district));
    let order: SQL[] = [sql`${schools.shortNameRu} COLLATE "ba_tailored"`, asc(schools.id)];
    if (q.q) {
      const needle = searchKey(q.q);
      const like = `%${likeEscape(needle)}%`;
      const substring = sql`(${norm(schools.nameRu)} LIKE ${like}::text OR ${norm(schools.shortNameRu)} LIKE ${like}::text)`;
      const fuzzy = sql`(${needle}::text <% ${norm(schools.shortNameRu)} OR ${needle}::text <% ${norm(schools.nameRu)})`;
      const similarity = sql`greatest(word_similarity(${needle}::text, ${norm(schools.shortNameRu)}), word_similarity(${needle}::text, ${norm(schools.nameRu)}))`;
      where.push(sql`(${substring} OR ${fuzzy})`);
      order = [sql`${substring} DESC`, sql`${similarity} DESC`, ...order];
    }
    return this.db
      .select()
      .from(schools)
      .where(where.length ? and(...where) : undefined)
      .orderBy(...order)
      .limit(q.limit + 1)
      .offset(offset);
  }

  async schoolRefs(ids: readonly string[]): Promise<Map<string, SchoolRef>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.select().from(schools).where(inArray(schools.id, [...new Set(ids)]));
    return new Map(rows.map((s) => [s.id, toSchoolRef(s)]));
  }

  async school(id: string): Promise<SchoolRow | undefined> {
    const [row] = await this.db.select().from(schools).where(eq(schools.id, id));
    return row;
  }
}
