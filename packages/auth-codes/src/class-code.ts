import { isCrockford, normalizeCodeInput, secureRandomBytes, symbolsFromBytes, type RandomBytes } from "./crockford.js";
import type { ParseResult } from "./qr-card.js";

/** Код класса: 6 символов Crockford (30 бит). Живёт 15 минут, вход по нему требует одобрения учителя (ADR 0016). */
export const CLASS_CODE_LENGTH = 6;
/** Срок жизни кода класса. */
export const CLASS_CODE_TTL_SECONDS = 15 * 60;

export interface ClassCode {
  /** Канонический вид: 6 символов без разделителей. */
  code: string;
  /** Для показа на экране: `ABC-DEF`. */
  display: string;
}

export type ClassCodeParseError = "empty" | "invalid_character" | "invalid_length";

/** `ABC-DEF` из канонического кода. */
export function formatClassCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/** Код из готовых случайных байтов (детерминированно; для векторов). */
export function classCodeFromRandomBytes(bytes: Uint8Array): ClassCode {
  if (bytes.length !== CLASS_CODE_LENGTH) throw new Error(`auth-codes: нужно ${CLASS_CODE_LENGTH} байт, получено ${bytes.length}`);
  const code = symbolsFromBytes(bytes);
  return { code, display: formatClassCode(code) };
}

/** Новый код класса из криптостойкого ГСЧ. */
export function generateClassCode(random: RandomBytes = secureRandomBytes): ClassCode {
  return classCodeFromRandomBytes(random(CLASS_CODE_LENGTH));
}

/** Разбор ручного ввода: нормализация → алфавит → длина (недопустимый символ важнее неверной длины). */
export function parseClassCode(input: string): ParseResult<ClassCode, ClassCodeParseError> {
  const code = normalizeCodeInput(input);
  if (code.length === 0) return { ok: false, error: "empty" };
  if (!isCrockford(code)) return { ok: false, error: "invalid_character" };
  if (code.length !== CLASS_CODE_LENGTH) return { ok: false, error: "invalid_length" };
  return { ok: true, code, display: formatClassCode(code) };
}
