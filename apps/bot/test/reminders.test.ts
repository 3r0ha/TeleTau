// Рассылка напоминаний о серии: кому — решает API (claim), бот отправляет без ПДн, заблокированные чаты отвязывает.
// Без сети: API в памяти, отправка — подделка; клиент API — с подменённым fetch.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTeleTauApi } from "../src/adapters/api.js";
import type { Outgoing } from "../src/core/messages.js";
import { ApiUnavailableError } from "../src/core/ports.js";
import { ChatUnreachableError, NotDeliveredError, RetryLaterError, sendDueReminders, startReminderLoop, type ReminderRun } from "../src/core/reminders.js";
import { CALLBACK, MENU, TEXT } from "../src/core/scenarios.js";
import { FakeApi } from "./fakes.js";

const ctx = { miniAppUrl: "https://teletau.example/miniapp" };
const noSleep = async () => undefined;

describe("отбор и отправка напоминаний", () => {
  it("отправляет тем, кого выдал API, — одинаковый текст без ПДн, с «Учиться» и «Выключить напоминания»", async () => {
    const api = new FakeApi().link("101", { enabled: true }).link("102", { enabled: true });
    api.due = ["101", "102"];
    const sent: [string, Outgoing][] = [];
    const run = await sendDueReminders({ api, ctx, sleep: noSleep, send: async (id, m) => void sent.push([id, m]) });
    expect(run).toEqual({ sent: 2, failed: 0, unlinked: 0, released: 0, apiUnavailable: false });
    expect(sent.map(([id]) => id)).toEqual(["101", "102"]);
    const [, message] = sent[0]!;
    expect(message.text).toBe("Сегодня ещё не было урока. Пройди один, чтобы не прервать серию.");
    expect(message.text).not.toMatch(/101|102/);
    expect(message.buttons).toEqual([
      [{ label: MENU.learn, action: { kind: "openMiniApp", url: ctx.miniAppUrl } }],
      [{ label: MENU.daily, action: { kind: "callback", data: CALLBACK.daily } }],
      [{ label: "🔕 Выключить напоминания", action: { kind: "callback", data: CALLBACK.off } }],
    ]);
    expect(sent[1]![1]).toEqual(message);
  });

  it("API выдаёт только должников серии: повторный шаг в те же сутки ничего не шлёт", async () => {
    const api = new FakeApi();
    api.due = ["101"];
    const send = vi.fn(async () => undefined);
    await sendDueReminders({ api, ctx, send, sleep: noSleep });
    await sendDueReminders({ api, ctx, send, sleep: noSleep });
    expect(send).toHaveBeenCalledTimes(1);
    expect(api.calls).toEqual(["claim", "claim"]);
  });

  it("заблокировал бота — чат отвязывается; обрыв сети — не отвязывается и не возвращается (исход неизвестен)", async () => {
    const api = new FakeApi().link("101", { enabled: true }).link("102", { enabled: true }).link("103", { enabled: true });
    api.due = ["101", "102", "103"];
    const run = await sendDueReminders({
      api,
      ctx,
      sleep: noSleep,
      send: async (id) => {
        if (id === "102") throw new ChatUnreachableError();
        if (id === "103") throw new Error("network down");
      },
    });
    expect(run).toEqual({ sent: 1, failed: 2, unlinked: 1, released: 0, apiUnavailable: false });
    expect([...api.links.keys()]).toEqual(["101", "103"]);
    expect(api.released).toEqual([]);
  });

  it("429 — ждём retry_after и повторяем; Telegram отказал и после повторов — чат возвращается в выдачу суток", async () => {
    const api = new FakeApi().link("101", { enabled: true }).link("102", { enabled: true }).link("103", { enabled: true });
    api.due = ["101", "102", "103"];
    const tries = new Map<string, number>();
    const pauses: number[] = [];
    const run = await sendDueReminders({
      api,
      ctx,
      sleep: async (ms) => void pauses.push(ms),
      send: async (id) => {
        tries.set(id, (tries.get(id) ?? 0) + 1);
        // 101: один 429 и успех; 102: 429 всегда; 103: ошибка Bot API (не 429) — точно не доставлено.
        if (id === "101" && tries.get(id) === 1) throw new RetryLaterError(3);
        if (id === "102") throw new RetryLaterError(2);
        if (id === "103") throw new NotDeliveredError(400);
      },
    });
    expect(run).toEqual({ sent: 1, failed: 2, unlinked: 0, released: 2, apiUnavailable: false });
    expect(tries).toEqual(new Map([["101", 2], ["102", 3], ["103", 1]]));
    expect(pauses.filter((ms) => ms >= 1000)).toEqual([3000, 2000, 2000]);
    expect(api.released).toEqual([{ day: "day-1", chatIds: ["102", "103"] }]);
    // Следующий шаг тех же суток выдаёт возвращённые чаты снова.
    const again = await sendDueReminders({ api, ctx, sleep: noSleep, send: async () => undefined });
    expect(again.sent).toBe(2);
  });

  it("слишком длинный retry_after не ждём — чат возвращается в выдачу", async () => {
    const api = new FakeApi();
    api.due = ["101"];
    const run = await sendDueReminders({ api, ctx, sleep: noSleep, send: async () => { throw new RetryLaterError(600); } });
    expect(run.released).toBe(1);
  });

  it("API недоступно — шаг пропускается без ошибки и без отправок", async () => {
    const api = new FakeApi();
    api.down = true;
    const send = vi.fn(async () => undefined);
    expect(await sendDueReminders({ api, ctx, send, sleep: noSleep })).toEqual({ sent: 0, failed: 0, unlinked: 0, released: 0, apiUnavailable: true });
    expect(send).not.toHaveBeenCalled();
  });

  it("без https-адреса Mini App — напоминание с одной кнопкой выключения", async () => {
    const api = new FakeApi();
    api.due = ["1"];
    const sent: Outgoing[] = [];
    await sendDueReminders({ api, ctx: { miniAppUrl: undefined }, sleep: noSleep, send: async (_id, m) => void sent.push(m) });
    expect(sent[0]?.buttons).toEqual([
      [{ label: MENU.daily, action: { kind: "callback", data: CALLBACK.daily } }],
      [{ label: "🔕 Выключить напоминания", action: { kind: "callback", data: CALLBACK.off } }],
    ]);
    expect(sent[0]?.text).toBe(TEXT.reminder);
  });
});

