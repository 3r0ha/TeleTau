// Свободный текст из запросов (ФИО, должность, причина отказа): в нём встречается башкирский текст, поэтому
// каноническая форма — только через @teletau/bashkir-text (CLAUDE.md, правило 7): NFC, без невидимых и управляющих
// направлением символов, двойники внутри кириллических слов заменены, пробелы схлопнуты и обрезаны по краям.
// Порядок проверок: управляющие символы → нормализация → допустимые символы → хотя бы одна буква →
// длина. Так «😀» в должности получает «Только русские или башкирские буквы…», «1» — «Нужна хотя бы одна буква»,
// а не «Не короче 2 символов».
import { fold, normalize } from "@teletau/bashkir-text";
import { CONTROL_CHARS_DETAIL, hasControlChars } from "./control-chars.js";
import { invalidField } from "./problem.js";

export interface TextFieldOptions {
  /** Разрешить табуляцию и переводы строки (они схлопываются в пробел нормализацией). */
  multiline?: boolean;
}

/** Управляющие символы — 422 до нормализации (NUL иначе дошёл бы до Postgres и дал 500); затем нормализация. */
function clean(raw: string, pointer: string, options: TextFieldOptions): string {
  if (hasControlChars(raw, { singleLine: options.multiline !== true })) throw invalidField(pointer, CONTROL_CHARS_DETAIL);
  return normalize(raw);
}

/**
 * Контракт проверяет длину до нормализации; если после неё строка стала короче `minLength` (например, состояла из
 * пробелов и невидимых символов) — 422 с указателем на поле.
 */
function requireLength(s: string, pointer: string, minLength: number): void {
  if ([...s].length < minLength) throw invalidField(pointer, `Не короче ${minLength} символов`);
}

/** Нормализованный текст поля без ограничений на алфавит (причина отказа модератора). */
export function normalizeTextField(raw: string, pointer: string, minLength: number, options: TextFieldOptions = {}): string {
  const s = clean(raw, pointer, options);
  requireLength(s, pointer, minLength);
  return s;
}

/** Буква: русская или башкирская (свёртка @teletau/bashkir-text — русская буква а–я, как у литеры класса). */
const isCyrillicLetter = (ch: string): boolean => /^[а-я]$/.test(fold(ch));
/** Разделители внутри ФИО: пробел, дефис (двойная фамилия), апостроф (О’Нил, Д’Артаньян — прямой и типографский). */
const NAME_SEPARATORS = new Set([" ", "-", "‐", "'", "’", "ʼ"]);

/**
 * ФИО взрослого (заявка учителя): после нормализации — только русские и башкирские буквы, пробел, дефис и апостроф,
 * и хотя бы одна буква в каждом слове. Латиница не принимается: официальные документы школ РБ, по которым модератор
 * сверяет заявку, ведутся кириллицей, а слово целиком латиницей — единственный способ обойти замену двойников
 * (нормализация заменяет латинские двойники только внутри кириллических слов) и выдать себя за другого учителя.
 */
export function normalizePersonName(raw: string, pointer: string): string {
  const s = clean(raw, pointer, {});
  const ok = [...s].every((ch) => isCyrillicLetter(ch) || NAME_SEPARATORS.has(ch)) && s.split(" ").every((w) => [...w].some(isCyrillicLetter));
  if (s.length > 0 && !ok) throw invalidField(pointer, "Только русские или башкирские буквы, пробел, дефис и апостроф");
  requireLength(s, pointer, 3);
  return s;
}

/** Знаки в должности: «Зам. директора по УВР (№ 2), учитель-логопед», «Учитель 1-й категории». */
const POSITION_MARKS = new Set([..." .,;:-‐–—()«»\"'’ʼ№/"]);

/**
 * Должность (заявка учителя): после нормализации — русские и башкирские буквы, цифры, пробел и знаки препинания,
 * хотя бы одна буква. Эмодзи и латиница не принимаются — как и в ФИО, по ней модератор сверяет заявку с документами.
 * Текст ошибки называет то, чего не хватает: «1» или «—» состоят из разрешённых символов — им нужна буква.
 */
export function normalizePosition(raw: string, pointer: string): string {
  const s = clean(raw, pointer, {});
  const chars = [...s];
  if (!chars.every((ch) => isCyrillicLetter(ch) || /^[0-9]$/.test(ch) || POSITION_MARKS.has(ch))) {
    throw invalidField(pointer, "Только русские или башкирские буквы, цифры, пробел и знаки препинания");
  }
  if (s.length > 0 && !chars.some(isCyrillicLetter)) throw invalidField(pointer, "Нужна хотя бы одна буква");
  requireLength(s, pointer, 2);
  return s;
}

/**
 * Прямые кавычки названий из справочника (`АНОО "Центр"`) → «ёлочки» для показа: кавычка в начале строки или после
 * пробела, скобки и открывающей кавычки открывает, остальные закрывают. Без прямых кавычек строка не меняется.
 */
export function typographicQuotes(text: string): string {
  if (!text.includes('"')) return text;
  return text.replace(/"/g, (_q, offset: number) => (offset === 0 || /[\s([«„]/u.test(text[offset - 1]!) ? "«" : "»"));
}
