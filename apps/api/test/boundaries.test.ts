import { describe, expect, it } from "vitest";
// @ts-expect-error — скрипт на JS без деклараций типов
import { findViolations } from "../scripts/boundaries.mjs";

const check = (files: Record<string, string>): string[] => findViolations(new Map(Object.entries(files)));

describe("module boundaries checker", () => {
  it("allows importing another module through its index.ts", () => {
    expect(
      check({
        "src/modules/a/a.service.ts": 'import { B } from "../b/index.js";',
        "src/modules/b/index.ts": 'export { B } from "./b.js";',
        "src/modules/b/b.ts": "export class B {}",
      }),
    ).toEqual([]);
  });

  it("forbids importing another module's internals", () => {
    const v = check({
      "src/modules/a/a.service.ts": 'import { B } from "../b/b.js";',
      "src/modules/b/b.ts": "export class B {}",
    });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("внутренностей модуля «b»");
  });

  it("forbids infra depending on modules", () => {
    const v = check({
      "src/infra/x.ts": 'import { H } from "../modules/health/index.js";',
      "src/modules/health/index.ts": "export class H {}",
    });
    expect(v.some((m: string) => m.includes("infra не должна"))).toBe(true);
  });

  it("detects import cycles", () => {
    const v = check({
      "src/a.ts": 'import { b } from "./b.js";',
      "src/b.ts": 'import { a } from "./a.js";',
    });
    expect(v.some((m: string) => m.startsWith("цикл"))).toBe(true);
  });
});

describe("table ownership (M0-05)", () => {
  it("forbids re-exporting a module's Drizzle schema from its index.ts", () => {
    const v = check({
      "src/modules/identity/index.ts": 'export { accounts } from "./identity.schema.js";',
      "src/modules/identity/identity.schema.ts": "export const accounts = {};",
      "src/modules/progress/progress.service.ts": 'import { accounts } from "../identity/index.js";',
    });
    expect(v.some((m: string) => m.includes("реэкспортирует схему"))).toBe(true);
  });

  it("forbids *.schema.ts files outside src/modules/<module>/", () => {
    const v = check({
      "src/db/schema.ts": "export const accounts = {};",
      "src/db/accounts.schema.ts": "export const accounts = {};",
    });
    expect(v.some((m: string) => m.includes("src/db/accounts.schema.ts") && m.includes("вне модуля"))).toBe(true);
    expect(v.some((m: string) => m.includes("src/db/schema.ts") && m.includes("вне модуля"))).toBe(true);
  });

  it("allows a module to use its own schema", () => {
    expect(
      check({
        "src/modules/identity/identity.repository.ts": 'import { accounts } from "./identity.schema.js";',
        "src/modules/identity/identity.schema.ts": "export const accounts = {};",
        "src/modules/identity/index.ts": 'export { IdentityModule } from "./identity.module.js";',
        "src/modules/identity/identity.module.ts": "export class IdentityModule {}",
      }),
    ).toEqual([]);
  });

  for (const shared of ["common", "db", "config"]) {
    it(`forbids src/${shared} depending on modules (no re-export loopholes)`, () => {
      const v = check({
        [`src/${shared}/reexport.ts`]: 'export { X } from "../modules/identity/index.js";',
        "src/modules/identity/index.ts": "export class X {}",
      });
      expect(v.some((m: string) => m.includes(`src/${shared}`) && m.includes("не должна зависеть от модулей"))).toBe(true);
    });
  }
});

