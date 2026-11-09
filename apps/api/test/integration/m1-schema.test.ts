// Защиты схемы на уровне БД (миграции 0001–0002; ADR 0009, 0016, 0017) против docker-compose (pnpm db:migrate).
// Каждый тест работает в транзакции и откатывает её: в журнале аудита и в pii после тестов ничего не остаётся.
import pg from "pg";
import { afterAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { uuidv7 } from "../../src/common/uuidv7.js";
import { loadConfig } from "../../src/config/config.js";

const config = loadConfig(process.env);
const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
let client: pg.PoolClient;

afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  client = await pool.connect();
  await client.query("BEGIN");
});
afterEach(async () => {
  await client.query("ROLLBACK");
  client.release();
});

/** Выполняет запрос и ждёт ошибку Postgres с кодом `code`; транзакция продолжается (точка сохранения). */
async function expectPgError(sql: string, params: unknown[], code: string, message?: RegExp): Promise<void> {
  await client.query("SAVEPOINT expect_error");
  let error: (Error & { code?: string }) | undefined;
  try {
    await client.query(sql, params);
  } catch (e) {
    error = e as Error & { code?: string };
  }
  await client.query("ROLLBACK TO SAVEPOINT expect_error");
  expect(error, `ожидалась ошибка ${code}: ${sql}`).toBeDefined();
  expect(error!.code).toBe(code);
  if (message) expect(error!.message).toMatch(message);
}

const hex64 = (c: string) => c.repeat(64);

async function insertAudit(): Promise<string> {
  const id = uuidv7();
  await client.query("INSERT INTO audit_log (id, action, target_type, metadata) VALUES ($1, 'card.issued', 'class_seat', $2)", [
    id,
    { seat: 7, version: 1 },
  ]);
  return id;
}

async function insertClass(): Promise<{ classId: string; schoolId: string }> {
  const districtId = uuidv7();
  const schoolId = uuidv7();
  const classId = uuidv7();
  await client.query(
    "INSERT INTO districts (id, oktmo, name_ru, kind, source, is_demo) VALUES ($1, $2, 'Демо-район', 'municipal_district', 'test', true)",
    [districtId, `demo-${districtId}`],
  );
  await client.query(
    "INSERT INTO schools (id, district_id, name_ru, short_name_ru, source, is_demo) VALUES ($1, $2, 'Демо-школа № 1', 'Демо № 1', 'test', true)",
    [schoolId, districtId],
  );
  await client.query(
    "INSERT INTO classes (id, school_id, teacher_account_id, grade, letter, program, academic_year) VALUES ($1, $2, $3, 5, 'Б', 'native', 2026)",
    [classId, schoolId, uuidv7()],
  );
  return { classId, schoolId };
}

describe("migrations 0001–0002 (M1 schema)", () => {
  it("created every M1 table in its schema", async () => {
    const { rows } = await client.query<{ t: string }>(
      "SELECT table_schema || '.' || table_name AS t FROM information_schema.tables WHERE table_schema IN ('public', 'pii') ORDER BY 1",
    );
    const tables = rows.map((r) => r.t);
    for (const t of [
      "public.accounts", "public.credentials", "public.sessions", "public.devices", "pii.adult_profiles",
      "public.districts", "public.schools", "public.classes", "public.class_seats", "public.seat_cards",
      "public.memberships", "public.join_requests", "public.legal_documents", "public.consents",
      "public.teacher_verifications", "public.audit_log",
    ]) {
      expect(tables).toContain(t);
    }
  });
});

