// Вкладка «Прогресс» класса — данные getClassProgress (packages/contracts/openapi.yaml): прогресс идёт по номерам мест
// без ников и ПДн, ники учитель берёт из GET /classes/{id} (ADR 0009). Здесь — склейка и подписи, без запросов.
// Подписи зависят от языка интерфейса: функции берут переводчик t (T из i18n/core).
import type { Schema } from "@teletau/contracts";
import { dayNumber } from "@teletau/session/clock";
import { dayMonth, dayOfMonth, monthOf } from "../../../../_components/dates";
import { plural } from "../../../../_components/learn/format";
import type { T } from "../../../../../i18n/core";
import type { Seat } from "../format";

export type ClassProgress = Schema<"ClassProgress">;
export type SeatProgress = Schema<"SeatProgress">;
export type LessonCompletion = Schema<"LessonCompletion">;
export type Week = Schema<"Week">;

export interface StudentRow {
  seatNumber: number;
  /** Ник со страницы класса; null — место ещё без ника (или ученик пришёл между запросами). */
  nickname: string | null;
  /** Ключ цвета соты — как у плитки места на вкладке «Места». */
  toneKey: string | number;
  progress: SeatProgress | null;
}

/**
 * Строки учеников по номерам мест: все занятые места класса (даже если ученик ещё не занимался) плюс места из прогресса,
 * которых ещё нет на странице класса (ученик вошёл между двумя запросами).
 */
export function studentRows(seats: readonly Seat[], progress: readonly SeatProgress[]): StudentRow[] {
  const byNumber = new Map(progress.map((p) => [p.seatNumber, p]));
  const rows: StudentRow[] = seats
    .filter((s) => s.student)
    .map((s) => ({ seatNumber: s.number, nickname: s.student!.nickname ?? null, toneKey: s.student!.accountId, progress: byNumber.get(s.number) ?? null }));
  const known = new Set(rows.map((r) => r.seatNumber));
  for (const p of progress) if (!known.has(p.seatNumber)) rows.push({ seatNumber: p.seatNumber, nickname: null, toneKey: p.seatNumber, progress: p });
  return rows.sort((a, b) => a.seatNumber - b.seatNumber);
}

const ufaDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yekaterinburg", year: "numeric", month: "2-digit", day: "2-digit" });

/** Учебные сутки по Уфе (CLAUDE.md «Соглашения»): «2026-11-14» для момента `nowMs`. */
export function ufaToday(nowMs: number): string {
  return ufaDate.format(new Date(nowMs));
}


/** Когда ученик занимался последний раз: «сегодня», «вчера», «12 ноября»; ещё ни разу — null. */
export function lastActiveLabel(lastActiveOn: string | undefined, today: string, t: T): string | null {
  if (!lastActiveOn) return null;
  const days = dayNumber(today) - dayNumber(lastActiveOn);
  if (days <= 0) return t("сегодня");
  if (days === 1) return t("вчера");
  return dayMonth(lastActiveOn, t);
}

/** «9–15 ноября» или «30 ноября – 6 декабря» — учебная неделя пн–вс. */
export function weekLabel(week: Week, t: T): string {
  if (monthOf(week.start) === monthOf(week.end)) return `${dayOfMonth(week.start)}–${dayMonth(week.end, t)}`;
  return `${dayMonth(week.start, t)} – ${dayMonth(week.end, t)}`;
}

export const lessonsWord = (n: number, t: T) => plural(n, [t("урок"), t("урока"), t("уроков")]);
export const daysWord = (n: number, t: T) => plural(n, [t("день"), t("дня"), t("дней")]);
export const studentsWord = (n: number, t: T) => plural(n, [t("ученик"), t("ученика"), t("учеников")]);

/** Точность ответов — целые проценты: 0.857 → «86%». */
export function percent(x: number): string {
  return `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`;
}

/** Главная строка ученика: «3 урока · сегодня»; ещё не занимался — «Уроков пока нет». */
export function studentSummary(p: SeatProgress | null, today: string, t: T): string {
  if (!p || (p.lessonsCompleted === 0 && !p.lastActiveOn)) return t("Уроков пока нет");
  const last = lastActiveLabel(p.lastActiveOn, today, t);
  return [`${p.lessonsCompleted} ${lessonsWord(p.lessonsCompleted, t)}`, last].filter(Boolean).join(" · ");
}

