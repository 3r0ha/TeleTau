import type { Me } from "@teletau/session/types";
import { nextTeacherStep } from "../teacher/useTeacher";

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
