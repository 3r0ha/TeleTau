// Порт свёртки @teletau/bashkir-text в SQL (правило 7): функция org_search_fold из миграции 0004 использует ту же
// таблицу FOLD_MAP, что и ключ поиска в TS. Изменили FOLD_MAP — тест падает, нужна новая миграция функции и индексов.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FOLD_FROM, FOLD_TO, searchKey } from "../src/modules/org/directory.service.js";

const migration = readFileSync(new URL("../drizzle/0004_m1_round2.sql", import.meta.url), "utf8");

describe("school search key (M1-29, M1-34)", () => {
  it("org_search_fold in migration 0004 translates exactly the FOLD_MAP of @teletau/bashkir-text", () => {
    const m = /translate\(lower\(t\), '([^']*)', '([^']*)'\)/.exec(migration);
    expect(m, "в 0004 нет translate(lower(t), …)").not.toBeNull();
    expect(m![1]).toBe(FOLD_FROM);
    expect(m![2]).toBe(FOLD_TO);
    expect(migration).toMatch(/CREATE INDEX "schools_name_ru_fold_trgm_idx" ON "schools" USING gin \(org_search_fold\("name_ru"\) gin_trgm_ops\)/);
    expect(migration).toMatch(/CREATE INDEX "schools_short_name_ru_fold_trgm_idx" ON "schools" USING gin \(org_search_fold\("short_name_ru"\) gin_trgm_ops\)/);
  });

  it("treats «№ 1» and «№1» alike, ignores case, ё/е and special Bashkir letters", () => {
    expect(searchKey("СОШ № 1")).toBe(searchKey("сош №1"));
    expect(searchKey("школа  №   12")).toBe("школа №12");
    expect(searchKey("Ҡиселёва")).toBe(searchKey("киселева"));
  });
});
