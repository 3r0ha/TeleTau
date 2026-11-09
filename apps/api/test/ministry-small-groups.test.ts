// Юнит-тесты скрытия малых групп кабинета министерства (ADR 0023): «< 5» у малой группы и дополнительное скрытие,
// чтобы малую группу нельзя было вычислить вычитанием видимых строк из итога.
import { describe, expect, it } from "vitest";
import { groupCount, SMALL_GROUP_THRESHOLD, suppressOne, suppressRows, type GroupCounts } from "../src/modules/ministry/index.js";

const g = (students: number, lessonsWeek = students, activeWeek = Math.min(students, 1), lessonsTotal = students * 3): GroupCounts => ({ students, activeWeek, lessonsWeek, lessonsTotal });

describe("ministry — малые группы (small-groups.ts)", () => {
  it("порог — 5 учеников", () => {
    expect(SMALL_GROUP_THRESHOLD).toBe(5);
  });

  it("одна группа: 1–4 ученика скрыты, 0 и ≥ 5 — видны", () => {
    expect(suppressOne(g(4))).toEqual({ suppression: "small_group" });
    expect(suppressOne(g(1))).toEqual({ suppression: "small_group" });
    expect(suppressOne(g(5))).toEqual({ students: 5, activeWeek: 1, lessonsWeek: 5, lessonsTotal: 15 });
    expect(suppressOne(g(0))).toEqual({ students: 0, activeWeek: 0, lessonsWeek: 0, lessonsTotal: 0 });
    expect(groupCount(3)).toEqual({ suppression: "small_group" });
    expect(groupCount(0)).toEqual({ value: 0 });
    expect(groupCount(12)).toEqual({ value: 12 });
  });

  it("скрытая строка не несёт ни одного числа", () => {
    const [row] = suppressRows([g(2, 40, 2, 90)]);
    expect(Object.keys(row!)).toEqual(["suppression"]);
  });

  it("одна малая школа — скрывается и самая маленькая из остальных (итог района минус видимые ≠ малая школа)", () => {
    const rows = suppressRows([g(24), g(3), g(30), g(12)]);
    expect(rows.map((r) => r.suppression ?? r.students)).toEqual([24, "small_group", 30, "complementary"]);
  });

  it("две малые школы с суммой < 5 — дополнительное скрытие; с суммой ≥ 5 — не нужно", () => {
    expect(suppressRows([g(1), g(2), g(20), g(8)]).map((r) => r.suppression ?? r.students)).toEqual(["small_group", "small_group", 20, "complementary"]);
    expect(suppressRows([g(4), g(3), g(20)]).map((r) => r.suppression ?? r.students)).toEqual(["small_group", "small_group", 20]);
  });

  it("пустые строки не скрываются и не выбираются для дополнительного скрытия", () => {
    expect(suppressRows([g(0), g(2), g(0), g(9)]).map((r) => r.suppression ?? r.students)).toEqual([0, "small_group", 0, "complementary"]);
  });

  it("скрывать больше нечего — остаётся одна скрытая (её итог сам меньше порога и скрыт выше)", () => {
    expect(suppressRows([g(3), g(0)]).map((r) => r.suppression ?? r.students)).toEqual(["small_group", 0]);
  });

  it("без малых групп ничего не скрыто; порядок строк сохраняется", () => {
    expect(suppressRows([g(7), g(5), g(40)]).map((r) => r.students)).toEqual([7, 5, 40]);
  });

  it("из видимых строк и итога скрытое не восстанавливается точнее, чем до суммы ≥ порога", () => {
    const counts = [g(24), g(1), g(6), g(19)];
    const shown = suppressRows(counts);
    const total = counts.reduce((n, c) => n + c.students, 0);
    const visible = shown.reduce((n, r) => n + (r.students ?? 0), 0);
    expect(total - visible).toBeGreaterThanOrEqual(SMALL_GROUP_THRESHOLD);
  });
});