/** Строка недели: «На неделе: 2 урока · 24 мёда · точность 86%»; без занятий — «На неделе без уроков». */
export function weekSummary(p: SeatProgress | null, t: T): string {
  if (!p || p.lessonsThisWeek === 0) return t("На неделе без уроков");
  const parts = [`${p.lessonsThisWeek} ${lessonsWord(p.lessonsThisWeek, t)}`, `${p.honeyThisWeek} ${t("мёда")}`];
  if (p.accuracy !== undefined) parts.push(t("точность {value}", { value: percent(p.accuracy) }));
  return t("На неделе: {list}", { list: parts.join(" · ") });
}
export const timesWord = (n: number, t: T) => plural(n, [t("раз"), t("раза"), t("раз")]);
export const placesWord = (n: number, t: T) => plural(n, [t("место"), t("места"), t("мест")]);

/** Как давно ученик занимался: сегодня, на этой неделе, на этой неделе — ни одного урока, ещё ни разу. */
export type Activity = "today" | "week" | "idle" | "never";

export function activityOf(p: SeatProgress | null | undefined, today: string): Activity {
  if (!p || (!p.lastActiveOn && p.lessonsCompleted === 0)) return "never";
  if (p.lastActiveOn === today) return "today";
  return p.lessonsThisWeek > 0 ? "week" : "idle";
}

/** Обзор класса: кто занимался сегодня и кому на этой неделе нужен толчок (ни одного урока). */
export function classToday(rows: readonly StudentRow[], today: string): { today: StudentRow[]; idle: StudentRow[] } {
  const by = (a: Activity[]) => rows.filter((r) => a.includes(activityOf(r.progress, today)));
  return { today: by(["today"]), idle: by(["idle", "never"]) };
}

/** Сколько ников показать в «Не занимались на неделе»: остальные — «Ещё N» со ссылкой на «Прогресс» в порядке «Кто отстаёт». */
export const IDLE_SHOWN = 4;

/** «Прогресс» класса сразу в порядке «Кто отстаёт» (progress/page.tsx читает `order`). */
export const behindHref = (classId: string) => `/teacher/classes/${classId}/progress?order=attention`;

export type ClassProgressUnit = Schema<"ClassProgressUnit">;

/** Уроки одного места тропы в «Прохождении уроков». */
export interface PlaceGroup {
  /** Ключ группы: id юнита; уроки без места (ответ API без units) — «lessons». */
  key: string;
  unit: ClassProgressUnit | null;
  lessons: LessonCompletion[];
  /** Сколько пройдено классом: прохождения уроков места / (уроков × учеников), 0..1. */
  share: number;
}

function shareOf(lessons: readonly LessonCompletion[], students: number): number {
  if (!students || !lessons.length) return 0;
  return lessons.reduce((s, l) => s + Math.min(l.completedSeats, students), 0) / (lessons.length * students);
}

/** Уроки по местам тропы в порядке юнитов; без units в ответе — одна группа без заголовка места. */
export function placeGroups(progress: Pick<ClassProgress, "lessons" | "units">, students: number): PlaceGroup[] {
  const units = [...(progress.units ?? [])].sort((a, b) => a.order - b.order);
  const byUnit = new Map(units.map((u) => [u.id, [] as LessonCompletion[]]));
  const loose: LessonCompletion[] = [];
  for (const l of progress.lessons) ((l.unitId ? byUnit.get(l.unitId) : undefined) ?? loose).push(l);
  const groups: PlaceGroup[] = units.flatMap((u) => {
    const lessons = byUnit.get(u.id)!;
    return lessons.length ? [{ key: u.id, unit: u, lessons, share: shareOf(lessons, students) }] : [];
  });
  if (loose.length) groups.push({ key: "lessons", unit: null, lessons: loose, share: shareOf(loose, students) });
  return groups;
}

/**
 * Где класс сейчас: место следующего урока после самого дальнего, который прошла хотя бы половина учеников. Никто из
 * половины ещё не начинал — первое место; большинство прошло всё — последнее. Пустой список — −1.
 */
export function currentPlaceIndex(groups: readonly PlaceGroup[], students: number): number {
  const flat = groups.flatMap((g, i) => g.lessons.map((l) => ({ i, done: l.completedSeats })));
  if (!flat.length) return -1;
  const half = Math.max(1, Math.ceil(students / 2));
  let last = -1;
  flat.forEach((l, k) => {
    if (l.done >= half) last = k;
  });
  return (flat[last + 1] ?? flat[flat.length - 1]!).i;
}