describe("audit_log is append-only (ADR 0017)", () => {
  it("accepts inserts", async () => {
    const id = await insertAudit();
    const { rows } = await client.query("SELECT action, metadata FROM audit_log WHERE id = $1", [id]);
    expect(rows).toEqual([{ action: "card.issued", metadata: { seat: 7, version: 1 } }]);
  });

  it("rejects UPDATE, DELETE and TRUNCATE even for the table owner (trigger)", async () => {
    const id = await insertAudit();
    await expectPgError("UPDATE audit_log SET action = 'card.revoked' WHERE id = $1", [id], "42501", /append-only: UPDATE/);
    await expectPgError("DELETE FROM audit_log WHERE id = $1", [id], "42501", /append-only: DELETE/);
    await expectPgError("TRUNCATE audit_log", [], "42501", /append-only: TRUNCATE/);
    const { rowCount } = await client.query("SELECT 1 FROM audit_log WHERE id = $1 AND action = 'card.issued'", [id]);
    expect(rowCount).toBe(1);
  });

  it("the application role teletau_app may insert and read, but has no UPDATE/DELETE/TRUNCATE privilege", async () => {
    const id = await insertAudit();
    await client.query("SET LOCAL ROLE teletau_app");
    await insertAudit();
    const { rowCount } = await client.query("SELECT 1 FROM audit_log WHERE id = $1", [id]);
    expect(rowCount).toBe(1);
    await expectPgError("UPDATE audit_log SET action = 'card.revoked' WHERE id = $1", [id], "42501", /permission denied/);
    await expectPgError("DELETE FROM audit_log WHERE id = $1", [id], "42501", /permission denied/);
    await expectPgError("TRUNCATE audit_log", [], "42501", /permission denied/);
  });

  it("the application role can still update ordinary tables", async () => {
    const { classId } = await insertClass();
    await client.query("SET LOCAL ROLE teletau_app");
    const { rowCount } = await client.query("UPDATE classes SET status = 'archived' WHERE id = $1", [classId]);
    expect(rowCount).toBe(1);
  });

  it("rejects malformed actions and non-object metadata", async () => {
    await expectPgError("INSERT INTO audit_log (id, action) VALUES ($1, 'Card Issued')", [uuidv7()], "23514");
    await expectPgError("INSERT INTO audit_log (id, action, metadata) VALUES ($1, 'card.issued', '[1]')", [uuidv7()], "23514");
  });
});

describe("pii holds no rows for child accounts (ADR 0009)", () => {
  it("rejects a pii.adult_profiles row for a child account", async () => {
    const child = uuidv7();
    await client.query("INSERT INTO accounts (id, kind, roles) VALUES ($1, 'child', '{student}')", [child]);
    await expectPgError(
      "INSERT INTO pii.adult_profiles (account_id, email) VALUES ($1, 'parent@example.org')",
      [child],
      "23514",
      /child accounts have no personal data/,
    );
  });

  it("accepts an adult profile, but the account can no longer become a child", async () => {
    const adult = uuidv7();
    await client.query("INSERT INTO accounts (id, kind) VALUES ($1, 'adult')", [adult]);
    await client.query("INSERT INTO pii.adult_profiles (account_id, email, full_name) VALUES ($1, 'teacher@example.org', 'Тест Тестович')", [adult]);
    await expectPgError("UPDATE accounts SET kind = 'child' WHERE id = $1", [adult], "23514", /cannot become a child/);
  });

  it("stores e-mail only in lower case and only once", async () => {
    const a = uuidv7();
    const b = uuidv7();
    await client.query("INSERT INTO accounts (id, kind) VALUES ($1, 'adult'), ($2, 'adult')", [a, b]);
    await expectPgError("INSERT INTO pii.adult_profiles (account_id, email) VALUES ($1, 'Teacher@Example.org')", [a], "23514");
    await client.query("INSERT INTO pii.adult_profiles (account_id, email) VALUES ($1, 'teacher@example.org')", [a]);
    await expectPgError("INSERT INTO pii.adult_profiles (account_id, email) VALUES ($1, 'teacher@example.org')", [b], "23505");
  });

  it("staff accounts have no nickname; children and adult learners may (0010, ADR 0022)", async () => {
    await expectPgError(
      "INSERT INTO accounts (id, kind, nickname, nickname_key) VALUES ($1, 'staff', 'Смелая пчела', 'a1.n1')",
      [uuidv7()],
      "23514",
    );
    await client.query("INSERT INTO accounts (id, kind, nickname, nickname_key) VALUES ($1, 'adult', 'Смелая пчела', 'a1.n1')", [uuidv7()]);
    await expectPgError("INSERT INTO accounts (id, kind, daily_goal) VALUES ($1, 'child', 4)", [uuidv7()], "23514");
  });
});

