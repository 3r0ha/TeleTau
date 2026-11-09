// Скрытие малых групп в кабинете министерства (ADR 0023): числа группы меньше порога не показываются, чтобы их
// нельзя было связать с конкретным ребёнком. Чистые функции — без ввода-вывода (тесты: test/ministry-small-groups.test.ts).
import type { Schema } from "@teletau/contracts";

/** Порог малой группы: меньше 5 учеников — числа скрыты. */
export const SMALL_GROUP_THRESHOLD = 5;

/** Числа группы учеников до скрытия. */
export interface GroupCounts {
  students: number;
  activeWeek: number;
  lessonsWeek: number;
  lessonsTotal: number;
}

export type LearnerActivity = Schema<"LearnerActivity">;

export const ZERO: GroupCounts = { students: 0, activeWeek: 0, lessonsWeek: 0, lessonsTotal: 0 };

const isSmall = (g: GroupCounts, threshold: number) => g.students > 0 && g.students < threshold;
const shown = (g: GroupCounts): LearnerActivity => ({ students: g.students, activeWeek: g.activeWeek, lessonsWeek: g.lessonsWeek, lessonsTotal: g.lessonsTotal });

/** Одна группа без соседей (итог республики, район в карточке района): малая — скрыта. */
export function suppressOne(g: GroupCounts, threshold = SMALL_GROUP_THRESHOLD): LearnerActivity {
  return isSmall(g, threshold) ? { suppression: "small_group" } : shown(g);
}

/**
 * Строки одного списка, сумма которых видна рядом (школы района — итог района; районы и «Учусь сам» — итог республики).
 * 1) Малая группа (1…порог−1 учеников) скрыта — `small_group`.
 * 2) Дополнительное скрытие: пока скрытых учеников в сумме больше нуля, но меньше порога, скрывается ещё и самая
 *    маленькая из видимых непустых строк — `complementary`. Иначе скрытое вычислялось бы вычитанием видимых строк
 *    из итога (одна малая школа — итог района минус остальные школы).
 * Порядок строк сохраняется. Пустые группы (0 учеников) не скрываются: в них нечего раскрывать.
 */
export function suppressRows(rows: readonly GroupCounts[], threshold = SMALL_GROUP_THRESHOLD): LearnerActivity[] {
  const out = rows.map((g): LearnerActivity => (isSmall(g, threshold) ? { suppression: "small_group" } : shown(g)));
  let hidden = rows.reduce((n, g, i) => (out[i]!.suppression ? n + g.students : n), 0);
  while (hidden > 0 && hidden < threshold) {
    let pick = -1;
    rows.forEach((g, i) => {
      if (out[i]!.suppression || g.students === 0) return;
      if (pick < 0 || g.students < rows[pick]!.students) pick = i;
    });
    if (pick < 0) break; // скрывать больше нечего: итог тогда сам меньше порога и скрыт выше по иерархии
    out[pick] = { suppression: "complementary" };
    hidden += rows[pick]!.students;
  }
  return out;
}

/** Ученики группы — число или «скрыто» (GroupCount). */
export function groupCount(students: number, threshold = SMALL_GROUP_THRESHOLD): Schema<"GroupCount"> {
  return students > 0 && students < threshold ? { suppression: "small_group" } : { value: students };
}
