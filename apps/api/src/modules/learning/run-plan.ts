// План забега и проверка ответа — чистые функции. План хранится в lesson_runs.plan (только на сервере): упражнения
// в порядке показа ровно в том виде, в каком их видел ученик (перемешанные плитки и варианты с непрозрачными id,
// стороны дуэли), и ключи проверки. Поэтому ответ проверяется по тому, что было показано, даже если контент
// обновился во время урока. Проверка — matchAnswer из @teletau/bashkir-text (векторы contracts/test-vectors/answer-check).
import { randomBytes, randomInt } from "node:crypto";
import type { Schema } from "@teletau/contracts";
import { FOLD_MAP, matchAnswer } from "@teletau/bashkir-text";
import type { GradedVerdict, Verdict } from "@teletau/domain-rules";
import { invalidField, unprocessable } from "../../common/problem.js";
import type { DuelCard } from "../consensus/index.js";
import {
  wordKey,
  type BaString,
  type ExerciseContent,
  type SourceCitation,
  type WordContent,
} from "../content/index.js";
import { placeIntros, promptHints, wordsUsedBy } from "./word-intro.js";

export type RunExercise = Schema<"RunExercise">;
export type AttemptAnswer = Schema<"AttemptAnswer">;

export type PlanKey =
  | { type: "tiles"; tiles: Record<string, string>; accepted: BaString[]; meaningRu?: string }
  | { type: "choice"; correctOptionId: string; meaningRu?: string }
  | { type: "free"; accepted: BaString[]; meaningRu?: string }
  | { type: "duel"; itemId: string; shown: [string, string] }
  /** pairs — верный перевод (id справа) для каждого слова (id слева); wordOf — слово словаря за словом слева. */
  | { type: "pairs"; pairs: Record<string, string>; wordOf: Record<string, string> }
  /** Карточка «Новое слово» (word_intro): ответа нет — на мёд, точность и повторение не влияет. */
  | { type: "intro"; wordId: string };

/** Упражнение, на которое отвечают (всё, кроме карточек «Новое слово»). */
export const isAnswerable = (item: PlanItem): boolean => item.key.type !== "intro";

export interface PlanItem {
  /** Идентификатор упражнения в забеге (exerciseId API). */
  id: string;
  /** Упражнение контента; у дуэлей узла «Помоги языку» — нет. */
  exerciseId?: string;
  view: RunExercise;
  key: PlanKey;
  /** Слова словаря, которые проверяет упражнение: по первой попытке они получают оценку FSRS. */
  words?: string[];
}

export interface RunPlan {
  v: 1;
  unitId: string;
  titleRu: string;
  newWords: BaString[];
  /** Слова словаря из new_words урока — при завершении урока попадают в повторение. */
  wordIds?: string[];
  items: PlanItem[];
}

/** Случайное целое из [0, n). */
export type Rng = (n: number) => number;
export const cryptoRng: Rng = (n) => randomInt(n);

/** Панель букв: особые буквы башкирского алфавита (строчные) — те, что сворачивает bashkir-text, кроме ё. */
export const LETTER_PANEL: readonly string[] = [...FOLD_MAP.keys()]
  .map((cp) => String.fromCodePoint(cp))
  .filter((ch) => ch !== "ё" && ch === ch.toLowerCase());

export function shuffle<T>(xs: readonly T[], rng: Rng): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Перемешивание, которое не оставляет исходный порядок (если элементов больше одного и они различимы). */
function shuffleAway<T>(
  xs: readonly T[],
  rng: Rng,
  same: (a: readonly T[], b: readonly T[]) => boolean,
): T[] {
  let out = shuffle(xs, rng);
  for (let i = 0; i < 5 && xs.length > 1 && same(out, xs); i++) out = shuffle(xs, rng);
  return out;
}

const opaqueId = () => randomBytes(6).toString("base64url");

function sourcesOf(list: readonly SourceCitation[]): { sources?: SourceCitation[] } {
  return list.length > 0 ? { sources: [...list] } : {};
}