describe("org: seats, cards and class codes (ADR 0016)", () => {
  it("seat numbers are unique within a class and limited to 1–99", async () => {
    const { classId } = await insertClass();
    await client.query("INSERT INTO class_seats (id, class_id, seat_number) VALUES ($1, $2, 7)", [uuidv7(), classId]);
    await expectPgError("INSERT INTO class_seats (id, class_id, seat_number) VALUES ($1, $2, 7)", [uuidv7(), classId], "23505");
    await expectPgError("INSERT INTO class_seats (id, class_id, seat_number) VALUES ($1, $2, 100)", [uuidv7(), classId], "23514");
  });

  it("a seat has at most one active card; reissue = revoke + new version; handles stay unique", async () => {
    const { classId } = await insertClass();
    const seat = uuidv7();
    await client.query("INSERT INTO class_seats (id, class_id, seat_number) VALUES ($1, $2, 1)", [seat, classId]);
    const card = (version: number, handle: string, status = "active") =>
      client.query(
        `INSERT INTO seat_cards (id, seat_id, version, handle, secret_hash, status, issued_by_account_id, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, ${status === "revoked" ? "now()" : "NULL"})`,
        [uuidv7(), seat, version, handle, hex64("a"), status, uuidv7()],
      );
    await card(1, "0123456789");
    await expectPgError(
      "INSERT INTO seat_cards (id, seat_id, version, handle, secret_hash, issued_by_account_id) VALUES ($1, $2, 2, 'ABCDEFGHJK', $3, $4)",
      [uuidv7(), seat, hex64("b"), uuidv7()],
      "23505",
    );
    await client.query("UPDATE seat_cards SET status = 'revoked', revoked_at = now() WHERE seat_id = $1 AND version = 1", [seat]);
    await card(2, "ABCDEFGHJK");
    await expectPgError(
      "INSERT INTO seat_cards (id, seat_id, version, handle, secret_hash, status, issued_by_account_id, revoked_at) VALUES ($1, $2, 3, '0123456789', $3, 'revoked', $4, now())",
      [uuidv7(), seat, hex64("c"), uuidv7()],
      "23505",
    );
  });

  it("card handles must be Crockford base32 and secrets must be hashes", async () => {
    const { classId } = await insertClass();
    const seat = uuidv7();
    await client.query("INSERT INTO class_seats (id, class_id, seat_number) VALUES ($1, $2, 2)", [seat, classId]);
    const insert = (handle: string, hash: string) =>
      expectPgError(
        "INSERT INTO seat_cards (id, seat_id, version, handle, secret_hash, issued_by_account_id) VALUES ($1, $2, 1, $3, $4, $5)",
        [uuidv7(), seat, handle, hash, uuidv7()],
        "23514",
      );
    await insert("0123456789U", hex64("a"));
    await insert("012345678I", hex64("a"));
    await insert("0123456789", "ABCDEFGHJKMNPQRSTVWXYZ0123");
  });

  it("an active class code hash is unique across classes", async () => {
    const a = await insertClass();
    const b = await insertClass();
    const set = (id: string) =>
      client.query("UPDATE classes SET join_code_hash = $1, join_code_expires_at = now() + interval '15 minutes' WHERE id = $2", [hex64("d"), id]);
    await set(a.classId);
    await client.query("SAVEPOINT dup");
    await expect(set(b.classId)).rejects.toMatchObject({ code: "23505" });
    await client.query("ROLLBACK TO SAVEPOINT dup");
  });
});

describe("consent: one subject, paper only for seats", () => {
  it("rejects electronic consent for a seat and consent without a subject", async () => {
    const doc = uuidv7();
    await client.query(
      "INSERT INTO legal_documents (id, kind, version, title, effective_from) VALUES ($1, 'consent_child', 'test-1', 'Тест', now())",
      [doc],
    );
    await expectPgError(
      "INSERT INTO consents (id, document_id, method, subject_seat_id, subject_class_id, given_by_account_id) VALUES ($1, $2, 'electronic', $3, $4, $5)",
      [uuidv7(), doc, uuidv7(), uuidv7(), uuidv7()],
      "23514",
    );
    await expectPgError(
      "INSERT INTO consents (id, document_id, method, given_by_account_id) VALUES ($1, $2, 'paper', $3)",
      [uuidv7(), doc, uuidv7()],
      "23514",
    );
    const seat = uuidv7();
    const paper = "INSERT INTO consents (id, document_id, method, subject_seat_id, subject_class_id, given_by_account_id) VALUES ($1, $2, 'paper', $3, $4, $5)";
    await client.query(paper, [uuidv7(), doc, seat, uuidv7(), uuidv7()]);
    await expectPgError(paper, [uuidv7(), doc, seat, uuidv7(), uuidv7()], "23505");
  });
});