describe("boundaries.mjs as a CLI (M0-04)", () => {
  it("still detects violations when the repository path has spaces and Cyrillic", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join, dirname } = await import("node:path");
    const { spawnSync } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");

    const root = mkdtempSync(join(tmpdir(), "Мой проект кәрәҙ "));
    try {
      const api = join(root, "apps", "api");
      mkdirSync(join(api, "scripts"), { recursive: true });
      mkdirSync(join(api, "src/modules/health"), { recursive: true });
      mkdirSync(join(api, "src/modules/other"), { recursive: true });
      const here = dirname(fileURLToPath(import.meta.url));
      copyFileSync(join(here, "../scripts/boundaries.mjs"), join(api, "scripts/boundaries.mjs"));
      writeFileSync(join(api, "src/modules/health/health.service.ts"), 'import { x } from "../other/some.js";');
      writeFileSync(join(api, "src/modules/other/some.ts"), "export const x = 1;");

      const res = spawnSync(process.execPath, ["scripts/boundaries.mjs"], { cwd: api, encoding: "utf8" });
      expect(res.status, res.stdout + res.stderr).toBe(1);
      expect(res.stderr).toContain("Нарушены границы модулей");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("table ownership — no transitive leaks (M0-R2-04)", () => {
  it("forbids re-exporting a schema through an intermediate file (export * chain)", () => {
    const v = check({
      "src/modules/identity/index.ts": 'export * from "./identity.service.js";',
      "src/modules/identity/identity.service.ts": 'export { accounts } from "./identity.schema.js";\nexport class IdentityService {}',
      "src/modules/identity/identity.schema.ts": "export const accounts = 1;",
    });
    expect(v.some((m: string) => m.includes("реэкспортирует схему") && m.includes("identity.service.ts"))).toBe(true);
  });

  it("forbids leaking a schema via import-then-export", () => {
    const v = check({
      "src/modules/identity/index.ts": 'export { accounts } from "./tables.js";',
      "src/modules/identity/tables.ts": 'import { accounts } from "./identity.schema.js";\nexport { accounts };',
      "src/modules/identity/identity.schema.ts": "export const accounts = 1;",
    });
    expect(v.some((m: string) => m.includes("реэкспортирует схему"))).toBe(true);
  });

  it("allows index.ts to export a service that only imports the schema internally", () => {
    expect(
      check({
        "src/modules/identity/index.ts": 'export { IdentityService } from "./identity.service.js";',
        "src/modules/identity/identity.service.ts": 'import { accounts } from "./identity.schema.js";\nexport class IdentityService { t = accounts; }',
        "src/modules/identity/identity.schema.ts": "export const accounts = 1;",
      }),
    ).toEqual([]);
  });

  it("forbids declaring Drizzle tables outside *.schema.ts", () => {
    const v = check({
      "src/modules/progress/tables.ts": 'import { pgTable } from "drizzle-orm/pg-core";\nexport const accounts = pgTable("accounts", {});',
    });
    expect(v.some((m: string) => m.includes("pgTable") && m.includes("tables.ts"))).toBe(true);
    for (const fn of ["pgSchema", "pgEnum", "pgView"]) {
      expect(check({ "src/modules/x/x.service.ts": `const s = ${fn}("x");` }).length, fn).toBeGreaterThan(0);
    }
    expect(check({ "src/modules/x/x.schema.ts": 'export const t = pgTable("t", {});' })).toEqual([]);
  });
});

describe("boundaries.mjs as a CLI — launched through a symlink (M0-R2-04)", () => {
  it("still runs the check when argv[1] is a symlinked path", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, symlinkSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join, dirname } = await import("node:path");
    const { spawnSync } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");

    const real = mkdtempSync(join(tmpdir(), "teletau-real-"));
    const link = `${real}-link`;
    try {
      const api = join(real, "apps", "api");
      mkdirSync(join(api, "scripts"), { recursive: true });
      mkdirSync(join(api, "src/modules/health"), { recursive: true });
      mkdirSync(join(api, "src/modules/other"), { recursive: true });
      const here = dirname(fileURLToPath(import.meta.url));
      copyFileSync(join(here, "../scripts/boundaries.mjs"), join(api, "scripts/boundaries.mjs"));
      writeFileSync(join(api, "src/modules/health/health.service.ts"), 'import { x } from "../other/some.js";');
      writeFileSync(join(api, "src/modules/other/some.ts"), "export const x = 1;");
      symlinkSync(real, link);

      const res = spawnSync(process.execPath, [join(link, "apps/api/scripts/boundaries.mjs")], { encoding: "utf8" });
      expect(res.status, res.stdout + res.stderr).toBe(1);
      expect(res.stderr).toContain("Нарушены границы модулей");
    } finally {
      rmSync(link, { force: true });
      rmSync(real, { recursive: true, force: true });
    }
  });
});

describe("table ownership — residual bypasses (M0-R3-04)", () => {
  const leaks = (m: string) => m.includes("реэкспортирует схему");

  it("forbids pgTableCreator outside *.schema.ts", () => {
    const v = check({
      "src/modules/x/tables.ts": 'import { pgTableCreator } from "drizzle-orm/pg-core";\nexport const table = pgTableCreator((n) => `x_${n}`);',
    });
    expect(v.some((m: string) => m.includes("pgTableCreator"))).toBe(true);
    expect(check({ "src/modules/x/x.schema.ts": 'import { pgTableCreator } from "drizzle-orm/pg-core";\nexport const t = pgTableCreator((n) => n);' })).toEqual([]);
  });

  it("forbids importing Drizzle table constructors under an alias outside *.schema.ts", () => {
    const v = check({
      "src/modules/x/tables.ts": 'import { pgTable as table, pgSchema as ns } from "drizzle-orm/pg-core";\nexport const a = table("a", {});',
    });
    expect(v.some((m: string) => m.includes("импорт pgTable (как table)"))).toBe(true);
    expect(v.some((m: string) => m.includes("импорт pgSchema (как ns)"))).toBe(true);
  });

  it("allows type-only imports from drizzle-orm/pg-core anywhere", () => {
    expect(check({ "src/modules/x/x.repository.ts": 'import type { PgTable } from "drizzle-orm/pg-core";\nexport type T = PgTable;' })).toEqual([]);
  });

  it("forbids leaking a schema value through a renamed export", () => {
    const v = check({
      "src/modules/identity/index.ts": 'export * from "./tables.js";',
      "src/modules/identity/tables.ts": 'import { users } from "./identity.schema.js";\nexport const usersTable = users;',
      "src/modules/identity/identity.schema.ts": "export const users = 1;",
    });
    expect(v.some(leaks)).toBe(true);
  });

  it("forbids leaking schema values wrapped in an object (named or spread)", () => {
    const named = check({
      "src/modules/identity/index.ts": 'export { identityTables } from "./tables.js";',
      "src/modules/identity/tables.ts": 'import { accounts } from "./identity.schema.js";\nexport const identityTables = {\n  accounts,\n};',
      "src/modules/identity/identity.schema.ts": "export const accounts = 1;",
    });
    const spread = check({
      "src/modules/identity/index.ts": 'export * from "./tables.js";',
      "src/modules/identity/tables.ts": 'import * as s from "./identity.schema.js";\nexport const tables = { ...s };',
      "src/modules/identity/identity.schema.ts": "export const accounts = 1;",
    });
    expect(named.some(leaks)).toBe(true);
    expect(spread.some(leaks)).toBe(true);
  });

  it("forbids leaking a schema through export default", () => {
    const v = check({
      "src/modules/identity/index.ts": 'export { default as tables } from "./tables.js";',
      "src/modules/identity/tables.ts": 'import * as schema from "./identity.schema.js";\nexport default schema;',
      "src/modules/identity/identity.schema.ts": "export const accounts = 1;",
    });
    expect(v.some(leaks)).toBe(true);
  });

  it("does not treat a service built from the schema as a leak", () => {
    expect(
      check({
        "src/modules/identity/index.ts": 'export * from "./identity.service.js";',
        "src/modules/identity/identity.service.ts":
          'import { accounts } from "./identity.schema.js";\nimport { Repo } from "./repo.js";\nexport const identityService = new Repo(accounts);\nexport const reader = makeReader(accounts);\nexport default class IdentityService { t = accounts; }',
        "src/modules/identity/repo.ts": "export class Repo {}",
        "src/modules/identity/identity.schema.ts": "export const accounts = 1;",
      }),
    ).toEqual([]);
  });
});
