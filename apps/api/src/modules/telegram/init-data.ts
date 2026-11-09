// Проверка initData Telegram Mini App (core.telegram.org/bots/webapps — «Validating data received via the Mini App»):
//  1. initData — строка запроса; data-check-string — все поля, кроме `hash`, по алфавиту, «ключ=значение» через «\n»
//     (значения — после декодирования из адреса);
//  2. секретный ключ — HMAC-SHA-256 токена бота с ключом «WebAppData»;
//  3. подпись верна, если HMAC-SHA-256 data-check-string с этим ключом в hex равен `hash`;
//  4. `auth_date` (секунды Unix) — не старше суток, иначе перехваченную строку можно было бы предъявлять сколько угодно.
// Из проверенной строки берётся только `user.id` (он же chat_id личного чата с ботом). Имя, ник, фото, язык и прочее
// не читаются и никуда не передаются (CLAUDE.md, правила 5 и 13). Строку не логировать: в ней профиль пользователя.
import { createHmac, timingSafeEqual } from "node:crypto";

/** Срок годности initData: сутки. */
export const INIT_DATA_MAX_AGE_SECONDS = 86_400;
/** Допуск на расхождение часов: `auth_date` «из будущего» — не больше чем на 5 минут. */
export const INIT_DATA_CLOCK_SKEW_SECONDS = 300;
/** Длиннее initData не бывает (с запасом); больше — не разбираем. */
export const INIT_DATA_MAX_LENGTH = 4096;

export type InitDataFailure = "malformed" | "bad_signature" | "expired" | "no_user";

export type InitDataCheck = { ok: true; userId: number; authDate: Date } | { ok: false; reason: InitDataFailure };

const fail = (reason: InitDataFailure): InitDataCheck => ({ ok: false, reason });

/** Секретный ключ проверки: HMAC-SHA-256(ключ «WebAppData», сообщение — токен бота). */
export function initDataSecretKey(botToken: string): Buffer {
  return createHmac("sha256", "WebAppData").update(botToken, "utf8").digest();
}

/** data-check-string: все поля, кроме `hash`, по алфавиту (по кодовым точкам), «ключ=значение» через «\n». */
export function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

/** Подпись initData токеном бота (hex) — для тестовых векторов и проверки. */
export function signInitData(params: URLSearchParams, botToken: string): string {
  return createHmac("sha256", initDataSecretKey(botToken)).update(dataCheckString(params), "utf8").digest("hex");
}

/**
 * Проверяет initData: разбор → подпись → срок → `user.id`. Подпись проверяется раньше разбора JSON пользователя:
 * неподписанные данные не разбираются вовсе. Сравнение подписи — за постоянное время.
 */
export function verifyInitData(raw: string, botToken: string, now: Date, maxAgeSeconds = INIT_DATA_MAX_AGE_SECONDS): InitDataCheck {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > INIT_DATA_MAX_LENGTH) return fail("malformed");
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  // Повтор ключа: какое из значений подписано, неясно — такую строку Telegram не присылает.
  if (keys.length === 0 || new Set(keys).size !== keys.length) return fail("malformed");
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return fail("malformed");

  const expected = Buffer.from(signInitData(params, botToken), "hex");
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) return fail("bad_signature");

  const authRaw = params.get("auth_date") ?? "";
  if (!/^[1-9][0-9]{0,11}$/.test(authRaw)) return fail("malformed");
  const authSeconds = Number(authRaw);
  const age = now.getTime() / 1000 - authSeconds;
  if (age > maxAgeSeconds || age < -INIT_DATA_CLOCK_SKEW_SECONDS) return fail("expired");

  let user: unknown;
  try {
    user = JSON.parse(params.get("user") ?? "");
  } catch {
    return fail("no_user");
  }
  const id = (user as { id?: unknown } | null)?.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return fail("no_user");
  return { ok: true, userId: id, authDate: new Date(authSeconds * 1000) };
}
