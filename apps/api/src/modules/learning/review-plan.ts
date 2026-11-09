// План забега повторения — чистая функция (как run-plan.ts). На входе слова, срок которых наступил (карточки FSRS-6
// по порядку: сначала самые просроченные), и словарь курса (модуль content). Упражнения строятся только из строк
// контента — нового башкирского текста здесь не появляется (CLAUDE.md, правило 6): слово, его перевод и слова других
// карточек словаря как лишние варианты.
//
// Форма по слову: при первом повторении (reps = 1, слово только что из урока) — «Что значит это слово?»; дальше —
// активное вспоминание: плитки для фраз из нескольких слов, «Напиши по-башкирски» для отдельных слов. При 5 и больше
// словах 4 самых устойчивых соединяются в «Пары» в конце забега.
import type { Schema } from "@teletau/contracts";
import { tileWords, type WordContent } from "../content/index.js";
import { cryptoRng, LETTER_PANEL, pairsItem, shuffle, type PlanItem, type Rng, type RunPlan } from "./run-plan.js";

/** Сколько слов в одном забеге повторения. */
export const REVIEW_MAX_WORDS = 8;
/** С какого числа слов часть из них идёт в «Пары» и сколько пар. */
export const REVIEW_PAIRS_FROM = 5;
export const REVIEW_PAIRS_SIZE = 4;
/** lessonId забега повторения. */
export const REVIEW_LESSON_ID = "review";
export const REVIEW_TITLE_RU = "Повторение";

export interface DueWord {
  wordId: string;
  reps: number;
  stability: number;
}

/** Перевод для сравнения: регистр, пунктуация и лишние пробелы не важны. */
const meaningKey = (ru: string) =>
  ru
    .toLocaleLowerCase("ru")
    .replace(/[\p{P}\s]+/gu, " ")
    .trim();

const randomId = (rng: Rng) => {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += abc[rng(abc.length)];
  return out;
};

function sourcesOf(list: readonly Schema<"SourceCitation">[]): { sources?: Schema<"SourceCitation">[] } {
  return list.length > 0 ? { sources: [...list] } : {};
}

/** Первые n элементов из перемешанного списка. */
const pick = <T>(xs: readonly T[], n: number, rng: Rng): T[] => shuffle(xs, rng).slice(0, n);

export function buildReviewPlan(input: { due: readonly DueWord[]; lexicon: readonly WordContent[] }, rng: Rng = cryptoRng): RunPlan {
  const byId = new Map(input.lexicon.map((w) => [w.id, w]));
  const due = input.due.filter((d) => byId.has(d.wordId)).slice(0, REVIEW_MAX_WORDS);
  const items: PlanItem[] = [];
  const nextId = () => `e${items.length + 1}`;

  // «Пары»: самые устойчивые слова с разными переводами — в конце забега.
  let paired: DueWord[] = [];
  if (due.length >= REVIEW_PAIRS_FROM) {
    const seen = new Set<string>();
    for (const d of [...due].sort((a, b) => b.stability - a.stability)) {
      const m = meaningKey(byId.get(d.wordId)!.translationRu);
      if (seen.has(m)) continue;
      seen.add(m);
      paired.push(d);
      if (paired.length === REVIEW_PAIRS_SIZE) break;
    }
    if (paired.length < 3) paired = [];
  }
  const pairedIds = new Set(paired.map((d) => d.wordId));

  for (const d of due.filter((x) => !pairedIds.has(x.wordId))) {
    const word = byId.get(d.wordId)!;
    const id = nextId();
    const common = { id, review: word.word.review, ...sourcesOf(word.sources) };
    const meaning = meaningKey(word.translationRu);
    const others = input.lexicon.filter((w) => w.id !== word.id);
    // Синонимы: другие слова словаря с тем же переводом тоже принимаются.
    const accepted = [word.word, ...others.filter((w) => meaningKey(w.translationRu) === meaning).map((w) => w.word)];

    if (d.reps <= 1) {
      const distractors: string[] = [];
      const taken = new Set([meaning]);
      for (const w of shuffle(others, rng)) {
        const m = meaningKey(w.translationRu);
        if (taken.has(m)) continue;
        taken.add(m);
        distractors.push(w.translationRu);
        if (distractors.length === 3) break;
      }
      if (distractors.length >= 2) {
        const options = shuffle(
          [{ id: randomId(rng), textRu: word.translationRu, correct: true }, ...distractors.map((textRu) => ({ id: randomId(rng), textRu, correct: false }))],
          rng,
        );
        items.push({
          id,
          view: {
            ...common,
            type: "choice_ba_ru",
            prompt: word.word.text,
            ...(word.word.audio ? { promptAudio: word.word.audio } : {}),
            options: options.map((o) => ({ id: o.id, textRu: o.textRu })),
          },
          key: { type: "choice", correctOptionId: options.find((o) => o.correct)!.id, meaningRu: word.translationRu },
          words: [word.id],
        });
        continue;
      }
    }

    const answerTiles = tileWords(word.word.text);
    if (answerTiles.length >= 2) {
      const own = new Set(answerTiles.map((t) => t.toLocaleLowerCase("ru")));
      const extra = pick(
        [...new Set(others.flatMap((w) => tileWords(w.word.text)))].filter((t) => !own.has(t.toLocaleLowerCase("ru"))),
        3,
        rng,
      );
      if (extra.length > 0) {
        const tiles = [...answerTiles, ...extra].map((text) => ({ id: randomId(rng), text }));
        let shown = shuffle(tiles, rng);
        for (let i = 0; i < 5 && shown.every((t, k) => t.text === tiles[k]!.text); i++) shown = shuffle(tiles, rng);
        items.push({
          id,
          view: { ...common, type: "tiles_ru_ba", promptRu: word.translationRu, tiles: shown },
          key: { type: "tiles", tiles: Object.fromEntries(tiles.map((t) => [t.id, t.text])), accepted: [word.word], meaningRu: word.translationRu },
          words: [word.id],
        });
        continue;
      }
    }

    items.push({
      id,
      view: { ...common, type: "free_ru_ba", promptRu: word.translationRu, letters: [...LETTER_PANEL] },
      key: { type: "free", accepted, meaningRu: word.translationRu },
      words: [word.id],
    });
  }

  if (paired.length > 0) {
    const words = paired.map((d) => byId.get(d.wordId)!);
    const id = nextId();
    const review = words.every((w) => w.word.review === "native_approved") ? "native_approved" : "needs_native_review";
    const sources = [...new Map(words.flatMap((w) => w.sources).map((c) => [JSON.stringify(c), c])).values()];
    const item = pairsItem(
      id,
      words.map((w) => ({ word: w.word, ru: w.translationRu, wordId: w.id })),
      { id, review, ...sourcesOf(sources) },
      rng,
    );
    if (item) items.push(item);
  }

  return { v: 1, unitId: REVIEW_LESSON_ID, titleRu: REVIEW_TITLE_RU, newWords: [], items };
}