interface PlanInput {
  unitId: string;
  titleRu: string;
  newWords: readonly BaString[];
  wordIds?: readonly string[];
  exercises: readonly ExerciseContent[];
  /** Дуэль для упражнения duel (ключ — id упражнения); нет дуэли — упражнение пропускается. */
  duels: ReadonlyMap<string, DuelCard>;
  /** «Помоги языку»: дуэли узла (упражнений контента у него нет). */
  extraDuels?: readonly DuelCard[];
  /** Слова урока, которых ученик ещё не встречал, по порядку new_words, — карточки «Новое слово». Нет — без карточек. */
  introWords?: readonly WordContent[];
  /** Словарь курса — подсказки к словам условия заданий на перевод с русского. Нет — без подсказок. */
  lexicon?: readonly WordContent[];
}

function introItem(id: string, w: WordContent): PlanItem {
  return {
    id,
    view: {
      id,
      type: "word_intro",
      review: w.word.review,
      ...sourcesOf(w.sources),
      word: w.word,
      translationRu: w.translationRu,
    },
    key: { type: "intro", wordId: w.id },
  };
}

/** Подсказки к условию (если есть совпадения со словарём). */
function hintsOf(
  promptRu: string,
  lexicon: readonly WordContent[] | undefined,
  answers: readonly BaString[],
): { hints?: Schema<"PromptHint">[] } {
  if (!lexicon?.length) return {};
  const hints = promptHints(
    promptRu,
    lexicon,
    answers.map((a) => a.text),
  );
  return hints.length ? { hints } : {};
}

/** Номер упражнения в забеге (e1, e2, …) — по порядку показа, вместе с карточками. */
function renumber(item: PlanItem, id: string): PlanItem {
  return { ...item, id, view: { ...item.view, id } };
}

function duelItem(id: string, card: DuelCard, exerciseId?: string): PlanItem {
  return {
    id,
    ...(exerciseId ? { exerciseId } : {}),
    view: {
      id,
      type: "duel",
      review: card.review,
      ...sourcesOf(card.sources),
      itemId: card.itemId,
      sourceRu: card.sourceRu,
      a: card.a.text,
      b: card.b.text,
    },
    key: { type: "duel", itemId: card.itemId, shown: [card.a.variantId, card.b.variantId] },
  };
}

