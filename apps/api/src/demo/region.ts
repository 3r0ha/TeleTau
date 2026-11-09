// Республика в демо-мире (ADR 0023): классы в школах нескольких районов справочника и ученики «Учусь сам» — чтобы
// кабинет министерства на показе выглядел живо. Чистые функции без ввода-вывода: сид (world.ts) создаёт учётные
// записи и классы через API, а уроки записывает публичным ProgressService.recordLessonCompletion (как его вызывает
// learning при завершении забега) — без самих забегов, чтобы сид оставался быстрым. Детских ПДн нет: ученик — место
// и ник из словаря.
//
// Лига. Классы республики — 2–4 и 9–11 (возрастные группы лиги 7–10 и 15–17), «Учусь сам» — 15–17 и взрослые:
// с 5 «Б» и 6 «А» (11–14), где сид выстраивает лигу демо-ученика, они в одну группу не попадают.
// Малые группы: в Бурзянском районе — школа на 3 ученика (район меньше 5 — «< 5»), в Баймакском — школа на 4
// (у её строки «< 5», у соседней — дополнительное скрытие).
import { dayWindow, mulberry32, pickN, randInt, type DemoCalendar, type Rng } from "./plan.js";

export interface RegionClassSpec {
  grade: number;
  letter: string;
  seats: number;
  /** Вероятность, что ученик занимается в неделю. */
  engagement: number;
  /** С какой недели класс занимается (смещение от текущей, ≤ 0). */
  since: number;
}

export interface RegionSchoolSpec {
  key: string;
  /** ОКТМО района справочника (apps/api/data/rb-districts.csv). */
  oktmo: string;
  /** Какая по счёту школа района в стабильной сортировке GET /schools (краткое название). */
  pick: number;
  teacher: { email: string; fullName: string };
  classes: RegionClassSpec[];
}

export interface RegionSelfSpec {
  key: string;
  ageBand: "age_15_17" | "adult";
  nicknameId: string;
  engagement: number;
  since: number;
}

/** Урок ученика республики: `kid` — ключ ученика («r03-1-07») или ученика «Учусь сам» («self-2»). */
export interface RegionLessonEvent {
  at: Date;
  kid: string;
}

const teacher = (n: number) => ({ email: `region${n}@demo.teletau.local`, fullName: `Учитель Районный ${"АБВГДЕЖЗИКЛМН"[n - 1]}` });

/** Школы республики: районы и городские округа — по ОКТМО, школа — по позиции в списке района. */
export const REGION_SCHOOLS: readonly RegionSchoolSpec[] = [
  { key: "r01", oktmo: "80701000", pick: 0, teacher: teacher(1), classes: [{ grade: 3, letter: "А", seats: 18, engagement: 0.8, since: -7 }, { grade: 10, letter: "Б", seats: 14, engagement: 0.6, since: -6 }] },
  { key: "r02", oktmo: "80701000", pick: 3, teacher: teacher(2), classes: [{ grade: 2, letter: "В", seats: 16, engagement: 0.85, since: -5 }, { grade: 4, letter: "А", seats: 18, engagement: 0.7, since: -7 }] },
  { key: "r03", oktmo: "80701000", pick: 7, teacher: teacher(3), classes: [{ grade: 9, letter: "А", seats: 12, engagement: 0.5, since: -3 }] },
  { key: "r04", oktmo: "80745000", pick: 1, teacher: teacher(4), classes: [{ grade: 3, letter: "Б", seats: 16, engagement: 0.75, since: -6 }] },
  { key: "r05", oktmo: "80745000", pick: 4, teacher: teacher(5), classes: [{ grade: 11, letter: "А", seats: 11, engagement: 0.55, since: -4 }] },
  { key: "r06", oktmo: "80606000", pick: 0, teacher: teacher(6), classes: [{ grade: 4, letter: "Б", seats: 14, engagement: 0.8, since: -7 }] },
  { key: "r07", oktmo: "80606000", pick: 2, teacher: teacher(7), classes: [{ grade: 2, letter: "А", seats: 10, engagement: 0.9, since: -5 }] },
  { key: "r08", oktmo: "80606000", pick: 5, teacher: teacher(8), classes: [{ grade: 11, letter: "Б", seats: 4, engagement: 0.75, since: -2 }] },
  { key: "r09", oktmo: "80611000", pick: 1, teacher: teacher(9), classes: [{ grade: 10, letter: "А", seats: 12, engagement: 0.6, since: -2 }] },
  { key: "r10", oktmo: "80653000", pick: 0, teacher: teacher(10), classes: [{ grade: 3, letter: "А", seats: 15, engagement: 0.7, since: -4 }] },
  { key: "r11", oktmo: "80619000", pick: 0, teacher: teacher(11), classes: [{ grade: 2, letter: "Б", seats: 3, engagement: 1, since: -3 }] },
  { key: "r12", oktmo: "80727000", pick: 2, teacher: teacher(12), classes: [{ grade: 9, letter: "Б", seats: 15, engagement: 0.45, since: -1 }] },
];

