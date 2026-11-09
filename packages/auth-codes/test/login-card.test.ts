// Свойства личной карточки входа и общего разбора сканера (ADR 0022). Векторы — contracts/test-vectors/login-card/.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CROCKFORD_ALPHABET,
  QR_SEAT_LENGTH,
  QR_SECRET_LENGTH,
  generatePersonalCard,
  parseLoginCard,
  parseQrPayload,
  personalCardFromRandomBytes,
  qrCardFromRandomBytes,
} from "../src/index.js";

const SEED = 20261105;
const bytes = (n: number) => fc.uint8Array({ minLength: n, maxLength: n });
const personal = bytes(QR_SEAT_LENGTH + QR_SECRET_LENGTH).map(personalCardFromRandomBytes);
const seat = bytes(QR_SEAT_LENGTH + QR_SECRET_LENGTH).map(qrCardFromRandomBytes);

describe("personal login card", () => {
  it("build → parse round-trips as kind personal, also in lower case", () => {
    fc.assert(
      fc.property(personal, (c) => {
        const expected = { ok: true, kind: "personal", handle: c.handle, secret: c.secret, payload: c.payload };
        expect(parseLoginCard(c.payload)).toEqual(expected);
        expect(parseLoginCard(c.payload.toLowerCase())).toEqual(expected);
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });

  it("seat cards parse with the same scanner as kind seat", () => {
    fc.assert(
      fc.property(seat, (c) => {
        expect(parseLoginCard(c.payload)).toEqual({ ok: true, kind: "seat", handle: c.seat, secret: c.secret, payload: c.payload });
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });

  it("swapping the prefix TT1 ↔ TP1 always breaks the checksum — the kinds never mix", () => {
    fc.assert(
      fc.property(personal, seat, (p, s) => {
        expect(parseLoginCard(p.payload.replace(/^TP1/, "TT1"))).toEqual({ ok: false, error: "bad_checksum" });
        expect(parseLoginCard(s.payload.replace(/^TT1/, "TP1"))).toEqual({ ok: false, error: "bad_checksum" });
        // Старый разбор карточки места личную карточку не принимает вовсе.
        expect(parseQrPayload(p.payload).ok).toBe(false);
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });

  it("any single-symbol substitution is caught", () => {
    fc.assert(
      fc.property(personal, fc.nat(), fc.integer({ min: 1, max: 31 }), (c, pos, delta) => {
        const body = c.handle + c.secret;
        const i = pos % body.length;
        const typo = body.slice(0, i) + CROCKFORD_ALPHABET[(CROCKFORD_ALPHABET.indexOf(body[i]!) + delta) % 32]! + body.slice(i + 1);
        const payload = `TP1.${typo.slice(0, QR_SEAT_LENGTH)}.${typo.slice(QR_SEAT_LENGTH)}.${c.payload.slice(-2)}`;
        expect(parseLoginCard(payload)).toEqual({ ok: false, error: "bad_checksum" });
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });

  it("parsing never throws on arbitrary input", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (s) => {
        expect(typeof parseLoginCard(s).ok).toBe("boolean");
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });

  it("generated cards are distinct", () => {
    const handles = new Set<string>();
    for (let i = 0; i < 5000; i++) handles.add(generatePersonalCard().handle);
    expect(handles.size).toBe(5000);
  });
});
