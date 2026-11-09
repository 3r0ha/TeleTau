// Модуль telegram (ADR 0020) без базы: проверка подписи initData по алгоритму Telegram, правила напоминаний по Уфе,
// маскирование initData и секрета сервиса в логах, конфигурация.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { redact, redactString } from "../src/common/redact.js";
import { DEV_BOT_SERVICE_TOKEN, loadConfig } from "../src/config/config.js";
import { dataCheckString, INIT_DATA_MAX_AGE_SECONDS, signInitData, verifyInitData } from "../src/modules/telegram/init-data.js";
import { outsideQuietHours, reminderDue, ufaHour } from "../src/modules/telegram/reminders.js";

// Публичный тестовый вектор из документации @telegram-apps/init-data-node (docs.telegram-mini-apps.com): токен бота,
// initData и подпись получены не нашим кодом — совпадение 256-битной подписи подтверждает сам алгоритм.
const PUBLIC_TOKEN = "5768337691:AAH5YkoiEuPk8-FZa32hStHTqXiLPtAEhx8";
const PUBLIC_INIT_DATA =
  "query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A279058397%2C%22first_name%22%3A%22Vladislav%22%2C%22last_name%22%3A%22Kibenko%22%2C%22username%22%3A%22vdkfrost%22%2C%22language_code%22%3A%22ru%22%2C%22is_premium%22%3Atrue%7D&auth_date=1662771648&hash=c501b71e775f74ce10e377dea85a7ea24ecd640b223ea86dfe453e0eaed2e2b2";
const PUBLIC_AUTH_DATE = 1662771648;
const at = (seconds: number) => new Date(seconds * 1000);

/**
 * Подпись «как у Telegram», записанная заново по документации (core.telegram.org/bots/webapps), без кода модуля:
 * секрет = HMAC_SHA256(key="WebAppData", msg=token), hash = hex(HMAC_SHA256(key=секрет, msg=data_check_string)).
 */
