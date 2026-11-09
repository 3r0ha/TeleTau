// Квест класса на неделю (docs/02 §6): общая цель в сотах — пройденных уроках учеников класса. Цель растёт
// с размером класса (≈ 12,5 сот на ученика — 300 на класс из 24, как в прототипе), а вклад одного ученика ограничен
// двумя «нормами», чтобы двое не вытягивали весь класс. Числа стартовые, калибруются на пилоте.

/** Сот на ученика в неделю (цель класса). */
export const QUEST_CELLS_PER_STUDENT = 12.5;
/** Минимальная цель — у маленького класса или класса без учеников. */
export const QUEST_MIN_GOAL = 30;
/** Сколько сот одного ученика идёт в квест за неделю. */
export const QUEST_STUDENT_CAP = 2 * QUEST_CELLS_PER_STUDENT;

/** Цель недели: 12,5 соты на ученика с округлением вверх до десятка, не меньше 30. */
export function questGoal(students: number): number {
  return Math.max(QUEST_MIN_GOAL, Math.ceil((students * QUEST_CELLS_PER_STUDENT) / 10) * 10);
}

/** Прогресс квеста: сумма сот учеников, у каждого — не больше QUEST_STUDENT_CAP. */
export function questProgress(perStudent: readonly number[]): number {
  return perStudent.reduce((sum, n) => sum + Math.min(Math.max(0, n), QUEST_STUDENT_CAP), 0);
}
