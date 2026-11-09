import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { findClosedResponseSchemas } from "../scripts/response-rules.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const load = (p) => parse(readFileSync(join(here, p), "utf8"));

test("finds additionalProperties:false reachable from responses through $ref, properties, items and allOf", () => {
  const found = findClosedResponseSchemas(load("fixtures/closed-response.yaml"));
  assert.deepEqual(found.sort(), ["#/components/schemas/Meta", "#/components/schemas/Tag/allOf/0"]);
});

test("ignores closed schemas used only in request bodies", () => {
  const found = findClosedResponseSchemas(load("fixtures/closed-response.yaml"));
  assert.ok(!found.some((p) => p.includes("OnlyInRequest")));
});

test("the real contract has no closed response schemas (M0-07)", () => {
  assert.deepEqual(findClosedResponseSchemas(load("../openapi.yaml")), []);
});