describe("цикл напоминаний", () => {
  afterEach(() => vi.useRealTimers());

  it("шаг сразу и по таймеру; шаги не накладываются; в лог — только счётчики", async () => {
    vi.useFakeTimers();
    let release: () => void = () => undefined;
    const runs: number[] = [];
    const step = vi.fn(
      () =>
        new Promise<ReminderRun>((resolve) => {
          runs.push(Date.now());
          release = () => resolve({ sent: 2, failed: 1, unlinked: 1, released: 0, apiUnavailable: false });
        }),
    );
    const log = vi.fn();
    const stop = startReminderLoop(step, 60_000, log);
    expect(step).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000); // первый шаг ещё идёт — второй не начинается
    expect(step).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(step).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith("bot: напоминания — отправлено 2, не доставлено 1, отвязано 1");
    stop();
    release();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(step).toHaveBeenCalledTimes(2);
  });
});

describe("клиент API (openapi-fetch по контракту, подменённый fetch)", () => {
  const recorded: Request[] = [];
  const respond = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": status >= 400 ? "application/problem+json" : "application/json" } });

  const client = (handler: (r: Request) => Response | Promise<Response>, warn = vi.fn()) =>
    createTeleTauApi({
      baseUrl: "http://api.test/",
      serviceToken: "test-service-token-0123456789",
      warn,
      fetch: async (r) => {
        recorded.push(r.clone());
        return handler(r);
      },
    });

  it("секрет сервиса — в X-Service-Token; пути и тела — из контракта", async () => {
    recorded.length = 0;
    const api = client(async (r) => {
      const path = new URL(r.url).pathname;
      if (path === "/api/v1/telegram/bot/reminders/claim") return respond(200, { day: "2026-11-04", items: [{ chatId: "101" }, { chatId: "102" }] });
      if (r.method === "DELETE") return respond(204);
      return respond(200, { chatId: "101", reminders: { enabled: true, hour: 19 } });
    });
    expect(await api.claimReminders()).toEqual({ day: "2026-11-04", chatIds: ["101", "102"] });
    expect(await api.chat("101")).toEqual({ chatId: "101", reminders: { enabled: true, hour: 19 } });
    expect(await api.setReminders("101", { enabled: true, hour: 19 })).toMatchObject({ reminders: { hour: 19 } });
    await api.unlink("101");
    expect(recorded.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "POST /api/v1/telegram/bot/reminders/claim",
      "GET /api/v1/telegram/bot/chats/101",
      "PUT /api/v1/telegram/bot/chats/101/reminders",
      "DELETE /api/v1/telegram/bot/chats/101",
    ]);
    expect(recorded.every((r) => r.headers.get("x-service-token") === "test-service-token-0123456789")).toBe(true);
    expect(await recorded[2]!.json()).toEqual({ enabled: true, hour: 19 });
  });

  it("возврат недоставленных: POST /telegram/bot/reminders/release с сутками и чатами; пустой список — без запроса", async () => {
    recorded.length = 0;
    const api = client(() => new Response(null, { status: 204 }));
    await api.releaseReminders("2026-11-04", ["101", "102"]);
    await api.releaseReminders("2026-11-04", []);
    expect(recorded.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual(["POST /api/v1/telegram/bot/reminders/release"]);
    expect(await recorded[0]!.json()).toEqual({ day: "2026-11-04", chatIds: ["101", "102"] });
  });

  it("ответ дуэли 409: код Problem из тела ошибки — already_voted → voted, dialog_closed → closed", async () => {
    const problem = (code: string) => () => respond(409, { type: "about:blank", title: "—", status: 409, code });
    const id = "00000000-0000-4000-8000-000000000001";
    expect(await client(problem("already_voted")).answerDuel(id, "a")).toEqual({ kind: "voted" });
    expect(await client(problem("dialog_closed")).answerDuel(id, "a")).toEqual({ kind: "closed" });
  });

  it("фраза дня: публичный путь из контракта, ответ без pair — null", async () => {
    recorded.length = 0;
    const api = client(() => respond(200, { date: "2026-11-13", pair: { sourceRu: "Здравствуйте!", kind: "phrase", textBa: "Һаумыһығыҙ!", sources: [] } }));
    expect(await api.phraseOfDay()).toMatchObject({ sourceRu: "Здравствуйте!", textBa: "Һаумыһығыҙ!" });
    expect(recorded.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual(["GET /api/v1/public/phrase-of-day"]);
    const noPair = client(() => respond(200, { date: "2026-11-13" }));
    expect(await noPair.phraseOfDay()).toBeNull();
  });

  it("404 chat_not_linked — null; 5xx, сеть и отвергнутый секрет — ApiUnavailableError (с одним предупреждением)", async () => {    expect(await client(() => respond(404, { type: "about:blank", title: "Чат Telegram не привязан", status: 404, code: "chat_not_linked" })).chat("5")).toBeNull();
    await expect(client(() => respond(503, { status: 503 })).claimReminders()).rejects.toBeInstanceOf(ApiUnavailableError);
    await expect(
      client(() => {
        throw new TypeError("fetch failed");
      }).chat("5"),
    ).rejects.toBeInstanceOf(ApiUnavailableError);
    const warn = vi.fn();
    const denied = client(() => respond(401, { status: 401, code: "unauthenticated" }), warn);
    await expect(denied.claimReminders()).rejects.toBeInstanceOf(ApiUnavailableError);
    await expect(denied.claimReminders()).rejects.toBeInstanceOf(ApiUnavailableError);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/BOT_SERVICE_TOKEN/);
    expect(warn.mock.calls[0]![0]).not.toContain("test-service-token");
  });
});
