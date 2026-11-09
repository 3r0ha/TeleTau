// План демо-мира (docs/plans/M2.md §1, «Сборка»): кто из учеников когда занимается. Чистые функции без ввода-вывода —
// сид (world.ts) исполняет события по порядку времени через публичные сервисы модулей с подменёнными часами.
//
// Лига: повышение — первые 5 группы (domain-rules league.ts), группы недели заполняются до 20 по очереди. Чтобы к
// текущей неделе в Лиге Кипрея (4-й тир) собралась группа, ученики идут когортами по 5 со сдвигом на неделю: когорта
// занимается три недели подряд (Клевер → Гречиха → Донник → Кипрей) и в каждой неделе оказывается в группе своего тира
// одна или с учениками, у которых очков заведомо меньше (не больше 2 дней занятий в неделю против 4–5 у когорты).
import { dayToDate, mondayOf, ufaDayNumber, ufaMidnight } from "@teletau/domain-rules";

/** Детерминированный ГСЧ (mulberry32): мир одинаков от запуска к запуску, кроме выбора дуэлей сервером. */
export type Rng = () => number;
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randInt = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
export function pickN<T>(rng: Rng, xs: readonly T[], n: number): T[] {
  const pool = [...xs];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  return out;
}

/** Момент «сутки `day` по Уфе, `minutes` минут от полуночи». */
export const ufaTime = (day: number, minutes: number) => new Date(ufaMidnight(day).getTime() + minutes * 60_000);

export interface DemoCalendar {
  now: Date;
  /** Сегодня по Уфе (номер суток). */
  today: number;
  /** Понедельник текущей недели. */
  monday: number;
  /** Последний момент для событий сида сегодня: события сида не ближе 40 минут к запуску. */
  todayEnd: Date;
}

export function demoCalendar(now: Date): DemoCalendar {
  const today = ufaDayNumber(now);
  return { now, today, monday: mondayOf(today), todayEnd: new Date(now.getTime() - 40 * 60_000) };
}

// ── состав классов ──

/** Когорты лиги (см. заголовок): C1 — недели −5…−3, C2 — −4…−2, C3 — −3…−1; G — изредка; idle — не занимались. */
export type Cohort = "C1" | "C2" | "C3" | "G" | "idle";

export interface KidSpec {
  /** Ключ ученика в мире: «5b-07». */
  key: string;
  classKey: ClassKey;
  seat: number;
  /** Ник из словаря (identity/nicknames.ts, ADR 0009). */
  nicknameId: string;
  cohort: Cohort;
  /** Занимается на этой неделе (смещение недели от текущей, 0 — текущая). */
  activeNow: boolean;
  /** Доля верных первых попыток. */
  skill: number;
}

export type ClassKey = "5b" | "6a";

/** Демо-ученик показа: №07 · «Смелая пчела» (a00.n00). */
export const DEMO_STUDENT_SEAT = 7;
export const DEMO_STUDENT_NICKNAME_ID = "a00.n00";

/**
 * Ники одноклассников — из словаря (aNN.nNN), без повторов. Первые — как в прототипе лиги (shots/16-league):
 * «Ловкий шмель», «Добрый барсук», «Мудрая сова».
 */
const NICKNAMES_5B = [
  "a06.n01", "a04.n05", "a03.n02", "a02.n04", "a14.n06", "a07.n10", "a00.n00", "a09.n11", "a15.n13", "a01.n03",
  "a11.n07", "a05.n12", "a13.n14", "a08.n15", "a16.n16", "a10.n17", "a12.n18", "a17.n19", "a18.n20", "a19.n09",
  "a20.n22", "a21.n24", "a22.n26", "a23.n27",
];
const NICKNAMES_6A = ["a24.n28", "a25.n29", "a26.n30", "a27.n31", "a28.n32", "a29.n33", "a30.n34", "a31.n35", "a03.n08", "a05.n21"];

