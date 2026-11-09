// Новое слово сначала показывают, потом проверяют (docs/02 §1, «показать → закрепить → проверить») — чистые функции
// плана забега (run-plan.ts):
// - placeIntros — где в уроке стоят карточки «Новое слово» (word_intro): по две перед первым упражнением со словом,
//   затем упражнения с этими словами, затем следующие слова;
// - promptHints — подсказки к словам условия заданий на перевод с русского.
// Всё — только строки словаря курса (content, с источниками): нового башкирского текста здесь нет (CLAUDE.md,
// правило 6). Слова сравниваются целиком через answerTokens из @teletau/bashkir-text (правило 7) — без угадывания форм:
// «мәктәп» есть в «Урта мәктәп», но не в «мәктәпкә».
import { answerTokens } from "@teletau/bashkir-text";
import type { Schema } from "@teletau/contracts";
import type { BaString, ExerciseContent, WordContent } from "../content/index.js";

/** Сколько карточек «Новое слово» подряд. Больше — только если одно упражнение сразу проверяет больше новых слов. */
export const INTRO_BATCH = 2;
/** Не больше подсказок на одно условие (как maxItems в контракте). */
export const HINTS_MAX = 12;

/** Слова строки подряд — ключ сравнения (как wordKey словаря). */
const tokensOf = (text: string): string[] => answerTokens(text);

/** Есть ли в строке слова needle подряд (целыми словами). */
export function containsWords(hay: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++)
    if (needle.every((t, k) => hay[i + k] === t)) return true;
  return false;
}

/**
 * Башкирские строки, с которыми ученик работает в упражнении: принятые ответы, слово выбора, слова «Пар». Лишние
 * плитки не в счёт — их знать не нужно.
 */
export function exerciseBaTexts(ex: ExerciseContent): string[] {
  const out = ex.answerKey.kind === "accepted" ? ex.answerKey.accepted.map((a) => a.text) : [];
  if (ex.type === "choice_ba_ru") {
    const prompt = ex.payload["prompt"] as BaString | undefined;
    if (prompt) out.push(prompt.text);
  }
  if (ex.type === "match_pairs")
    out.push(
      ...((ex.payload["pairs"] as { ba: BaString }[] | undefined) ?? []).map((p) => p.ba.text),
    );
  return out;
}

/** Какие из слов (id словаря — wordKey, слова через пробел) встречаются в строках упражнения целиком. */
export function wordsUsedBy(ex: ExerciseContent, wordIds: readonly string[]): string[] {
  const texts = exerciseBaTexts(ex).map(tokensOf);
  return wordIds.filter((id) => {
    const needle = id.split(" ").filter(Boolean);
    return texts.some((hay) => containsWords(hay, needle));
  });
}

/**
 * Где стоят карточки: `uses[i]` — новые слова, с которыми работает i-е упражнение урока (по порядку показа), `words` —
 * новые слова урока (порядок new_words). Ответ — слова карточек перед каждым упражнением (`before[i]`).
 *
 * Перед упражнением, где есть ещё не показанное слово, — все его такие слова, добранные до INTRO_BATCH следующими по
 * первому упражнению. Слова, которых нет ни в одном упражнении, идут с последней парой карточек (их проверит повторение,
 * поэтому показать их надо); если ни одно упражнение не работает с новыми словами — все карточки в начале урока.
 * Без упражнений карточек нет: урок из одних карточек ничего не проверяет.
 */
