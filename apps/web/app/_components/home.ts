import type { Me } from "@teletau/session/types";

export type TeacherStep = "/teacher/terms" | "/teacher/apply" | "/teacher/pending" | "/teacher";

/** Куда должен попасть взрослый: условия → заявка → ожидание → кабинет. */
export function nextTeacherStep(me: Me): TeacherStep {
  if (me.pendingConsents.length > 0) return "/teacher/terms";
  if (me.teacherStatus === "none") return "/teacher/apply";
  if (me.teacherStatus === "pending" || me.teacherStatus === "rejected") return "/teacher/pending";
  return "/teacher";
}

/**
 * Куда вернуть вошедшего (ADR 0022): ребёнок — на тропу (без ника — выбор ника); взрослый, который учится (выбрал
 * «Учиться» — есть ник), — на тропу; учитель или заявитель — в кабинет по этапам; взрослый, который ещё не выбрал, —
 * на выбор «Учиться / Я учитель». Сотрудник — не сюда (консоль).
 */
export function homeOf(me: Me): string | null {
  if (me.kind === "child") return me.nickname ? "/learn" : "/student/nickname";
  if (me.kind !== "adult") return null;
  if (me.teacherStatus !== "none") return nextTeacherStep(me);
  return me.nickname ? "/learn" : "/welcome";
}
