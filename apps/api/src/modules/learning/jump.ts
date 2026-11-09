// Испытание для перехода (docs/02 §2): знающий открывает закрытое место тропы, не проходя уроки
// перед ним. Чистые функции: сколько заданий взять из «Испытаний места» непройденных мест, какие именно и чем кончилось.
// Испытание — забег вида jump (lesson_id = id юнита); ответы и итог — общие операции забега (learning.service.ts).
import type { Verdict } from "@teletau/domain-rules";
import type { ExerciseContent } from "../content/index.js";
import { cryptoRng, shuffle, type Rng } from "./run-plan.js";

/** Заданий в испытании (не больше: меньше — если в «Испытаниях» мест столько нет). */
export const JUMP_EXERCISES = 10;
/** Сколько неверных ответов можно дать, чтобы место открылось («почти» и опечатка ошибкой не считаются). */
export const JUMP_MISTAKES_ALLOWED = 2;
/** Заголовок забега (LessonRun.titleRu). */
export const JUMP_TITLE_RU = "Испытание";

/**
 * Сколько заданий взять из «Испытания» каждого места (`available` — по порядку тропы): по одному по кругу, начиная с
 * последнего места (ближайшего к цели), пока не наберётся `size` или не кончатся задания. К месту 6 — по 2 из пяти мест,
 * к месту 2 — все 8 из первого.
 */
export function jumpAllocation(available: readonly number[], size: number = JUMP_EXERCISES): number[] {
  const take = available.map(() => 0);
  let left = size;
  for (let progressed = true; left > 0 && progressed; ) {
    progressed = false;
    for (let i = available.length - 1; i >= 0 && left > 0; i--) {
      if (take[i]! < available[i]!) {
        take[i]!++;
        left--;
        progressed = true;
      }
    }
  }
  return take;
}

/** Задание с проверкой ответа: дуэль — голос, а не ответ, в испытание не идёт. */
const isGraded = (e: ExerciseContent): boolean => e.type !== "duel";

/**
 * Задания испытания: из «Испытания» каждого места — случайные (по `jumpAllocation`) в порядке контента; места — по
 * порядку тропы, от простого к сложному. Каждая попытка — новый набор: испытание не выучить наизусть.
 */
export function jumpExercises(tests: readonly (readonly ExerciseContent[])[], rng: Rng = cryptoRng, size: number = JUMP_EXERCISES): ExerciseContent[] {
  const pools = tests.map((t) => t.filter(isGraded));
  const take = jumpAllocation(
    pools.map((p) => p.length),
    size,
  );
  return pools.flatMap((pool, i) => {
    const picked = new Set(shuffle(pool.map((_, j) => j), rng).slice(0, take[i]));
    return pool.filter((_, j) => picked.has(j));
  });
}

export interface JumpOutcome {
  /** Неверных первых попыток. */
  mistakes: number;
  /** Ошибок больше, чем можно: испытание уже не сдать — забег заканчивается досрочно (AttemptResult.runEnded). */
  over: boolean;
  /** Сдано: ответ на каждое задание и ошибок не больше JUMP_MISTAKES_ALLOWED. */
  passed: boolean;
}

/** Итог по вердиктам первых попыток (`answered`) при `total` заданиях. */
export function jumpOutcome(answered: readonly Verdict[], total: number): JumpOutcome {
  const mistakes = answered.filter((v) => v === "wrong").length;
  const over = mistakes > JUMP_MISTAKES_ALLOWED;
  return { mistakes, over, passed: !over && answered.length >= total };
}
