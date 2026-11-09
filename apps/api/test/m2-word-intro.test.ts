// «Новое слово» перед упражнениями и подсказки к условию — чистые функции плана забега (word-intro.ts, run-plan.ts).
// Строки — синтетические (test/fixtures/content-srs: сочетания букв, не слова языка — правило 6).
import { fileURLToPath } from "node:url";
import type { Schema } from "@teletau/contracts";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/common/problem.js";
import { buildCourse, readContent, wordKey } from "../src/modules/content/content-import.js";
import type { ExerciseContent, WordContent } from "../src/modules/content/index.js";
import { buildReviewPlan } from "../src/modules/learning/review-plan.js";
import {
  buildPlan,
  checkAnswer,
  isAnswerable,
  type RunPlan,
} from "../src/modules/learning/run-plan.js";
import {
  containsWords,
  placeIntros,
  promptHints,
  wordsUsedBy,
} from "../src/modules/learning/word-intro.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/content-srs/", import.meta.url));
const bundle = buildCourse(readContent(FIXTURE)[0]!);
const lexicon: WordContent[] = bundle.words.map((w) => ({
  id: w.id,
  position: w.position,
  word: { text: w.text, review: w.review, ...(w.audio ? { audio: w.audio } : {}) },
  translationRu: w.translationRu,
  sources: w.sources,
  lessonId: w.lessonId,
}));
const word = (id: string) => lexicon.find((w) => w.id === id)!;

/** Урок фикстуры так, как его отдаёт ContentService.lesson (без базы). */
function lesson(id: string): {
  exercises: ExerciseContent[];
  wordIds: string[];
  newWords: Schema<"BaString">[];
} {
  const l = bundle.lessons.find((x) => x.id === id)!;
  const wordIds = [...new Set(l.newWords.map((w) => wordKey(w.text)))].filter((k) =>
    lexicon.some((w) => w.id === k),
  );
  const exercises = bundle.exercises
    .filter((e) => e.lessonId === id)
    .map(({ answerKey, ...e }): ExerciseContent => {
      const { meaningRu, ...key } = answerKey as typeof answerKey & { meaningRu?: string };
      // Слова, которые проверяет упражнение, — как у ContentService.lesson: строки ответа целиком из слов урока.
      const tested =
        key.kind === "accepted"
          ? key.accepted.map((a) => a.text)
          : e.type === "choice_ba_ru"
            ? [(e.payload["prompt"] as Schema<"BaString">).text]
            : e.type === "match_pairs"
              ? (e.payload["pairs"] as { ba: Schema<"BaString"> }[]).map((p) => p.ba.text)
              : [];
      const words = [...new Set(tested.map(wordKey))].filter((k) => wordIds.includes(k));
      return {
        id: e.id,
        position: e.position,
        type: e.type,
        payload: e.payload,
        answerKey: key,
        review: e.review,
        sources: e.sources,
        ...(meaningRu ? { meaningRu } : {}),
        words,
      };
    });
  return { exercises, wordIds, newWords: l.newWords };
}

function plan(
  id: string,
  opts: { met?: string[]; intro?: boolean; hints?: boolean } = {},
): RunPlan {
  const l = lesson(id);
  const introWords =
    opts.intro === false ? [] : l.wordIds.filter((w) => !opts.met?.includes(w)).map(word);
  return buildPlan({
    unitId: "s-u1",
    titleRu: "Урок",
    newWords: l.newWords,
    wordIds: l.wordIds,
    exercises: l.exercises,
    duels: new Map(),
    introWords,
    ...(opts.hints === false ? {} : { lexicon }),
  });
}

/** Порядок показа: карточка — [слово], упражнение — его вид. */
const order = (p: RunPlan) =>
  p.items.map((i) => (i.view.type === "word_intro" ? `[${i.view.word.text}]` : i.view.type));

