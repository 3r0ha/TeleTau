import { Inject, Injectable } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { asc, eq, inArray, type SQL } from "drizzle-orm";
import type { Db } from "../../db/database.js";
import { DB } from "../../infra/tokens.js";
import type { CorpusApi, CorpusItemsOptions, CorpusVariant, DuelItem } from "./corpus.api.js";
import { sourceItems, variants } from "./corpus.schema.js";

/** source_ref варианта или исходника: ссылка на content/sources.yaml и место в нём; title и license импорт берёт из реестра. */
interface StoredSourceRef {
  ref?: string;
  url?: string;
  page?: string | number;
  locator?: string;
  title?: string;
  license?: string;
}

/** Ссылка на источник для показа (SourceCitation): страница печатного издания — в locator. */
export function citation(raw: unknown): Schema<"SourceCitation"> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as StoredSourceRef;
  const title = s.title ?? s.ref;
  if (!title) return undefined;
  const locator = [s.locator, s.page !== undefined ? `с. ${s.page}` : undefined].filter(Boolean).join(", ");
  return { title, ...(s.url ? { url: s.url } : {}), ...(locator ? { locator } : {}), ...(s.license ? { license: s.license } : {}) };
}

const citationKey = (c: Schema<"SourceCitation">) => `${c.title}\u0000${c.url ?? ""}\u0000${c.locator ?? ""}`;

/** Исходники и варианты (таблицы corpus.schema.ts). Импорт дуэлей — duels-import.ts (`pnpm --filter @teletau/api corpus:import`). */
@Injectable()
export class CorpusService implements CorpusApi {
  constructor(@Inject(DB) protected readonly db: Db) {}

  async duelPool(unitId: string): Promise<DuelItem[]> {
    return this.load(this.db, eq(sourceItems.unitId, unitId), false);
  }

  async allDuels(): Promise<DuelItem[]> {
    return this.load(this.db, undefined, false);
  }

  async items(itemIds: readonly string[], options: CorpusItemsOptions = {}): Promise<Map<string, DuelItem>> {
    const ids = [...new Set(itemIds)];
    if (ids.length === 0) return new Map();
    const list = await this.load(options.db ?? this.db, inArray(sourceItems.id, ids), options.withRejected === true);
    return new Map(list.map((i) => [i.itemId, i]));
  }

  async itemByExternalId(externalId: string): Promise<DuelItem | undefined> {
    return (await this.load(this.db, eq(sourceItems.externalId, externalId), false))[0];
  }

  /** Исходники с ровно двумя вариантами; без withRejected — только те, где ни один вариант не отклонён носителем. */
  private async load(db: Db, where: SQL | undefined, withRejected: boolean): Promise<DuelItem[]> {
    const items = await db.select().from(sourceItems).where(where).orderBy(asc(sourceItems.externalId));
    if (items.length === 0) return [];
    const rows = await db
      .select()
      .from(variants)
      .where(inArray(variants.sourceItemId, items.map((i) => i.id)))
      .orderBy(asc(variants.sourceItemId), asc(variants.id));
    const byItem = new Map<string, (typeof rows)[number][]>();
    for (const v of rows) byItem.set(v.sourceItemId, [...(byItem.get(v.sourceItemId) ?? []), v]);

    const out: DuelItem[] = [];
    for (const item of items) {
      const vs = byItem.get(item.id) ?? [];
      if (vs.length !== 2) continue; // импорт держит ровно два варианта на исходник; иначе это не дуэль
      if (!withRejected && vs.some((v) => v.review === "native_rejected")) continue;
      const pair = vs.map((v): CorpusVariant => {
        const source = citation(v.sourceRef);
        return { id: v.id, text: v.text, review: v.review, origin: v.origin, ...(source ? { source } : {}) };
      }) as [CorpusVariant, CorpusVariant];
      const sources = new Map<string, Schema<"SourceCitation">>();
      for (const raw of [item.sourceRef, ...vs.map((v) => v.sourceRef)]) {
        const c = citation(raw);
        if (c) sources.set(citationKey(c), c);
      }
      out.push({
        itemId: item.id,
        externalId: item.externalId,
        ...(item.unitId ? { unitId: item.unitId } : {}),
        sourceRu: item.text,
        kind: item.kind,
        variants: pair,
        sources: [...sources.values()],
      });
    }
    return out;
  }
}
