// Тропа: состояния узлов курса для участника (правила — описание GET /course в openapi.yaml). Чистая функция:
// на входе курс (модуль content), сколько раз участник прошёл каждый узел и какие уроки засчитаны испытанием для
// перехода (модуль progress).
import type { Schema } from "@teletau/contracts";
import type { CourseContent, UnitContent } from "../content/index.js";
import { jumpAllocation, JUMP_MISTAKES_ALLOWED } from "./jump.js";

type TrailNode = Schema<"TrailNode">;

/** Узел с проверкой знаний: урок или «Испытание места» («Помоги языку» — нет). */
const isGraded = (n: { kind: string }): boolean => n.kind !== "help_language";

/** Сколько заданий с ответом в «Испытании» места (из них собирается испытание для перехода). */
const placeTestSize = (u: UnitContent): number => u.nodes.filter((n) => n.kind === "place_test").reduce((sum, n) => sum + n.gradedCount, 0);

/**
 * done — узел пройден хотя бы раз; current — первый непройденный урок (lesson или place_test), все уроки перед которым
 * пройдены, — один на курс или нет; open — «Помоги языку», все уроки перед которым пройдены; locked — остальное
 * и все узлы закрытого юнита. Порядок — юниты по порядку, узлы по порядку внутри юнита. Узел открытого юнита, который
 * учитель задал классу ученика (`assigned`, ADR 0021), вместо locked — open: задание можно выполнить сразу.
 *
 * Испытание для перехода (docs/02 §2): урок из `skipped` (засчитан сданным испытанием) — done с `passedByTest`, пока его
 * не прошли по-настоящему. Открытый юнит, перед которым пройдены не все уроки, а все юниты перед ним открыты, — с `jump`:
 * его можно открыть испытанием из «Испытаний» мест, где остались непройденные уроки.
 */
export function buildTrail(
  course: CourseContent,
  completions: ReadonlyMap<string, number>,
  assigned: ReadonlySet<string> = new Set(),
  skipped: ReadonlySet<string> = new Set(),
): Schema<"Course"> {
  let lessonsDone = true;
  let current = false;
  /** Все юниты до этого открыты (контент закрытого юнита испытанием не проверить и не перепрыгнуть). */
  let unitsOpen = true;
  /** Размеры «Испытаний» мест перед этим, где остались непройденные уроки. */
  const pending: number[] = [];
  const units = course.units.map((u) => {
    const jumpSize = u.status === "open" && unitsOpen && !lessonsDone ? jumpAllocation(pending).reduce((a, b) => a + b, 0) : 0;
    let unitPending = false;
    const nodes = u.nodes.map((n): TrailNode => {
      const passes = completions.get(n.id) ?? 0;
      const graded = isGraded(n);
      const byTest = graded && passes === 0 && skipped.has(n.id);
      const done = passes > 0 || byTest;
      let state: TrailNode["state"];
      if (u.status === "locked") state = "locked";
      else if (done) state = "done";
      else if (graded && lessonsDone && !current) state = "current";
      else if (!graded && lessonsDone) state = "open";
      else if (assigned.has(n.id)) state = "open";
      else state = "locked";
      if (state === "current") current = true;
      if (graded && (u.status === "locked" || !done)) {
        lessonsDone = false;
        unitPending = true;
      }
      return {
        id: n.id,
        kind: n.kind,
        state,
        titleRu: n.titleRu,
        ...(n.icon ? { icon: n.icon } : {}),
        ...(u.status === "open" ? { exerciseCount: n.exerciseCount } : {}),
        completions: passes,
        ...(byTest && state === "done" ? { passedByTest: true } : {}),
      };
    });
    if (u.status !== "open") unitsOpen = false;
    if (unitPending) pending.push(placeTestSize(u));
    return {
      id: u.id,
      order: u.position,
      state: u.status,
      place: u.place,
      topicRu: u.topicRu,
      nodes,
      ...(jumpSize > 0 ? { jump: { exerciseCount: jumpSize, mistakesAllowed: JUMP_MISTAKES_ALLOWED } } : {}),
    };
  });
  return { id: course.id, contentVersion: course.contentVersion, units };
}

/**
 * Сколько разных уроков (lesson и place_test, без «Помоги языку») участник прошёл хотя бы раз или сдал испытанием для
 * перехода: знающий, открывший место испытанием, уже не новичок (дуэли в уроке — LESSONS_BEFORE_DUELS).
 */
export function lessonsPassed(trail: Schema<"Course">): number {
  return trail.units.flatMap((u) => u.nodes).filter((n) => isGraded(n) && ((n.completions ?? 0) > 0 || n.passedByTest === true)).length;
}

/**
 * Что даёт испытание для перехода к юниту `unitId` по тропе вызывающего: «Испытания места» юнитов перед ним, где
 * остались непройденные уроки (`tests`, по порядку тропы), и сами эти уроки (`skips` — засчитываются, если сдано).
 */
export function jumpScope(trail: Schema<"Course">, unitId: string): { tests: string[]; skips: string[] } {
  const tests: string[] = [];
  const skips: string[] = [];
  for (const unit of trail.units) {
    if (unit.id === unitId) break;
    const left = unit.nodes.filter((n) => isGraded(n) && n.state !== "done");
    if (left.length === 0) continue;
    skips.push(...left.map((n) => n.id));
    tests.push(...unit.nodes.filter((n) => n.kind === "place_test").map((n) => n.id));
  }
  return { tests, skips };
}

/** Узел тропы и его юнит по id. */
export function findNode(trail: Schema<"Course">, nodeId: string): { unit: Schema<"CourseUnit">; node: TrailNode } | undefined {
  for (const unit of trail.units) {
    const node = unit.nodes.find((n) => n.id === nodeId);
    if (node) return { unit, node };
  }
  return undefined;
}
