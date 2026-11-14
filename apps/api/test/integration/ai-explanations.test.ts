// Объяснение ошибки (docs/04-ai-gigachat.md §3 сценарий 1) — настоящий API против Docker-стека и локального
// стаб-шлюза (http://127.0.0.1:<эфемерный>): проверяем кеш по (упражнение, класс ошибки), дневной лимит,
// деградацию к шаблону (шлюз недоступен, ребёнок), 409/404 и контекст без ПДн.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Schema } from "@teletau/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCourse, importCourse, readContent } from "../../src/modules/content/content-import.js";
import { bootApi, expectStatus, newDevice, testConfig, type AuthSession, type TestApi } from "./harness.js";

type Problem = Schema<"Problem">;
type Run = Schema<"LessonRun">;
type Explanation = Schema<"AiExplanation">;

const FIXTURE = fileURLToPath(new URL("../fixtures/content/", import.meta.url));
const LIMIT = 3;

/** Контексты, дошедшие до стаба: проверяем форму (никаких ПДн) и один вызов на кеш. */
const stubContexts: Array<Record<string, unknown>> = [];
let stubCalls = 0;
let stubMode: "ok" | "down" = "ok";
const stub = createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/v1/explain-error") {
    res.writeHead(404).end();
    return;
  }
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    stubCalls++;
    const ctx = JSON.parse(raw) as Record<string, unknown>;
    stubContexts.push(ctx);
    if (stubMode === "down") {
      res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ code: "ai_unavailable" }));
      return;
    }
    const accepted = (ctx.exercise as { accepted: string[] }).accepted[0] ?? "";
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({ text: `Ты был совсем рядом! Правильно пишется «${accepted}» — сверь особые буквы.`, model: "stub", usage: { inputTokens: 10, outputTokens: 12 } }),
    );
  });
});

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;
let grown: AuthSession;
let grown2: AuthSession;
let kid: AuthSession;
let run: Run;

const signup = async (ageBand: Schema<"AgeBand">): Promise<AuthSession> => {
  const res = await api.post<AuthSession>("/auth/self", { body: { device: newDevice(), nicknameId: "a03.n02", ageBand } });
  expectStatus(res, 201);
  return res.body;
};

const startRun = async (who: AuthSession): Promise<Run> => {
  const runId = randomUUID();
  const res = await api.post<Run>("/lessons/t-l1/runs", { token: who.accessToken, body: { runId } });
  expectStatus(res, 201);
  return res.body;
};

const attempt = async (who: AuthSession, r: Run, exerciseId: string, answer: unknown) => {
  const res = await api.post<Schema<"AttemptResult">>(`/lesson-runs/${r.runId}/attempts`, {
    token: who.accessToken,
    body: { attemptId: randomUUID(), exerciseId, answer },
  });
  expectStatus(res, 200);
  return res.body;
};

const explain = (who: AuthSession, r: Run, attemptId: string) =>
  api.call<Explanation | Problem>("POST", `/lesson-runs/${r.runId}/attempts/${attemptId}/explanation`, { token: who.accessToken });

beforeAll(async () => {
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  ({ api, pool, close } = await bootApi({ ...testConfig(), AI_GATEWAY_URL: url, AI_EXPLANATION_LIMIT: LIMIT }));
  await importCourse(pool, buildCourse(readContent(FIXTURE)[0]!), { force: true });
  grown = await signup("adult");
  grown2 = await signup("adult");
  kid = await signup("age_11_14");
  run = await startRun(grown);
});

afterAll(async () => {
  await close?.();
  stub.close();
});

