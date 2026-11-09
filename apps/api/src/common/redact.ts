// Фильтр логов (ADR 0015 §5): токены, коды, e-mail, полезные нагрузки QR, X-Poll-Token, секрет сервиса и initData
// Telegram (имя, ник и фото из профиля, ADR 0020) не попадают в логи.
// Две линии защиты: ключи объектов (значение заменяется целиком) и шаблоны в любой строке —
// сообщения, стеки ошибок, тексты ошибок Postgres («Key (email)=(…)»).

/** Ключи, значения которых не логируются никогда (сравнение без учёта регистра и разделителей). */
export const REDACTED_KEYS = [
  "authorization",
  "refreshToken",
  "accessToken",
  "payload",
  "code",
  "totp",
  "email",
  "x-poll-token",
  "pollToken",
  "secret",
  "fullName",
  "position",
  "cookie",
  "set-cookie",
  "initData",
  "x-service-token",
  "serviceToken",
] as const;

const KEY_SET = new Set(REDACTED_KEYS.map((k) => k.toLowerCase().replace(/[-_]/g, "")));
const isRedactedKey = (key: string) => KEY_SET.has(key.toLowerCase().replace(/[-_]/g, ""));

const PATTERNS: Array<[RegExp, string]> = [
  // Хвост «params: …» ошибки запроса Drizzle (`Failed query: …\nparams: <значения>`) — до первой строки стека.
  // Основная защита — describeError (errors.ts) не пишет текст ошибок БД вовсе; это вторая линия.
  [/(^|\n)params:[^\n]*(?:\n(?![ \t]+at )[^\n]*)*/g, "$1params: [redacted]"],
  // refresh-токен `ttr_…` и токен опроса `ttp_…`
  [/\btt[rp]_[A-Za-z0-9_-]{8,}/g, "tt*_[redacted]"],
  // полезная нагрузка QR TT1.<seat>.<secret>.<check> — в любом регистре и с «битыми» частями
  [/\bTT\d+\.[0-9A-Za-z.-]{6,}/gi, "TT1.[redacted]"],
  // личная карточка входа TP1.<handle>.<secret>.<check> (ADR 0022) — так же
  [/\bTP\d+\.[0-9A-Za-z.-]{6,}/gi, "TP1.[redacted]"],
  // JWT (заголовок base64url начинается с eyJ)
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g, "[jwt]"],
  // Bearer-заголовок целиком
  [/\bBearer\s+\S+/gi, "Bearer [redacted]"],
  // e-mail
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  // initData Telegram (строка запроса с auth_date и hash; в ней профиль пользователя) — целиком, в любом месте строки
  [/[^\s"'<>]*auth_date(?:=|%3D)[^\s"'<>]*/gi, "[initData]"],
];

/** Строка без секретов и e-mail. */
export function redactString(s: string): string {
  let out = s;
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  return out;
}

/** Глубокая копия значения без секретов: опасные ключи — `[redacted]`, строки — через шаблоны. */
export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object" || depth > 8) return value;
  if (value instanceof Error) {
    const copy = new Error(redactString(value.message));
    copy.name = value.name;
    copy.stack = value.stack ? redactString(value.stack) : undefined;
    return copy;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = isRedactedKey(k) ? "[redacted]" : redact(v, depth + 1);
  return out;
}