export function buildPlan(input: PlanInput, rng: Rng = cryptoRng): RunPlan {
  // Сначала упражнения контента (id — временные), затем между ними — карточки «Новое слово» и сквозная нумерация.
  const items: PlanItem[] = [];
  /** Упражнения контента, из которых собраны items (по одному на каждый). */
  const shownFrom: ExerciseContent[] = [];
  const nextId = () => `e${items.length + 1}`;
  const buildExercise = (ex: ExerciseContent): void => {
    const id = nextId();
    const p = ex.payload;
    const common = { id, review: ex.review, ...sourcesOf(ex.sources) };
    const meaning = ex.meaningRu ? { meaningRu: ex.meaningRu } : {};
    const words = ex.words?.length ? { words: [...ex.words] } : {};
    switch (ex.type) {
      case "tiles_ru_ba": {
        if (ex.answerKey.kind !== "accepted") return;
        const promptRu = String(p["promptRu"] ?? "");
        // Тексты плиток (не путать с words — словами словаря, которые проверяет упражнение).
        const tileTexts = (p["tiles"] as string[] | undefined) ?? [];
        const tiles = tileTexts.map((text) => ({ id: opaqueId(), text }));
        const shown = shuffleAway(tiles, rng, (a, b) => a.every((t, i) => t.text === b[i]!.text));
        items.push({
          id,
          exerciseId: ex.id,
          view: {
            ...common,
            type: "tiles_ru_ba",
            promptRu,
            ...hintsOf(promptRu, input.lexicon, ex.answerKey.accepted),
            tiles: shown,
          },
          key: {
            type: "tiles",
            tiles: Object.fromEntries(tiles.map((t) => [t.id, t.text])),
            accepted: ex.answerKey.accepted,
            ...meaning,
          },
          ...words,
        });
        break;
      }
      case "choice_ba_ru": {
        if (ex.answerKey.kind !== "choice") return;
        const correct = ex.answerKey.correct;
        const options = ((p["optionsRu"] as string[] | undefined) ?? []).map((textRu, i) => ({
          id: opaqueId(),
          textRu,
          correct: i === correct,
        }));
        const prompt = p["prompt"] as BaString | undefined;
        const correctOption = options.find((o) => o.correct);
        if (!prompt || !correctOption) return;
        items.push({
          id,
          exerciseId: ex.id,
          view: {
            ...common,
            type: "choice_ba_ru",
            prompt: prompt.text,
            ...(prompt.audio ? { promptAudio: prompt.audio } : {}),
            options: shuffle(options, rng).map((o) => ({ id: o.id, textRu: o.textRu })),
          },
          key: { type: "choice", correctOptionId: correctOption.id, ...meaning },
          ...words,
        });
        break;
      }
      case "free_ru_ba": {
        if (ex.answerKey.kind !== "accepted") return;
        const promptRu = String(p["promptRu"] ?? "");
        items.push({
          id,
          exerciseId: ex.id,
          view: {
            ...common,
            type: "free_ru_ba",
            promptRu,
            ...hintsOf(promptRu, input.lexicon, ex.answerKey.accepted),
            letters: [...LETTER_PANEL],
          },
          key: { type: "free", accepted: ex.answerKey.accepted, ...meaning },
          ...words,
        });
        break;
      }
      case "duel": {
        const card = input.duels.get(ex.id);
        if (card) items.push(duelItem(id, card, ex.id));
        break;
      }
      case "match_pairs": {
        if (ex.answerKey.kind !== "pairs") return;
        const pairs = ((p["pairs"] as { ba: BaString; ru: string }[] | undefined) ?? []).map(
          (pair) => ({ word: pair.ba, ru: pair.ru }),
        );
        const known = new Set(ex.words ?? []);
        const item = pairsItem(
          id,
          pairs.map((pair) => ({
            ...pair,
            wordId: known.has(wordKey(pair.word.text)) ? wordKey(pair.word.text) : undefined,
          })),
          common,
          rng,
        );
        if (item) items.push({ ...item, exerciseId: ex.id, ...words });
        break;
      }
    }
  };
  for (const ex of input.exercises) {
    const count = items.length;
    buildExercise(ex);
    if (items.length > count) shownFrom.push(ex);
  }

  const intro = input.introWords ?? [];
  const introIds = intro.map((w) => w.id);
  const before = placeIntros(
    shownFrom.map((ex) => wordsUsedBy(ex, introIds)),
    introIds,
  );
  const byId = new Map(intro.map((w) => [w.id, w]));
  const ordered: PlanItem[] = [];
  const id = () => `e${ordered.length + 1}`;
  items.forEach((item, i) => {
    for (const wordId of before[i] ?? []) ordered.push(introItem(id(), byId.get(wordId)!));
    ordered.push(renumber(item, id()));
  });
  for (const card of input.extraDuels ?? []) ordered.push(duelItem(id(), card));
  return {
    v: 1,
    unitId: input.unitId,
    titleRu: input.titleRu,
    newWords: [...input.newWords],
    ...(input.wordIds?.length ? { wordIds: [...input.wordIds] } : {}),
    items: ordered,
  };
}

/** Пара для упражнения «Пары»: башкирское слово, перевод и (если есть) слово словаря. */
export interface PairSource {
  word: BaString;
  ru: string;
  wordId?: string;
}

/**
 * Упражнение «Пары»: обе стороны перемешаны (правая — так, чтобы не совпадать с левой построчно), у каждой стороны —
 * непрозрачные id; ключ — какой перевод у какого слова. Меньше двух пар — упражнения нет.
 */