describe("«Новое слово»: сначала показать, потом проверить (placeIntros)", () => {
  it("по две карточки перед первым упражнением со словом, добор — следующими по первому упражнению", () => {
    expect(placeIntros([["a"], ["b"], ["c"], ["d"]], ["a", "b", "c", "d"])).toEqual([
      ["a", "b"],
      [],
      ["c", "d"],
      [],
    ]);
  });

  it("упражнение сразу с тремя новыми словами — три карточки перед ним", () => {
    expect(placeIntros([["a", "b", "c"]], ["a", "b", "c"])).toEqual([["a", "b", "c"]]);
  });

  it("слово без упражнения — с последней парой карточек; ни одно упражнение не работает с новыми словами — карточки в начале", () => {
    expect(placeIntros([["a"], ["b"], ["c"]], ["a", "b", "c", "x"])).toEqual([
      ["a", "b"],
      [],
      ["c", "x"],
    ]);
    expect(placeIntros([[], []], ["a", "b"])).toEqual([["a", "b"], []]);
  });

  it("без упражнений карточек нет; без новых слов — тоже", () => {
    expect(placeIntros([], ["a"])).toEqual([]);
    expect(placeIntros([["a"]], [])).toEqual([[]]);
  });

  it("слово встречается в упражнении только целиком: «ҡалым» есть в «лөкөм ҡалым», но не в «ҡалымға»", () => {
    expect(containsWords(["лөкөм", "ҡалым"], ["ҡалым"])).toBe(true);
    expect(containsWords(["ҡалымға"], ["ҡалым"])).toBe(false);
    const tiles = lesson("s-l2").exercises.find((e) => e.type === "tiles_ru_ba")!;
    expect(wordsUsedBy(tiles, ["ҡалым", "лөкөм", "һөрөк"])).toEqual(["ҡалым", "лөкөм"]);
  });
});

describe("план урока с карточками (buildPlan)", () => {
  it("новый ученик: карточки перед упражнениями со словами, сквозные id e1…; лишняя плитка не считается упражнением со словом", () => {
    const p = plan("s-l1");
    expect(order(p)).toEqual([
      "[ҡалым]",
      "[һөрөк]",
      "choice_ba_ru",
      "free_ru_ba",
      "[Пәләк тумә!]",
      "[ғүзә]",
      "tiles_ru_ba",
      "[сәңер]",
      "[ҙыйыр]",
      "match_pairs",
    ]);
    expect(p.items.map((i) => i.id)).toEqual(p.items.map((_, k) => `e${k + 1}`));
    expect(p.items.every((i) => i.view.id === i.id)).toBe(true);
  });

  it("карточка — слово словаря с записью, перевод и источник; ключ — без ответа", () => {
    const [card] = plan("s-l1").items;
    expect(card!.view).toEqual({
      id: "e1",
      type: "word_intro",
      review: "needs_native_review",
      sources: word("ҡалым").sources,
      word: {
        text: "ҡалым",
        review: "needs_native_review",
        audio: expect.objectContaining({ url: "/audio/719840da3879d058.m4a" }),
      },
      translationRu: "Значение 1",
    });
    expect(card!.key).toEqual({ type: "intro", wordId: "ҡалым" });
    expect(card!.exerciseId).toBeUndefined();
    expect(card!.words).toBeUndefined();
    expect(isAnswerable(card!)).toBe(false);
  });

  it("на карточку ответить нельзя — 422 answer_type_mismatch", () => {
    const [card] = plan("s-l1").items;
    for (const answer of [
      { type: "choice", optionId: "x" },
      { type: "text", text: "ҡалым" },
    ] as Schema<"AttemptAnswer">[]) {
      expect(() => checkAnswer(card!, answer)).toThrow(ApiError);
      try {
        checkAnswer(card!, answer);
      } catch (e) {
        expect((e as ApiError).code).toBe("answer_type_mismatch");
      }
    }
  });

  it("встреченное слово второй раз не показывается: во втором уроке — только «лөкөм», перед выбором с ним", () => {
    expect(order(plan("s-l2", { met: ["ҡалым"] }))).toEqual([
      "free_ru_ba",
      "[лөкөм]",
      "choice_ba_ru",
      "tiles_ru_ba",
    ]);
    expect(order(plan("s-l2", { met: ["ҡалым", "лөкөм"] }))).toEqual([
      "free_ru_ba",
      "choice_ba_ru",
      "tiles_ru_ba",
    ]);
  });

  it("клиент без карточек (introWords пусто) получает прежний урок: те же упражнения, id e1…e4", () => {
    const p = plan("s-l1", { intro: false });
    expect(p.items.map((i) => [i.id, i.view.type])).toEqual([
      ["e1", "choice_ba_ru"],
      ["e2", "free_ru_ba"],
      ["e3", "tiles_ru_ba"],
      ["e4", "match_pairs"],
    ]);
  });

  it("повторение карточек не показывает и подсказок не даёт", () => {
    const due = lexicon.map((w) => ({ wordId: w.id, reps: 2, stability: w.position }));
    const p = buildReviewPlan({ due, lexicon });
    expect(p.items.length).toBeGreaterThan(0);
    expect(p.items.some((i) => i.view.type === "word_intro" || "hints" in i.view)).toBe(false);
  });
});

