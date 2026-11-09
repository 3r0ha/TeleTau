import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  CLASS_CODE_LENGTH,
  CROCKFORD_ALPHABET,
  QR_SEAT_LENGTH,
  QR_SECRET_LENGTH,
  buildQrLink,
  generateClassCode,
  generateQrCard,
  normalizeCodeInput,
  parseClassCode,
  parseQrPayload,
  qrCardFromRandomBytes,
  secureRandomBytes,
} from "../src/index.js";

const SEED = 20261103;
const bytes = (n: number) => fc.uint8Array({ minLength: n, maxLength: n });
const card = bytes(QR_SEAT_LENGTH + QR_SECRET_LENGTH).map(qrCardFromRandomBytes);

describe("QR card properties", () => {
  it("build → parse round-trips, including through the link", () => {
    fc.assert(
      fc.property(card, (c) => {
        expect(parseQrPayload(c.payload)).toEqual({ ok: true, ...c });
        expect(parseQrPayload(buildQrLink("https://teletau.study", c.payload))).toEqual({ ok: true, ...c });
        expect(parseQrPayload(c.payload.toLowerCase())).toEqual({ ok: true, ...c });
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });

  it("any single-symbol substitution in seat or secret is caught by the checksum", () => {
    fc.assert(
      fc.property(card, fc.nat(), fc.integer({ min: 1, max: 31 }), (c, pos, delta) => {
        const body = c.seat + c.secret;
        const i = pos % body.length;
        const replaced = CROCKFORD_ALPHABET[(CROCKFORD_ALPHABET.indexOf(body[i]!) + delta) % 32]!;
        const typo = body.slice(0, i) + replaced + body.slice(i + 1);
        const check = c.payload.slice(-2);
        const payload = `TT1.${typo.slice(0, QR_SEAT_LENGTH)}.${typo.slice(QR_SEAT_LENGTH)}.${check}`;
        expect(parseQrPayload(payload)).toEqual({ ok: false, error: "bad_checksum" });
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });

  it("any transposition of two different adjacent symbols is caught by the checksum", () => {
    fc.assert(
      fc.property(card, fc.nat(), (c, pos) => {
        const body = c.seat + c.secret;
        const i = pos % (body.length - 1);
        fc.pre(body[i] !== body[i + 1]);
        const swapped = body.slice(0, i) + body[i + 1] + body[i] + body.slice(i + 2);
        const payload = `TT1.${swapped.slice(0, QR_SEAT_LENGTH)}.${swapped.slice(QR_SEAT_LENGTH)}.${c.payload.slice(-2)}`;
        expect(parseQrPayload(payload)).toEqual({ ok: false, error: "bad_checksum" });
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });

  it("parsing never throws on arbitrary input", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (s) => {
        const r = parseQrPayload(s);
        expect(typeof r.ok).toBe("boolean");
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });
});

describe("class code properties", () => {
  it("generated codes parse back, also as displayed and in lower case", () => {
    fc.assert(
      fc.property(bytes(CLASS_CODE_LENGTH), (b) => {
        const code = generateClassCode(() => b);
        expect(parseClassCode(code.code)).toEqual({ ok: true, ...code });
        expect(parseClassCode(code.display.toLowerCase())).toEqual({ ok: true, ...code });
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });

  it("normalization is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (s) => {
        const once = normalizeCodeInput(s);
        expect(normalizeCodeInput(once)).toBe(once);
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });
});

describe("randomness source", () => {
  it("uses the Web Crypto CSPRNG by default", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    try {
      generateQrCard();
      generateClassCode();
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("asks for exactly 36 bytes per card and 6 per class code", () => {
    const lengths: number[] = [];
    const spy = (n: number) => {
      lengths.push(n);
      return secureRandomBytes(n);
    };
    generateQrCard(spy);
    generateClassCode(spy);
    expect(lengths).toEqual([36, 6]);
  });

  it("10 000 generated cards have distinct seats and secrets", () => {
    const seats = new Set<string>();
    const secrets = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const c = generateQrCard();
      seats.add(c.seat);
      secrets.add(c.secret);
    }
    expect(seats.size).toBe(10_000);
    expect(secrets.size).toBe(10_000);
  });
});