function telegramSign(fields: Record<string, string>, token: string): string {
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

const OUR_TOKEN = "1234567890:AAEhBP0av28XrZbIVAbNLzEXAMPLEtoken1";
const NOW = 1_793_800_000; // 2026-11-04, секунды Unix
const fields = (over: Record<string, string> = {}): Record<string, string> => ({
  query_id: "AAE-test-query",
  user: JSON.stringify({ id: 4242424242, first_name: "Тест", username: "kid_example", language_code: "ru", photo_url: "https://t.me/i/userpic/320/x.svg" }),
  auth_date: String(NOW - 60),
  chat_instance: "-123456789",
  chat_type: "sender",
  signature: "kFBq0Ql0Hq7Q1t5s9YbF-test-signature-ed25519",
  ...over,
});

describe("initData: проверка подписи по алгоритму Telegram", () => {
  it("публичный вектор: подпись сходится, из профиля берётся только user.id", () => {
    const check = verifyInitData(PUBLIC_INIT_DATA, PUBLIC_TOKEN, at(PUBLIC_AUTH_DATE + 60));
    expect(check).toEqual({ ok: true, userId: 279058397, authDate: at(PUBLIC_AUTH_DATE) });
    expect(signInitData(new URLSearchParams(PUBLIC_INIT_DATA), PUBLIC_TOKEN)).toBe("c501b71e775f74ce10e377dea85a7ea24ecd640b223ea86dfe453e0eaed2e2b2");
  });

  it("data-check-string: все поля, кроме hash, по алфавиту, значения — декодированные", () => {
    expect(dataCheckString(new URLSearchParams(PUBLIC_INIT_DATA))).toBe(
      'auth_date=1662771648\nquery_id=AAHdF6IQAAAAAN0XohDhrOrc\nuser={"id":279058397,"first_name":"Vladislav","last_name":"Kibenko","username":"vdkfrost","language_code":"ru","is_premium":true}',
    );
  });

  it("свой вектор с полями Bot API 8 (signature, chat_instance, chat_type): signature входит в data-check-string", () => {
    const raw = telegramSign(fields(), OUR_TOKEN);
    expect(verifyInitData(raw, OUR_TOKEN, at(NOW))).toEqual({ ok: true, userId: 4242424242, authDate: at(NOW - 60) });
    // Подпись без signature в data-check-string не сошлась бы: поле подписано, а не служебное.
    const withoutSignature = new URLSearchParams(raw);
    withoutSignature.delete("signature");
    expect(verifyInitData(withoutSignature.toString(), OUR_TOKEN, at(NOW))).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("порядок полей в строке не важен — важна подпись", () => {
    const p = new URLSearchParams(telegramSign(fields(), OUR_TOKEN));
    const shuffled = new URLSearchParams([...p.entries()].reverse());
    expect(verifyInitData(shuffled.toString(), OUR_TOKEN, at(NOW)).ok).toBe(true);
  });

  it("подделка: другой пользователь, другой токен, изменённая подпись — bad_signature", () => {
    const forged = PUBLIC_INIT_DATA.replace("279058397", "279058398");
    expect(verifyInitData(forged, PUBLIC_TOKEN, at(PUBLIC_AUTH_DATE + 60))).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyInitData(PUBLIC_INIT_DATA, OUR_TOKEN, at(PUBLIC_AUTH_DATE + 60))).toEqual({ ok: false, reason: "bad_signature" });
    const flipped = PUBLIC_INIT_DATA.replace("hash=c501", "hash=d501");
    expect(verifyInitData(flipped, PUBLIC_TOKEN, at(PUBLIC_AUTH_DATE + 60))).toEqual({ ok: false, reason: "bad_signature" });
    const extra = `${PUBLIC_INIT_DATA}&start_param=x`;
    expect(verifyInitData(extra, PUBLIC_TOKEN, at(PUBLIC_AUTH_DATE + 60))).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("auth_date: ровно сутки — ещё годится, на секунду старше — expired; из будущего больше 5 минут — expired", () => {
    expect(verifyInitData(PUBLIC_INIT_DATA, PUBLIC_TOKEN, at(PUBLIC_AUTH_DATE + INIT_DATA_MAX_AGE_SECONDS)).ok).toBe(true);
    expect(verifyInitData(PUBLIC_INIT_DATA, PUBLIC_TOKEN, at(PUBLIC_AUTH_DATE + INIT_DATA_MAX_AGE_SECONDS + 1))).toEqual({ ok: false, reason: "expired" });
    expect(verifyInitData(PUBLIC_INIT_DATA, PUBLIC_TOKEN, at(PUBLIC_AUTH_DATE - 299)).ok).toBe(true);
    expect(verifyInitData(PUBLIC_INIT_DATA, PUBLIC_TOKEN, at(PUBLIC_AUTH_DATE - 301))).toEqual({ ok: false, reason: "expired" });
  });

  it("неразборчивая строка — malformed: пусто, без hash, hash не hex, повтор ключа, слишком длинная, auth_date не число", () => {
    const now = at(NOW);
    expect(verifyInitData("", OUR_TOKEN, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyInitData("auth_date=1&user=%7B%7D", OUR_TOKEN, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyInitData("auth_date=1&hash=xyz", OUR_TOKEN, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyInitData(`${PUBLIC_INIT_DATA}&auth_date=1662771648`, PUBLIC_TOKEN, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyInitData(`a=${"x".repeat(5000)}&hash=${"0".repeat(64)}`, OUR_TOKEN, now)).toEqual({ ok: false, reason: "malformed" });
    const badDate = telegramSign(fields({ auth_date: "soon" }), OUR_TOKEN);
    expect(verifyInitData(badDate, OUR_TOKEN, now)).toEqual({ ok: false, reason: "malformed" });
  });

  it("подписано, но без пользователя или с чужим id — no_user", () => {
    const noUser = fields();
    delete noUser["user"];
    expect(verifyInitData(telegramSign(noUser, OUR_TOKEN), OUR_TOKEN, at(NOW))).toEqual({ ok: false, reason: "no_user" });
    for (const user of ['{"id":"42"}', '{"id":-5}', '{"id":1.5}', "not json", '{"id":9007199254740993}']) {
      expect(verifyInitData(telegramSign(fields({ user }), OUR_TOKEN), OUR_TOKEN, at(NOW)), user).toEqual({ ok: false, reason: "no_user" });
    }
  });
});

describe("напоминания: сутки и тихие часы по Уфе (UTC+5)", () => {
  it("час по Уфе", () => {
    expect(ufaHour(new Date("2026-11-04T13:00:00Z"))).toBe(18);
    expect(ufaHour(new Date("2026-11-04T19:30:00Z"))).toBe(0);
    expect(ufaHour(new Date("2026-11-04T02:59:59Z"))).toBe(7);
  });

  it("тихие часы 21:00–08:00: нет напоминаний; в выбранный час и позже в те же сутки — пора", () => {
    expect([7, 8, 20, 21, 23, 0].map(outsideQuietHours)).toEqual([false, true, true, false, false, false]);
    expect(reminderDue(18, 17)).toBe(false);
    expect(reminderDue(18, 18)).toBe(true);
    expect(reminderDue(18, 20)).toBe(true);
    expect(reminderDue(18, 21)).toBe(false);
    expect(reminderDue(8, 7)).toBe(false);
  });
});

describe("логи: ни initData, ни секрета сервиса", () => {
  it("строка initData целиком заменяется — в тексте, в адресе, в объекте", () => {
    expect(redactString(`link failed: ${PUBLIC_INIT_DATA}`)).toBe("link failed: [initData]");
    expect(redactString(`url=/x#tgWebAppData=${encodeURIComponent(PUBLIC_INIT_DATA)}`)).not.toMatch(/vdkfrost|279058397|Kibenko/);
    expect(JSON.stringify(redact({ body: { initData: PUBLIC_INIT_DATA }, headers: { "x-service-token": "s3cret-s3cret-s3cret-s3cret" } }))).not.toMatch(
      /vdkfrost|279058397|s3cret/,
    );
  });
});

describe("конфигурация Telegram", () => {
  it("TELEGRAM_BOT_TOKEN и BOT_SERVICE_TOKEN необязательны; неверный токен бота — понятная ошибка без значения", () => {
    expect(loadConfig({}).TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(loadConfig({ TELEGRAM_BOT_TOKEN: ` ${PUBLIC_TOKEN} ` }).TELEGRAM_BOT_TOKEN).toBe(PUBLIC_TOKEN);
    expect(() => loadConfig({ TELEGRAM_BOT_TOKEN: "not-a-token-value" })).toThrow(/TELEGRAM_BOT_TOKEN/);
    try {
      loadConfig({ TELEGRAM_BOT_TOKEN: "not-a-token-value" });
    } catch (e) {
      expect(String(e)).not.toContain("not-a-token-value");
    }
    expect(() => loadConfig({ BOT_SERVICE_TOKEN: "short" })).toThrow(/BOT_SERVICE_TOKEN/);
  });

  it("в production секрет бота — свой и не короче 32 символов", () => {
    const prod = {
      NODE_ENV: "production",
      AUTH_JWT_PRIVATE_KEY: "pem",
      AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      AUTH_SECRET_PEPPER: "p".repeat(40),
    };
    expect(() => loadConfig({ ...prod, BOT_SERVICE_TOKEN: DEV_BOT_SERVICE_TOKEN })).toThrow(/BOT_SERVICE_TOKEN/);
    expect(loadConfig({ ...prod, BOT_SERVICE_TOKEN: "s".repeat(40) }).BOT_SERVICE_TOKEN).toBe("s".repeat(40));
  });
});