export function placeIntros(
  uses: readonly (readonly string[])[],
  words: readonly string[],
  batchSize: number = INTRO_BATCH,
): string[][] {
  const before: string[][] = uses.map(() => []);
  if (uses.length === 0 || words.length === 0) return before;
  const known = new Set(words);
  const firstUse = new Map<string, number>();
  uses.forEach((ids, i) =>
    ids.forEach((id) => known.has(id) && !firstUse.has(id) && firstUse.set(id, i)),
  );
  const rank = (id: string) => firstUse.get(id) ?? Number.POSITIVE_INFINITY;
  // Порядок показа: по первому упражнению со словом, внутри — как в new_words; слова без упражнений — в конце.
  let pending = [...words]
    .map((id, k) => ({ id, k }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.k - b.k)
    .map((w) => w.id);
  const usedLater = (id: string, after: number) =>
    uses.some((ids, j) => j > after && ids.includes(id));

  for (let i = 0; i < uses.length && pending.length > 0; i++) {
    const need = pending.filter((id) => uses[i]!.includes(id));
    if (need.length === 0) continue;
    const batch = [...need];
    for (const id of pending) {
      if (batch.length >= batchSize) break;
      if (!batch.includes(id)) batch.push(id);
    }
    pending = pending.filter((id) => !batch.includes(id));
    // Последняя пара: дальше ни одно упражнение не работает с оставшимися словами — они идут сейчас.
    if (pending.every((id) => !usedLater(id, i))) {
      batch.push(...pending);
      pending = [];
    }
    before[i] = batch;
  }
  if (pending.length > 0) before[0] = [...pending, ...before[0]!];
  return before;
}

interface Span {
  start: number;
  end: number;
  key: string;
}

/** Слова русской строки с позициями: буквы и цифры, дефис и апостроф внутри слова. */
const WORD = /[\p{L}\p{M}\p{N}]+(?:[-'’][\p{L}\p{M}\p{N}]+)*/gu;

function spansOf(text: string): Span[] {
  return [...text.matchAll(WORD)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    key: tokensOf(m[0]).join(" "),
  }));
}

/**
 * Подсказки к словам русского условия: слово или фраза условия, совпавшие с переводом слова словаря целиком (самое
 * длинное совпадение слева направо, без пересечений). Перевод — башкирское слово словаря; у одного перевода несколько
 * слов — сначала то, что есть в принятом ответе, затем первое по курсу. Подсказки на всё условие нет (без учёта
 * регистра и знаков): она выдала бы ответ, а вспомнить слово — и есть задание; вместо неё — подсказки к словам внутри.
 */
export function promptHints(
  promptRu: string,
  lexicon: readonly WordContent[],
  answers: readonly string[] = [],
): Schema<"PromptHint">[] {
  const spans = spansOf(promptRu);
  if (spans.length === 0 || lexicon.length === 0) return [];
  const answerWords = answers.map(tokensOf);
  const inAnswer = (w: WordContent) =>
    answerWords.some((hay) => containsWords(hay, tokensOf(w.word.text)));
  const byFirst = new Map<string, { tokens: string[]; word: WordContent }[]>();
  for (const word of lexicon) {
    const tokens = tokensOf(word.translationRu);
    if (tokens.length === 0) continue;
    const list = byFirst.get(tokens[0]!) ?? [];
    list.push({ tokens, word });
    byFirst.set(tokens[0]!, list);
  }
  const better = (a: WordContent, b: WordContent) =>
    inAnswer(a) !== inAnswer(b) ? inAnswer(a) : a.position < b.position;

  const out: Schema<"PromptHint">[] = [];
  for (let i = 0; i < spans.length && out.length < HINTS_MAX;) {
    let best: { len: number; word: WordContent } | undefined;
    for (const c of byFirst.get(spans[i]!.key) ?? []) {
      if (i + c.tokens.length > spans.length || !c.tokens.every((t, k) => spans[i + k]!.key === t))
        continue;
      if (i === 0 && c.tokens.length === spans.length) continue;
      if (
        !best ||
        c.tokens.length > best.len ||
        (c.tokens.length === best.len && better(c.word, best.word))
      )
        best = { len: c.tokens.length, word: c.word };
    }
    if (!best) {
      i++;
      continue;
    }
    out.push({
      text: promptRu.slice(spans[i]!.start, spans[i + best.len - 1]!.end),
      translation: best.word.word,
    });
    i += best.len;
  }
  return out;
}
