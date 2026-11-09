import { describe, expect, it } from "vitest";
import { createFastifyAdapter } from "../src/bootstrap.js";
import { decrypt, encrypt, hexEquals, sha256Hex } from "../src/common/crypto.js";
import { decodeCursor, encodeCursor, KeysetCursor, OffsetCursor } from "../src/common/cursor.js";
import { validationErrors } from "../src/common/problem.filter.js";
import { normalizePersonName, normalizePosition, normalizeTextField } from "../src/common/text.js";
import { currentAcademicYear, ufaToday } from "../src/common/time.js";
import { loadConfig } from "../src/config/config.js";
import { demoStaffEnabled, encryptionKey } from "../src/config/secrets.js";
import { requestFingerprint } from "../src/infra/idempotency.js";
import { uiModeForGrade } from "../src/modules/identity/accounts.service.js";
import { normalizeClassLetter } from "../src/modules/org/classes.service.js";
import { nameKey, parseCsv, parseSchools, readDirectory } from "../src/modules/org/directory-import.js";

describe("AES-256-GCM sealing", () => {
  const key = encryptionKey(loadConfig({}));
  it("round-trips and binds the ciphertext to its purpose (AAD)", () => {
    const sealed = encrypt(key, "SECRET", "print-job:1");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(decrypt(key, sealed, "print-job:1")).toBe("SECRET");
    expect(() => decrypt(key, sealed, "print-job:2")).toThrow();
    expect(() => decrypt(Buffer.alloc(32, 1), sealed, "print-job:1")).toThrow();
  });
  it("compares hashes in constant time and refuses empty or different lengths", () => {
    expect(hexEquals(sha256Hex("a"), sha256Hex("a"))).toBe(true);
    expect(hexEquals(sha256Hex("a"), sha256Hex("b"))).toBe(false);
    expect(hexEquals("", "")).toBe(false);
    expect(hexEquals("ab", "abcd")).toBe(false);
  });
});

describe("config for auth (ADR 0015)", () => {
  it("derives a stable dev encryption key but refuses weak secrets in production", () => {
    expect(encryptionKey(loadConfig({})).equals(encryptionKey(loadConfig({})))).toBe(true);
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/AUTH_JWT_PRIVATE_KEY[\s\S]*AUTH_ENCRYPTION_KEY[\s\S]*AUTH_SECRET_PEPPER/);
    expect(() => loadConfig({ AUTH_DEMO_OTP: "12" })).toThrow(/AUTH_DEMO_OTP/);
    expect(loadConfig({ AUTH_DEMO_OTP: "" }).AUTH_DEMO_OTP).toBeUndefined();
    expect(loadConfig({ TRUST_PROXY: "2" }).TRUST_PROXY).toBe(2);
    expect(loadConfig({}).TRUST_PROXY).toBe(false);
    expect(loadConfig({ TRUST_PROXY: "loopback" }).TRUST_PROXY).toEqual(["loopback"]);
    expect(loadConfig({ TRUST_PROXY: "10.0.0.0/8, ::1" }).TRUST_PROXY).toEqual(["10.0.0.0/8", "::1"]);
    for (const bad of ["yes", "10.0.0.0/33", "10.0.0.1/8/1", "loopback,"]) expect(() => loadConfig({ TRUST_PROXY: bad }), bad).toThrow(/TRUST_PROXY/);
  });
  it("demo staff need their own flag AUTH_DEMO_STAFF, forbidden in production (M1-21)", () => {
    expect(loadConfig({}).AUTH_DEMO_STAFF).toBe(false);
    expect(loadConfig({ AUTH_DEMO_STAFF: "" }).AUTH_DEMO_STAFF).toBe(false);
    expect(loadConfig({ AUTH_DEMO_STAFF: "0" }).AUTH_DEMO_STAFF).toBe(false);
    expect(loadConfig({ AUTH_DEMO_STAFF: "1" }).AUTH_DEMO_STAFF).toBe(true);
    expect(loadConfig({ AUTH_DEMO_STAFF: "true" }).AUTH_DEMO_STAFF).toBe(true);
    expect(() => loadConfig({ AUTH_DEMO_STAFF: "yes" })).toThrow(/AUTH_DEMO_STAFF/);
    // Демо-код сам по себе демо-сотрудников не включает.
    expect(demoStaffEnabled(loadConfig({ AUTH_DEMO_OTP: "0000" }))).toBe(false);
    expect(demoStaffEnabled(loadConfig({ AUTH_DEMO_OTP: "0000", AUTH_DEMO_STAFF: "1" }))).toBe(true);
    expect(() => loadConfig({ NODE_ENV: "production", AUTH_DEMO_STAFF: "1" })).toThrow(/демо-сотрудники запрещены в production[\s\S]*AUTH_DEMO_STAFF/);
  });
});

