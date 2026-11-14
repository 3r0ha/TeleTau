// Юнит-тесты демо-сида (src/demo): план мира по календарю Уфы и ответы демо-учеников. Сам сид проверяет мир
// перед выходом (world.ts, summaries) и прогоняется в каждом `pnpm e2e` на своей базе. Строки — синтетические
// сочетания букв (как test/fixtures/content), не слова языка (правило 6); исключение — демо-корпус ba-kz
// (ниже): это показные пары словаря, источник — «Демо-корпус ТелеТау».
import { dateToDay, LEAGUE_GROUP_SIZE, mondayOf, ufaDayNumber } from "@teletau/domain-rules";
import type { Schema } from "@teletau/contracts";
import { describe, expect, it } from "vitest";
import { normalize, toComparable } from "@teletau/bashkir-text";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { almostText, answerSheet, correctAnswer, mistakenAnswer, tileWords } from "../src/demo/answers.js";
import { KZ_PAIRS, KZ_SOURCE, KZ_UNIT, kzExternalId, writeKzCorpus } from "../src/demo/kz-corpus.js";
import { buildPlan, DEMO_STUDENT_DAYS, DEMO_STUDENT_SEAT, type LessonDayEvent } from "../src/demo/plan.js";
import { buildRegionPlan, REGION_SCHOOLS, REGION_SELF, regionKidKey, regionNickname } from "../src/demo/region.js";
import { parseDuelFiles, parseSources } from "../src/modules/corpus/duels-import.js";
import type { LessonContent } from "../src/modules/content/index.js";
import { buildPlan as buildRunPlan, checkAnswer } from "../src/modules/learning/run-plan.js";

/** Понедельник 09.11.2026 … воскресенье 15.11.2026, 12:00 по Уфе (07:00 UTC), и раннее утро понедельника. */
const WEEK = [9, 10, 11, 12, 13, 14, 15].map((d) => new Date(`2026-11-${String(d).padStart(2, "0")}T07:00:00Z`));
const EARLY_MONDAY = new Date("2026-11-08T19:30:00Z"); // 00:30 понедельника по Уфе

