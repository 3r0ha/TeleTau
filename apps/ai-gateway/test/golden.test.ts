// Golden-набор промпта explain_error (prompts/explain_error/golden.json): каждый случай идёт через настоящий маршрут
// шлюза на скриптованном мок-провайдере — проверяются исход (текст или причина отказа) и сам промпт.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROMPTS_DIR } from "../src/prompts.js";
import type { CompletionRequest } from "../src/providers/provider.js";
import { buildServer } from "../src/server.js";

interface GoldenCase {
  name: string;
  context: Record<string, unknown> & { learnerAnswer?: string };
  output: string;
  expect: { status: 200; text: string } | { status: 503; code: string; reason?: string };
  promptIncludes?: string[];
  promptExcludes?: string[];
  promptLineCount?: Record<string, number>;
}

const golden = JSON.parse(readFileSync(join(PROMPTS_DIR, "explain_error", "golden.json"), "utf8")) as { promptId: string; cases: GoldenCase[] };

describe(`golden-набор ${golden.promptId}`, () => {
  it("набор не пуст и относится к существующей версии промпта", () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(5);
  });

  for (const c of golden.cases) {
    it(c.name, async () => {
      const seen: CompletionRequest[] = [];
      const app = buildServer(
        {
          name: "golden",
          complete: async (request) => {
            seen.push(request);
            return { text: c.output, usage: { inputTokens: 0, outputTokens: 0 } };
          },
        },
        { logger: false },
      );
      const res = await app.inject({ method: "POST", url: "/v1/explain-error", payload: { promptId: golden.promptId, ...c.context } });
      await app.close();

      expect(res.statusCode).toBe(c.expect.status);
      if (c.expect.status === 200) {
        expect(res.json()).toMatchObject({ text: c.expect.text, promptId: golden.promptId });
      } else {
        expect(res.json()).toEqual({ code: c.expect.code, ...(c.expect.reason ? { reason: c.expect.reason } : {}) });
      }

      expect(seen).toHaveLength(1);
      const prompt = `${seen[0]!.system}\n${seen[0]!.user}`;
      expect(seen[0]!.promptId).toBe(golden.promptId);
      for (const s of c.promptIncludes ?? []) expect(prompt).toContain(s);
      for (const s of c.promptExcludes ?? []) expect(prompt).not.toContain(s);
      for (const [start, n] of Object.entries(c.promptLineCount ?? {})) {
        expect(seen[0]!.user.split("\n").filter((line) => line.startsWith(start))).toHaveLength(n);
      }
      // Ввод ученика — ровно одна строка-JSON сразу под заголовком блока, без переводов строк и ёлочек.
      const lines = seen[0]!.user.split("\n");
      const header = lines.findIndex((line) => line.startsWith("LEARNER_INPUT"));
      if (c.context.learnerAnswer === undefined) {
        expect(header).toBe(-1);
      } else {
        expect(header).toBeGreaterThan(0);
        const value = JSON.parse(lines[header + 1]!) as unknown;
        expect(typeof value).toBe("string");
        expect(value as string).not.toMatch(/[\n\r«»]/);
      }
    });
  }
});
