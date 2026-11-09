// Юнит-тесты правил уроков, которых нет в общих векторах: разбор курса из YAML, состояния узлов тропы, план забега
// без ключей и проверка ответа по нему, квест класса. Мёд, серия и лига — векторы и тесты @teletau/domain-rules.
// Строки — синтетические (test/fixtures/content), как в contracts/test-vectors/answer-check.
import { fileURLToPath } from "node:url";
import type { Schema } from "@teletau/contracts";
import { describe, expect, it } from "vitest";
import { questGoal, questProgress, QUEST_STUDENT_CAP } from "../src/modules/competition/quest.js";
import type { DuelCard } from "../src/modules/consensus/index.js";
import type { CourseContent, ExerciseContent } from "../src/modules/content/index.js";
import { buildCourse, readContent, tileWords, type CourseFiles, type ExerciseRow } from "../src/modules/content/content-import.js";
import { buildPlan, checkAnswer, lessonDuelsAllowed, LESSONS_BEFORE_DUELS, LETTER_PANEL, shouldRetry, shuffle, type PlanItem } from "../src/modules/learning/run-plan.js";
import { buildTrail, lessonsPassed } from "../src/modules/learning/trail.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/content/", import.meta.url));
const files = (): CourseFiles => readContent(FIXTURE)[0]!;