describe("demo plan (src/demo/plan.ts)", () => {
  for (const now of [...WEEK, EARLY_MONDAY]) {
    it(`${now.toISOString()}: events before the run, demo student — 5 days in a row, cohorts outscore the rest`, () => {
      const plan = buildPlan(now, { extraWorlds: 2 });
      const today = ufaDayNumber(now);
      const times = plan.events.map((e) => e.at.getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(Math.max(...times)).toBeLessThan(now.getTime());
      // Сегодня демо-ученик не занимается: серия 5, урок показа сделает 6.
      expect(plan.demoStudentDays).toEqual([today - 5, today - 4, today - 3, today - 2, today - 1]);
      expect(plan.events.filter((e) => e.type === "demoStudent").map((e) => ufaDayNumber(e.at))).toEqual(plan.demoStudentDays);
      expect(plan.events.filter((e) => e.type === "demoStudent")).toHaveLength(DEMO_STUDENT_DAYS.length);
      // Лига: недели −3…−1 без его уроков — очки напрямую, по одной записи на неделю.
      const monday = mondayOf(today);
      const lessonWeeks = new Set(plan.demoStudentDays.map(mondayOf));
      const direct = plan.events.filter((e) => e.type === "leaguePoints").map((e) => mondayOf(ufaDayNumber(e.at)));
      expect(direct).toEqual([-3, -2, -1].map((w) => monday + 7 * w).filter((m) => !lessonWeeks.has(m)));
      expect(plan.events.filter((e) => e.type === "extraStudent").map((e) => ufaDayNumber(e.at))).toEqual([today - 1, today - 1]);

      // В неделях когорты — 4–5 дней занятий, у остальных — не больше 2 дней по одному уроку (они не обгонят когорту).
      const byKidWeek = new Map<string, LessonDayEvent[]>();
      for (const e of plan.events) {
        if (e.type !== "lessonDay") continue;
        const key = `${e.kid}@${mondayOf(ufaDayNumber(e.at))}`;
        byKidWeek.set(key, [...(byKidWeek.get(key) ?? []), e]);
      }
      const weeks = { C1: [-5, -4, -3], C2: [-4, -3, -2], C3: [-3, -2, -1] } as const;
      for (const kid of plan.kids) {
        if (kid.seat === DEMO_STUDENT_SEAT && kid.classKey === "5b") continue;
        if (kid.cohort === "C1" || kid.cohort === "C2" || kid.cohort === "C3") {
          for (const w of weeks[kid.cohort]) expect(byKidWeek.get(`${kid.key}@${monday + 7 * w}`)?.length ?? 0, kid.key).toBeGreaterThanOrEqual(4);
        }
        if (kid.cohort === "G") {
          for (let w = -5; w <= 0; w++) {
            const days = byKidWeek.get(`${kid.key}@${monday + 7 * w}`) ?? [];
            expect(days.length).toBeLessThanOrEqual(2);
            for (const d of days) expect(d.graded).toBe(1);
          }
        }
        if (kid.cohort === "idle") expect([...byKidWeek.keys()].some((k) => k.startsWith(`${kid.key}@`))).toBe(false);
      }
    });
  }

  it("roster: 5 «Б» — 24 seats, seat 7 is «Смелая пчела» (a00.n00); nicknames from the dictionary without repeats; a league group fits", () => {
    const { kids } = buildPlan(WEEK[2]!);
    const fiveB = kids.filter((k) => k.classKey === "5b");
    expect(fiveB.map((k) => k.seat)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(fiveB.find((k) => k.seat === DEMO_STUDENT_SEAT)?.nicknameId).toBe("a00.n00");
    expect(new Set(kids.map((k) => k.nicknameId)).size).toBe(kids.length);
    for (const k of kids) expect(k.nicknameId).toMatch(/^a\d{2}\.n\d{2}$/);
    // Лига Кипрея текущей недели — все три когорты и демо-ученик в одной группе.
    expect(kids.filter((k) => ["C1", "C2", "C3"].includes(k.cohort)).length).toBeLessThanOrEqual(LEAGUE_GROUP_SIZE);
    // «Занимались 18 из 24» после урока показа.
    expect(fiveB.filter((k) => k.activeNow).length).toBe(18);
  });

  it("is deterministic for the same moment", () => {
    const a = buildPlan(WEEK[3]!);
    const b = buildPlan(WEEK[3]!);
    expect(a.events.map((e) => [e.type, e.at.toISOString()])).toEqual(b.events.map((e) => [e.type, e.at.toISOString()]));
    expect(dateToDay("2026-11-12")).toBe(ufaDayNumber(WEEK[3]!));
  });
});

const ba = (text: string): Schema<"BaString"> => ({ text, review: "needs_native_review" }) as Schema<"BaString">;

/** Синтетический урок: плитки, выбор, ввод с особой буквой. */
const lesson: LessonContent = {
  id: "t-lesson",
  unitId: "t-u1",
  position: 1,
  kind: "lesson",
  titleRu: "Тест",
  exerciseCount: 3,
  gradedCount: 3,
  newWords: [ba("ҡәр")],
  contentVersion: 1,
  exercises: [
    { id: "x1", position: 1, type: "tiles_ru_ba", payload: { promptRu: "раз два", tiles: ["Тәк", "ҙур", "лоп"] }, answerKey: { kind: "accepted", accepted: [ba("Тәк ҙур.")] }, review: "needs_native_review", sources: [] },
    { id: "x2", position: 2, type: "choice_ba_ru", payload: { prompt: ba("ҡәр"), optionsRu: ["один", "два", "три", "четыре"] }, answerKey: { kind: "choice", correct: 2 }, review: "needs_native_review", sources: [] },
    { id: "x3", position: 3, type: "free_ru_ba", payload: { promptRu: "три" }, answerKey: { kind: "accepted", accepted: [ba("ҡәр")] }, review: "needs_native_review", sources: [] },
  ],
};

describe("demo answers (src/demo/answers.ts)", () => {
  const plan = buildRunPlan({ unitId: "t-u1", titleRu: "Тест", newWords: lesson.newWords, exercises: lesson.exercises, duels: new Map() });
  const tiles = plan.items[0]!;
  // В плитках «Тәк ҙур.» слова — без пунктуации: tileWords как у импорта.
  it("tileWords strips punctuation like content import", () => {
    expect(tileWords("Тәк ҙур.")).toEqual(["Тәк", "ҙур"]);
    expect(tileWords("  — а, б! ")).toEqual(["а", "б"]);
  });

  it("almostText swaps the first special letter for its Russian pair, keeping case", () => {
    expect(almostText("ҡәр")).toBe("кәр");
    expect(almostText("Ҡәр")).toBe("Кәр");
    expect(almostText("раз")).toBeUndefined();
  });

  it("correct answers pass the server check; mistakes give wrong or almost", () => {
    for (const item of plan.items) {
      expect(checkAnswer(item, correctAnswer(item.view, lesson)).verdict, item.view.type).toBe("correct");
      expect(checkAnswer(item, mistakenAnswer(item.view, lesson, "wrong")).verdict, item.view.type).toBe("wrong");
    }
    expect(checkAnswer(plan.items[2]!, mistakenAnswer(plan.items[2]!.view, lesson, "almost")).verdict).toBe("almost");
    expect(tiles.view.type).toBe("tiles_ru_ba");
  });

  it("answer sheet: prompts, answers, an «almost» spelling and a wrong option", () => {
    expect(answerSheet(lesson)).toEqual([
      { type: "tiles_ru_ba", prompt: "раз два", answer: ["Тәк", "ҙур"] },
      { type: "choice_ba_ru", prompt: "ҡәр", answer: ["три"], wrong: "один" },
      { type: "free_ru_ba", prompt: "три", answer: ["ҡәр"], almost: "кәр" },
    ]);
  });
});

describe("demo republic (src/demo/region.ts, ADR 0023)", () => {
  it("уроки республики — детерминированно, до запуска сида и по порядку времени", () => {
    for (const now of [...WEEK, EARLY_MONDAY]) {
      const cal = buildPlan(now).calendar;
      const a = buildRegionPlan(cal);
      expect(buildRegionPlan(cal)).toEqual(a);
      const times = a.map((e) => e.at.getTime());
      expect(times).toEqual([...times].sort((x, y) => x - y));
      expect(Math.max(...times)).toBeLessThanOrEqual(cal.todayEnd.getTime());
      // Все ученики, чьи уроки в плане, есть в составе (классы и «Учусь сам»).
      const keys = new Set([
        ...REGION_SCHOOLS.flatMap((s) => s.classes.flatMap((c, ci) => Array.from({ length: c.seats }, (_, i) => regionKidKey(s.key, ci, i + 1)))),
        ...REGION_SELF.map((s) => s.key),
      ]);
      expect(a.every((e) => keys.has(e.kid))).toBe(true);
      expect(a.length).toBeGreaterThan(300);
    }
  });

  it("лига: классы республики не 5–8, «Учусь сам» не 11–14 — с 5 «Б» и 6 «А» в одну группу не попадают", () => {
    for (const s of REGION_SCHOOLS) for (const c of s.classes) expect(c.grade < 5 || c.grade > 8).toBe(true);
    for (const s of REGION_SELF) expect(s.ageBand).not.toBe("age_11_14");
  });

  it("малые группы для показа скрытия: школы меньше 5 учеников есть, ники — из словаря", () => {
    const small = REGION_SCHOOLS.filter((s) => s.classes.reduce((n, c) => n + c.seats, 0) < 5);
    expect(small.map((s) => s.key)).toEqual(["r08", "r11"]);
    for (let n = 0; n < 300; n++) expect(regionNickname(n)).toMatch(/^a(0\d|[12]\d|3[01])\.n(0\d|[12]\d|3[0-5])$/);
    expect(new Set(REGION_SELF.map((s) => s.nicknameId)).size).toBe(REGION_SELF.length);
  });
});

// Демо-корпус пары ba-kz (src/demo/kz-corpus.ts) — настоящие казахские и башкирские слова: это словарь для показа
// публичной выгрузки, а не тестовая синтетика. Остальные тесты файла строк языка не содержат (правило 6).
describe("demo kz-corpus (src/demo/kz-corpus.ts)", () => {
  it("30–50 пар: казахский исходник и башкирский эквивалент в канонической форме, альтернатива отличается", () => {
    expect(KZ_PAIRS.length).toBeGreaterThanOrEqual(30);
    expect(KZ_PAIRS.length).toBeLessThanOrEqual(50);
    const seenKz = new Set<string>();
    for (const p of KZ_PAIRS) {
      expect(p.kz.length).toBeGreaterThan(0);
      expect(seenKz.has(p.kz)).toBe(false);
      seenKz.add(p.kz);
      // Башкирские тексты — в канонической форме normalize() (правило 7), варианты различаются после toComparable.
      expect(p.ba).toBe(normalize(p.ba));
      expect(p.alt).toBe(normalize(p.alt));
      expect(toComparable(p.ba)).not.toBe(toComparable(p.alt));
      expect(["word", "phrase"]).toContain(p.kind);
      expect(p.domain).toMatch(/^[a-z]+$/);
    }
    // Разделы словаря для демонстрации: приветствие, семья, числа, быт, природа.
    const domains = new Set(KZ_PAIRS.map((p) => p.domain));
    expect([...domains].sort()).toEqual(["family", "greeting", "household", "nature", "numbers"]);
  });

  it("writeKzCorpus пишет файлы, которые разбирает corpus:import: 50 дуэлей с источником «Демо-корпус ТелеТау»", () => {
    const dir = mkdtempSync(join(tmpdir(), "teletau-kz-test-"));
    try {
      const { duelsDir, sourcesFile } = writeKzCorpus(dir);
      const sources = parseSources(readFileSync(sourcesFile, "utf8"));
      expect(sources.get(KZ_SOURCE.id)).toMatchObject({ title: "Демо-корпус ТелеТау", license: KZ_SOURCE.license });
      const duels = parseDuelFiles([{ name: "kz-demo.yaml", text: readFileSync(join(duelsDir, "kz-demo.yaml"), "utf8") }], sources);
      expect(duels).toHaveLength(KZ_PAIRS.length);
      duels.forEach((d, n) => {
        expect(d.externalId).toBe(kzExternalId(n));
        expect(d.unitId).toBe(KZ_UNIT);
        expect(d.ru).toBe(KZ_PAIRS[n]!.kz);
        expect(d.variants[0]!.text).toBe(KZ_PAIRS[n]!.ba);
        expect(d.variants[1]!.text).toBe(KZ_PAIRS[n]!.alt);
        for (const v of d.variants) expect(v.sourceRef.title).toBe("Демо-корпус ТелеТау");
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