describe("AI · объяснение ошибки: GigaChat через шлюз, кеш, лимит, деградация (learning.ai.ts)", () => {
  it("верной попытке объяснение не нужно — 409 explanation_not_applicable, счётчик не растёт", async () => {
    const tiles = run.exercises.find((e) => e.type === "tiles_ru_ba")! as Schema<"TilesExercise">;
    const ok = await attempt(grown, run, tiles.id, { type: "tiles", tileIds: ["Пиҡол", "тумә"].map((text) => tiles.tiles.find((t) => t.text === text)!.id) });
    expect(ok.verdict).toBe("correct");
    const res = await explain(grown, run, ok.attemptId);
    expect([res.status, (res.body as Problem).code]).toEqual([409, "explanation_not_applicable"]);
  });

  it("неверный ответ взрослого: шлюз вернул текст — source ai; контекст без ПДн", async () => {
    const choice = run.exercises.find((e) => e.type === "choice_ba_ru")!;
    const wrong = await attempt(grown, run, choice.id, { type: "choice", optionId: (choice as Schema<"ChoiceExercise">).options.find((o) => o.textRu === "Значение В")!.id });
    expect(wrong.verdict).toBe("wrong");
    const res = await explain(grown, run, wrong.attemptId);
    expectStatus(res, 200);
    expect(res.body).toMatchObject({ source: "ai" });
    expect((res.body as Explanation).text).toContain("һөлөк");
    // Контекст шлюза: только учебные данные — никаких ников, id аккаунтов и устройств.
    expect(stubContexts.at(-1)).toMatchObject({ exercise: { kind: "translate_ba_ru", accepted: ["һөлөк"] }, learnerAnswer: "Значение В", verdict: "wrong" });
    expect(Object.keys(stubContexts.at(-1)!).sort()).toEqual(["exercise", "learnerAnswer", "verdict"]);
  });

  it("кеш: другой взрослый с той же ошибкой получает тот же ответ — без нового вызова шлюза", async () => {
    const run2 = await startRun(grown2);
    const choice = run2.exercises.find((e) => e.type === "choice_ba_ru")!;
    const wrong = await attempt(grown2, run2, choice.id, { type: "choice", optionId: (choice as Schema<"ChoiceExercise">).options.find((o) => o.textRu === "Значение В")!.id });
    const before = stubCalls;
    const res = await explain(grown2, run2, wrong.attemptId);
    expectStatus(res, 200);
    expect(res.body).toMatchObject({ source: "ai" });
    expect(stubCalls).toBe(before);
  });

  it("шлюз недоступен — шаблон без ошибки для пользователя; кеш не портится (потом придёт живой ответ)", async () => {
    stubMode = "down";
    const free = run.exercises.filter((e) => e.type === "free_ru_ba")[0]!;
    const almost = await attempt(grown, run, free.id, { type: "text", text: "Казым" });
    expect(almost.verdict).toBe("almost");
    const res = await explain(grown, run, almost.attemptId);
    expectStatus(res, 200);
    expect(res.body).toMatchObject({ source: "template" });
    expect((res.body as Explanation).text).toContain("особая буква");
    stubMode = "ok";
  });

  it("ребёнку GigaChat не зовётся (§5.5) — шаблон без вызова шлюза", async () => {
    const kidRun = await startRun(kid);
    const free = kidRun.exercises.filter((e) => e.type === "free_ru_ba")[0]!;
    const wrong = await attempt(kid, kidRun, free.id, { type: "text", text: "не-то" });
    const before = stubCalls;
    const res = await explain(kid, kidRun, wrong.attemptId);
    expectStatus(res, 200);
    expect(res.body).toMatchObject({ source: "template" });
    expect(stubCalls).toBe(before);
  });

  it("чужая попытка — 404, как у попыток: существование чужого не раскрывается", async () => {
    const free = run.exercises.filter((e) => e.type === "free_ru_ba")[0]!;
    const almost = await attempt(grown, run, free.id, { type: "text", text: "Казым" });
    const res = await explain(grown2, run, almost.attemptId);
    expect(res.status).toBe(404);
  });

  it("дневной лимит: 429 ai_explanation_limit с retry-after до полуночи по Уфе", async () => {
    // Счётчик взрослого (лимит 3): ошибочный выбор (1) + almost при лежащем шлюзе (2) — осталось одно.
    const free = run.exercises.filter((e) => e.type === "free_ru_ba")[0]!;
    const last = await explain(grown, run, (await attempt(grown, run, free.id, { type: "text", text: "Казым" })).attemptId);
    expectStatus(last, 200);
    const over = await explain(grown, run, (await attempt(grown, run, free.id, { type: "text", text: "Казым" })).attemptId);
    expect(over.status).toBe(429);
    expect((over.body as Problem).code).toBe("ai_explanation_limit");
    expect(Number(over.headers["retry-after"])).toBeGreaterThan(0);
  });
});