/** «Учусь сам» без класса: старшие школьники и взрослые (не 11–14 — см. заголовок про лигу). */
export const REGION_SELF: readonly RegionSelfSpec[] = Array.from({ length: 9 }, (_, i) => ({
  key: `self-${i + 1}`,
  ageBand: i % 3 === 2 ? ("adult" as const) : ("age_15_17" as const),
  nicknameId: `a${String((i * 5 + 4) % 32).padStart(2, "0")}.n${String((i * 11 + 6) % 36).padStart(2, "0")}`,
  engagement: 0.5 + (i % 4) * 0.12,
  since: -1 - (i % 6),
}));

/** Ключ ученика класса республики: школа, номер класса в школе, место. */
export const regionKidKey = (school: string, classIndex: number, seat: number) => `${school}-${classIndex + 1}-${String(seat).padStart(2, "0")}`;

/** Ник ученика класса республики — из словаря (32 прилагательных × 36 существительных), детерминированно. */
export function regionNickname(n: number): string {
  return `a${String(n % 32).padStart(2, "0")}.n${String((n * 7 + 3) % 36).padStart(2, "0")}`;
}

/**
 * Уроки республики по времени: ученик занимается в неделю с вероятностью класса — 1–2 дня по 1–2 урока, начиная
 * с недели `since`. ГСЧ детерминированный (mulberry32): мир одинаков от запуска к запуску.
 */
export function buildRegionPlan(cal: DemoCalendar, seed = 0x7265_6731): RegionLessonEvent[] {
  const rng = mulberry32(seed);
  const events: RegionLessonEvent[] = [];
  const weekDays = (offset: number) => Array.from({ length: 7 }, (_, i) => cal.monday + 7 * offset + i).filter((d) => dayWindow(cal, d));
  const plan = (kid: string, engagement: number, since: number, r: Rng) => {
    for (let w = since; w <= 0; w++) {
      if (r() >= engagement) continue;
      const days = weekDays(w);
      const count = Math.min(days.length, r() < 0.65 ? 1 : 2);
      const picked = pickN(r, days, count).sort((a, b) => a - b);
      for (const day of picked) {
        const win = dayWindow(cal, day)!;
        let at = new Date(win.from.getTime() + Math.floor(r() * (win.to.getTime() - win.from.getTime()) * 0.7));
        const lessons = r() < 0.7 ? 1 : 2;
        for (let i = 0; i < lessons; i++) {
          events.push({ at, kid });
          at = new Date(at.getTime() + randInt(r, 6, 14) * 60_000);
        }
      }
    }
  };
  for (const school of REGION_SCHOOLS) {
    school.classes.forEach((cls, ci) => {
      for (let seat = 1; seat <= cls.seats; seat++) plan(regionKidKey(school.key, ci, seat), cls.engagement, cls.since, rng);
    });
  }
  for (const s of REGION_SELF) plan(s.key, s.engagement, s.since, rng);
  return events.filter((e) => e.at.getTime() <= cal.todayEnd.getTime()).sort((x, y) => x.at.getTime() - y.at.getTime() || (x.kid < y.kid ? -1 : 1));
}
