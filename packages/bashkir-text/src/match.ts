// Проверка ответа ученика (docs/02 §4): correct / almost (только особая буква) / typo (одна опечатка в длинном слове) / wrong.
// Правила — contracts/test-vectors/answer-check/README.md, векторы — answer-check/match.json. Сравнение — только через
// normalize/toComparable/fold этого пакета (CLAUDE.md, правило 7).
import { fold, toComparable } from "./normalize.js";

export type AnswerVerdict = "correct" | "almost" | "typo" | "wrong";

export interface LetterHint {
  /** Нужная буква (строчная). */
  expected: string;
  /** Буква в ответе (строчная). */
  got: string;
  /** Номер слова, с 0. */
  token: number;
  /** Номер буквы в слове, с 0, в кодовых точках формы toComparable. */
  index: number;
}

export interface AnswerMatch {
  verdict: AnswerVerdict;
  /** Индекс совпавшего принятого варианта (нет у wrong). */
  matched?: number;
  /** Подсказка буквы — только у almost. */
  hint?: LetterHint;
}

export type AnswerInput = { kind: "text"; answer: string; accepted: readonly string[] } | { kind: "tiles"; answer: readonly string[]; accepted: readonly string[] };

/** Слово «длинное», если в нём не меньше стольких кодовых точек: в нём прощается одна опечатка. */
export const TYPO_MIN_LENGTH = 5;

const PUNCT = /^\p{P}$/u;
const LETTER = /^[\p{L}\p{M}]$/u;
const IN_WORD_PUNCT = new Set(["-", "'", "’"]);

/** Слова ответа: toComparable → пунктуация (кроме - ' ’ между буквами) → пробел → разбиение. */
export function answerTokens(s: string): string[] {
  const cps = Array.from(toComparable(s));
  const out = cps.map((ch, i) => {
    if (!PUNCT.test(ch)) return ch;
    const keep = IN_WORD_PUNCT.has(ch) && LETTER.test(cps[i - 1] ?? "") && LETTER.test(cps[i + 1] ?? "");
    return keep ? ch : " ";
  });
  return out.join("").split(" ").filter((t) => t.length > 0);
}

const sameTokens = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((t, i) => t === b[i]);

/** Расстояние Дамерау — Левенштейна (оптимальное выравнивание строк) по кодовым точкам. */
export function osaDistance(x: string, y: string): number {
  const a = Array.from(x);
  const b = Array.from(y);
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

function firstDifference(answer: readonly string[], expected: readonly string[]): LetterHint | undefined {
  for (let t = 0; t < expected.length; t++) {
    const a = Array.from(answer[t]!);
    const e = Array.from(expected[t]!);
    for (let i = 0; i < e.length; i++) if (a[i] !== e[i]) return { expected: e[i]!, got: a[i]!, token: t, index: i };
  }
  return undefined;
}

function isTypo(answer: readonly string[], expected: readonly string[]): boolean {
  if (answer.length !== expected.length) return false;
  const differing = expected.map((e, i) => [fold(answer[i]!), fold(e), e] as const).filter(([a, e]) => a !== e);
  if (differing.length !== 1) return false;
  const [a, e, raw] = differing[0]!;
  return Array.from(raw).length >= TYPO_MIN_LENGTH && osaDistance(a, e) === 1;
}

/** Проверка ответа по множеству принятых вариантов (порядок `accepted` — приоритет). */
export function matchAnswer(input: AnswerInput): AnswerMatch {
  const answer = answerTokens(input.kind === "tiles" ? input.answer.join(" ") : input.answer);
  if (answer.length === 0) return { verdict: "wrong" };
  const accepted = input.accepted.map(answerTokens);

  const correct = accepted.findIndex((e) => sameTokens(answer, e));
  if (correct >= 0) return { verdict: "correct", matched: correct };
  if (input.kind === "tiles") return { verdict: "wrong" };

  const folded = answer.map((t) => fold(t));
  for (let i = 0; i < accepted.length; i++) {
    const e = accepted[i]!;
    if (!sameTokens(folded, e.map((t) => fold(t)))) continue;
    const hint = firstDifference(answer, e);
    if (hint) return { verdict: "almost", matched: i, hint };
  }
  const typo = accepted.findIndex((e) => isTypo(answer, e));
  if (typo >= 0) return { verdict: "typo", matched: typo };
  return { verdict: "wrong" };
}
