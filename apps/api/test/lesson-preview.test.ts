// «Что в уроке» для учителя — чистая функция lessonPreview (learning/lesson-preview.ts) над контентом курса.
// Точные значения — на синтетическом курсе (test/fixtures/content: сочетания букв, не слова языка — правило 6);
// на демо-курсе (content/course) — свойства всех узлов тропы, без башкирских строк в тесте.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCourse, readContent, wordKey, type CourseBundle } from "../src/modules/content/content-import.js";
import type { ExerciseContent, LessonContent, Lexicon, UnitContent } from "../src/modules/content/index.js";
import { lessonPreview } from "../src/modules/learning/lesson-preview.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/content/", import.meta.url));

/** Курс так, как его отдают ContentService.course / lesson / words (без базы). */
function contentOf(bundle: CourseBundle) {
  const lexicon: Lexicon = {
    courseId: bundle.courseId,
    contentVersion: bundle.version,
    words: bundle.words.map((w) => ({
      id: w.id,
      position: w.position,
      word: { text: w.text, review: w.review, ...(w.audio ? { audio: w.audio } : {}) },
      translationRu: w.translationRu,
      sources: w.sources,
      lessonId: w.lessonId,
    })),
  };
  const known = new Set(lexicon.words.map((w) => w.id));
  const lesson = (id: string): LessonContent => {
    const l = bundle.lessons.find((x) => x.id === id)!;
    const exercises = bundle.exercises
      .filter((e) => e.lessonId === id)
      .map(({ answerKey, lessonId: _lessonId, duelRef: _duelRef, ...e }): ExerciseContent => {
        const { meaningRu, ...key } = answerKey as typeof answerKey & { meaningRu?: string };
        return { ...e, answerKey: key, ...(meaningRu ? { meaningRu } : {}) };
      });
    return {
      id: l.id,
      unitId: l.unitId,
      position: l.position,
      kind: l.kind,
      titleRu: l.titleRu,
      exerciseCount: l.kind === "help_language" ? (l.duelCount ?? 0) : exercises.length,
      gradedCount: exercises.filter((e) => e.type !== "duel").length,
      newWords: l.newWords,
      wordIds: [...new Set(l.newWords.map((w) => wordKey(w.text)))].filter((k) => known.has(k)),
      exercises,
      contentVersion: bundle.version,
    };
  };
  const unit = (id: string): UnitContent => {
    const u = bundle.units.find((x) => x.id === id)!;
    return {
      id: u.id,
      position: u.position,
      status: u.status,
      place: { slug: u.placeSlug, titleRu: u.titleRu, ...(u.titleBa && u.titleBaReview ? { titleBa: { text: u.titleBa, review: u.titleBaReview } } : {}) },
      topicRu: u.topicRu,
      nodes: [],
    };
  };
  const preview = (id: string) => {
    const l = lesson(id);
    return lessonPreview(l, unit(l.unitId), lexicon);
  };
  return { preview, lexicon };
}

const fixture = contentOf(buildCourse(readContent(FIXTURE)[0]!));
const shown = (list: { word: { text: string }; translationRu: string }[]) => list.map((w) => [w.word.text, w.translationRu]);

describe("lessonPreview — what is inside a trail node, for the teacher", () => {
  it("lesson: new words with translation, phrases from new words, task kinds in order of first appearance", () => {
    const p = fixture.preview("t-l1");
    expect(p).toMatchObject({ lessonId: "t-l1", kind: "lesson", titleRu: "Урок один", unitId: "t-u1", place: { titleRu: "Место один" }, exerciseCount: 5 });
    // «строки нет в уроке» — не строка урока: в словарь не попала, в «Что в уроке» тоже.
    expect(shown(p.words)).toEqual([["һөлөк", "Значение Б"]]);
    expect(shown(p.phrases)).toEqual([["Пиҡол тумә!", "Синтетика А"]]);
    // Отклонённое носителем задание не импортируется — и не считается.
    expect(p.tasks).toEqual([
      { type: "tiles_ru_ba", count: 1 },
      { type: "choice_ba_ru", count: 1 },
      { type: "free_ru_ba", count: 2 },
      { type: "duel", count: 1 },
    ]);
  });

  it("lesson: a phrase from a task (not a new word) comes with the Russian side of the task; single task words are not new words", () => {
    const p = fixture.preview("t-l2");
    expect(shown(p.words)).toEqual([["тумә", "Синтетика З"]]);
    expect(shown(p.phrases)).toEqual([["ғарыҙ һөлөк", "Синтетика Л"]]);
    expect(p.words.map((w) => w.id)).not.toContain("пиҡол");
  });

  it("place test: separate words of its tasks are words, with the dictionary translation when the word is there", () => {
    const p = fixture.preview("t-test");
    expect(p.kind).toBe("place_test");
    expect(shown(p.words)).toEqual([
      ["тумә", "Синтетика З"],
      ["пиҡол", "Значение К"],
    ]);
    expect(shown(p.phrases)).toEqual([["ғарыҙ һөлөк", "Синтетика Л"]]);
  });

  it("duels: only the kind and the count — no variants, no answers", () => {
    const p = fixture.preview("t-l2");
    expect(p.tasks.find((t) => t.type === "duel")).toEqual({ type: "duel", count: 1 });
    expect(JSON.stringify(p)).not.toMatch(/variant|t-u1-d07|duelRef/);
  });
});

describe("lessonPreview — demo course (content/course)", () => {
  const bundle = buildCourse(readContent()[0]!);
  const demo = contentOf(bundle);
  const nodes = bundle.lessons.map((l) => l.id);

  it.each(nodes)("%s: every string is translated, no repeats, phrases have several words, words have one", (id) => {
    const p = demo.preview(id);
    const all = [...p.words, ...p.phrases];
    expect(new Set(all.map((w) => w.id)).size).toBe(all.length);
    for (const w of all) {
      expect(w.translationRu.trim()).not.toBe("");
      expect(w.id).toBe(wordKey(w.word.text));
    }
    for (const w of p.words) expect(w.id).not.toContain(" ");
    for (const w of p.phrases) expect(w.id).toContain(" ");
    expect(p.tasks.reduce((s, t) => s + t.count, 0)).toBe(p.exerciseCount);
  });

  it("every new word of a lesson that is in the dictionary is shown, with its recording when the dictionary has one", () => {
    const byId = new Map(demo.lexicon.words.map((w) => [w.id, w]));
    for (const l of bundle.lessons.filter((x) => x.kind === "lesson")) {
      const p = demo.preview(l.id);
      const keys = [...new Set(l.newWords.map((w) => wordKey(w.text)))].filter((k) => byId.has(k));
      expect([...p.words, ...p.phrases].map((w) => w.id), l.id).toEqual(expect.arrayContaining(keys));
      for (const w of [...p.words, ...p.phrases]) if (byId.get(w.id)?.word.audio) expect(w.word.audio, `${l.id}: ${w.id}`).toEqual(byId.get(w.id)!.word.audio);
    }
    const audio = bundle.lessons.flatMap((l) => demo.preview(l.id).words).filter((w) => w.word.audio);
    expect(audio.length).toBeGreaterThan(0);
  });

  it("help_language: no strings, only duels", () => {
    const help = bundle.lessons.find((l) => l.kind === "help_language")!;
    const p = demo.preview(help.id);
    expect(p).toMatchObject({ kind: "help_language", words: [], phrases: [], tasks: [{ type: "duel", count: help.duelCount }] });
  });
});
