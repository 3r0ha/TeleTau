// Дуэль и голоса по группам (docs/plans/M2.md §1 шаги 2, 5, 6; §3 «Ч3»; правила — ADR 0019, векторы
// contracts/test-vectors/{consensus,xp}). Настоящее приложение против Docker-стека, настоящий ProgressService (xp_ledger).
// Дуэли — синтетические (без башкирских слов, правило 6), загружаются тем же corpus:import, что и демо-контент.
//
// Поток: импорт → голоса детей в уроке (через ConsensusService.recordVote) → взрослый: до голоса 403 vote_required,
// голос → голоса по группам, voting → учитель: голос решает, accepted, children_prefer → мёд pending → final →
// «Мой вклад» ребёнка и взрослого. Плюс эскалация, «Не знаю», исчерпание пула, журнал только на вставку.
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Schema } from "@teletau/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "../../src/common/auth.js";
import { uuidv7 } from "../../src/common/uuidv7.js";
import type { Db } from "../../src/db/database.js";
import { DB } from "../../src/infra/tokens.js";
import { ConsensusService, type DuelCard } from "../../src/modules/consensus/index.js";
import { tallyItem, type JudgmentRecord } from "../../src/modules/consensus/tally.js";
import { CorpusService, type DuelItem } from "../../src/modules/corpus/index.js";
import { importDuels } from "../../src/modules/corpus/duels-import.js";
import { scanPdf } from "../support/pdf-qr.js";
import { bootApi, email, expectStatus, newDevice, RUN, type AuthSession, type TestApi } from "./harness.js";

type Votes = Schema<"CorpusItemVotes">;
type Problem = Schema<"Problem">;

const UNIT = `it-${RUN}`;
const DUEL = (n: number) => `it-${RUN}-d0${n}`;

const SOURCES = `sources:
  - id: synthetic-it
    title: "Синтетический источник интеграционного теста"
    url: https://example.org/it
    license: CC0
    accessed: "2026-11-04"
`;
const variant = (text: string, review = "needs_native_review") => `
      - ba: ${text}
        source:
          ref: synthetic-it
          url: https://example.org/it/${encodeURIComponent(text)}
          locator: строка «${text}»
        review: ${review}`;
const duel = (n: number) => `  - id: ${DUEL(n)}
    ru: "Синтетическая фраза ${n}"
    kind: phrase
    variants:${variant(`Синтетика ${n} икс`)}${variant(`Синтетика ${n} игрек`)}
`;
const duelsYaml = (d3Review = "needs_native_review") =>
  `unit: ${UNIT}\nduels:\n${duel(1)}${duel(2)}  - id: ${DUEL(3)}\n    ru: "Синтетическая фраза 3"\n    kind: phrase\n    variants:${variant("Синтетика 3 икс", d3Review)}${variant("Синтетика 3 игрек")}\n${duel(4)}`;

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;
let consensus: ConsensusService;
let db: Db;
let dir: string;

let teacher: AuthSession;
let adult: AuthSession;
let adult2: AuthSession;
const children: AuthSession[] = [];
/** Синтетические дуэли: X — первый вариант YAML, Y — второй (по тексту, порядок в базе не важен). */
const items: Array<{ item: DuelItem; x: string; y: string }> = [];
/** id голосов: кто → исходник → judgmentId. */
const judgment = new Map<string, string>();

const principal = (s: AuthSession): Principal => ({ accountId: s.account.id, kind: s.account.kind, roles: s.account.roles, sessionId: "", deviceId: "" });
const ledger = async (judgmentId: string) =>
  (
    await pool.query<{ status: string; amount: number; finalized_at: Date | null; account_id: string }>(
      "SELECT status::text AS status, amount, finalized_at, account_id FROM xp_ledger WHERE reason = 'vote' AND ref_id = $1",
      [judgmentId],
    )
  ).rows;