/** Класс 5 «Б»: места 1–24 заняты. Место 7 — демо-ученик (когорта C3, его история строится отдельно). */
export function roster(rng: Rng): KidSpec[] {
  const kids: KidSpec[] = [];
  const cohortOf5b = (seat: number): Cohort => {
    if (seat <= 5) return "C1";
    if (seat === 6 || (seat >= 8 && seat <= 11)) return "C2";
    if (seat === DEMO_STUDENT_SEAT || (seat >= 12 && seat <= 15)) return "C3";
    if (seat >= 23) return "idle";
    return "G";
  };
  for (let seat = 1; seat <= 24; seat++) {
    const cohort = cohortOf5b(seat);
    kids.push({
      key: `5b-${String(seat).padStart(2, "0")}`,
      classKey: "5b",
      seat,
      nicknameId: NICKNAMES_5B[seat - 1]!,
      cohort,
      // «Занимались 18 из 24» после урока показа: когорты (14) + места 16–18 + демо-ученик.
      activeNow: cohort === "C1" || cohort === "C2" || cohort === "C3" || (seat >= 16 && seat <= 18),
      skill: 0.6 + rng() * 0.35,
    });
  }
  for (let seat = 1; seat <= NICKNAMES_6A.length; seat++) {
    kids.push({
      key: `6a-${String(seat).padStart(2, "0")}`,
      classKey: "6a",
      seat,
      nicknameId: NICKNAMES_6A[seat - 1]!,
      // Двое без истории: перед показом они выравнивают голоса детей в парах показа (world.ts, childVote).
      cohort: seat > NICKNAMES_6A.length - 2 ? "idle" : "G",
      activeNow: seat <= 6,
      skill: 0.55 + rng() * 0.4,
    });
  }
  return kids;
}

// ── события ──

/** День занятий ученика: «Помоги языку», если он открыт и не пройден, и `graded` уроков подряд. */
export interface LessonDayEvent {
  type: "lessonDay";
  at: Date;
  kid: string;
  graded: number;
}

/** Урок демо-ученика из его пятидневной истории (узел — по номеру дня, см. DEMO_STUDENT_DAYS). */
export interface DemoStudentEvent {
  type: "demoStudent";
  at: Date;
  index: number;
}

/** Очки лиги демо-ученика за неделю без уроков (только через CompetitionService.addLeaguePoints — см. world.ts). */
export interface LeaguePointsEvent {
  type: "leaguePoints";
  at: Date;
  kid: string;
  points: number;
}

/** Учитель другой школы и взрослые принимают дуэли: `early` — «лишние» для демо-ученика, `late` — остальные. */
export interface AcceptEvent {
  type: "accept";
  at: Date;
  which: "early" | "late";
}

/** Ученик мира e2e: два урока с «Не знаю» во всех дуэлях, кроме своей (world.ts). */
export interface ExtraStudentEvent {
  type: "extraStudent";
  at: Date;
  world: number;
}

export type DemoEvent = LessonDayEvent | DemoStudentEvent | LeaguePointsEvent | AcceptEvent | ExtraStudentEvent;

/** Пять дней демо-ученика (сегодня — шестой): узлы тропы по порядку. Голосов в них — 7 (1 + 1 + 3 + 1 + 1). */
export const DEMO_STUDENT_DAYS = ["u01-privet", "u01-kak-tebya-zovut", "u01-help-1", "u01-privet", "u01-kak-tebya-zovut"] as const;

/** Окно занятий в сутки `day`: после уроков в прошлые дни; сегодня — с утра до todayEnd. Нет окна — undefined. */
export function dayWindow(cal: DemoCalendar, day: number): { from: Date; to: Date } | undefined {
  if (day < cal.today) return { from: ufaTime(day, 15 * 60), to: ufaTime(day, 20 * 60) };
  if (day > cal.today) return undefined;
  const end = cal.todayEnd;
  const morning = ufaTime(day, 7 * 60);
  const from = end.getTime() - morning.getTime() >= 60 * 60_000 ? morning : ufaTime(day, 5);
  return end.getTime() - from.getTime() >= 10 * 60_000 ? { from, to: end } : undefined;
}

const between = (rng: Rng, w: { from: Date; to: Date }) => new Date(w.from.getTime() + Math.floor(rng() * (w.to.getTime() - w.from.getTime())));

/** Недели активности когорт (смещение от текущей недели) — по 4–5 дней. Текущая неделя — 2–3 дня у всех активных. */
const COHORT_WEEKS: Record<"C1" | "C2" | "C3", number[]> = { C1: [-5, -4, -3], C2: [-4, -3, -2], C3: [-3, -2, -1] };
/** Места 5 «Б» с лидерами текущей недели в Лиге Кипрея (по одному-двое из каждой когорты). */
const LEAGUE_LEADERS = new Set([1, 6, 12, 3]);

