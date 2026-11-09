import {
  CYRILLIC_FROM,
  CYRILLIC_TO,
  FOLD_MAP,
  LETTER_MAP,
  LOWER_MAP,
  REMOVE,
  REMOVE_NEAR_LETTERS,
  SEQUENCES,
  WHITESPACE,
} from "./table.generated.js";

/** Слово — максимальная последовательность кодовых точек категорий Unicode L* и M*. */
const WORD_CP = /^[\p{L}\p{M}]$/u;
const SPACE = 0x20;
/** Размер порции при сборке строки: String.fromCodePoint(...огромный массив) переполняет стек. */
const CHUNK = 8192;

const isWordCp = (cp: number | undefined): boolean => cp !== undefined && WORD_CP.test(String.fromCodePoint(cp));
const isCyrillic = (cp: number): boolean => cp >= CYRILLIC_FROM && cp <= CYRILLIC_TO;

function toCodePoints(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) out.push(ch.codePointAt(0) as number);
  return out;
}

function fromCodePoints(cps: readonly number[]): string {
  let out = "";
  for (let i = 0; i < cps.length; i += CHUNK) out += String.fromCodePoint(...cps.slice(i, i + CHUNK));
  return out;
}

/**
 * Шаг 2: невидимые символы. ZWJ/ZWNJ удаляются только рядом с буквами — эмодзи-последовательности сохраняются.
 * «Рядом» = ближайшая слева или справа кодовая точка, не являющаяся ZWJ/ZWNJ, — буква или знак (категории L* или M*).
 * Линейно: проход слева направо запоминает, буква ли ближайший «не-соединитель» слева, проход справа налево —
 * справа: без повторного просмотра всей цепочки для каждого соединителя (это было бы O(n²)).
 */
function removeInvisible(input: readonly number[]): number[] {
  const cps = input.filter((cp) => !REMOVE.has(cp));
  const n = cps.length;
  const wordOnLeft = new Uint8Array(n);
  let lastIsWord = false;
  for (let i = 0; i < n; i++) {
    const cp = cps[i] as number;
    if (REMOVE_NEAR_LETTERS.has(cp)) wordOnLeft[i] = lastIsWord ? 1 : 0;
    else lastIsWord = isWordCp(cp);
  }
  const keep = new Uint8Array(n);
  let nextIsWord = false;
  for (let i = n - 1; i >= 0; i--) {
    const cp = cps[i] as number;
    if (REMOVE_NEAR_LETTERS.has(cp)) {
      keep[i] = wordOnLeft[i] || nextIsWord ? 0 : 1;
    } else {
      keep[i] = 1;
      nextIsWord = isWordCp(cp);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(cps[i] as number);
  return out;
}

function replaceSequences(cps: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < cps.length; i++) {
    const a = cps[i] as number;
    const b = cps[i + 1];
    const seq = b === undefined ? undefined : SEQUENCES.find(([x, y]) => x === a && y === b);
    if (seq) {
      out.push(seq[2]);
      i++;
    } else {
      out.push(a);
    }
  }
  return out;
}

/** Замена двойников — только внутри слов, где есть хотя бы одна кириллическая кодовая точка. */
function mapLettersInCyrillicWords(cps: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < cps.length) {
    const cp = cps[i] as number;
    if (!isWordCp(cp)) {
      out.push(cp);
      i++;
      continue;
    }
    let j = i;
    while (j < cps.length && isWordCp(cps[j])) j++;
    const word = cps.slice(i, j);
    const cyrillic = word.some(isCyrillic);
    for (const w of word) out.push(cyrillic ? (LETTER_MAP.get(w) ?? w) : w);
    i = j;
  }
  return out;
}

function normalizeSpaces(cps: readonly number[]): number[] {
  const out: number[] = [];
  for (const cp of cps) {
    if (WHITESPACE.has(cp)) {
      if (out.length > 0 && out[out.length - 1] !== SPACE) out.push(SPACE);
    } else {
      out.push(cp);
    }
  }
  if (out[out.length - 1] === SPACE) out.pop();
  return out;
}

/**
 * Каноническая форма башкирского текста (алгоритм v3): NFC → удаление невидимых → NFC →
 * последовательности → двойники в кириллических словах → пробелы → NFC. Регистр сохраняется.
 * Правила — contracts/shared/bashkir-homoglyphs.json, векторы — contracts/test-vectors/bashkir-text/.
 */
export function normalize(input: string): string {
  let cps = removeInvisible(toCodePoints(input.normalize("NFC")));
  cps = toCodePoints(fromCodePoints(cps).normalize("NFC"));
  cps = replaceSequences(cps);
  cps = mapLettersInCyrillicWords(cps);
  cps = normalizeSpaces(cps);
  return fromCodePoints(cps).normalize("NFC");
}

/**
 * Нижний регистр по собственной таблице простых соответствий (латиница, греческий, кириллица),
 * без контекстных правил (конечная сигма Σ → σ). Не зависит от версии Unicode среды выполнения,
 * поэтому совпадает на TS, Swift и Kotlin.
 */
function lower(cps: readonly number[]): number[] {
  return cps.map((cp) => LOWER_MAP.get(cp) ?? cp);
}

/** Не более стольких применений при поиске неподвижной точки (на практике хватает двух). */
const MAX_FIXPOINT_STEPS = 4;

/** Применяет step, пока результат меняется (не более MAX_FIXPOINT_STEPS раз). */
function fixpoint(input: string, step: (s: string) => string): string {
  let current = step(input);
  for (let n = 1; n < MAX_FIXPOINT_STEPS; n++) {
    const next = step(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

const comparableOnce = (s: string): string => fromCodePoints(lower(toCodePoints(normalize(s)))).normalize("NFC");
const foldOnce = (s: string): string =>
  fromCodePoints(toCodePoints(toComparable(s)).map((cp) => FOLD_MAP.get(cp) ?? cp)).normalize("NFC");

/** Форма для точного сравнения: неподвижная точка NFC(нижний регистр(normalize(s))). Особые буквы сохраняются. */
export function toComparable(input: string): string {
  return fixpoint(input, comparableOnce);
}

/**
 * Свёртка особых букв (ҡ→к, ғ→г, …) для «почти верно» и нечёткого поиска: неподвижная точка
 * NFC(foldMap(toComparable(s))). Неподвижная точка нужна, потому что NFC после свёртки может собрать
 * букву, которую нормализация снова заменит (у + U+0308 → ӱ → ү → у).
 */
export function fold(input: string): string {
  return fixpoint(input, foldOnce);
}