const choiceFor = (card: { a: { variantId: string }; b: { variantId: string } }, variantId: string): "a" | "b" => (card.a.variantId === variantId ? "a" : "b");

/** Голос ребёнка из урока — так его передаёт модуль learning: в транзакции попытки, judgmentId = attemptId. */
async function childVote(child: AuthSession, n: number, target: "x" | "y") {
  const { item, x, y } = items[n - 1]!;
  const card = (await consensus.duelByRef(principal(child), item.externalId)) as DuelCard;
  expect(card, `дуэль ${n} для ребёнка`).toBeDefined();
  const id = uuidv7();
  judgment.set(`${child.account.id}:${n}`, id);
  const vote = {
    judgmentId: id,
    voter: principal(child),
    itemId: item.itemId,
    shown: [card.a.variantId, card.b.variantId] as const,
    choice: choiceFor(card, target === "x" ? x : y),
    context: "lesson" as const,
    runId: randomUUID(),
    latencyMs: 1800,
    at: new Date(),
  };
  return { vote, receipt: await db.transaction((tx) => consensus.recordVote(tx, vote)) };
}

/** Голос взрослого или учителя вне урока: дуэль из GET /corpus/duels, голос — POST /corpus/judgments. */
async function httpVote(who: AuthSession, n: number, target: "x" | "y" | "skip") {
  const { item, x, y } = items[n - 1]!;
  const list = await api.get<Schema<"CorpusDuelList">>("/corpus/duels?limit=10", { token: who.accessToken });
  expectStatus(list, 200);
  const d = list.body.items.find((i) => i.itemId === item.itemId);
  expect(d, `дуэль ${n} в списке`).toBeDefined();
  const card = { a: d!.variants[0]!, b: d!.variants[1]! };
  const id = uuidv7();
  judgment.set(`${who.account.id}:${n}`, id);
  const body = { judgmentId: id, itemId: item.itemId, shown: [card.a.variantId, card.b.variantId], choice: target === "skip" ? "skip" : choiceFor(card, target === "x" ? x : y), latencyMs: 2500 };
  const res = await api.post<Votes>("/corpus/judgments", { token: who.accessToken, body });
  return { body, res };
}

const tally = (v: Votes, group: "child" | "teacher" | "adult", variantId: string) => v.groups[group].variants.find((x) => x.variantId === variantId)?.votes;

beforeAll(async () => {
  ({ api, pool, close } = await bootApi());
  consensus = api.app.get(ConsensusService);
  db = api.app.get<Db>(DB);
  dir = mkdtempSync(join(tmpdir(), "teletau-duels-"));
  writeFileSync(join(dir, "sources.yaml"), SOURCES);
  mkdirSync(join(dir, "duels"));
});

afterAll(async () => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  await close?.();
});

