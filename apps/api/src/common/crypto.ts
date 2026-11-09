import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** SHA-256 в hex — для секретов с высокой энтропией (refresh-токен, секрет карточки, токен опроса). */
export const sha256Hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

/** HMAC-SHA-256 с перцем в hex — для значений с низкой энтропией (e-mail, код класса, IP; ADR 0015–0017). */
export const hmacHex = (pepper: string, value: string): string => createHmac("sha256", pepper).update(value, "utf8").digest("hex");

/** Криптостойкая случайная строка base64url из `bytes` байт. */
export const randomTokenB64 = (bytes: number): string => randomBytes(bytes).toString("base64url");

/** Сравнение двух hex-хешей за постоянное время (разная длина — сразу false). */
export function hexEquals(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Сравнение строк за постоянное время (через их SHA-256). */
export const safeEquals = (a: string, b: string): boolean => hexEquals(sha256Hex(a), sha256Hex(b));

const AES_PREFIX = "v1";

/** AES-256-GCM: `v1.<iv>.<tag>.<ciphertext>` в base64url. `aad` привязывает шифртекст к назначению. */
export function encrypt(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [AES_PREFIX, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

/** Обратное к encrypt; при неверном ключе, aad или подделке — исключение. */
export function decrypt(key: Buffer, sealed: string, aad: string): string {
  const [prefix, iv, tag, ct] = sealed.split(".");
  if (prefix !== AES_PREFIX || !iv || !tag || ct === undefined) throw new Error("decrypt: неизвестный формат");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