export function pairsItem(
  id: string,
  pairs: readonly PairSource[],
  common: { id: string; review: Schema<"ReviewStatus">; sources?: SourceCitation[] },
  rng: Rng,
): PlanItem | undefined {
  if (pairs.length < 2) return undefined;
  const rows = pairs.map((p) => ({ leftId: opaqueId(), rightId: opaqueId(), ...p }));
  const left = shuffle(rows, rng);
  const right = shuffleAway(left, rng, (a, b) => a.every((r, i) => r.rightId === b[i]!.rightId));
  const wordOf: Record<string, string> = {};
  for (const r of rows) if (r.wordId) wordOf[r.leftId] = r.wordId;
  return {
    id,
    view: {
      ...common,
      type: "match_pairs",
      left: left.map((r) => ({
        id: r.leftId,
        text: r.word.text,
        ...(r.word.audio ? { audio: r.word.audio } : {}),
      })),
      right: right.map((r) => ({ id: r.rightId, textRu: r.ru })),
    },
    key: {
      type: "pairs",
      pairs: Object.fromEntries(rows.map((r) => [r.leftId, r.rightId])),
      wordOf,
    },
    ...(Object.keys(wordOf).length ? { words: [...new Set(Object.values(wordOf))] } : {}),
  };
}

/** Какой вид ответа подходит к упражнению; у карточки «Новое слово» ответа нет. */
const ANSWER_TYPE: Record<PlanKey["type"], AttemptAnswer["type"] | undefined> = {
  tiles: "tiles",
  choice: "choice",
  free: "text",
  duel: "duel",
  pairs: "pairs",
  intro: undefined,
};

export interface CheckedAnswer {
  verdict: Verdict;
  correctAnswer?: BaString;
  correctOptionId?: string;
  meaningRu?: string;
  hint?: Schema<"LetterHint">;
  correctPairs?: Schema<"PairMatch">[];
  /** «Пары»: вердикт по каждому слову слева (верно ли соединено). */
  pairVerdicts?: Record<string, "correct" | "wrong">;
}

/** Проверка ответа по плану. Дуэль не оценивается — `recorded` (голос пишет вызывающий). */
export function checkAnswer(item: PlanItem, answer: AttemptAnswer): CheckedAnswer {
  const key = item.key;
  if (answer.type !== ANSWER_TYPE[key.type]) throw unprocessable("answer_type_mismatch");
  const meaning = "meaningRu" in key && key.meaningRu ? { meaningRu: key.meaningRu } : {};
  switch (key.type) {
    case "intro":
      throw unprocessable("answer_type_mismatch");
    case "duel":
      return { verdict: "recorded" };
    case "choice": {
      const optionId = (answer as Schema<"ChoiceAnswer">).optionId;
      const view = item.view as Schema<"ChoiceExercise">;
      if (!view.options.some((o) => o.id === optionId))
        throw invalidField("/answer/optionId", "Такого варианта нет в задании");
      return {
        verdict: optionId === key.correctOptionId ? "correct" : "wrong",
        correctOptionId: key.correctOptionId,
        ...meaning,
      };
    }
    case "tiles": {
      const ids = (answer as Schema<"TilesAnswer">).tileIds;
      const seen = new Set<string>();
      const texts = ids.map((tileId, i) => {
        const text = key.tiles[tileId];
        if (text === undefined)
          throw invalidField(`/answer/tileIds/${i}`, "Такой плитки нет в задании");
        if (seen.has(tileId)) throw invalidField(`/answer/tileIds/${i}`, "Плитка выбрана дважды");
        seen.add(tileId);
        return text;
      });
      const m = matchAnswer({
        kind: "tiles",
        answer: texts,
        accepted: key.accepted.map((a) => a.text),
      });
      return { verdict: m.verdict, correctAnswer: key.accepted[m.matched ?? 0]!, ...meaning };
    }
    case "free": {
      const m = matchAnswer({
        kind: "text",
        answer: (answer as Schema<"TextAnswer">).text,
        accepted: key.accepted.map((a) => a.text),
      });
      return {
        verdict: m.verdict,
        correctAnswer: key.accepted[m.matched ?? 0]!,
        ...(m.hint ? { hint: m.hint } : {}),
        ...meaning,
      };
    }
    case "pairs": {
      // Все пары сразу: каждое слово слева и каждый перевод справа — ровно один раз.
      const links = (answer as Schema<"PairsAnswer">).pairs;
      const rights = new Set(Object.values(key.pairs));
      const seenLeft = new Set<string>();
      const seenRight = new Set<string>();
      for (const l of links) {
        if (
          !(l.left in key.pairs) ||
          !rights.has(l.right) ||
          seenLeft.has(l.left) ||
          seenRight.has(l.right)
        )
          throw unprocessable("pairs_incomplete");
        seenLeft.add(l.left);
        seenRight.add(l.right);
      }
      if (seenLeft.size !== Object.keys(key.pairs).length) throw unprocessable("pairs_incomplete");
      const pairVerdicts: Record<string, "correct" | "wrong"> = {};
      for (const l of links)
        pairVerdicts[l.left] = key.pairs[l.left] === l.right ? "correct" : "wrong";
      const verdict = Object.values(pairVerdicts).every((v) => v === "correct")
        ? "correct"
        : "wrong";
      const order = (item.view as Schema<"MatchPairsExercise">).left.map((w) => w.id);
      return {
        verdict,
        correctPairs: order.map((left) => ({ left, right: key.pairs[left]! })),
        pairVerdicts,
      };
    }
  }
}