describe("permanent demo class code AUTH_DEMO_CLASS_CODE (M2)", () => {
  it("6 Crockford symbols, upper-cased; empty — off; forbidden in production", () => {
    expect(loadConfig({}).AUTH_DEMO_CLASS_CODE).toBeUndefined();
    expect(loadConfig({ AUTH_DEMO_CLASS_CODE: "" }).AUTH_DEMO_CLASS_CODE).toBeUndefined();
    expect(loadConfig({ AUTH_DEMO_CLASS_CODE: "000000" }).AUTH_DEMO_CLASS_CODE).toBe("000000");
    expect(loadConfig({ AUTH_DEMO_CLASS_CODE: " k7q4mz " }).AUTH_DEMO_CLASS_CODE).toBe("K7Q4MZ");
    for (const bad of ["00000", "0000000", "000-000", "OOOOOO", "IIIIII", "ЖЖЖЖЖЖ"]) {
      expect(() => loadConfig({ AUTH_DEMO_CLASS_CODE: bad }), bad).toThrow(/AUTH_DEMO_CLASS_CODE/);
    }
    expect(() => loadConfig({ NODE_ENV: "production", AUTH_DEMO_CLASS_CODE: "000000" })).toThrow(/постоянный код класса запрещён в production[\s\S]*AUTH_DEMO_CLASS_CODE/);
  });
});

describe("grade → UI mode (M1-16, docs/05 §7)", () => {
  it("1–4 → bee, 5–8 → bortnik, 9–11 → keeper", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(uiModeForGrade)).toEqual([
      "bee", "bee", "bee", "bee", "bortnik", "bortnik", "bortnik", "bortnik", "keeper", "keeper", "keeper",
    ]);
  });
});

