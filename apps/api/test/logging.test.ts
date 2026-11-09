// Логи без ПДн и без падений: ошибки БД описываются кодами и именами, без текста и параметров;
// логгер не падает без стека; хвост «params:» вырезается из любой строки.
import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError, sqlOperation, stackFrames } from "../src/common/errors.js";
import { RedactingLogger } from "../src/common/logger.js";
import { redactString } from "../src/common/redact.js";

const FULL_NAME = "Секретова Зульфия Рашитовна";
const POSITION = "Завуч гимназии 3";

/** Ошибка pg (DatabaseError): поля без значений + сообщение, в котором значения бывают. */
function pgError(code: string, extra: Record<string, string> = {}): Error {
  return Object.assign(new Error(`invalid byte sequence for encoding "UTF8": 0x00 near "${FULL_NAME}"`), { code, severity: "ERROR", ...extra });
}

function drizzleError(): DrizzleQueryError {
  return new DrizzleQueryError(
    'update "pii"."adult_profiles" set "full_name" = $1, "position" = $2, "updated_at" = $3 where "pii"."adult_profiles"."account_id" = $4',
    [FULL_NAME, POSITION, "2026-11-02T23:24:49.653Z", "01a19e94-6c3c-7000-8000-000000000001"],
    pgError("22021", { table: "adult_profiles", routine: "report_invalid_encoding" }),
  );
}

describe("describeError: database errors without values (M1-01)", () => {
  it("names the operation, SQLSTATE, table and constraint, never the message or params", () => {
    const text = describeError(drizzleError());
    expect(text).toBe('DrizzleQueryError (update "pii"."adult_profiles") ← caused by PostgresError SQLSTATE=22021 table=adult_profiles routine=report_invalid_encoding');
    expect(text).not.toContain(FULL_NAME);
    expect(text).not.toContain(POSITION);
    expect(text).not.toContain("params");
    const unique = describeError(new DrizzleQueryError('insert into "teacher_verifications" ("id") values ($1)', ["x"], pgError("23505", { constraint: "teacher_verifications_one_pending_uq" })));
    expect(unique).toContain("SQLSTATE=23505 constraint=teacher_verifications_one_pending_uq");
  });
  it("extracts the verb and the first table of a query", () => {
    expect(sqlOperation('select "id" from "schools" where "id" = $1')).toBe('select "schools"');
    expect(sqlOperation('insert into "pii"."adult_profiles" ("x") values ($1)')).toBe('insert "pii"."adult_profiles"');
    expect(sqlOperation("SELECT 1")).toBe("select");
  });
  it("keeps the name and a redacted message of other errors; stack frames carry no message", () => {
    expect(describeError(new TypeError("Cannot read properties of undefined (reading 'replace') for teacher@example.org"))).toBe(
      "TypeError: Cannot read properties of undefined (reading 'replace') for [email]",
    );
    const frames = stackFrames(drizzleError())!;
    expect(frames).toMatch(/^\s+at /);
    expect(frames).not.toContain(FULL_NAME);
    expect(describeError("boom")).toBe("thrown string");
  });
});

describe("redactString: the «params:» tail of a Drizzle error is cut from any string (second line of defence)", () => {
  it("removes params up to the first stack frame, including multi-line values", () => {
    const stack = `Error: Failed query: update "pii"."adult_profiles" set "full_name" = $1\nparams: ${FULL_NAME},${POSITION}\nвторая строка значения\n    at PgPreparedQuery.queryWithCache (file.js:1:2)\n    at next (file.js:3:4)`;
    const out = redactString(stack);
    expect(out).not.toContain(FULL_NAME);
    expect(out).not.toContain("вторая строка значения");
    expect(out).toContain("params: [redacted]");
    expect(out).toContain("at PgPreparedQuery.queryWithCache");
    expect(redactString(`x\nparams: ${FULL_NAME}`)).toBe("x\nparams: [redacted]");
  });
});

describe("RedactingLogger (M1-04)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not crash on error() without a stack and still masks secrets", () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => (writes.push(String(c)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((c: string | Uint8Array) => (writes.push(String(c)), true));
    const logger = new RedactingLogger("QA");
    expect(() => logger.error("boom")).not.toThrow();
    expect(() => logger.error("boom", undefined)).not.toThrow();
    expect(() => logger.error("boom for teacher@example.org", `Error: x\nparams: ${FULL_NAME}\n    at f (a.js:1:1)`)).not.toThrow();
    const out = writes.join("");
    expect(out).toContain("boom");
    expect(out).not.toContain("teacher@example.org");
    expect(out).not.toContain(FULL_NAME);
  });
});
