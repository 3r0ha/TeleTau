import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { findAccessViolations } from "../scripts/access-rules.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const problem = { content: { "application/problem+json": { schema: { type: "object" } } } };
const ok = { description: "ok" };
const spec = (op, extra = {}) => ({ security: [{ bearerAuth: [] }], paths: { "/api/v1/x/{id}": { post: { operationId: "x", ...op } } }, ...extra });

test("the real contract follows the access rules (ADR 0017)", () => {
  const real = parse(readFileSync(join(here, "../openapi.yaml"), "utf8"));
  assert.deepEqual(findAccessViolations(real), []);
});

test("every M1 operation of the plan is present in the contract", () => {
  const real = parse(readFileSync(join(here, "../openapi.yaml"), "utf8"));
  const ops = new Set();
  for (const [path, item] of Object.entries(real.paths)) for (const m of Object.keys(item)) ops.add(`${m.toUpperCase()} ${path.replace("/api/v1", "")}`);
  const expected = [
    "POST /auth/qr", "POST /auth/class-code", "GET /auth/class-code/{requestId}", "POST /auth/otp/request", "POST /auth/otp/verify",
    "POST /auth/refresh", "POST /auth/logout", "GET /me", "PATCH /me", "GET /nicknames/suggest", "GET /districts", "GET /schools",
    "POST /classes", "GET /classes", "GET /classes/{id}", "POST /classes/{id}/seats", "GET /classes/{id}/cards.pdf",
    "POST /classes/{id}/seats/{seat}/reissue", "POST /classes/{id}/join-code", "GET /classes/{id}/join-requests",
    "POST /classes/{id}/join-requests/{rid}/approve", "POST /classes/{id}/join-requests/{rid}/reject",
    "POST /teacher/verification", "GET /teacher/verification", "GET /moderation/teacher-verifications",
    "POST /moderation/teacher-verifications/{id}/approve", "POST /moderation/teacher-verifications/{id}/reject",
    "GET /legal-documents/current", "POST /consents", "POST /classes/{id}/seats/{seat}/paper-consent", "POST /consents/{id}/revoke",
    "GET /admin/audit-log",
  ];
  assert.deepEqual(expected.filter((e) => !ops.has(e)), []);
  assert.ok(![...ops].some((o) => o.includes("/auth/oauth")), "OAuth убран из M1 решением владельца");
});

test("flags a missing x-access", () => {
  const v = findAccessViolations(spec({ responses: { 200: ok } }));
  assert.match(v.join("\n"), /нет x-access\.roles/);
});

test("flags unknown roles and policies", () => {
  const v = findAccessViolations(spec({ "x-access": { roles: ["root"], policy: "magic" }, responses: { 200: ok } }));
  assert.match(v.join("\n"), /неизвестная роль «root»/);
  assert.match(v.join("\n"), /неизвестная политика «magic»/);
});

test("requires 401, 403, 404 and 422 where applicable", () => {
  const v = findAccessViolations(
    spec({
      "x-access": { roles: ["teacher"], policy: "class-teacher" },
      parameters: [{ name: "id", in: "path", required: true }],
      requestBody: { content: {} },
      responses: { 200: ok },
    }),
  ).join("\n");
  for (const code of ["401", "403", "404", "422"]) assert.match(v, new RegExp(`без ответа ${code}`));
});

test("public operations must be anonymous-only and vice versa", () => {
  const v1 = findAccessViolations(spec({ security: [], "x-access": { roles: ["teacher"] }, responses: { 200: ok, 404: problem, 422: problem } }));
  assert.match(v1.join("\n"), /не разрешает anonymous, а security — наоборот/);
  const v2 = findAccessViolations(spec({ "x-access": { roles: ["anonymous"] }, responses: { 200: ok, 401: problem, 404: problem } }));
  assert.match(v2.join("\n"), /разрешает anonymous, а security — наоборот/);
});

test("error responses must be problem+json", () => {
  const v = findAccessViolations(
    spec({
      "x-access": { roles: ["any"] },
      responses: { 200: ok, 401: { content: { "application/json": {} } }, 404: problem },
    }),
  );
  assert.match(v.join("\n"), /ответ 401 не в формате application\/problem\+json/);
});

test("optional auth (security: [{}, bearer]) is consistent with roles [anonymous, any]", () => {
  const v = findAccessViolations(
    spec({ security: [{}, { bearerAuth: [] }], "x-access": { roles: ["anonymous", "any"] }, responses: { 200: ok, 404: problem } }),
  );
  assert.deepEqual(v, []);
});

test("service role (ADR 0020): alone, only with the serviceToken scheme, and the scheme only for it", () => {
  const svc = { security: [{ serviceToken: [] }], "x-access": { roles: ["service"] }, responses: { 200: ok, 401: problem, 403: problem } };
  assert.deepEqual(findAccessViolations(spec(svc)), []);
  const mixed = findAccessViolations(spec({ ...svc, "x-access": { roles: ["service", "student"] } })).join("\n");
  assert.match(mixed, /роль service не сочетается с другими ролями/);
  const bearer = findAccessViolations(spec({ ...svc, security: [{ bearerAuth: [] }] })).join("\n");
  assert.match(bearer, /роль service — значит, security: \[\{ serviceToken: \[\] \}\]/);
  const either = findAccessViolations(spec({ ...svc, security: [{ serviceToken: [] }, { bearerAuth: [] }] })).join("\n");
  assert.match(either, /роль service — значит/);
  const userOp = findAccessViolations(spec({ ...svc, "x-access": { roles: ["student"] } })).join("\n");
  assert.match(userOp, /serviceToken — только у роли service/);
});
