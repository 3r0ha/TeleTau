// Повторение слов (FSRS-6), «Мой словарь», «Пары» и записи произношения — чистые функции без базы:
// импорт словаря курса и «Пар» (content-import.ts), план забега повторения (review-plan.ts), проверка «Пар» и оценки
// слов (run-plan.ts). Строки — синтетические (test/fixtures/content-srs: сочетания букв, не слова языка — правило 6).
import { fileURLToPath } from "node:url";
import type { Schema } from "@teletau/contracts";
import { describe, expect, it } from "vitest";
import { buildCourse, readContent, wordKey } from "../src/modules/content/content-import.js";
import type { WordContent } from "../src/modules/content/index.js";
import { buildReviewPlan, REVIEW_MAX_WORDS, type DueWord } from "../src/modules/learning/review-plan.js";
import { buildPlan, checkAnswer, wordVerdicts, type Rng } from "../src/modules/learning/run-plan.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/content-srs/", import.meta.url));
const bundle = () => buildCourse(readContent(FIXTURE)[0]!);

/** Детерминированный ГСЧ (LCG) — перемешивание повторяемо. */
function seeded(seed = 7): Rng {
  let x = seed >>> 0;
  return (n) => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x % n;
  };
}

describe("content import — словарь курса, «Пары», записи", () => {
  it("слова new_words с переводом: свой ru, иначе русская сторона упражнения; одно слово при разной пунктуации", () => {
    const words = bundle().words;
    expect(words.map((w) => [w.id, w.text, w.translationRu, w.lessonId])).toEqual([
      ["ҡалым", "ҡалым", "Значение 1", "s-l1"],
      ["һөрөк", "һөрөк", "Значение 2", "s-l1"],
      ["пәләк тумә", "Пәләк тумә!", "Значение 6", "s-l1"],
      ["ғүзә", "ғүзә", "Значение 3", "s-l1"],
      ["сәңер", "сәңер", "Значение 4", "s-l1"],
      ["ҙыйыр", "ҙыйыр", "Значение 5", "s-l1"],
      ["лөкөм", "лөкөм", "Значение 9", "s-l2"],
    ]);
    expect(words.map((w) => w.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Одна строка проверена носителем, другая (лишняя плитка) — нет: у слова худший статус.
    expect(words.find((w) => w.id === "сәңер")?.review).toBe("needs_native_review");
    expect(wordKey("Ҡалым.")).toBe(wordKey("ҡалым"));
  });

  it("запись произношения — у строки, слова и нового слова урока: копия на нашем сайте (m4a и ogg), только с Wikimedia Commons", () => {
    const b = bundle();
    // Копия test/fixtures/content-srs/audio/Synthetic-s1.ogg: id — первые 16 hex SHA-256 файла (как у prepare-audio).
    const audio = {
      url: "/audio/719840da3879d058.m4a",
      files: [
        { url: "/audio/719840da3879d058.m4a", type: 'audio/mp4; codecs="mp4a.40.2"' },
        { url: "/audio/719840da3879d058.ogg", type: 'audio/ogg; codecs="vorbis"' },
      ],
      source: expect.objectContaining({ title: "Синтетический набор для тестов", locator: "запись 1", license: "CC BY-SA 4.0" }),
    };
    expect(b.words[0]!.audio).toEqual(audio);
    expect(b.words[1]!.audio).toBeNull();
    expect(b.lessons.find((l) => l.id === "s-l1")!.newWords[0]).toEqual({ text: "ҡалым", review: "needs_native_review", audio });
    const choice = b.exercises.find((e) => e.id === "s-l1-choice")!;
    expect((choice.payload["prompt"] as Schema<"BaString">).audio).toEqual(audio);

    const files = readContent(FIXTURE)[0]!;
    const lesson = structuredClone(files.lessons["s-l1"]) as { exercises: { prompt?: { audio?: { url: string } } }[] };
    lesson.exercises[0]!.prompt!.audio!.url = "https://example.org/voice.ogg";
    expect(() => buildCourse({ ...files, lessons: { ...files.lessons, "s-l1": lesson } })).toThrow(/Wikimedia Commons/);
    // Нет копии записи в content/audio — импорт не проходит.
    expect(() => buildCourse({ ...files, audio: {} })).toThrow(/нет копии записи content\/audio\/Synthetic-s1\.ogg/);
  });

  it("«Пары»: пары по порядку в payload, отклонённая носителем пара убирается, ключ — порядок", () => {
    const pairs = bundle().exercises.find((e) => e.id === "s-l1-pairs")!;
    expect(pairs.type).toBe("match_pairs");
    expect(pairs.answerKey).toEqual({ kind: "pairs" });
    expect((pairs.payload["pairs"] as { ba: Schema<"BaString">; ru: string }[]).map((p) => [p.ba.text, p.ru])).toEqual([
      ["ғүзә", "Значение 3"],
      ["сәңер", "Значение 4"],
      ["ҙыйыр", "Значение 5"],
    ]);
    expect(pairs.review).toBe("needs_native_review");
    expect(bundle().skipped.strings).toBeGreaterThanOrEqual(1);
  });
});

const pairsExercise = () => {
  const b = bundle();
  const e = b.exercises.find((x) => x.id === "s-l1-pairs")!;
  return {
    id: e.id,
    position: 1,
    type: e.type,
    payload: e.payload,
    answerKey: e.answerKey as { kind: "pairs" },
    review: e.review,
    sources: [],
    words: ["ғүзә", "сәңер", "ҙыйыр"],
  };
};

describe("«Пары» в забеге: перемешивание, проверка, оценки слов", () => {
  const plan = buildPlan({ unitId: "s-u1", titleRu: "t", newWords: [], exercises: [pairsExercise()], duels: new Map() }, seeded());
  const item = plan.items[0]!;
  const view = item.view as Schema<"MatchPairsExercise">;
  const rightOf = (text: string) => view.right.find((r) => r.textRu === { ғүзә: "Значение 3", сәңер: "Значение 4", ҙыйыр: "Значение 5" }[text])!.id;

  it("клиент видит обе стороны с непрозрачными id; переводы не стоят все напротив своих слов", () => {
    expect(view.type).toBe("match_pairs");
    expect(view.left.map((w) => w.text).sort()).toEqual(["ғүзә", "ҙыйыр", "сәңер"].sort());
    expect(view.right.map((r) => r.textRu).sort()).toEqual(["Значение 3", "Значение 4", "Значение 5"]);
    expect(view.left.every((w, i) => rightOf(w.text) === view.right[i]!.id)).toBe(false);
    expect(new Set([...view.left, ...view.right].map((x) => x.id)).size).toBe(6);
  });

  it("все пары верно — correct; одна путаница — wrong, верные пары в ответе и оценка по каждому слову", () => {
    const ok = checkAnswer(item, { type: "pairs", pairs: view.left.map((w) => ({ left: w.id, right: rightOf(w.text) })) });
    expect(ok.verdict).toBe("correct");
    expect(ok.correctPairs).toHaveLength(3);
    expect([...wordVerdicts(item, ok).values()]).toEqual(["correct", "correct", "correct"]);

    const [a, b, c] = view.left;
    const mixed = checkAnswer(item, {
      type: "pairs",
      pairs: [
        { left: a!.id, right: rightOf(b!.text) },
        { left: b!.id, right: rightOf(a!.text) },
        { left: c!.id, right: rightOf(c!.text) },
      ],
    });
    expect(mixed.verdict).toBe("wrong");
    expect(mixed.correctPairs).toEqual(view.left.map((w) => ({ left: w.id, right: rightOf(w.text) })));
    const byWord = wordVerdicts(item, mixed);
    expect(byWord.get(a!.text)).toBe("wrong");
    expect(byWord.get(b!.text)).toBe("wrong");
    expect(byWord.get(c!.text)).toBe("correct");
  });

  it("не все пары, повтор стороны или чужой id — 422 pairs_incomplete", () => {
    const [a, b] = view.left;
    const bad = [
      [{ left: a!.id, right: rightOf(a!.text) }],
      view.left.map((w) => ({ left: w.id, right: rightOf(a!.text) })),
      view.left.map((w) => ({ left: w.id === a!.id ? "чужой" : w.id, right: rightOf(w.text) })),
      [...view.left.map((w) => ({ left: w.id, right: rightOf(w.text) })), { left: b!.id, right: rightOf(b!.text) }],
    ];
    for (const pairs of bad) expect(() => checkAnswer(item, { type: "pairs", pairs })).toThrow(expect.objectContaining({ status: 422, code: "pairs_incomplete" }));
  });
});

/** Словарь из импорта в форме ContentService.words(). */
const lexicon = (): WordContent[] =>
  bundle().words.map((w) => ({
    id: w.id,
    position: w.position,
    word: { text: w.text, review: w.review, ...(w.audio ? { audio: w.audio } : {}) },
    translationRu: w.translationRu,
    sources: w.sources,
    lessonId: w.lessonId,
  }));

describe("план повторения", () => {
  const due = (ids: string[], reps = 1): DueWord[] => ids.map((wordId, i) => ({ wordId, reps, stability: 1 + i }));

  it("первое повторение — «Что значит это слово?» с переводом среди чужих переводов, запись — у слова", () => {
    const plan = buildReviewPlan({ due: due(["ҡалым"]), lexicon: lexicon() }, seeded());
    expect(plan).toMatchObject({ unitId: "review", titleRu: "Повторение", newWords: [] });
    const item = plan.items[0]!;
    const view = item.view as Schema<"ChoiceExercise">;
    expect(view).toMatchObject({ type: "choice_ba_ru", prompt: "ҡалым", review: "needs_native_review" });
    expect(view.promptAudio?.url).toBe("/audio/719840da3879d058.m4a");
    expect(view.options.map((o) => o.textRu)).toContain("Значение 1");
    expect(new Set(view.options.map((o) => o.textRu)).size).toBe(view.options.length);
    expect(item.words).toEqual(["ҡалым"]);
    const right = view.options.find((o) => o.textRu === "Значение 1")!;
    expect(checkAnswer(item, { type: "choice", optionId: right.id }).verdict).toBe("correct");
  });

  it("дальше — вспоминание: фраза плитками (с лишними словами из словаря), слово — вводом с панелью букв", () => {
    const plan = buildReviewPlan({ due: due(["пәләк тумә", "һөрөк"], 3), lexicon: lexicon() }, seeded());
    const [tiles, free] = plan.items;
    expect(tiles!.view).toMatchObject({ type: "tiles_ru_ba", promptRu: "Значение 6" });
    const tileTexts = (tiles!.view as Schema<"TilesExercise">).tiles.map((t) => t.text);
    expect(tileTexts).toEqual(expect.arrayContaining(["Пәләк", "тумә"]));
    expect(tileTexts.length).toBeGreaterThan(2);
    expect(free!.view).toMatchObject({ type: "free_ru_ba", promptRu: "Значение 2" });
    expect(checkAnswer(free!, { type: "text", text: "Һөрөк!" }).verdict).toBe("correct");
    expect(checkAnswer(free!, { type: "text", text: "хөрөк" }).verdict).toBe("almost");
  });

  it("5 и больше слов — 4 самых устойчивых в «Пары» в конце; не больше 8 слов; слова вне словаря пропускаются", () => {
    const all = ["ҡалым", "һөрөк", "пәләк тумә", "ғүзә", "сәңер", "ҙыйыр", "лөкөм", "нет-в-словаре"];
    const plan = buildReviewPlan({ due: due(all, 2), lexicon: lexicon() }, seeded());
    const last = plan.items.at(-1)!;
    expect(last.view.type).toBe("match_pairs");
    // Устойчивость растёт с индексом: самые устойчивые — последние 4 слова словаря.
    expect([...(last.words ?? [])].sort()).toEqual(["ғүзә", "лөкөм", "сәңер", "ҙыйыр"].sort());
    expect(plan.items).toHaveLength(4);
    const words = plan.items.flatMap((i) => i.words ?? []);
    expect(words).toHaveLength(7);
    expect(new Set(words).size).toBe(7);
    expect(REVIEW_MAX_WORDS).toBe(8);
  });

  it("повторять нечего — забег без упражнений", () => {
    expect(buildReviewPlan({ due: [], lexicon: lexicon() }).items).toEqual([]);
  });
});
