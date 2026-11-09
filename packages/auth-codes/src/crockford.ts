/**
 * Алфавит base32 Crockford: 32 символа без I, L, O, U. Значение символа — его индекс.
 * Формат описан в contracts/test-vectors/qr-card/README.md (ADR 0016).
 */
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const VALUE = new Map<string, number>([...CROCKFORD_ALPHABET].map((ch, i) => [ch, i]));

/** Значение символа канонического алфавита или undefined. */
export function crockfordValue(ch: string): number | undefined {
  return VALUE.get(ch);
}

/** Все символы строки — из канонического алфавита (после нормализации). */
export function isCrockford(s: string): boolean {
  for (const ch of s) if (!VALUE.has(ch)) return false;
  return true;
}

/** Символ = байт & 31. 256 делится на 32, поэтому из равномерных байтов получаются равномерные символы. */
export function symbolsFromBytes(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += CROCKFORD_ALPHABET[b & 31];
  return out;
}

/** Удаляемые при ручном вводе символы: пробелы (включая неразрывные) и дефисы/тире. */
const REMOVED = new Set([
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x2007, 0x202f, // пробелы
  0x002d, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2212, // дефис, тире, минус
]);

/**
 * Замены после перевода ASCII в верхний регистр: похожие символы Crockford (O→0, I→1, L→1)
 * и кириллические двойники латинских букв и цифр — ребёнок может набирать в русской раскладке.
 * Башкирские буквы (Ҡ, Ҙ, Ө…) намеренно не заменяются: это другие буквы, а не двойники.
 */
const SUBSTITUTE = new Map<number, string>([
  [0x4f, "0"], // O
  [0x49, "1"], // I
  [0x4c, "1"], // L
  // кириллица, заглавные
  [0x0410, "A"], [0x0412, "B"], [0x0421, "C"], [0x0415, "E"], [0x041d, "H"], [0x041a, "K"],
  [0x041c, "M"], [0x041e, "0"], [0x0420, "P"], [0x0422, "T"], [0x0425, "X"], [0x0423, "Y"], [0x0417, "3"],
  // кириллица, строчные
  [0x0430, "A"], [0x0432, "B"], [0x0441, "C"], [0x0435, "E"], [0x043d, "H"], [0x043a, "K"],
  [0x043c, "M"], [0x043e, "0"], [0x0440, "P"], [0x0442, "T"], [0x0445, "X"], [0x0443, "Y"], [0x0437, "3"],
]);

/**
 * Нормализация ручного ввода кода (общая для QR-полезной нагрузки и кода класса):
 * 1) удалить пробелы и дефисы из REMOVED; 2) ASCII a–z → A–Z; 3) замены SUBSTITUTE.
 * Остальные символы (точка, знаки, прочие буквы) сохраняются — их отвергает проверка алфавита.
 */
export function normalizeCodeInput(input: string): string {
  let out = "";
  for (const ch of input) {
    const cp = ch.codePointAt(0)!;
    if (REMOVED.has(cp)) continue;
    const upper = cp >= 0x61 && cp <= 0x7a ? cp - 0x20 : cp;
    out += SUBSTITUTE.get(upper) ?? String.fromCodePoint(upper);
  }
  return out;
}

/** Источник криптостойких случайных байтов. По умолчанию — Web Crypto (Node ≥ 19, браузеры). */
export type RandomBytes = (length: number) => Uint8Array;

export const secureRandomBytes: RandomBytes = (length) => {
  const webCrypto = (globalThis as { crypto?: { getRandomValues(a: Uint8Array): Uint8Array } }).crypto;
  if (!webCrypto?.getRandomValues) throw new Error("auth-codes: нет криптостойкого ГСЧ (globalThis.crypto.getRandomValues)");
  return webCrypto.getRandomValues(new Uint8Array(length));
};
