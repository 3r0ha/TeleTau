import { describe, expect, it } from "vitest";
import { allNicknames, NICKNAME_COUNT, nicknameById, suggestNicknames } from "../src/modules/identity/nicknames.js";

// Башкирские буквы (CLAUDE.md, правило 7) — в словаре их быть не должно (правило 6).
const BASHKIR = /[ӘәӨөҮүҒғҠҡҢңҘҙҪҫҺһ]/u;

describe("nickname dictionary (ADR 0009)", () => {
  const all = allNicknames();

  it("is large enough for a school and every id matches the contract pattern", () => {
    expect(NICKNAME_COUNT).toBeGreaterThanOrEqual(1000);
    expect(new Set(all.map((n) => n.text)).size).toBe(all.length);
    for (const n of all) {
      expect(n.id).toMatch(/^[a-z0-9.:_-]{1,64}$/);
      expect(nicknameById(n.id)).toEqual(n);
    }
  });

  it("is Russian only: two Cyrillic words, capitalized, no Bashkir letters", () => {
    for (const n of all) {
      expect(n.text).toMatch(/^[А-ЯЁ][а-яё]+ [а-яё]+$/u);
      expect(n.text).not.toMatch(BASHKIR);
    }
  });

  it("agrees the adjective with the noun's grammatical gender", () => {
    expect(nicknameById("a00.n00")?.text).toBe("Смелая пчела");
    expect(nicknameById("a00.n01")?.text).toBe("Смелый шмель");
    expect(nicknameById("a23.n32")?.text).toBe("Весеннее солнце");
    expect(nicknameById("a30.n03")?.text).toBe("Озорной ёж");
  });

  it("rejects unknown ids and suggests distinct nicknames", () => {
    for (const id of ["a99.n00", "a00.n99", "x", "a0.n0", "Смелая пчела"]) expect(nicknameById(id)).toBeUndefined();
    const s = suggestNicknames(10);
    expect(s).toHaveLength(10);
    expect(new Set(s.map((n) => n.id)).size).toBe(10);
  });
});
