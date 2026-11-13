// Фраза дня (ТЗ §3.6): публичная витрина без регистрации — детерминированный выбор из принятых пар корпуса.
// Три синтетические дуэли голосами взрослых доводим до принятия, затем: анониму доступно, пара — основной принятый
// вариант с источником, в течение суток одна и та же, сутки — по Уфе (UTC+5), за 62 дня выбор меняется.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Schema } from "@teletau/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConsensusService } from "../../src/modules/consensus/consensus.service.js";
import { CorpusService } from "../../src/modules/corpus/index.js";
import { importDuels } from "../../src/modules/corpus/duels-import.js";
import { uuidv7 } from "../../src/common/uuidv7.js";
import { bootApi, email, expectStatus, newDevice, RUN, type AuthSession, type TestApi } from "./harness.js";

let api: TestApi;
let pool: import("pg").Pool;
let close: () => Promise<void>;
let dir: string;
const voters: AuthSession[] = [];
const texts: string[] = [];

beforeAll(async () => {
  ({ api, pool, close } = await bootApi());
  dir = mkdtempSync(join(tmpdir(), "teletau-pod-"));
  writeFileSync(join(dir, "sources.yaml"), `sources:\n  - id: synthetic-pod\n    title: "Синтетика фразы дня"\n    url: https://example.org/pod\n    license: CC0\n    accessed: "2026-11-05"\n`);
  mkdirSync(join(dir, "duels"));
  const UNIT = `it-pod-${RUN}`;
  const v = (text: string) => `\n      - ba: ${text}\n        source:\n          ref: synthetic-pod\n          url: https://example.org/pod/${encodeURIComponent(text)}\n          locator: строка «${text}»\n        review: needs_native_review`;
  const duel = (n: number, ru: string) => `  - id: ${UNIT}-d0${n}\n    ru: "${ru}"\n    kind: phrase\n    variants:${v(`${ru} икс ${RUN}`)}${v(`${ru} игрек ${RUN}`)}\n`;
  writeFileSync(join(dir, "duels", `${UNIT}.yaml`), `unit: ${UNIT}\nduels:\n${duel(1, "Фраза один")}${duel(2, "Фраза два")}${duel(3, "Фраза три")}`);
  await importDuels(pool, { dir: join(dir, "duels"), sourcesFile: join(dir, "sources.yaml") });
  const items = await api.app.get(CorpusService).duelPool(UNIT);
  expect(items).toHaveLength(3);

  // Трое взрослых за «икс» в каждой дуэли (2+2+2 ≥ 3 голосов, перевес ≥ 2): приняты по duel-v0.
  for (const i of [1, 2, 3]) voters.push(await api.loginAdult(email(`pod-adult-${i}`), newDevice()));
  for (const s of voters) await api.acceptRequiredConsents(s.accessToken);
  for (const item of items) {
    const x = item.variants[0]!;
    const y = item.variants[1]!;
    texts.push(x.text);
    for (const s of voters) {
      const r = await api.post<Schema<"CorpusItemVotes">>("/corpus/judgments", { token: s.accessToken, body: { judgmentId: uuidv7(), itemId: item.itemId, shown: [x.id, y.id], choice: "a" } });
      expectStatus(r, 201);
    }
  }
});

afterAll(async () => {
  await close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /public/phrase-of-day", () => {
  it("анониму: пара дня — основной принятый вариант; повторный вызов — тот же ответ", async () => {
    const consensus = api.app.get(ConsensusService);
    const accepted = new Set((await consensus.fundDictionary()).items.filter((p) => p.main).map((p) => p.textBa));
    // Синтетика этого файла — среди принятых основных вариантов.
    for (const t of texts) expect(accepted).toContain(t);

    const res = await api.get<Schema<"PhraseOfDay">>("/public/phrase-of-day");
    expectStatus(res, 200);
    const body = res.body;
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.pair).toBeDefined();
    expect(accepted).toContain(body.pair!.textBa);
    expect(Array.isArray(body.pair!.sources)).toBe(true);
    expect(JSON.stringify(body)).not.toContain(voters[0]!.account.id);

    const again = await api.get<Schema<"PhraseOfDay">>("/public/phrase-of-day");
    expect(again.body).toEqual(body);
  });

  it("сутки — по Уфе: 20:00 UTC уже следующие сутки; в течение суток выбор не меняется", async () => {
    const consensus = api.app.get(ConsensusService);
    const morning = await consensus.phraseOfDay(new Date("2026-11-13T02:00:00Z"));
    const evening = await consensus.phraseOfDay(new Date("2026-11-13T18:00:00Z"));
    const nextDay = await consensus.phraseOfDay(new Date("2026-11-13T20:00:00Z"));
    expect(morning.date).toBe("2026-11-13");
    expect(evening.date).toBe("2026-11-13");
    expect(nextDay.date).toBe("2026-11-14");
    // Одни учебные сутки — одна пара: ответ совпадает целиком (кроме даты, она та же).
    expect(morning.pair).toEqual(evening.pair);
  });

  it("выбор детерминирован и меняется по дням: за 62 суток — больше одной пары", async () => {
    const consensus = api.app.get(ConsensusService);
    const dictionary = await consensus.fundDictionary();
    const accepted = new Set(dictionary.items.filter((p) => p.main).map((p) => p.textBa));
    const seen = new Set<string>();
    for (let k = 0; k < 62; k++) {
      const { pair } = await consensus.phraseOfDay(new Date(Date.UTC(2026, 0, 1) + k * 86_400_000));
      if (pair) {
        seen.add(pair.textBa);
        expect(accepted).toContain(pair.textBa);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});