describe("M2 · duel and votes by group (corpus, consensus)", () => {
  it("corpus:import loads duels idempotently and refuses to change the variants of a loaded duel", async () => {
    const duels = join(dir, "duels");
    writeFileSync(join(duels, `${UNIT}.yaml`), duelsYaml());
    const opts = { dir: duels, sourcesFile: join(dir, "sources.yaml") };

    const first = await importDuels(pool, opts);
    expect(first).toMatchObject({ files: 1, items: { inserted: 4, updated: 0, unchanged: 0, skipped: 0 }, variants: { inserted: 8, updated: 0, unchanged: 0 } });
    const again = await importDuels(pool, opts);
    expect(again).toMatchObject({ items: { inserted: 0, updated: 0, unchanged: 4 }, variants: { inserted: 0, updated: 0, unchanged: 8 } });

    // Вердикт носителя меняется на месте; другой текст варианта — ошибка (на варианты ссылаются голоса).
    writeFileSync(join(duels, `${UNIT}.yaml`), duelsYaml("native_approved"));
    expect(await importDuels(pool, opts)).toMatchObject({ variants: { updated: 1, unchanged: 7 } });
    writeFileSync(join(duels, `${UNIT}.yaml`), duelsYaml("native_approved").replace("Синтетика 4 игрек", "Синтетика 4 зет"));
    await expect(importDuels(pool, opts)).rejects.toThrow(/уже загружена с другими вариантами/);
    writeFileSync(join(duels, `${UNIT}.yaml`), duelsYaml("native_approved"));
    expect(await importDuels(pool, opts)).toMatchObject({ items: { inserted: 0, updated: 0 }, variants: { inserted: 0, updated: 0 } });

    // Настоящий демо-контент тоже загружается и повторно ничего не меняет.
    const real = await importDuels(pool);
    if (real.files > 0) {
      const realAgain = await importDuels(pool);
      expect(realAgain.items).toMatchObject({ inserted: 0, updated: 0, unchanged: real.items.inserted + real.items.unchanged });
      expect(realAgain.variants).toMatchObject({ inserted: 0, updated: 0 });
    }

    const corpus = api.app.get(CorpusService);
    const pool4 = await corpus.duelPool(UNIT);
    expect(pool4.map((i) => i.externalId)).toEqual([1, 2, 3, 4].map(DUEL));
    for (const item of pool4) {
      const x = item.variants.find((v) => v.text.endsWith("икс"))!;
      const y = item.variants.find((v) => v.text.endsWith("игрек"))!;
      expect(item.variants.every((v) => v.origin === "import")).toBe(true);
      expect(item.sources[0]).toMatchObject({ title: "Синтетический источник интеграционного теста", license: "CC0" });
      items.push({ item, x: x.id, y: y.id });
    }
    expect(items[2]!.item.variants.find((v) => v.id === items[2]!.x)?.review).toBe("native_approved");
  });

  it("children vote inside lessons through ConsensusService: «Голос учтён», no distribution, honey ripens", async () => {
    const moderator = await api.loginStaff("moderator");
    teacher = await api.verifiedTeacher("duel-teacher", moderator.accessToken, 2);
    const cls = await api.post<Schema<"ClassDetail">>("/classes", { token: teacher.accessToken, body: { grade: 8, letter: "Э", program: "native" } });
    expectStatus(cls, 201);
    const seats = await api.post<Schema<"SeatIssueResult">>(`/classes/${cls.body.id}/seats`, { token: teacher.accessToken, body: { count: 3 } });
    expectStatus(seats, 201);
    const pdf = await api.get(seats.body.printJob.pdfPath, { token: teacher.accessToken });
    const links = (await scanPdf(pdf.raw)).qr.flat();
    for (const link of links.slice(0, 3)) {
      const s = await api.post<AuthSession>("/auth/qr", { body: { payload: link, device: newDevice() } });
      expectStatus(s, 200);
      children.push(s.body);
    }
    const [c1, c2, c3] = children as [AuthSession, AuthSession, AuthSession];

    // Дуэль 1: дети выбирают Y, Y, X (большинство детей — Y). Дуэль 4: все трое — X.
    const first = await childVote(c1, 1, "y");
    expect(first.receipt).toEqual({ judgmentId: first.vote.judgmentId, replay: false, status: "voting" });
    await childVote(c2, 1, "y");
    await childVote(c3, 1, "x");
    for (const c of children) await childVote(c, 4, "x");
    await childVote(c1, 2, "x");
    await childVote(c1, 3, "x");

    // Повтор попытки (тот же attemptId) — тот же результат без новой записи; другой голос с тем же id — 422.
    expect(await db.transaction((tx) => consensus.recordVote(tx, first.vote))).toEqual({ judgmentId: first.vote.judgmentId, replay: true, status: "voting" });
    await expect(db.transaction((tx) => consensus.recordVote(tx, { ...first.vote, choice: first.vote.choice === "a" ? "b" : "a" }))).rejects.toMatchObject({
      status: 422,
      code: "idempotency_key_reused",
    });
    await expect(db.transaction((tx) => consensus.recordVote(tx, { ...first.vote, judgmentId: uuidv7() }))).rejects.toMatchObject({ status: 409, code: "already_voted" });
    const { rows } = await pool.query<{ n: number; groups: string[] }>(
      "SELECT count(*)::int AS n, array_agg(DISTINCT voter_group::text) AS groups FROM judgments WHERE source_item_id = $1",
      [items[0]!.item.itemId],
    );
    expect(rows[0]).toEqual({ n: 3, groups: ["child"] });

    // Голосами одних детей не принимается; мёд «созревает».
    for (const id of [judgment.get(`${c1.account.id}:1`)!, judgment.get(`${c3.account.id}:4`)!]) {
      expect(await ledger(id)).toMatchObject([{ status: "pending", amount: 3, finalized_at: null }]);
    }

    // Без повторов своих голосов: у первого ребёнка пул юнита исчерпан — пустой список, у второго — две оставшиеся.
    expect(await consensus.pickDuels(principal(c1), UNIT, 10)).toEqual([]);
    expect(await consensus.duelByRef(principal(c1), DUEL(1))).toBeUndefined();
    const rest = await consensus.pickDuels(principal(c2), UNIT, 10);
    expect(rest.map((c) => c.itemId).sort()).toEqual([items[1]!.item.itemId, items[2]!.item.itemId].sort());
    for (const c of rest) expect(c.review).toBe("needs_native_review");

    // Детям распределение голосов не показываем и вне урока они не голосуют.
    const peek = await api.get<Problem>(`/corpus/items/${items[0]!.item.itemId}/votes`, { token: c1.accessToken });
    expect(peek.status).toBe(403);
    const outside = await api.post<Problem>("/corpus/judgments", {
      token: c1.accessToken,
      body: { judgmentId: uuidv7(), itemId: items[1]!.item.itemId, shown: [items[1]!.x, items[1]!.y], choice: "a" },
    });
    expect(outside.status).toBe(403);
    expectStatus(await api.get("/corpus/duels", { token: c1.accessToken }), 403);

    const cells = await api.get<Schema<"MyCellsPage">>("/corpus/my-cells", { token: c1.accessToken });
    expectStatus(cells, 200);
    expect(cells.body.summary).toEqual({ matured: 0, pending: 4, honeyFinal: 0, honeyPending: 12 });
    expect(cells.body.items.map((c) => c.status)).toEqual(["pending", "pending", "pending", "pending"]);
  });

  it("an adult sees votes only after voting; the vote is split by group and keeps the duel in voting", async () => {
    adult = await api.loginAdult(email("duel-adult"));
    const [d1] = items;
    const before = await api.get<Problem>(`/corpus/items/${d1!.item.itemId}/votes`, { token: adult.accessToken });
    expect(before.status).toBe(403);
    expect(before.body.code).toBe("vote_required");

    const list = await api.get<Schema<"CorpusDuelList">>("/corpus/duels?limit=10", { token: adult.accessToken });
    expectStatus(list, 200);
    const mine = list.body.items.find((i) => i.itemId === d1!.item.itemId)!;
    expect(mine).toMatchObject({ sourceRu: "Синтетическая фраза 1", review: "needs_native_review" });
    expect(mine.variants.map((v) => v.variantId).sort()).toEqual([d1!.x, d1!.y].sort());
    expect(mine.sources?.[0]?.title).toBe("Синтетический источник интеграционного теста");
    // Чем больше голосов, тем раньше: у дуэли 1 их 3, у дуэли 2 — 1.
    const order = list.body.items.map((i) => i.itemId);
    expect(order.indexOf(d1!.item.itemId)).toBeLessThan(order.indexOf(items[1]!.item.itemId));

    // Чужие варианты — 422, неизвестный исходник — 404.
    const foreign = await api.post<Problem>("/corpus/judgments", {
      token: adult.accessToken,
      body: { judgmentId: uuidv7(), itemId: d1!.item.itemId, shown: [d1!.x, items[1]!.x], choice: "a" },
    });
    expect([foreign.status, foreign.body.code]).toEqual([422, "validation_failed"]);
    const missing = await api.post<Problem>("/corpus/judgments", {
      token: adult.accessToken,
      body: { judgmentId: uuidv7(), itemId: randomUUID(), shown: [d1!.x, d1!.y], choice: "a" },
    });
    expect(missing.status).toBe(404);

    const { body, res } = await httpVote(adult, 1, "x");
    expectStatus(res, 201);
    expect(res.body).toMatchObject({ itemId: d1!.item.itemId, sourceRu: "Синтетическая фраза 1", status: "voting", rulesVersion: "duel-v0" });
    expect(res.body.decidedBy).toBeUndefined();
    expect(res.body.groups.child).toMatchObject({ total: 3, both: 0, skip: 0 });
    expect([tally(res.body, "child", d1!.x), tally(res.body, "child", d1!.y)]).toEqual([1, 2]);
    expect([res.body.groups.adult.total, tally(res.body, "adult", d1!.x), tally(res.body, "adult", d1!.y)]).toEqual([1, 1, 0]);
    expect(res.body.groups.teacher.total).toBe(0);
    expect(res.body.myVote).toMatchObject({ choice: body.choice, variantId: d1!.x });
    expect(res.body.variants.every((v) => !v.accepted && !v.main && v.tags.length === 0)).toBe(true);

    // Повтор с тем же judgmentId — тот же ответ без новой записи; второй голос за исходник — 409.
    const replay = await api.post<Votes>("/corpus/judgments", { token: adult.accessToken, body });
    expectStatus(replay, 201);
    expect(replay.body.groups).toEqual(res.body.groups);
    const second = await api.post<Problem>("/corpus/judgments", { token: adult.accessToken, body: { ...body, judgmentId: uuidv7() } });
    expect([second.status, second.body.code]).toEqual([409, "already_voted"]);

    const after = await api.get<Votes>(`/corpus/items/${d1!.item.itemId}/votes`, { token: adult.accessToken });
    expectStatus(after, 200);
    expect(after.body.groups).toEqual(res.body.groups);
    const relist = await api.get<Schema<"CorpusDuelList">>("/corpus/duels?limit=10", { token: adult.accessToken });
    expect(relist.body.items.map((i) => i.itemId)).not.toContain(d1!.item.itemId);
    expect(await ledger(body.judgmentId)).toMatchObject([{ status: "pending", amount: 3 }]);
  });

  it("the teacher's vote decides: accepted by duel-v0, children_prefer on the children's choice, honey matures", async () => {
    const [d1, , , d4] = items;
    const before = await api.get<Problem>(`/corpus/items/${d1!.item.itemId}/votes`, { token: teacher.accessToken });
    expect([before.status, before.body.code]).toEqual([403, "vote_required"]);

    const { res } = await httpVote(teacher, 1, "x");
    expectStatus(res, 201);
    expect(res.body).toMatchObject({ status: "accepted", decidedBy: "rule" });
    expect([res.body.groups.teacher.total, tally(res.body, "teacher", d1!.x)]).toEqual([1, 1]);
    const byId = new Map(res.body.variants.map((v) => [v.variantId, v]));
    expect(byId.get(d1!.x)).toMatchObject({ accepted: true, main: true, tags: [] });
    expect(byId.get(d1!.y)).toMatchObject({ accepted: false, main: false, tags: ["children_prefer"] });
    const seenByAdult = await api.get<Votes>(`/corpus/items/${d1!.item.itemId}/votes`, { token: adult.accessToken });
    expect(seenByAdult.body).toMatchObject({ status: "accepted", decidedBy: "rule" });

    // Мёд: согласные с итогом (X) — 3, несогласные (Y) — 1; pending → final с моментом решения.
    const [c1, c2, c3] = children as [AuthSession, AuthSession, AuthSession];
    const expected: Array<[AuthSession, number]> = [
      [c1, 1],
      [c2, 1],
      [c3, 3],
      [adult, 3],
      [teacher, 3],
    ];
    for (const [who, amount] of expected) {
      const rows = await ledger(judgment.get(`${who.account.id}:1`)!);
      expect(rows, who.account.kind).toMatchObject([{ status: "final", amount, account_id: who.account.id }]);
      expect(rows[0]!.finalized_at).toBeInstanceOf(Date);
    }

    // Сценарий показа: 3 голоса детей и 1 голос учителя → принят, мёд согласных детей стал final (вектор c003).
    const d4res = await httpVote(teacher, 4, "x");
    expect(d4res.res.body).toMatchObject({ status: "accepted", decidedBy: "rule" });
    expect(d4res.res.body.variants.find((v) => v.variantId === d4!.x)).toMatchObject({ accepted: true, main: true, tags: [] });
    for (const c of children) expect(await ledger(judgment.get(`${c.account.id}:4`)!)).toMatchObject([{ status: "final", amount: 3 }]);
  });

  it("teachers and adults disagreeing escalate; «Не знаю» earns nothing; escalated duels leave the list", async () => {
    const [, d2, d3] = items;
    const a = await httpVote(adult, 2, "x");
    expect(a.res.body.status).toBe("voting");
    const t = await httpVote(teacher, 2, "y");
    expectStatus(t.res, 201);
    expect(t.res.body.status).toBe("escalated");
    expect(t.res.body.decidedBy).toBeUndefined();
    expect(t.res.body.variants.some((v) => v.accepted || v.main)).toBe(false);
    expect(await ledger(t.body.judgmentId)).toMatchObject([{ status: "pending", amount: 3 }]);

    adult2 = await api.loginAdult(email("duel-adult-2"));
    const list = await api.get<Schema<"CorpusDuelList">>("/corpus/duels?limit=10", { token: adult2.accessToken });
    const ids = list.body.items.map((i) => i.itemId);
    expect(ids).not.toContain(d2!.item.itemId); // escalated — ждёт эксперта
    expect(ids).not.toContain(items[0]!.item.itemId); // accepted
    expect(ids).toContain(d3!.item.itemId);

    const skip = await httpVote(adult2, 3, "skip");
    expectStatus(skip.res, 201);
    expect(skip.res.body.groups.adult).toMatchObject({ total: 1, skip: 1, both: 0 });
    expect(skip.res.body.myVote).toEqual({ choice: "skip", votedAt: expect.any(String) });
    expect(await ledger(skip.body.judgmentId)).toEqual([]);
    const cells = await api.get<Schema<"MyCellsPage">>("/corpus/my-cells", { token: adult2.accessToken });
    expect(cells.body.items.find((c) => c.itemId === d3!.item.itemId)).toMatchObject({ status: "none", honey: 0, choice: "skip" });
    expect(cells.body.summary).toEqual({ matured: 0, pending: 0, honeyFinal: 0, honeyPending: 0 });
  });

  it("«Мой вклад»: matured cells with the honey earned, pending ones ripening, newest first, page by page", async () => {
    const [c1, , c3] = children as [AuthSession, AuthSession, AuthSession];
    const [d1, d2, d3, d4] = items;

    const p1 = await api.get<Schema<"MyCellsPage">>("/corpus/my-cells?limit=3", { token: c1.accessToken });
    expectStatus(p1, 200);
    // D1 — принят (Y — не итог): 1; D4 — принят, согласие: 3; D2 — эскалирован, D3 — голосование: по 3 «созревает».
    expect(p1.body.summary).toEqual({ matured: 2, pending: 2, honeyFinal: 4, honeyPending: 6 });
    // Ребёнок голосовал в порядке D1, D4, D2, D3 — новые сначала.
    expect(p1.body.items.map((c) => c.itemId)).toEqual([d3!.item.itemId, d2!.item.itemId, d4!.item.itemId]);
    expect(p1.body.items[0]).toMatchObject({ status: "pending", honey: 3 });
    expect(p1.body.items[0]!.agreed).toBeUndefined();
    expect(p1.body.items[1]).toMatchObject({ status: "pending", honey: 3 });
    expect(p1.body.items[2]).toMatchObject({ status: "matured", honey: 3, agreed: true, sourceRu: "Синтетическая фраза 4" });
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await api.get<Schema<"MyCellsPage">>(`/corpus/my-cells?limit=3&cursor=${p1.body.nextCursor}`, { token: c1.accessToken });
    expectStatus(p2, 200);
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.items[0]).toMatchObject({ itemId: d1!.item.itemId, status: "matured", honey: 1, agreed: false });
    expect(p2.body.items[0]!.chosen).toEqual({ text: "Синтетика 1 игрек", review: "needs_native_review" });
    expect(Date.parse(p2.body.items[0]!.maturedAt!)).toBeGreaterThanOrEqual(Date.parse(p2.body.items[0]!.votedAt));
    expect(p2.body.nextCursor).toBeUndefined();
    const broken = await api.get<Problem>("/corpus/my-cells?cursor=not-a-cursor", { token: c1.accessToken });
    expect(broken.status).toBe(422);

    const c3cells = await api.get<Schema<"MyCellsPage">>("/corpus/my-cells", { token: c3.accessToken });
    expect(c3cells.body.summary).toEqual({ matured: 2, pending: 0, honeyFinal: 6, honeyPending: 0 });
    expect(c3cells.body.items.find((c) => c.itemId === d1!.item.itemId)).toMatchObject({ status: "matured", honey: 3, agreed: true, chosen: { text: "Синтетика 1 икс" } });

    // Мёд «Моего вклада» совпадает с журналом мёда (ProgressService).
    const { rows } = await pool.query<{ status: string; total: number }>(
      "SELECT status::text AS status, sum(amount)::int AS total FROM xp_ledger WHERE reason = 'vote' AND account_id = $1 GROUP BY status ORDER BY status",
      [c1.account.id],
    );
    expect(Object.fromEntries(rows.map((r) => [r.status, r.total]))).toEqual({ pending: 6, final: 4 });

    const adultCells = await api.get<Schema<"MyCellsPage">>("/corpus/my-cells", { token: adult.accessToken });
    expect(adultCells.body.summary).toEqual({ matured: 1, pending: 1, honeyFinal: 3, honeyPending: 3 });
  });

  it("an accepted duel holds until M4: votes against are recorded and counted, the status and honey stay (ADR 0019)", async () => {
    const d4 = items[3]!;
    const state = async () =>
      (await pool.query<{ status: string; decided_at: Date; main: string }>("SELECT status::text AS status, decided_at, main_variant_id AS main FROM item_state WHERE source_item_id = $1", [d4.item.itemId])).rows[0]!;
    const before = await state();
    expect(before).toMatchObject({ status: "accepted", main: d4.x });

    // Два взрослых против итога (Y). Без закрепления учитель (X) и взрослые (Y) разошлись бы — escalated.
    let last: Votes | undefined;
    for (const who of [adult, adult2]) {
      const id = uuidv7();
      judgment.set(`${who.account.id}:4`, id);
      const res = await api.post<Votes>("/corpus/judgments", { token: who.accessToken, body: { judgmentId: id, itemId: d4.item.itemId, shown: [d4.y, d4.x], choice: "a" } });
      expectStatus(res, 201);
      last = res.body;
    }
    expect(last).toMatchObject({ status: "accepted", decidedBy: "rule" });
    expect([last!.groups.adult.total, tally(last!, "adult", d4.y), tally(last!, "adult", d4.x)]).toEqual([2, 2, 0]);
    expect([last!.groups.child.total, last!.groups.teacher.total]).toEqual([3, 1]);
    expect(last!.variants.find((v) => v.variantId === d4.x)).toMatchObject({ accepted: true, main: true });
    expect(last!.variants.find((v) => v.variantId === d4.y)).toMatchObject({ accepted: false, main: false });
    expect(await state()).toEqual(before);
    expect((await consensus.recompute(d4.item.itemId))!.journalOutcome.status).toBe("escalated");

    // Поздний голос сразу «созревает» против закреплённого итога: несогласие — 1; мёд детей не тронут.
    for (const who of [adult, adult2]) expect(await ledger(judgment.get(`${who.account.id}:4`)!)).toMatchObject([{ status: "final", amount: 1 }]);
    for (const c of children) expect(await ledger(judgment.get(`${c.account.id}:4`)!)).toMatchObject([{ status: "final", amount: 3 }]);
    const cells = await api.get<Schema<"MyCellsPage">>("/corpus/my-cells", { token: adult2.accessToken });
    expect(cells.body.items.find((c) => c.itemId === d4.item.itemId)).toMatchObject({ status: "matured", honey: 1, agreed: false, maturedAt: before.decided_at.toISOString() });
  });

  it("item_state is exactly what a recount of the immutable journal gives (rule 9)", async () => {
    for (const { item } of items) {
      const { rows: variants } = await pool.query<{ id: string }>("SELECT id FROM variants WHERE source_item_id = $1 ORDER BY id", [item.itemId]);
      const { rows: journal } = await pool.query<JudgmentRecord>(
        `SELECT id, judge_account_id AS "judgeAccountId", voter_group::text AS "voterGroup", variant_a_id AS "variantAId",
                variant_b_id AS "variantBId", choice::text AS choice, created_at AS "createdAt"
         FROM judgments WHERE source_item_id = $1`,
        [item.itemId],
      );
      const recount = tallyItem([variants[0]!.id, variants[1]!.id], journal);
      const { rows } = await pool.query(
        `SELECT status::text AS status, accepted_variant_ids AS "acceptedVariantIds", main_variant_id AS "mainVariantId",
                children_prefer_variant_id AS "childrenPreferVariantId", votes_by_group AS "votesByGroup", scores,
                decided_by::text AS "decidedBy", decided_at AS "decidedAt", rules_version AS "rulesVersion"
         FROM item_state WHERE source_item_id = $1`,
        [item.itemId],
      );
      expect(rows[0], item.externalId).toEqual({
        status: recount.outcome.status,
        acceptedVariantIds: recount.acceptedVariantIds,
        mainVariantId: recount.mainVariantId,
        childrenPreferVariantId: recount.childrenPreferVariantId,
        votesByGroup: recount.votesByGroup,
        scores: recount.scores,
        decidedBy: recount.outcome.decidedBy,
        decidedAt: recount.decidedAt,
        rulesVersion: "duel-v0",
      });
      expect(await consensus.recompute(item.itemId)).toEqual(recount);
    }
  });

  it("judgments is append-only in the database: UPDATE, DELETE and TRUNCATE are refused (rule 9)", async () => {
    const id = judgment.get(`${children[0]!.account.id}:1`)!;
    await expect(pool.query("UPDATE judgments SET choice = 'both' WHERE id = $1", [id])).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM judgments WHERE id = $1", [id])).rejects.toThrow(/append-only/);
    await expect(pool.query("TRUNCATE judgments")).rejects.toThrow(/append-only/);
    const { rows } = await pool.query<{ choice: string }>("SELECT choice::text AS choice FROM judgments WHERE id = $1", [id]);
    expect(rows).toHaveLength(1);
  });
});