describe("плитки проверяют слово фразы (words для повторения)", () => {
  it("у плиток words — слово словаря из ответа, как у других упражнений; тексты плиток в план не просачиваются", () => {
    const tiles = plan("s-l1", { intro: false }).items.find((i) => i.view.type === "tiles_ru_ba")!;
    expect(tiles.words).toEqual(["пәләк тумә"]);
    expect(Object.keys(tiles).sort()).toEqual(["exerciseId", "id", "key", "view", "words"]);
  });
});

describe("подсказки к условию (promptHints)", () => {
  it("слово внутри фразы условия совпало с переводом слова словаря — подсказка с башкирским словом; «Значение 10» — нет: только целые слова", () => {
    const tiles = plan("s-l2").items.find((i) => i.view.type === "tiles_ru_ba")!
      .view as Schema<"TilesExercise">;
    expect(tiles.promptRu).toBe("Значение 9, затем Значение 10");
    expect(tiles.hints).toEqual([{ text: "Значение 9", translation: word("лөкөм").word }]);
  });

  it("подсказки на всё условие нет — она выдала бы ответ: «Напиши по-башкирски: Значение 1» без подсказки", () => {
    const free = plan("s-l2", { met: ["ҡалым", "лөкөм"] }).items[0]!
      .view as Schema<"FreeInputExercise">;
    expect(free.promptRu).toBe("Значение 1");
    expect(free.hints).toBeUndefined();
    // Регистр и знаки не важны: «значение 1!» — тоже всё условие.
    expect(promptHints("значение 1!", [word("ҡалым")])).toEqual([]);
  });

  it("вместо подсказки на всё условие — подсказки к словам внутри фразы", () => {
    const lex = [word("ҡалым"), { ...word("лөкөм"), translationRu: "Значение 1 и 2" }];
    expect(promptHints("Значение 1 и 2.", lex)).toEqual([{ text: "Значение 1", translation: word("ҡалым").word }]);
  });

  it("самое длинное совпадение слева направо, без пересечений; текст — ровно как в условии, по порядку", () => {
    const lex = [
      word("ҡалым"),
      word("һөрөк"),
      { ...word("лөкөм"), translationRu: "Значение 1 и 2" },
    ];
    expect(promptHints("Сначала значение 1 и 2, потом «Значение 2»!", lex)).toEqual([
      { text: "значение 1 и 2", translation: word("лөкөм").word },
      { text: "Значение 2", translation: word("һөрөк").word },
    ]);
  });

  it("у одного перевода несколько слов — сначала то, что есть в принятом ответе, затем первое по курсу", () => {
    const twin = { ...word("лөкөм"), translationRu: "Значение 1" };
    expect(promptHints("Значение 1 и ещё", [word("ҡалым"), twin])[0]!.translation.text).toBe("ҡалым");
    expect(
      promptHints("Значение 1 и ещё", [word("ҡалым"), twin], ["лөкөм ғүзә"])[0]!.translation.text,
    ).toBe("лөкөм");
  });

  it("без словаря (повторение) и в «Испытании места» подсказок нет", () => {
    const p = plan("s-l1", { hints: false });
    expect(p.items.some((i) => "hints" in i.view)).toBe(false);
  });
});