/**
 * Вердикт первой попытки по каждому слову словаря, которое проверяет упражнение: у «Пар» — по своей паре, у остальных —
 * вердикт упражнения. Дуэль слов не проверяет.
 */
export function wordVerdicts(item: PlanItem, checked: CheckedAnswer): Map<string, GradedVerdict> {
  const out = new Map<string, GradedVerdict>();
  if (checked.verdict === "recorded" || !item.words?.length) return out;
  if (item.key.type === "pairs") {
    for (const [left, wordId] of Object.entries(item.key.wordOf))
      out.set(wordId, checked.pairVerdicts?.[left] ?? "wrong");
    return out;
  }
  for (const w of item.words) out.set(w, checked.verdict);
  return out;
}

/** Засчитывается ли первая попытка как верная (almost и typo — да; векторы xp). */
export const isCredited = (v: Verdict): boolean =>
  v === "correct" || v === "almost" || v === "typo";

/**
 * Сколько раз упражнение возвращается после ошибки (docs/02 §3): одно повторение в конце урока, после второй ошибки —
 * верный ответ и дальше. Слово при этом уходит в повторение (FSRS, Again — по первой попытке).
 */
export const RETRIES_PER_EXERCISE = 1;

/**
 * Вернётся ли упражнение в конце урока (AttemptResult.retry): только неверный ответ и только пока повторы не исчерпаны.
 * `priorAttempts` — сколько попыток по этому упражнению забега было до этой. Решает сервер — клиенты (веб, iOS, Android)
 * только следуют флагу, поэтому урок конечен при любых ответах.
 */
export const shouldRetry = (verdict: Verdict, priorAttempts: number): boolean =>
  verdict === "wrong" && priorAttempts < RETRIES_PER_EXERCISE;

/**
 * Сколько уроков (lesson и «Испытание места») ученик проходит, прежде чем в уроке появится дуэль (docs/02 §3): в первых
 * двух уроках дуэлей нет — новичок, который только что увидел первые слова, не может судить, какой перевод естественнее.
 * Узлы «Помоги языку» правило не трогает: туда приходят по своей воле.
 */
export const LESSONS_BEFORE_DUELS = 2;

/** Можно ли дать дуэль в уроке ученику, прошедшему `lessonsPassed` разных уроков. */
export const lessonDuelsAllowed = (lessonsPassed: number): boolean =>
  lessonsPassed >= LESSONS_BEFORE_DUELS;