describe("content:import — разбор курса (content-import.ts)", () => {
  const bundle = buildCourse(files());

  it("курс, юниты, узлы и упражнения в порядке тропы", () => {
    expect(bundle.courseId).toBe("t-course");
    expect(bundle.version).toBe(1);
    expect(bundle.units.map((u) => [u.id, u.position, u.status])).toEqual([
      ["t-u1", 1, "open"],
      ["t-u2", 2, "locked"],
    ]);
    expect(bundle.lessons.map((l) => [l.id, l.unitId, l.position, l.kind, l.duelCount])).toEqual([
      ["t-l1", "t-u1", 1, "lesson", null],
      ["t-help", "t-u1", 2, "help_language", 2],
      ["t-l2", "t-u1", 3, "lesson", null],
      ["t-test", "t-u1", 4, "place_test", null],
      ["t-u2-l1", "t-u2", 1, "lesson", null],
      ["t-u2-help", "t-u2", 2, "help_language", 1],
    ]);
    expect(bundle.lessons.find((l) => l.id === "t-l1")?.titleRu).toBe("Урок один");
    expect(bundle.lessons.find((l) => l.id === "t-u2-l1")?.titleRu).toBe("Закрытый урок");
  });

  it("native_rejected не импортируется: упражнение без строк пропущено, отклонённые ответ и плитка убраны", () => {
    const l1 = bundle.exercises.filter((e) => e.lessonId === "t-l1");
    expect(l1.map((e) => [e.id, e.position])).toEqual([
      ["t-l1-tiles", 1],
      ["t-l1-choice", 2],
      ["t-l1-free-short", 3],
      ["t-l1-free-long", 4],
      ["t-l1-duel", 5],
    ]);
    expect(bundle.skipped).toEqual({ exercises: 1, strings: 3 });
    const tiles = l1[0] as ExerciseRow;
    expect(tiles.payload).toEqual({ promptRu: "Синтетика А", tiles: ["Пиҡол", "тумә", "ғарыҙ"] });
    expect(tiles.answerKey).toEqual({ kind: "accepted", accepted: [{ text: "Пиҡол тумә!", review: "needs_native_review" }], meaningRu: "Синтетика А" });
    expect(tiles.review).toBe("needs_native_review");
    const long = l1[3]!;
    expect(long.answerKey).toEqual({ kind: "accepted", accepted: [{ text: "сәлдерәм", review: "needs_native_review" }] });
  });

  it("ключи ответов — только в answer_key, payload их не содержит; источники — из sources.yaml", () => {
    const choice = bundle.exercises.find((e) => e.id === "t-l1-choice")!;
    expect(choice.payload).toEqual({ prompt: { text: "һөлөк", review: "needs_native_review" }, optionsRu: ["Значение Б", "Значение В", "Значение Г"] });
    expect(choice.answerKey).toEqual({ kind: "choice", correct: 0, meaningRu: "Значение Б" });
    expect(choice.sources).toEqual([{ title: "Синтетический набор для тестов", url: "https://example.org/synthetic/4", locator: "строка 4", license: "—" }]);
    const duel = bundle.exercises.find((e) => e.id === "t-l1-duel")!;
    expect(duel).toMatchObject({ payload: {}, answerKey: { kind: "none" }, duelRef: null });
  });

  it("новые слова — только строки упражнений урока, со статусом проверки", () => {
    expect(bundle.lessons.find((l) => l.id === "t-l1")?.newWords).toEqual([
      { text: "Пиҡол тумә!", review: "needs_native_review" },
      { text: "һөлөк", review: "needs_native_review" },
    ]);
  });

  it("хеш не зависит от порядка ключей YAML и меняется с содержимым", () => {
    const f = files();
    const reordered = { ...f, course: Object.fromEntries(Object.entries(f.course as Record<string, unknown>).reverse()) };
    expect(buildCourse(reordered).hash).toBe(bundle.hash);
    const changed = structuredClone(f);
    ((changed.lessons["t-l2"] as { title_ru: string }).title_ru = "Другое");
    expect(buildCourse(changed).hash).not.toBe(bundle.hash);
  });

  it("ошибки формата: нет файла урока открытого юнита, повтор id упражнения, неизвестный источник", () => {
    const noLesson = structuredClone(files());
    delete noLesson.lessons["t-l2"];
    expect(() => buildCourse(noLesson)).toThrow(/нет файла урока/);
    const dup = structuredClone(files());
    ((dup.lessons["t-l2"] as { exercises: { id: string }[] }).exercises[0]!.id = "t-l1-tiles");
    expect(() => buildCourse(dup)).toThrow(/уже есть в курсе/);
    const badRef = structuredClone(files());
    ((badRef.lessons["t-l2"] as { exercises: { answers: { source: { ref: string } }[] }[] }).exercises[0]!.answers[0]!.source.ref = "nope");
    expect(() => buildCourse(badRef)).toThrow(/источника «nope» нет/);
  });

  it("плитки — слова без пунктуации по краям", () => {
    expect(tileWords("«Пиҡол, тумә!»  ғарыҙ-һөлөк")).toEqual(["Пиҡол", "тумә", "ғарыҙ-һөлөк"]);
  });

  it.skipIf(readContent().length === 0)("демо-контент content/course (Ч1) разбирается без ошибок", () => {
    for (const f of readContent()) {
      const b = buildCourse(f);
      expect(b.units.length).toBeGreaterThan(0);
      for (const l of b.lessons.filter((x) => x.kind !== "help_language" && b.units.find((u) => u.id === x.unitId)?.status === "open")) {
        expect(b.exercises.some((e) => e.lessonId === l.id), l.id).toBe(true);
      }
    }
  });

  it("нет каталога course/ — курсов нет", () => {
    expect(readContent(fileURLToPath(new URL("./fixtures/", import.meta.url)))).toEqual([]);
  });
});

const node = (id: string, kind: "lesson" | "help_language" | "place_test", exerciseCount = 3) => ({ id, unitId: "", position: 0, kind, titleRu: id, exerciseCount, gradedCount: exerciseCount });
const COURSE: CourseContent = {
  id: "c",
  contentVersion: 2,
  units: [
    { id: "u1", position: 1, status: "open", place: { slug: "a", titleRu: "А" }, topicRu: "Т", nodes: [node("a1", "lesson"), node("h1", "help_language", 2), node("a2", "lesson"), node("t1", "place_test")] },
    { id: "u2", position: 2, status: "open", place: { slug: "b", titleRu: "Б" }, topicRu: "Т", nodes: [node("b1", "lesson"), node("h2", "help_language")] },
    { id: "u3", position: 3, status: "locked", place: { slug: "c", titleRu: "В" }, topicRu: "Т", nodes: [node("c1", "lesson")] },
  ],
};
const states = (completions: Record<string, number>) =>
  buildTrail(COURSE, new Map(Object.entries(completions))).units.flatMap((u) => u.nodes.map((n) => `${n.id}:${n.state}`));