describe("Idempotency-Key request fingerprint (M1-06)", () => {
  it("does not depend on key order and differs for a different body", () => {
    expect(requestFingerprint({ a: 1, b: { c: [1, 2], d: "x" } })).toBe(requestFingerprint({ b: { d: "x", c: [1, 2] }, a: 1 }));
    expect(requestFingerprint({ count: 24 })).not.toBe(requestFingerprint({ count: 25 }));
    expect(requestFingerprint({ count: 24 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("TRUST_PROXY: rate limits see the student IP, not the IP of the Next.js BFF (M1)", () => {
  /** request.ip, каким его видят ограничения частоты, для запроса с адреса `remote` и заголовком X-Forwarded-For. */
  async function clientIp(trust: string, remote: string, xff?: string): Promise<string> {
    const app = createFastifyAdapter(loadConfig({ TRUST_PROXY: trust })).getInstance();
    app.get("/ip", async (req) => ({ ip: req.ip }));
    const res = await app.inject({ url: "/ip", remoteAddress: remote, headers: xff ? { "x-forwarded-for": xff } : {} });
    await app.close();
    return (res.json() as { ip: string }).ip;
  }

  it("dev (loopback): the BFF on this machine passes the browser IP, a remote client cannot spoof it", async () => {
    expect(await clientIp("loopback", "127.0.0.1", "203.0.113.7")).toBe("203.0.113.7");
    expect(await clientIp("loopback", "::1", "203.0.113.7")).toBe("203.0.113.7");
    // Подделанный адрес слева в цепочке не помогает: берётся ближайший недоверенный.
    expect(await clientIp("loopback", "127.0.0.1", "198.51.100.1, 203.0.113.7")).toBe("203.0.113.7");
    expect(await clientIp("loopback", "10.1.2.3", "203.0.113.7")).toBe("10.1.2.3");
    expect(await clientIp("loopback", "127.0.0.1")).toBe("127.0.0.1");
  });

  it("without TRUST_PROXY X-Forwarded-For is ignored; a hop count trusts exactly that many proxies", async () => {
    expect(await clientIp("false", "127.0.0.1", "203.0.113.7")).toBe("127.0.0.1");
    expect(await clientIp("1", "10.0.0.5", "198.51.100.1, 203.0.113.7")).toBe("203.0.113.7");
  });
});

describe("free text with Bashkir letters goes through @teletau/bashkir-text (rule 7)", () => {
  // Башкирское слово в тестах — «кәрәҙ» («соты», docs/native-review-queue.md, №3).
  it("normalizes NFC, invisible characters, homoglyphs inside Cyrillic words and spaces", () => {
    expect(normalizeTextField("  Школа\u200b   «Кәрәҙ» ", "/position", 3)).toBe("Школа «Кәрәҙ»");
    expect(normalizeTextField("Учит\u0065ль", "/position", 2)).toBe("Учитель"); // латинская e внутри кириллического слова
    expect(normalizeTextField("\u0435\u0308ж", "/x", 1)).toBe("ёж"); // е + U+0308 → ё (NFC)
  });
  it("rejects a value that is too short after normalization, with a field pointer", () => {
    expect(() => normalizeTextField(" \u200b\u00ad ", "/reason", 3)).toThrow(/422/);
  });
  it("rejects control characters U+0000–U+001F and U+007F–U+009F with 422 before they reach Postgres (M1-01)", () => {
    for (const bad of ["Секретова\u0000 Зульфия", "a\u0001b", "Учитель\u001f", "x\u007fy", "x\u0085y", "две\nстроки", "таб\tуляция"]) {
      expect(() => normalizeTextField(bad, "/position", 2), JSON.stringify(bad)).toThrow(/422/);
    }
    // В многострочном поле (причина отказа) переводы строк допустимы и схлопываются в пробел, NUL — нет.
    expect(normalizeTextField("Школа не\r\nподтвердила\tзаявку", "/reason", 3, { multiline: true })).toBe("Школа не подтвердила заявку");
    expect(() => normalizeTextField("Школа\u0000", "/reason", 3, { multiline: true })).toThrow(/422/);
  });
});

describe("full name of an adult (M1-34): Russian and Bashkir letters, space, hyphen, apostrophe", () => {
  // Башкирские буквы в тесте — отдельные буквы алфавита, не слова (новых башкирских слов не добавляем, правило 6).
  it("accepts Cyrillic names with Bashkir letters, double surnames and apostrophes", () => {
    expect(normalizePersonName("  Иванова   Мария Петровна ", "/fullName")).toBe("Иванова Мария Петровна");
    expect(normalizePersonName("Салтыкова-Щедрина Анна", "/fullName")).toBe("Салтыкова-Щедрина Анна");
    expect(normalizePersonName("Д\u2019Артаньян Шарль", "/fullName")).toBe("Д\u2019Артаньян Шарль");
    expect(normalizePersonName("Ҡәҙҫһ Әөүңғ Ё", "/fullName")).toBe("Ҡәҙҫһ Әөүңғ Ё");
    // латинские двойники внутри кириллического слова заменяются нормализацией и проходят
    expect(normalizePersonName("Ив\u0061нова Мария", "/fullName")).toBe("Иванова Мария");
  });
  it("rejects emoji, digits, Latin words, dots and lone separators with a Russian detail", () => {
    for (const bad of ["😀😀 😀", "Иванова 2", "John Smith", "Иванова A. И.", "Иванова Мария.", "Иванова - Мария", "Иванова \u0000Мария", "Ab"]) {
      try {
        normalizePersonName(bad, "/fullName");
        expect.unreachable(bad);
      } catch (e) {
        expect((e as { status: number }).status, bad).toBe(422);
        expect((e as { errors: Array<{ pointer: string; detail: string }> }).errors[0]!.pointer).toBe("/fullName");
      }
    }
  });
});

describe("position of a teacher (M1-41, M1-62): the error names what is missing", () => {
  const detailOf = (raw: string): string | undefined => {
    try {
      normalizePosition(raw, "/position");
      return undefined;
    } catch (e) {
      return (e as { errors: Array<{ detail: string }> }).errors[0]!.detail;
    }
  };
  it("accepts letters with digits and punctuation", () => {
    expect(normalizePosition("Зам. директора по УВР (№ 2), учитель-логопед", "/position")).toBe("Зам. директора по УВР (№ 2), учитель-логопед");
    expect(normalizePosition("Учитель 1-й категории", "/position")).toBe("Учитель 1-й категории");
  });
  it("digits and punctuation only — «Нужна хотя бы одна буква»", () => {
    for (const raw of ["1", "12", "—", "№ 2", "(1)"]) expect(detailOf(raw), raw).toBe("Нужна хотя бы одна буква");
  });
  it("other characters — the list of allowed ones; one letter — the length", () => {
    for (const raw of ["😀", "Учитель 😀", "Teacher", "1 😀"]) {
      expect(detailOf(raw), raw).toBe("Только русские или башкирские буквы, цифры, пробел и знаки препинания");
    }
    expect(detailOf(" а ")).toBe("Не короче 2 символов");
  });
});

describe("cursor (M1-19: validated by each endpoint schema)", () => {
  const id = "01a19e94-6c3c-7000-8000-000000000001";
  it("is opaque base64url and round-trips", () => {
    const c = encodeCursor({ at: "2026-11-03T00:00:00.000Z", id });
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(c, KeysetCursor)).toEqual({ at: "2026-11-03T00:00:00.000Z", id });
    expect(decodeCursor(encodeCursor({ o: 50 }), OffsetCursor)).toEqual({ o: 50 });
    expect(decodeCursor(undefined, OffsetCursor)).toBeUndefined();
  });
  it("rejects garbage, foreign shapes and wrong types with 422 and a Russian detail", () => {
    const bad = [
      ["%%%", KeysetCursor],
      [encodeCursor({ o: 1 }), KeysetCursor],
      [encodeCursor({ at: "x", id: "y" }), KeysetCursor],
      [encodeCursor({ at: "2026-11-03T00:00:00.000Z", id: "not-a-uuid" }), KeysetCursor],
      [encodeCursor({ o: "abc" }), OffsetCursor],
      [encodeCursor({ o: -5 }), OffsetCursor],
      [encodeCursor({ o: 1.5 }), OffsetCursor],
      [encodeCursor({ o: 1, extra: 2 }), OffsetCursor],
      [Buffer.from("null").toString("base64url"), OffsetCursor],
    ] as const;
    for (const [raw, schema] of bad) {
      try {
        decodeCursor(raw, schema);
        expect.unreachable(raw);
      } catch (e) {
        expect((e as { status: number }).status, raw).toBe(422);
        expect((e as { errors: Array<{ pointer: string; detail: string }> }).errors[0]).toMatchObject({ pointer: "#/query/cursor", detail: expect.stringMatching(/курсор/) });
      }
    }
  });
});

describe("validation errors → FieldError pointers (contract FieldError)", () => {
  it("maps body to JSON Pointers and other parts to #/query, #/path, #/header, with Russian details (M1-34)", () => {
    expect(
      validationErrors({ validation: [{ instancePath: "", keyword: "required", message: "must have required property 'count'", params: { missingProperty: "count" } }] }),
    ).toEqual([{ pointer: "/count", detail: "Обязательное поле" }]);
    expect(validationErrors({ validationContext: "querystring", validation: [{ instancePath: "/limit", keyword: "maximum", message: "must be <= 100", params: { limit: 100 } }] })).toEqual([
      { pointer: "#/query/limit", detail: "Не больше 100" },
    ]);
    expect(validationErrors({ validationContext: "params", validation: [{ instancePath: "/id", keyword: "format", message: "must match format \"uuid\"", params: { format: "uuid" } }] })).toEqual([
      { pointer: "#/path/id", detail: "Неверный идентификатор" },
    ]);
    const details = validationErrors({
      validation: [
        { instancePath: "", keyword: "additionalProperties", params: { additionalProperty: "x" } },
        { instancePath: "/fullName", keyword: "minLength", params: { limit: 3 } },
        { instancePath: "/count", keyword: "type", params: { type: "integer" } },
        { instancePath: "/program", keyword: "enum", params: {} },
        { instancePath: "/email", keyword: "format", params: { format: "email" } },
        { instancePath: "/odd", keyword: "somethingNew", params: {} },
      ],
    }).map((e) => e.detail);
    expect(details).toEqual(["Лишнее поле — его нет в описании запроса", "Не короче 3 символов", "Нужно целое число", "Недопустимое значение", "Неверный адрес e-mail", "Неверное значение"]);
    for (const d of details) expect(d).toMatch(/[а-яё]/i);
    expect(validationErrors({ validationContext: "headers", validation: [{ instancePath: "", params: { missingProperty: "x-poll-token" }, message: "m" }] })[0]!.pointer).toBe(
      "#/header/x-poll-token",
    );
  });
});

describe("class letter (Cyrillic incl. Bashkir, correct code points)", () => {
  it("uppercases and accepts Bashkir letters", () => {
    expect(normalizeClassLetter(" б ")).toBe("Б");
    expect(normalizeClassLetter("ә")).toBe("Ә"); // ә → Ә
    expect(normalizeClassLetter("ҡ")).toBe("Ҡ"); // ҡ → Ҡ
    expect(normalizeClassLetter("1")).toBe("1");
  });
  it("uses the canonical form of @teletau/bashkir-text: homoglyphs inside Cyrillic words, Kazakh қ → Ҡ", () => {
    expect(normalizeClassLetter("қ")).toBe("Ҡ");
    expect(normalizeClassLetter("б\u0061")).toBe("БА"); // латинская a рядом с кириллицей
    expect(normalizeClassLetter("\u200bб")).toBe("Б");
    expect(normalizeClassLetter("ё")).toBe("Ё");
  });
  it("rejects Latin without Cyrillic around, Tatar and other alphabets instead of guessing", () => {
    for (const bad of ["B", "ə", "җ", "ӑ", "і", "АБВГ", "", " ", "А Б", "5-"]) expect(() => normalizeClassLetter(bad), bad).toThrow(/422/);
  });
});

describe("school days and the academic year are in Ufa time", () => {
  it("switches the date at Ufa midnight (UTC+5)", () => {
    expect(ufaToday(new Date("2026-11-02T18:59:00Z"))).toBe("2026-11-02");
    expect(ufaToday(new Date("2026-11-02T19:00:00Z"))).toBe("2026-11-03");
  });
  it("starts a new academic year in August", () => {
    expect(currentAcademicYear(new Date("2026-07-31T12:00:00Z"))).toBe(2025);
    expect(currentAcademicYear(new Date("2026-08-01T12:00:00Z"))).toBe(2026);
    expect(currentAcademicYear(new Date("2027-05-01T12:00:00Z"))).toBe(2026);
  });
});

describe("directory CSV (RFC 4180)", () => {
  it("parses quotes, doubled quotes, commas and CRLF", () => {
    expect(parseCsv('a,b\r\n1,"x, ""y"""\r\n2,\r\n')).toEqual([
      { a: "1", b: 'x, "y"' },
      { a: "2", b: "" },
    ]);
    expect(() => parseCsv('a,b\r\n1,"x\r\n')).toThrow(/кавычка/);
    expect(() => parseCsv("a,b\r\n1\r\n")).toThrow(/полей/);
  });
  it("compares names ignoring case, ё/е and extra spaces", () => {
    expect(nameKey("  МБОУ  «Лицей»  Ёлки ")).toBe(nameKey("мбоу «лицей» елки"));
    // Свёртка @teletau/bashkir-text: особые буквы и двойники не создают «новых» филиалов при повторном импорте.
    expect(nameKey("СОШ «Кәрәҙ»")).toBe(nameKey("сош «караз»"));
    expect(nameKey("cредняя школа")).toBe(nameKey("средняя школа")); // латинская c внутри слова
  });
  it("treats empty, blank and dash values as missing: a branch without a short name gets name_ru (M1-17)", () => {
    const header = "district_oktmo,name_ru,short_name_ru,name_ba,inn,address,category,bashkir_medium,source";
    const rows = ["-", "—", "–", "_", "", "   ", " - "].map((dash, i) => `80601000,Филиал школы № ${i + 1} в д. Кумьязы,${dash},${dash},,${dash},,,src`);
    const schools = parseSchools([header, ...rows].join("\n"));
    expect(schools.map((s) => s.shortNameRu)).toEqual(schools.map((s) => s.nameRu));
    expect(schools.every((s) => s.nameBa === null && s.address === null && s.inn === null)).toBe(true);
    expect(schools[0]!.shortNameRu).toBe("Филиал школы № 1 в д. Кумьязы");
    // Прочерк внутри значения — часть названия, а не пропуск.
    expect(parseSchools(`${header}\n80601000,СОШ - филиал,СОШ-1,,,,,,src`)[0]!.shortNameRu).toBe("СОШ-1");
    expect(() => parseSchools(`${header}\n80601000,-,x,,,,,,src`)).toThrow(/наименования/);
  });
  it("the real directory has no dash or blank names", () => {
    const { districts, schools } = readDirectory();
    for (const s of schools) {
      expect(s.shortNameRu.trim().length, s.nameRu).toBeGreaterThan(1);
      expect(s.nameRu.trim().length).toBeGreaterThan(1);
    }
    expect(districts.every((d) => d.nameRu.trim().length > 1)).toBe(true);
  });
});
