import { CROCKFORD_ALPHABET, crockfordValue, isCrockford, normalizeCodeInput, secureRandomBytes, symbolsFromBytes, type RandomBytes } from "./crockford.js";
import { QR_CHECK_LENGTH, QR_PREFIX, QR_SEAT_LENGTH, QR_SECRET_LENGTH, qrChecksum, type ParseResult, type QrParseError } from "./qr-card.js";

/**
 * Личная карточка входа самостоятельного ученика (ADR 0022): `TP1.<handle>.<secret>.<check>` — та же природа, что
 * у карточки места `TT1` (ADR 0016): те же длины, алфавит и нормализация ручного ввода. Отличаются префиксом и
 * контрольной суммой — она считается с разделителем назначения `P` перед телом, поэтому подмена префикса TT1 ↔ TP1
 * всегда даёт `bad_checksum`: личную карточку не принять за карточку места класса и наоборот.
 */
export const PERSONAL_CARD_PREFIX = "TP1";
/** Идентификатор карточки: 10 символов (50 бит). Не секрет — по нему сервер находит карточку. */
export const PERSONAL_CARD_HANDLE_LENGTH = QR_SEAT_LENGTH;
/** Секрет: 26 символов (130 бит). В базе — SHA-256 для проверки и шифртекст для показа владельцу (ADR 0022). */
export const PERSONAL_CARD_SECRET_LENGTH = QR_SECRET_LENGTH;
/** Разделитель назначения контрольной суммы личной карточки — символ `P` (значение 22) перед `handle + secret`. */
export const PERSONAL_CARD_DOMAIN = "P";

const CHECK_MODULUS = 1021;

export interface PersonalCard {
  /** Идентификатор карточки, 10 символов Crockford. */
  handle: string;
  /** Секрет, 26 символов Crockford. */
  secret: string;
  /** Каноническая полезная нагрузка `TP1.<handle>.<secret>.<check>`. */
  payload: string;
}

/** Вид карточки входа: `seat` — карточка места класса (TT1, ADR 0016), `personal` — личная карточка (TP1, ADR 0022). */
export type LoginCardKind = "seat" | "personal";

export interface LoginCard {
  kind: LoginCardKind;
  /** Идентификатор: у карточки места — `seat`, у личной — `handle`. */
  handle: string;
  secret: string;
  payload: string;
}

/**
 * Контрольная сумма личной карточки: как `qrChecksum`, но по строке `P + handle + secret` (37 цифр base32). Ведущая
 * цифра P сдвигает остаток на постоянное ненулевое число (22·32³⁶ mod 1021), поэтому у одного и того же тела суммы
 * TT1 и TP1 всегда различны.
 */
export function personalCardChecksum(handle: string, secret: string): string {
  let r = 0;
  for (const ch of PERSONAL_CARD_DOMAIN + handle + secret) {
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

/** Каноническая полезная нагрузка личной карточки. */
export function buildPersonalCardPayload(handle: string, secret: string): string {
  assertPart("handle", handle, PERSONAL_CARD_HANDLE_LENGTH);
  assertPart("secret", secret, PERSONAL_CARD_SECRET_LENGTH);
  return `${PERSONAL_CARD_PREFIX}.${handle}.${secret}.${personalCardChecksum(handle, secret)}`;
}

/** Личная карточка из готовых случайных байтов: первые 10 — идентификатор, следующие 26 — секрет (для векторов). */
export function personalCardFromRandomBytes(bytes: Uint8Array): PersonalCard {
  if (bytes.length !== PERSONAL_CARD_HANDLE_LENGTH + PERSONAL_CARD_SECRET_LENGTH) {
    throw new Error(`auth-codes: нужно ${PERSONAL_CARD_HANDLE_LENGTH + PERSONAL_CARD_SECRET_LENGTH} байт, получено ${bytes.length}`);
  }
  const handle = symbolsFromBytes(bytes.subarray(0, PERSONAL_CARD_HANDLE_LENGTH));
  const secret = symbolsFromBytes(bytes.subarray(PERSONAL_CARD_HANDLE_LENGTH));
  return { handle, secret, payload: buildPersonalCardPayload(handle, secret) };
}

/** Новая личная карточка из криптостойкого ГСЧ (генерирует только сервер). */
export function generatePersonalCard(random: RandomBytes = secureRandomBytes): PersonalCard {
  return personalCardFromRandomBytes(random(PERSONAL_CARD_HANDLE_LENGTH + PERSONAL_CARD_SECRET_LENGTH));
}

const KINDS: Record<string, { kind: LoginCardKind; checksum: (handle: string, secret: string) => string }> = {
  [QR_PREFIX]: { kind: "seat", checksum: qrChecksum },
  [PERSONAL_CARD_PREFIX]: { kind: "personal", checksum: personalCardChecksum },
};

/**
 * Разбор того, что прочитал сканер «Я ученик → Сканировать карточку» или ввёл человек: карточка места `TT1.…`
 * (и ссылка `…/q#TT1.…` с ранних карточек) или личная карточка `TP1.…`. Шаги — как у `parseQrPayload`
 * (contracts/test-vectors/login-card/README.md); префикс определяет вид и контрольную сумму. Наши префиксы
 * с неизвестной версией (`TT<цифры>`, `TP<цифры>`) — `unsupported_version`.
 */
export function parseLoginCard(input: string): ParseResult<LoginCard, QrParseError> {
  const hash = input.indexOf("#");
  const normalized = normalizeCodeInput(hash >= 0 ? input.slice(hash + 1) : input);
  if (normalized.length === 0) return { ok: false, error: "empty" };

  const parts = normalized.split(".");
  const prefix = parts[0]!;
  const spec = KINDS[prefix];
  if (!spec) return { ok: false, error: /^T[TP][0-9]+$/.test(prefix) ? "unsupported_version" : "unknown_prefix" };
  if (parts.length !== 4) return { ok: false, error: "invalid_format" };
  const [, handle, secret, check] = parts as [string, string, string, string];
  if (!isCrockford(handle) || !isCrockford(secret) || !isCrockford(check)) return { ok: false, error: "invalid_character" };
  if (handle.length !== QR_SEAT_LENGTH || secret.length !== QR_SECRET_LENGTH || check.length !== QR_CHECK_LENGTH) {
    return { ok: false, error: "invalid_format" };
  }
  if (spec.checksum(handle, secret) !== check) return { ok: false, error: "bad_checksum" };
  return { ok: true, kind: spec.kind, handle, secret, payload: `${prefix}.${handle}.${secret}.${check}` };
}
