import { CROCKFORD_ALPHABET, crockfordValue, isCrockford, normalizeCodeInput, secureRandomBytes, symbolsFromBytes, type RandomBytes } from "./crockford.js";

/** Префикс и версия формата полезной нагрузки QR-карточки. */
export const QR_PREFIX = "TT1";
/** Идентификатор места (карточки): 10 символов = 50 бит. Не секрет — по нему сервер находит карточку. */
export const QR_SEAT_LENGTH = 10;
/** Секрет карточки: 26 символов = 130 бит (≥ 128 бит по ADR 0016). В базе — только SHA-256. */
export const QR_SECRET_LENGTH = 26;
/** Контрольная сумма: 2 символа, остаток по модулю простого 1021. */
export const QR_CHECK_LENGTH = 2;
/** Путь ссылки в QR: `<baseUrl>/q#<payload>`; фрагмент после `#` не уходит на сервер и не попадает в его логи. */
export const QR_LINK_PATH = "/q#";

const CHECK_MODULUS = 1021;

export interface QrCard {
  /** Идентификатор места, 10 символов Crockford. */
  seat: string;
  /** Секрет, 26 символов Crockford. */
  secret: string;
  /** Каноническая полезная нагрузка `TT1.<seat>.<secret>.<check>`. */
  payload: string;
}

export type QrParseError =
  | "empty"
  | "unknown_prefix"
  | "unsupported_version"
  | "invalid_format"
  | "invalid_character"
  | "bad_checksum";

export type ParseResult<T, E extends string> = ({ ok: true } & T) | { ok: false; error: E };

/**
 * Контрольная сумма: значение числа, записанного цифрами base32 строки `seat + secret`, по модулю 1021,
 * двумя символами (старший, младший). Ловит любую замену одного символа и перестановку соседних
 * (1021 — простое, больше 32), случайную ошибку пропускает с вероятностью 1/1021.
 */
export function qrChecksum(seat: string, secret: string): string {
  let r = 0;
  for (const ch of seat + secret) {
    const v = crockfordValue(ch);
    if (v === undefined) throw new Error(`auth-codes: символ «${ch}» не из алфавита Crockford`);
    r = (r * 32 + v) % CHECK_MODULUS;
  }
  return CROCKFORD_ALPHABET[Math.floor(r / 32)]! + CROCKFORD_ALPHABET[r % 32]!;
}

function assertPart(name: string, value: string, length: number): void {
  if (value.length !== length || !isCrockford(value)) {
    throw new Error(`auth-codes: ${name} — ${length} символов Crockford в верхнем регистре`);
  }
}

/** Собирает каноническую полезную нагрузку из места и секрета. */
export function buildQrPayload(seat: string, secret: string): string {
  assertPart("seat", seat, QR_SEAT_LENGTH);
  assertPart("secret", secret, QR_SECRET_LENGTH);
  return `${QR_PREFIX}.${seat}.${secret}.${qrChecksum(seat, secret)}`;
}

/** Ссылка для QR: завершающий `/` базового адреса не удваивается. */
export function buildQrLink(baseUrl: string, payload: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${QR_LINK_PATH}${payload}`;
}

/** Карточка из готовых случайных байтов: первые 10 — место, следующие 26 — секрет (детерминированно; для векторов). */
export function qrCardFromRandomBytes(bytes: Uint8Array): QrCard {
  if (bytes.length !== QR_SEAT_LENGTH + QR_SECRET_LENGTH) {
    throw new Error(`auth-codes: нужно ${QR_SEAT_LENGTH + QR_SECRET_LENGTH} байт, получено ${bytes.length}`);
  }
  const seat = symbolsFromBytes(bytes.subarray(0, QR_SEAT_LENGTH));
  const secret = symbolsFromBytes(bytes.subarray(QR_SEAT_LENGTH));
  return { seat, secret, payload: buildQrPayload(seat, secret) };
}

/** Новая карточка из криптостойкого ГСЧ. */
export function generateQrCard(random: RandomBytes = secureRandomBytes): QrCard {
  return qrCardFromRandomBytes(random(QR_SEAT_LENGTH + QR_SECRET_LENGTH));
}

/**
 * Разбор того, что дал сканер или ввёл человек: ссылка `…/q#<payload>` или сама полезная нагрузка.
 * Порядок: фрагмент после первого `#` → нормализация ручного ввода → префикс/версия → число сегментов → алфавит → длины → контрольная сумма.
 */
export function parseQrPayload(input: string): ParseResult<QrCard, QrParseError> {
  const hash = input.indexOf("#");
  const raw = hash >= 0 ? input.slice(hash + 1) : input;
  const normalized = normalizeCodeInput(raw);
  if (normalized.length === 0) return { ok: false, error: "empty" };

  const parts = normalized.split(".");
  const prefix = parts[0]!;
  if (prefix !== QR_PREFIX) {
    return { ok: false, error: /^TT[0-9]+$/.test(prefix) ? "unsupported_version" : "unknown_prefix" };
  }
  if (parts.length !== 4) return { ok: false, error: "invalid_format" };
  const [, seat, secret, check] = parts as [string, string, string, string];
  // Алфавит проверяется раньше длины: после него все символы — ASCII, и длина одинакова во всех портах
  // (UTF-16 в Kotlin/TS, графемы в Swift).
  if (!isCrockford(seat) || !isCrockford(secret) || !isCrockford(check)) return { ok: false, error: "invalid_character" };
  if (seat.length !== QR_SEAT_LENGTH || secret.length !== QR_SECRET_LENGTH || check.length !== QR_CHECK_LENGTH) {
    return { ok: false, error: "invalid_format" };
  }
  if (qrChecksum(seat, secret) !== check) return { ok: false, error: "bad_checksum" };
  return { ok: true, seat, secret, payload: `${QR_PREFIX}.${seat}.${secret}.${check}` };
}