describe("тропа — состояния узлов (trail.ts, описание GET /course)", () => {
  it("новичок: первый урок — current, остальное закрыто", () => {
    expect(states({})).toEqual(["a1:current", "h1:locked", "a2:locked", "t1:locked", "b1:locked", "h2:locked", "c1:locked"]);
  });

  it("после первого урока: «Помоги языку» открыт, следующий урок — current", () => {
    expect(states({ a1: 1 })).toEqual(["a1:done", "h1:open", "a2:current", "t1:locked", "b1:locked", "h2:locked", "c1:locked"]);
  });

  it("«Помоги языку» не мешает идти дальше; пройденный — done", () => {
    expect(states({ a1: 2, a2: 1, h1: 1 })).toEqual(["a1:done", "h1:done", "a2:done", "t1:current", "b1:locked", "h2:locked", "c1:locked"]);
  });

  it("current — один на курс; юнит 2 открывается после «Испытания места»; у закрытого юнита всё locked", () => {
    expect(states({ a1: 1, a2: 1, t1: 1 })).toEqual(["a1:done", "h1:open", "a2:done", "t1:done", "b1:current", "h2:locked", "c1:locked"]);
    expect(states({ a1: 1, a2: 1, t1: 1, b1: 1, c1: 1 })).toEqual(["a1:done", "h1:open", "a2:done", "t1:done", "b1:done", "h2:open", "c1:locked"]);
  });

  it("пройденные уроки — разные lesson и place_test, хотя бы раз; «Помоги языку» и повторы не в счёт", () => {
    const passed = (c: Record<string, number>) => lessonsPassed(buildTrail(COURSE, new Map(Object.entries(c))));
    expect(passed({})).toBe(0);
    expect(passed({ a1: 3, h1: 2 })).toBe(1);
    expect(passed({ a1: 1, a2: 1, t1: 1, h1: 1 })).toBe(3);
  });

  it("число упражнений — только у открытых юнитов; прохождения — у всех", () => {
    const trail = buildTrail(COURSE, new Map([["a1", 3]]));
    expect(trail.units[0]!.nodes[0]).toMatchObject({ exerciseCount: 3, completions: 3 });
    expect(trail.units[2]!.nodes[0]).not.toHaveProperty("exerciseCount");
    expect(trail.units[2]!.state).toBe("locked");
  });
});

const ex = (e: Partial<ExerciseContent> & Pick<ExerciseContent, "id" | "type" | "payload" | "answerKey">): ExerciseContent => ({
  position: 1,
  review: "needs_native_review",
  sources: [],
  ...e,
});
const EXERCISES: ExerciseContent[] = [
  ex({ id: "x-tiles", type: "tiles_ru_ba", payload: { promptRu: "А", tiles: ["пиҡол", "тумә", "ғарыҙ"] }, answerKey: { kind: "accepted", accepted: [{ text: "Пиҡол тумә!", review: "needs_native_review" }] } }),
  ex({ id: "x-choice", type: "choice_ba_ru", payload: { prompt: { text: "һөлөк", review: "needs_native_review" }, optionsRu: ["Б", "В", "Г"] }, answerKey: { kind: "choice", correct: 2 }, meaningRu: "Г" }),
  ex({ id: "x-free", type: "free_ru_ba", payload: { promptRu: "Д" }, answerKey: { kind: "accepted", accepted: [{ text: "ҡаҙым", review: "needs_native_review" }, { text: "сәлдерәм", review: "native_approved" }] } }),
  ex({ id: "x-duel", type: "duel", payload: {}, answerKey: { kind: "none" } }),
  ex({ id: "x-duel-none", type: "duel", payload: {}, answerKey: { kind: "none" } }),
];
const CARD: DuelCard = {
  itemId: "0193f000-0000-7000-8000-000000000001",
  sourceRu: "Е",
  a: { variantId: "0193f000-0000-7000-8000-00000000000a", text: "ҡывап" },
  b: { variantId: "0193f000-0000-7000-8000-00000000000b", text: "ҡывам" },
  review: "needs_native_review",
  sources: [{ title: "S" }],
};
const plan = () => buildPlan({ unitId: "u1", titleRu: "Урок", newWords: [], exercises: EXERCISES, duels: new Map([["x-duel", CARD]]) });
const item = (p: ReturnType<typeof plan>, type: PlanItem["key"]["type"]) => p.items.find((i) => i.key.type === type)!;

