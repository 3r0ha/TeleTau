import { describe, expect, it } from "vitest";
import { redact, redactString } from "../src/common/redact.js";

describe("log redaction (ADR 0015 §5)", () => {
  it("masks tokens, QR payloads, JWTs, bearer headers and e-mails inside any string", () => {
    const line =
      "refresh ttr_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ poll ttp_ZZZZZZZZZZZZZZ " +
      "qr https://teletau.study/q#TT1.0123456789.ABCDEFGHJKMNPQRSTVWXYZ0123.6V lower tt1.0123456789.abcdefghjkmnpqrstvwxyz0123.6v " +
      "jwt eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln Authorization: Bearer abc.def " +
      "Key (email)=(Teacher.Name@school.example.org) already exists";
    const out = redactString(line);
    for (const leak of ["ttr_AbCd", "ttp_ZZZZ", "0123456789.ABCDEF", "abcdefghjkmn", "eyJhbGci", "Teacher.Name@", "abc.def"]) {
      expect(out).not.toContain(leak);
    }
    expect(out).toContain("[email]");
    expect(out).toContain("TT1.[redacted]");
  });

  it("masks the personal login card payload TP1 (ADR 0022)", () => {
    const out = redactString("card TP1.0123456789.ABCDEFGHJKMNPQRSTVWXYZ0123.4S and tp1.0123456789.abcdefghjkmnpqrstvwxyz0123.4s");
    expect(out).not.toContain("ABCDEFGHJKMN");
    expect(out).not.toContain("abcdefghjkmn");
    expect(out).toContain("TP1.[redacted]");
  });

  it("masks sensitive keys at any depth and keeps the rest", () => {
    const value = {
      method: "POST",
      body: { email: "a@b.cd", refreshToken: "x", nested: [{ payload: "TT1.whatever" }], fullName: "Иванов Иван" },
      headers: { Authorization: "Bearer t", "X-Poll-Token": "p", "content-type": "application/json" },
    };
    expect(redact(value)).toEqual({
      method: "POST",
      body: { email: "[redacted]", refreshToken: "[redacted]", nested: [{ payload: "[redacted]" }], fullName: "[redacted]" },
      headers: { Authorization: "[redacted]", "X-Poll-Token": "[redacted]", "content-type": "application/json" },
    });
  });

  it("redacts error messages and stacks", () => {
    const e = redact(new Error("duplicate key: teacher@example.org")) as Error;
    expect(e.message).toBe("duplicate key: [email]");
    expect(e.stack).not.toContain("teacher@example.org");
  });
});
