// QR-карточки и коды классов (ADR 0016). Эталонная реализация общих тест-векторов
// contracts/test-vectors/qr-card/ и contracts/test-vectors/class-code/; порты Swift и Kotlin реализуются по тем же векторам.
export { CROCKFORD_ALPHABET, normalizeCodeInput, secureRandomBytes, type RandomBytes } from "./crockford.js";
export {
  QR_CHECK_LENGTH,
  QR_LINK_PATH,
  QR_PREFIX,
  QR_SEAT_LENGTH,
  QR_SECRET_LENGTH,
  buildQrLink,
  buildQrPayload,
  generateQrCard,
  parseQrPayload,
  qrCardFromRandomBytes,
  qrChecksum,
  type ParseResult,
  type QrCard,
  type QrParseError,
} from "./qr-card.js";
export {
  CLASS_CODE_LENGTH,
  CLASS_CODE_TTL_SECONDS,
  classCodeFromRandomBytes,
  formatClassCode,
  generateClassCode,
  parseClassCode,
  type ClassCode,
  type ClassCodeParseError,
} from "./class-code.js";
export {
  PERSONAL_CARD_DOMAIN,
  PERSONAL_CARD_HANDLE_LENGTH,
  PERSONAL_CARD_PREFIX,
  PERSONAL_CARD_SECRET_LENGTH,
  buildPersonalCardPayload,
  generatePersonalCard,
  parseLoginCard,
  personalCardChecksum,
  personalCardFromRandomBytes,
  type LoginCard,
  type LoginCardKind,
  type PersonalCard,
} from "./login-card.js";