describe("план забега и проверка ответа (run-plan.ts)", () => {
  it("упражнения в порядке контента, с id забега; дуэль без пары пропущена", () => {
    const p = plan();
    expect(p.items.map((i) => [i.id, i.exerciseId, i.view.type])).toEqual([
      ["e1", "x-tiles", "tiles_ru_ba"],
      ["e2", "x-choice", "choice_ba_ru"],
      ["e3", "x-free", "free_ru_ba"],
      ["e4", "x-duel", "duel"],
    ]);
  });

  it("ученик видит упражнения без ключей: ни принятых ответов, ни индекса верного варианта", () => {
    const views = JSON.stringify(plan().items.map((i) => i.view));
    for (const leak of ["accepted", "correct", "answerKey", "сәлдерәм", "ҡаҙым"]) expect(views).not.toContain(leak);
    const tiles = item(plan(), "tiles").view as Schema<"TilesExercise">;
    expect(tiles.tiles.map((t) => t.text).sort()).toEqual(["пиҡол", "тумә", "ғарыҙ"].sort());
    expect(new Set(tiles.tiles.map((t) => t.id)).size).toBe(3);
    const free = item(plan(), "free").view as Schema<"FreeInputExercise">;
    expect(free.letters).toEqual(LETTER_PANEL);
  });

  it("панель букв — 9 особых букв правильными кодовыми точками", () => {
    expect(LETTER_PANEL.map((c) => c.codePointAt(0)!.toString(16))).toEqual(["4a1", "493", "499", "4ab", "4bb", "4d9", "4e9", "4af", "4a3"]);
  });

  it("плитки: верный порядок — correct, другой — wrong; неизвестная или повторная плитка — 422", () => {
    const it_ = item(plan(), "tiles");
    const view = it_.view as Schema<"TilesExercise">;
    const id = (t: string) => view.tiles.find((x) => x.text === t)!.id;
    expect(checkAnswer(it_, { type: "tiles", tileIds: [id("пиҡол"), id("тумә")] })).toMatchObject({ verdict: "correct", correctAnswer: { text: "Пиҡол тумә!" } });
    expect(checkAnswer(it_, { type: "tiles", tileIds: [id("тумә"), id("пиҡол")] }).verdict).toBe("wrong");
    expect(() => checkAnswer(it_, { type: "tiles", tileIds: ["nope"] })).toThrow(expect.objectContaining({ status: 422, code: "validation_failed" }));
    expect(() => checkAnswer(it_, { type: "tiles", tileIds: [id("тумә"), id("тумә")] })).toThrow(expect.objectContaining({ status: 422 }));
  });

  it("выбор: верный вариант по непрозрачному id; при ошибке — верный id и толкование", () => {
    const it_ = item(plan(), "choice");
    const view = it_.view as Schema<"ChoiceExercise">;
    expect(view.prompt).toBe("һөлөк");
    const right = view.options.find((o) => o.textRu === "Г")!.id;
    const wrong = view.options.find((o) => o.textRu === "Б")!.id;
    expect(checkAnswer(it_, { type: "choice", optionId: right })).toEqual({ verdict: "correct", correctOptionId: right, meaningRu: "Г" });
    expect(checkAnswer(it_, { type: "choice", optionId: wrong })).toEqual({ verdict: "wrong", correctOptionId: right, meaningRu: "Г" });
    expect(() => checkAnswer(it_, { type: "choice", optionId: "zzz" })).toThrow(expect.objectContaining({ status: 422 }));
  });

  it("ввод: correct, almost с буквой, typo, wrong — по matchAnswer; правильная форма — совпавший вариант", () => {
    const it_ = item(plan(), "free");
    expect(checkAnswer(it_, { type: "text", text: "Ҡаҙым." })).toMatchObject({ verdict: "correct", correctAnswer: { text: "ҡаҙым" } });
    expect(checkAnswer(it_, { type: "text", text: "казым" })).toEqual({
      verdict: "almost",
      correctAnswer: { text: "ҡаҙым", review: "needs_native_review" },
      hint: { expected: "ҡ", got: "к", token: 0, index: 0 },
    });
    expect(checkAnswer(it_, { type: "text", text: "сәлдерәп" })).toMatchObject({ verdict: "typo", correctAnswer: { text: "сәлдерәм", review: "native_approved" } });
    expect(checkAnswer(it_, { type: "text", text: "ғарыҙ" })).toMatchObject({ verdict: "wrong", correctAnswer: { text: "ҡаҙым" } });
  });

  it("вид ответа не подходит к упражнению — 422 answer_type_mismatch", () => {
    expect(() => checkAnswer(item(plan(), "free"), { type: "choice", optionId: "a" })).toThrow(expect.objectContaining({ status: 422, code: "answer_type_mismatch" }));
    expect(() => checkAnswer(item(plan(), "duel"), { type: "text", text: "a" })).toThrow(expect.objectContaining({ code: "answer_type_mismatch" }));
  });

  it("дуэль: стороны — как в карточке consensus, ключ — показанные варианты; ответ не оценивается", () => {
    const d = item(plan(), "duel");
    expect(d.view).toEqual({ id: "e4", type: "duel", review: "needs_native_review", sources: [{ title: "S" }], itemId: CARD.itemId, sourceRu: "Е", a: "ҡывап", b: "ҡывам" });
    expect(d.key).toEqual({ type: "duel", itemId: CARD.itemId, shown: [CARD.a.variantId, CARD.b.variantId] });
    expect(checkAnswer(d, { type: "duel", choice: "both" })).toEqual({ verdict: "recorded" });
  });

  it("«Помоги языку»: только дуэли узла", () => {
    const p = buildPlan({ unitId: "u1", titleRu: "Помоги", newWords: [], exercises: [], duels: new Map(), extraDuels: [CARD, { ...CARD, itemId: "0193f000-0000-7000-8000-000000000002" }] });
    expect(p.items.map((i) => [i.id, i.view.type, i.exerciseId])).toEqual([
      ["e1", "duel", undefined],
      ["e2", "duel", undefined],
    ]);
  });

  it("повтор после ошибки — один: первая ошибка возвращает упражнение, вторая и дальше — нет; верный ответ — никогда", () => {
    expect([0, 1, 2].map((prior) => shouldRetry("wrong", prior))).toEqual([true, false, false]);
    for (const v of ["correct", "almost", "typo", "recorded"] as const) expect(shouldRetry(v, 0), v).toBe(false);
  });

  it("дуэль в уроке — с третьего урока ученика: в первых двух уроках дуэлей нет", () => {
    expect(LESSONS_BEFORE_DUELS).toBe(2);
    expect([0, 1, 2, 5].map(lessonDuelsAllowed)).toEqual([false, false, true, true]);
  });

  it("перемешивание — перестановка исходного набора", () => {
    let seed = 7;
    const rng = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
    const xs = [1, 2, 3, 4, 5, 6];
    expect(shuffle(xs, rng).sort()).toEqual(xs);
  });
});

describe("квест класса (quest.ts)", () => {
  it("цель — 12,5 соты на ученика, вверх до десятка, не меньше 30", () => {
    expect([0, 1, 2, 3, 24, 25].map(questGoal)).toEqual([30, 30, 30, 40, 300, 320]);
  });

  it("вклад одного ученика ограничен — двое не вытягивают класс", () => {
    expect(questProgress([3, 0, 100])).toBe(3 + QUEST_STUDENT_CAP);
  });
});
