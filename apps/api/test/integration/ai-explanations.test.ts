// Объяснение ошибки (docs/04-ai-gigachat.md §3 сценарий 1) — настоящий API против Docker-стека и локального
// стаб-шлюза (http://127.0.0.1:<эфемерный>): кеш только у объяснений без ответа ученика (ключ — упражнение, класс
// ошибки, версия промпта, хеш контекста), неверный ответ — живой вызов с ответом ученика без кеша, детям — шаблон
// раньше кеша, атомарный дневной лимит, деградация к шаблону, 409/404 и контекст без ПДн.
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
let grown3: AuthSession;
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

const freeBy = (r: Run, promptRu: string) => r.exercises.find((e) => e.type === "free_ru_ba" && (e as Schema<"FreeInputExercise">).promptRu === promptRu)!;
const wrongChoice = (r: Run) => {
  const choice = r.exercises.find((e) => e.type === "choice_ba_ru")! as Schema<"ChoiceExercise">;
  return { id: choice.id, answer: { type: "choice", optionId: choice.options.find((o) => o.textRu === "Значение В")!.id } };
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
  grown3 = await signup("adult");
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

  it("неверный ответ взрослого: живой вызов с ответом ученика — source ai; контекст без ПДн; в кеш не идёт", async () => {
    const choice = wrongChoice(run);
    const wrong = await attempt(grown, run, choice.id, choice.answer);
    expect(wrong.verdict).toBe("wrong");
    const res = await explain(grown, run, wrong.attemptId);
    expectStatus(res, 200);
    expect(res.body).toMatchObject({ source: "ai" });
    expect((res.body as Explanation).text).toContain("һөлөк");
    // Контекст шлюза: только учебные данные — никаких ников, id аккаунтов и устройств; версия промпта реестра.
    expect(stubContexts.at(-1)).toMatchObject({ promptId: "explain_error@v1", exercise: { kind: "translate_ba_ru", accepted: ["һөлөк"] }, learnerAnswer: "Значение В", verdict: "wrong" });
    expect(Object.keys(stubContexts.at(-1)!).sort()).toEqual(["exercise", "learnerAnswer", "promptId", "verdict"]);
    const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM ai_explanations WHERE error_class = 'wrong'");
    expect(rows[0]!.n).toBe(0);
  });

  it("объяснение с ответом ученика не кешируется: другой взрослый с той же ошибкой — новый вызов шлюза", async () => {
    const run2 = await startRun(grown2);
    const choice = wrongChoice(run2);
    const wrong = await attempt(grown2, run2, choice.id, choice.answer);
    const before = stubCalls;
    const res = await explain(grown2, run2, wrong.attemptId);
    expectStatus(res, 200);
    expect(res.body).toMatchObject({ source: "ai" });
    expect(stubCalls).toBe(before + 1);
  });

  it("«почти»: контекст без ответа ученика, кеш по контексту — другой взрослый с другим текстом ответа получает тот же ответ без вызова", async () => {
    const free = freeBy(run, "Синтетика Д");
    const almost = await attempt(grown, run, free.id, { type: "text", text: "Казым" });
    expect(almost.verdict).toBe("almost");
    const first = await explain(grown, run, almost.attemptId);
    expectStatus(first, 200);
    expect(first.body).toMatchObject({ source: "ai" });
    const ctx = stubContexts.at(-1)!;
    expect(ctx).not.toHaveProperty("learnerAnswer");
    expect(ctx).toMatchObject({ promptId: "explain_error@v1", verdict: "almost", exercise: { kind: "translate_ru_ba", promptRu: "Синтетика Д" } });
    expect(JSON.stringify(ctx)).not.toContain("Казым");

    const run2 = await startRun(grown2);
    const other = await attempt(grown2, run2, freeBy(run2, "Синтетика Д").id, { type: "text", text: "  казым  " });
    expect(other.verdict).toBe("almost");
    const before = stubCalls;
    const second = await explain(grown2, run2, other.attemptId);
    expectStatus(second, 200);
    expect(second.body).toEqual(first.body);
    expect(stubCalls).toBe(before);
    // Ключ кеша — версия промпта и хеш контекста, без ответа ученика.
    const { rows } = await pool.query<{ prompt_id: string; context_hash: string }>("SELECT prompt_id, context_hash FROM ai_explanations WHERE error_class = 'almost'");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.prompt_id === "explain_error@v1" && /^[0-9a-f]{64}$/.test(r.context_hash))).toBe(true);
  });

  it("ребёнку — шаблон раньше кеша: та же ошибка, что у взрослого в кеше, — template без вызова шлюза", async () => {
    const kidRun = await startRun(kid);
    const almost = await attempt(kid, kidRun, freeBy(kidRun, "Синтетика Д").id, { type: "text", text: "Казым" });
    expect(almost.verdict).toBe("almost");
    const before = stubCalls;
    const res = await explain(kid, kidRun, almost.attemptId);
    expectStatus(res, 200);
    expect(res.body).toMatchObject({ source: "template" });
    expect((res.body as Explanation).text).toContain("панели букв");
    expect(stubCalls).toBe(before);
  });

  it("ребёнку GigaChat не зовётся (§5.5) и на неверный ответ — шаблон по виду задания", async () => {
    const kidRun = await startRun(kid);
    const free = kidRun.exercises.filter((e) => e.type === "free_ru_ba")[0]!;
    const wrong = await attempt(kid, kidRun, free.id, { type: "text", text: "не-то" });
    const before = stubCalls;
    const res = await explain(kid, kidRun, wrong.attemptId);
    expectStatus(res, 200);
    expect(res.body).toMatchObject({ source: "template" });
    expect((res.body as Explanation).text).not.toMatch(/!|—|Ничего страшного|в конце урока/);
    expect(stubCalls).toBe(before);
  });

  it("шлюз недоступен — шаблон без ошибки для пользователя; кеш не портится (потом придёт живой ответ)", async () => {
    stubMode = "down";
    const run3 = await startRun(grown3);
    const free = freeBy(run3, "Синтетика Е");
    const almost = await attempt(grown3, run3, free.id, { type: "text", text: "сәлдерам" });
    expect(almost.verdict).toBe("almost");
    const res = await explain(grown3, run3, almost.attemptId);
    expectStatus(res, 200);
    expect(res.body).toMatchObject({ source: "template" });
    stubMode = "ok";
    const again = await explain(grown3, run3, (await attempt(grown3, run3, free.id, { type: "text", text: "сәлдерам" })).attemptId);
    expect(again.body).toMatchObject({ source: "ai" });
  });

  it("чужая попытка — 404, как у попыток: существование чужого не раскрывается", async () => {
    const free = freeBy(run, "Синтетика Д");
    const almost = await attempt(grown, run, free.id, { type: "text", text: "Казым" });
    const res = await explain(grown2, run, almost.attemptId);
    expect(res.status).toBe(404);
  });

  it("дневной лимит: 429 ai_explanation_limit с retry-after до полуночи по Уфе", async () => {
    // Свой взрослый: лимит 3 — три объяснения, четвёртое — 429.
    const who = await signup("adult");
    const r = await startRun(who);
    const free = freeBy(r, "Синтетика Д");
    for (let i = 0; i < LIMIT; i++) expectStatus(await explain(who, r, (await attempt(who, r, free.id, { type: "text", text: "Казым" })).attemptId), 200);
    const over = await explain(who, r, (await attempt(who, r, free.id, { type: "text", text: "Казым" })).attemptId);
    expect(over.status).toBe(429);
    expect((over.body as Problem).code).toBe("ai_explanation_limit");
    expect(Number(over.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("дневной лимит атомарен: параллельные запросы сверх лимита не проходят", async () => {
    const who = await signup("adult");
    const r = await startRun(who);
    const free = freeBy(r, "Синтетика Д");
    const attemptIds: string[] = [];
    for (let i = 0; i < LIMIT + 3; i++) attemptIds.push((await attempt(who, r, free.id, { type: "text", text: "Казым" })).attemptId);
    const results = await Promise.all(attemptIds.map((id) => explain(who, r, id)));
    expect(results.filter((x) => x.status === 200)).toHaveLength(LIMIT);
    expect(results.filter((x) => x.status === 429)).toHaveLength(3);
    const { rows } = await pool.query<{ count: number }>("SELECT count FROM ai_explanation_uses WHERE account_id = $1", [who.account.id]);
    expect(rows[0]!.count).toBe(LIMIT);
  });
});