export interface DemoPlan {
  calendar: DemoCalendar;
  kids: KidSpec[];
  events: DemoEvent[];
  /** Сутки истории демо-ученика (5 дней до сегодня). */
  demoStudentDays: number[];
}

/**
 * Все события мира по времени. `extraWorlds` — миры для повторов сквозного теста (`--e2e-worlds`): их ученики
 * занимаются вчера вечером, после того как приняты обычные дуэли.
 */
export function buildPlan(now: Date, options: { seed?: number; extraWorlds?: number } = {}): DemoPlan {
  const rng = mulberry32(options.seed ?? 0x6b65_7265);
  const cal = demoCalendar(now);
  const kids = roster(rng);
  const events: DemoEvent[] = [];
  const weekDays = (offset: number) => {
    const monday = cal.monday + 7 * offset;
    return Array.from({ length: 7 }, (_, i) => monday + i).filter((d) => dayWindow(cal, d));
  };
  const addDays = (kid: KidSpec, offset: number, count: number, graded: () => number) => {
    for (const day of pickN(rng, weekDays(offset), count).sort((a, b) => a - b)) {
      events.push({ type: "lessonDay", at: between(rng, dayWindow(cal, day)!), kid: kid.key, graded: graded() });
    }
  };

  for (const kid of kids) {
    if (kid.seat === DEMO_STUDENT_SEAT && kid.classKey === "5b") continue;
    if (kid.cohort === "C1" || kid.cohort === "C2" || kid.cohort === "C3") {
      for (const w of COHORT_WEEKS[kid.cohort]) addDays(kid, w, randInt(rng, 4, 5), () => randInt(rng, 1, 2));
      // Текущая неделя, Лига Кипрея: четверо лидеров занимаются много, остальные — по одному уроку (10–18 очков).
      // Демо-ученик после урока показа (его уроки недели + ≈ 16) — у зоны повышения или в ней.
      if (LEAGUE_LEADERS.has(kid.seat)) addDays(kid, 0, 3, () => 2);
      else addDays(kid, 0, 1, () => 1);
    } else if (kid.cohort === "G") {
      // Не больше 2 дней по одному уроку в неделю: ≤ 36 очков — меньше, чем у когорты (≥ 4 дня по ≥ 10 очков).
      for (const w of [-4, -3, -2, -1]) if (rng() < 0.55) addDays(kid, w, randInt(rng, 1, 2), () => 1);
      if (kid.activeNow) addDays(kid, 0, randInt(rng, 1, 2), () => 1);
    }
  }

  // Демо-ученик: пять дней подряд до сегодня, около 17:00 (серия 5 и обе заморозки — без пропусков).
  const demoStudentDays = [5, 4, 3, 2, 1].map((k) => cal.today - k);
  demoStudentDays.forEach((day, index) => events.push({ type: "demoStudent", at: ufaTime(day, 17 * 60 + randInt(rng, 0, 20)), index }));
  // Лига демо-ученика: Клевер (−3) → Гречиха (−2) → Донник (−1) → Кипрей. Недели без его уроков — очки напрямую.
  const demoKey = `5b-${String(DEMO_STUDENT_SEAT).padStart(2, "0")}`;
  const lessonWeeks = new Set(demoStudentDays.map((d) => mondayOf(d)));
  for (const [offset, points] of [
    [-3, 64],
    [-2, 52],
    [-1, 47],
  ] as const) {
    const monday = cal.monday + 7 * offset;
    if (!lessonWeeks.has(monday)) events.push({ type: "leaguePoints", at: ufaTime(monday + 3, 17 * 60 + 30), kid: demoKey, points });
  }

  // Дуэли: «лишние» для демо-ученика принимаются до всех уроков; остальные — вчера вечером, после его последнего урока.
  events.push({ type: "accept", at: ufaTime(cal.monday - 35, 12 * 60), which: "early" });
  events.push({ type: "accept", at: ufaTime(cal.today - 1, 19 * 60 + 30), which: "late" });
  for (let w = 0; w < (options.extraWorlds ?? 0); w++) events.push({ type: "extraStudent", at: ufaTime(cal.today - 1, 20 * 60 + 10 * w), world: w + 2 });

  events.sort((x, y) => x.at.getTime() - y.at.getTime());
  return { calendar: cal, kids, events, demoStudentDays };
}

export const describeDay = (day: number) => dayToDate(day);
