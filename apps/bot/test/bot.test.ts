// Сценарии ядра (канально-независимо) и адаптер Telegram на настоящем grammY с подменённым Bot API — без сети и токена.
import { describe, expect, it } from "vitest";
import { configureBot, createTelegramBot, fromTelegram, telegramSender, toTelegram, COMMANDS } from "../src/adapters/telegram.js";
import { loadConfig, miniAppUrlFor, MISSING_TOKEN_MESSAGE } from "../src/config.js";
import type { Outgoing } from "../src/core/messages.js";
import { ChatUnreachableError } from "../src/core/reminders.js";
import { CALLBACK, handle, MENU, TEXT, type BotContext } from "../src/core/scenarios.js";
import { BOT_INFO, callbackUpdate, fakeTelegram, FakeApi, textUpdate, USER_PII } from "./fakes.js";

const URL_APP = "https://teletau.example/miniapp";
const TOKEN = "7000000001:AAFakeTokenForTestsOnly_0123456789ab";
const cmd = (command: string, chatId = "42") => ({ chatId, kind: "command" as const, command, args: "" });
const tap = (data: string, chatId = "42") => ({ chatId, kind: "callback" as const, data });
const labels = (o: Outgoing | undefined) => (o?.buttons ?? []).flat().map((b) => b.label);
const menuLabels = (o: Outgoing | undefined) => (o?.menu ?? []).flat().map((b) => b.label);
const ctxWith = (api: FakeApi | null, miniAppUrl: string | undefined = URL_APP): BotContext => ({ api, miniAppUrl });

describe("ядро: /start и /help", () => {
  it("/start приветствует и ставит постоянное меню: «Учиться» (web_app), задание дня, фраза и напоминания", async () => {
    const [out] = await handle(cmd("start"), ctxWith(new FakeApi()));
    expect(out?.text).toMatch(/Привет/);
    expect(out?.buttons).toBeUndefined();
    expect(out?.menu).toEqual([
      [{ label: MENU.learn, webAppUrl: URL_APP }],
      [{ label: MENU.daily }, { label: MENU.phrase }],
      [{ label: MENU.reminders }],
    ]);
    expect(out?.text).not.toContain("/remind");
    expect(out?.text).not.toContain("/daily");
  });

  it("без https-адреса Mini App и без API — приветствие без кнопок и меню, но не ошибка", async () => {
    const [out] = await handle(cmd("start"), { api: null, miniAppUrl: undefined });
    expect(out).toEqual({ text: `${TEXT.start}\n${TEXT.startNoApp}` });
  });

  it("/help — кнопки меню, незнакомый текст — подсказка с меню", async () => {
    const [help] = await handle(cmd("help"), ctxWith(null));
    for (const label of [MENU.learn, MENU.daily, MENU.phrase, MENU.reminders]) expect(help?.text).toContain(label.replace(/^[^ ]+ /, ""));
    expect(help?.text).toContain("/start");
    const [fallback] = await handle({ chatId: "1", kind: "text", text: "сәләм" }, ctxWith(null));
    expect(fallback?.text).toMatch(/кнопк/i);
    expect(fallback?.text).toContain("/start");
  });

  it("нажатие кнопки меню приходит текстом — распознаётся как интент", async () => {
    const api = new FakeApi().link("42");
    const [duel] = await handle({ chatId: "42", kind: "text", text: MENU.daily }, ctxWith(api));
    expect(duel?.text).toContain(TEXT.duelHeader);
    const [phrase] = await handle({ chatId: "42", kind: "text", text: MENU.phrase }, ctxWith(api));
    expect(phrase?.text).toContain("Һаумыһығыҙ");
    const [menu] = await handle({ chatId: "42", kind: "text", text: MENU.reminders }, ctxWith(api));
    expect(menu?.text).toBe(TEXT.remindersOff);
  });

  it("никогда не повторяет chat id и текст пользователя (нет ПДн в сообщениях)", async () => {
    const api = new FakeApi().link("424242", { enabled: true, hour: 19 });
    const inputs = [
      { chatId: "424242", kind: "text" as const, text: "Меня зовут Айгуль, мой телефон 89001234567" },
      cmd("start", "424242"),
      cmd("remind", "424242"),
      tap(CALLBACK.hour(20), "424242"),
      cmd("remind_off", "424242"),
      cmd("unlink", "424242"),
    ];
    for (const input of inputs) {
      for (const o of await handle(input, ctxWith(api))) {
        const all = [o.text, ...labels(o), ...menuLabels(o)].join(" ");
        for (const pii of ["424242", "Айгуль", "89001234567"]) expect(all).not.toContain(pii);
      }
    }
  });
});

describe("ядро: /start <код> — привязка одноразовым кодом (ADR 0020)", () => {
  it("верный код: чат связан, код одноразовый — второй чат тем же кодом не привяжется", async () => {
    const api = new FakeApi().issueCode("ABCDEFGH");
    const [out] = await handle({ chatId: "42", kind: "command", command: "start", args: "ABCDEFGH" }, ctxWith(api));
    expect(out?.text).toBe(TEXT.linked);
    expect(api.links.has("42")).toBe(true);
    expect(api.linkCodes.size).toBe(0);
    const [again] = await handle({ chatId: "43", kind: "command", command: "start", args: "ABCDEFGH" }, ctxWith(api));
    expect(again?.text).toBe(TEXT.linkCodeBad);
    expect(api.links.has("43")).toBe(false);
  });

  it("неизвестный код — подсказка взять свежий в профиле, чат не привязан", async () => {
    const api = new FakeApi();
    const [out] = await handle({ chatId: "42", kind: "command", command: "start", args: "ZZZZZZZZ" }, ctxWith(api));
    expect(out?.text).toBe(TEXT.linkCodeBad);
    expect(api.links.size).toBe(0);
  });

  it("без кода и с мусором вместо него — прежний /start, API не дёргается", async () => {
    const api = new FakeApi();
    for (const args of ["", "   ", "привет", "12345678", "abcdefghi"]) {
      const [out] = await handle({ chatId: "42", kind: "command", command: "start", args }, ctxWith(api));
      expect(out?.text).toContain(TEXT.start);
    }
    expect(api.calls).toEqual([]);
  });

  it("код в нижнем регистре и с лишними аргументами гасится; без API — «нет связи»", async () => {
    const api = new FakeApi().issueCode("ABCDEFGH");
    const [out] = await handle({ chatId: "42", kind: "command", command: "start", args: "abcdefgh ещё слово" }, ctxWith(api));
    expect(out?.text).toBe(TEXT.linked);
    const [noApi] = await handle({ chatId: "44", kind: "command", command: "start", args: "ABCDEFGH" }, ctxWith(null));
    expect(noApi?.text).toBe(TEXT.unavailable);
  });

  it("ответ не содержит код и chat id (нет ПДн)", async () => {
    const api = new FakeApi().issueCode("ABCDEFGH");
    const outputs = [
      ...(await handle({ chatId: "424242", kind: "command", command: "start", args: "ABCDEFGH" }, ctxWith(api))),
      ...(await handle({ chatId: "424242", kind: "command", command: "start", args: "ZZZZZZZZ" }, ctxWith(api))),
    ];
    for (const o of outputs) {
      const all = [o.text, ...labels(o), ...menuLabels(o)].join(" ");
      expect(all).not.toContain("424242");
      expect(all).not.toContain("ABCDEFGH");
    }
  });

  it("адаптер: /start ABCDEFGH из настоящего сообщения доходит до погашения кода", async () => {
    const api = new FakeApi().issueCode("ABCDEFGH");
    const bot = createTelegramBot(TOKEN, ctxWith(api), { botInfo: BOT_INFO });
    const calls = fakeTelegram(bot);
    await bot.handleUpdate(textUpdate("/start ABCDEFGH") as never);
    expect(api.calls).toEqual(["redeem 4242 ABCDEFGH"]);
    expect(calls[0]!.payload).toMatchObject({ chat_id: 4242, text: TEXT.linked });
  });
});

describe("ядро: напоминания о серии по согласию", () => {
  it("непривязанный чат: «открой Учиться и войди» с меню, API ничего не меняет", async () => {
    const api = new FakeApi();
    const [out] = await handle(cmd("remind"), ctxWith(api));
    expect(out?.text).toBe(TEXT.notLinked);
    expect(labels(out)).toEqual([]);
    expect(out?.menu?.[0]).toEqual([{ label: MENU.learn, webAppUrl: URL_APP }]);
    const [on] = await handle(cmd("remind_on"), ctxWith(api));
    expect(on?.text).toBe(TEXT.notLinked);
    expect(api.links.size).toBe(0);
  });

  it("включение кнопкой, выбор часа, выключение кнопкой и командой", async () => {
    const api = new FakeApi().link("42");
    const [menu] = await handle(cmd("remind"), ctxWith(api));
    expect(menu?.text).toBe(TEXT.remindersOff);
    expect(menu?.buttons?.[0]?.[0]).toEqual({ label: "✅ Включить в 18:00", action: { kind: "callback", data: CALLBACK.on } });

    const [on] = await handle(tap(CALLBACK.on), ctxWith(api));
    expect(api.links.get("42")).toEqual({ enabled: true, hour: 18 });
    expect(on?.text).toBe(TEXT.remindersOn(18));
    expect(labels(on)).toEqual(["⏰ 16:00", "⏰ 17:00", "✅ 18:00", "⏰ 19:00", "⏰ 20:00", "🔕 Выключить", "❌ Отвязать чат"]);

    const [later] = await handle(tap(CALLBACK.hour(20)), ctxWith(api));
    expect(api.links.get("42")).toEqual({ enabled: true, hour: 20 });
    expect(labels(later)).toContain("✅ 20:00");

    const [off] = await handle(tap(CALLBACK.off), ctxWith(api));
    expect(off?.text).toBe(TEXT.turnedOff);
    expect(api.links.get("42")).toEqual({ enabled: false, hour: 20 });

    await handle(cmd("remind_on"), ctxWith(api));
    expect(api.links.get("42")?.enabled).toBe(true);
    await handle(cmd("remind_off"), ctxWith(api));
    expect(api.links.get("42")?.enabled).toBe(false);
    expect(api.calls).toEqual([
      "chat 42",
      'reminders 42 {"enabled":true}',
      'reminders 42 {"enabled":true,"hour":20}',
      'reminders 42 {"enabled":false}',
      'reminders 42 {"enabled":true}',
      'reminders 42 {"enabled":false}',
    ]);
  });

  it("чужие данные кнопки (час в тихие часы, мусор) — игнор без вызова API", async () => {
    const api = new FakeApi().link("42");
    for (const data of ["rem:h:23", "rem:h:7", "rem:h:", "rm -rf", CALLBACK.hour(15)]) expect(await handle(tap(data), ctxWith(api))).toEqual([]);
    expect(api.calls).toEqual([]);
  });

  it("/unlink и кнопка «❌ Отвязать чат» в меню напоминаний удаляют привязку вместе с настройками", async () => {
    const api = new FakeApi().link("42", { enabled: true });
    const [out] = await handle(cmd("unlink"), ctxWith(api));
    expect(out?.text).toBe(TEXT.unlinked);
    expect(api.links.has("42")).toBe(false);
    api.link("42", { enabled: true });
    const [byButton] = await handle(tap(CALLBACK.unlink), ctxWith(api));
    expect(byButton?.text).toBe(TEXT.unlinked);
    expect(api.links.has("42")).toBe(false);
  });

  it("API недоступно — вежливое «попробуй позже»; бот без секрета сервиса — «пока недоступны»", async () => {
    const api = new FakeApi().link("42");
    api.down = true;
    expect(await handle(cmd("remind"), ctxWith(api))).toEqual([{ text: TEXT.unavailable }]);
    expect(await handle(tap(CALLBACK.on), ctxWith(api))).toEqual([{ text: TEXT.unavailable }]);
    expect(await handle(cmd("remind"), ctxWith(null))).toEqual([{ text: TEXT.remindersDisabled }]);
    expect(await handle(cmd("unlink"), ctxWith(null))).toEqual([{ text: TEXT.remindersDisabled }]);
  });
});

describe("ядро: ежедневное задание «Помоги языку» (ADR 0024)", () => {
  /** Первая кнопка выбора (сторона A) выданной дуэли. */
  const firstChoice = (o: Outgoing | undefined) => {
    const b = o?.buttons?.[0]?.[0];
    return b?.action.kind === "callback" ? b.action.data : "";
  };

  it("непривязанный чат: «открой Учиться и войди» с меню", async () => {
    const api = new FakeApi();
    const [out] = await handle(cmd("daily"), ctxWith(api));
    expect(out?.text).toBe(TEXT.notLinkedDaily);
    expect(labels(out)).toEqual([]);
    expect(out?.menu?.[0]).toEqual([{ label: MENU.learn, webAppUrl: URL_APP }]);
    expect(api.calls).toEqual(["daily 42"]);
  });

  it("выдача: исходник, стороны с номерами и кнопки ≤ 64 байт; повтор — то же задание (идемпотентность FSM)", async () => {
    const api = new FakeApi().link("42");
    const [out] = await handle(cmd("daily"), ctxWith(api));
    expect(out?.text).toBe(`${TEXT.duelHeader}\n\n${TEXT.duelAsk}\n\n«Синтетическая фраза 1»\n\n1. синтез1 икс\n2. синтез1 игрек`);
    expect(labels(out)).toEqual([`1️⃣ синтез1 икс`, `2️⃣ синтез1 игрек`, TEXT.duelBoth, TEXT.duelSkip, TEXT.duelCancel]);
    for (const b of (out?.buttons ?? []).flat()) {
      const data = b.action.kind === "callback" ? b.action.data : "";
      expect(data.length, data).toBeLessThanOrEqual(64);
    }
    const again = await handle(cmd("daily"), ctxWith(api));
    expect(again).toEqual([out]);
    expect(api.calls).toEqual(["daily 42", "daily 42"]);
  });

  it("ответ кнопкой: «учтён»; та же кнопка — тот же ответ (replay); другой выбор — «уже учтён»; до следующих суток — done", async () => {
    const api = new FakeApi().link("42");
    const [duel] = await handle(cmd("daily"), ctxWith(api));
    const data = firstChoice(duel);
    expect(data).toMatch(/^dd:[0-9a-f-]{36}:a$/);

    const [voted] = await handle(tap(data), ctxWith(api));
    expect(voted?.text).toBe(TEXT.duelVoted);
    const [replay] = await handle(tap(data), ctxWith(api));
    expect(replay).toEqual(voted);
    // Распределение голосов не показывается — только «учтён» (защита от конформизма, docs/03 §4a).
    const [other] = await handle(tap(`${data.slice(0, -1)}b`), ctxWith(api));
    expect(other?.text).toBe(TEXT.duelVotedAlready);

    const [done] = await handle(cmd("daily"), ctxWith(api));
    expect(done?.text).toBe(TEXT.dailyDone);
    // Новые сутки — новая дуэля: done считается по суткам ответа, не по дню выдачи.
    api.nextDay();
    const [next] = await handle(cmd("daily"), ctxWith(api));
    expect(next?.text).toContain("Синтетическая фраза 2");
    expect(api.calls).toEqual(["daily 42", `answer ${data.slice(3, -2)} a`, `answer ${data.slice(3, -2)} a`, `answer ${data.slice(3, -2)} b`, "daily 42", "daily 42"]);
  });

  it("/cancel закрывает задание: голоса не было; кнопки старого — «закрыто»; повтор — «нечего»; /daily — новая дуэля", async () => {
    const api = new FakeApi().link("42");
    const [duel] = await handle(cmd("daily"), ctxWith(api));
    const data = firstChoice(duel);
    expect((await handle(cmd("cancel"), ctxWith(api)))[0]?.text).toBe(TEXT.dailyCancelled);
    expect((await handle(tap(data), ctxWith(api)))[0]?.text).toBe(TEXT.duelClosed);
    expect((await handle(cmd("cancel"), ctxWith(api)))[0]?.text).toBe(TEXT.dailyNothingToCancel);
    const [fresh] = await handle(cmd("daily"), ctxWith(api));
    expect(firstChoice(fresh)).not.toBe(data);
    // Отмена — не ответ: кнопки закрытого диалога голоса не оставляют, исходник не считается голосованным.
    expect(api.votedItems.size).toBe(0);
  });

  it("за исходник уже голосовали из веба: устаревшая кнопка — «уже учтён», /daily — другая дуэля", async () => {
    const api = new FakeApi().link("42");
    const [duel] = await handle(cmd("daily"), ctxWith(api));
    api.externalVote(0); // голос из веба по исходнику выданной дуэли
    expect((await handle(tap(firstChoice(duel)), ctxWith(api)))[0]?.text).toBe(TEXT.duelVotedAlready);
    const [fresh] = await handle(cmd("daily"), ctxWith(api));
    expect(fresh?.text).toContain("Синтетическая фраза 2");
  });

  it("пул нерешённых дуэлей исчерпан — empty", async () => {
    const api = new FakeApi().link("42");
    api.externalVote(0).externalVote(1).externalVote(2);
    expect((await handle(cmd("daily"), ctxWith(api)))[0]?.text).toBe(TEXT.dailyEmpty);
  });

  it("API недоступно — «попробуй позже»; бот без секрета сервиса — «пока недоступно»", async () => {
    const api = new FakeApi().link("42");
    api.down = true;
    expect(await handle(cmd("daily"), ctxWith(api))).toEqual([{ text: TEXT.unavailable }]);
    expect(await handle(tap("dd:00000000-0000-4000-8000-000000000001:a"), ctxWith(api))).toEqual([{ text: TEXT.unavailable }]);
    expect(await handle(cmd("cancel"), ctxWith(api))).toEqual([{ text: TEXT.unavailable }]);
    expect(await handle(cmd("daily"), ctxWith(null))).toEqual([{ text: TEXT.dailyDisabled }]);
    expect(await handle(cmd("cancel"), ctxWith(null))).toEqual([{ text: TEXT.dailyDisabled }]);
  });

  it("чужие данные кнопки дуэли (не uuid, не тот выбор) — игнор без вызова API", async () => {
    const api = new FakeApi().link("42");
    for (const data of ["dd:", "dd:abc:a", "dd:00000000-0000-4000-8000-000000000001:x", "dd:00000000-0000-4000-8000-000000000001", "dd:000000000000400080000000000000001:a", "xx:00000000-0000-4000-8000-000000000001:a"])
      expect(await handle(tap(data), ctxWith(api))).toEqual([]);
    expect(api.calls).toEqual([]);
  });

  it("в ответах ежедневки нет ПДн Telegram и chat id (правило 13)", async () => {
    const api = new FakeApi().link("424242");
    const [duel] = await handle(cmd("daily", "424242"), ctxWith(api));
    const outs = [
      duel!,
      ...(await handle(tap(firstChoice(duel)), ctxWith(api))),
      ...(await handle(cmd("cancel", "424242"), ctxWith(api))),
      ...(await handle(cmd("daily", "424242"), ctxWith(api))),
    ];
    for (const o of outs) {
      const all = [o.text, ...labels(o)].join(" ");
      expect(all).not.toContain("424242");
      for (const pii of USER_PII) expect(all).not.toContain(pii);
    }
  });
});

describe("ядро: фраза дня (ТЗ §3.6)", () => {
  it("«💬 Фраза дня» показывает пару дня без привязки чата, ответ несёт меню", async () => {
    const api = new FakeApi();
    const [out] = await handle(cmd("phrase", "777"), ctxWith(api));
    expect(out?.text).toBe("Фраза дня\n\n«Һаумыһығыҙ!»\n— «Здравствуйте!»");
    expect(labels(out)).toEqual([]);
    expect(menuLabels(out)).toEqual([MENU.learn, MENU.daily, MENU.phrase, MENU.reminders]);
    expect(api.calls).toEqual(["phrase"]);
  });

  it("принятых пар нет — «загляни позже»; API недоступно — «попробуй позже»; без секрета — «пока недоступна»", async () => {
    const empty = new FakeApi();
    empty.phrase = null;
    expect((await handle(cmd("phrase"), ctxWith(empty)))[0]?.text).toContain("Принятых пар");

    const down = new FakeApi();
    down.down = true;
    expect((await handle(cmd("phrase"), ctxWith(down)))[0]?.text).toBe(TEXT.unavailable);

    expect((await handle(cmd("phrase"), ctxWith(null)))[0]?.text).toBe(TEXT.phraseDisabled);
  });
});

describe("адаптер Telegram: преобразования", () => {
  it("кнопки Mini App — web_app, остальные — callback_data", () => {
    const msg = toTelegram({ text: "x", buttons: [[{ label: "Открыть", action: { kind: "openMiniApp", url: "https://a.b/" } }, { label: "Вкл", action: { kind: "callback", data: "rem:on" } }]] });
    expect(msg.reply_markup).toEqual({ inline_keyboard: [[{ text: "Открыть", web_app: { url: "https://a.b/" } }, { text: "Вкл", callback_data: "rem:on" }]] });
    expect(toTelegram({ text: "x" })).toEqual({ text: "x" });
  });

  it("постоянное меню — reply-клавиатура (web_app и текстовые кнопки), одно reply_markup на сообщение", () => {
    const msg = toTelegram({ text: "x", menu: [[{ label: "📚 Учиться", webAppUrl: "https://a.b/" }], [{ label: "⚡️ Задание дня" }]] });
    expect(msg.reply_markup).toEqual({
      keyboard: [[{ text: "📚 Учиться", web_app: { url: "https://a.b/" } }], [{ text: "⚡️ Задание дня" }]],
      is_persistent: true,
      resize_keyboard: true,
    });
  });

  it("команды с упоминанием бота и аргументами", () => {
    expect(fromTelegram(7, "/Start@teletau_bot class42")).toEqual({ chatId: "7", kind: "command", command: "start", args: "class42" });
    expect(fromTelegram(7, "/remind_off")).toEqual({ chatId: "7", kind: "command", command: "remind_off", args: "" });
    expect(fromTelegram(7, "просто текст")).toEqual({ chatId: "7", kind: "text", text: "просто текст" });
  });
});

describe("адаптер Telegram: настоящий grammY, подменённый Bot API", () => {
  const setup = (api = new FakeApi(), reply?: Parameters<typeof fakeTelegram>[1]) => {
    const bot = createTelegramBot(TOKEN, ctxWith(api), { botInfo: BOT_INFO });
    return { bot, api, calls: fakeTelegram(bot, reply) };
  };

  it("/start в личном чате → sendMessage с постоянным меню; из профиля в ответ ничего не попало", async () => {
    const { bot, calls } = setup();
    await bot.handleUpdate(textUpdate("/start") as never);
    expect(calls.map((c) => c.method)).toEqual(["sendMessage"]);
    const p = calls[0]!.payload;
    expect(p["chat_id"]).toBe(4242);
    expect(p["reply_markup"]).toMatchObject({
      keyboard: [
        [{ text: MENU.learn, web_app: { url: URL_APP } }],
        [{ text: MENU.daily }, { text: MENU.phrase }],
        [{ text: MENU.reminders }],
      ],
      is_persistent: true,
    });
    for (const pii of USER_PII) expect(JSON.stringify(p)).not.toContain(pii);
  });

  it("групповой чат бот не обслуживает: ни ответа, ни вызова API", async () => {
    const { bot, api, calls } = setup(new FakeApi().link("-100"));
    await bot.handleUpdate(textUpdate("/remind", { id: -100, type: "group" }) as never);
    expect(calls).toEqual([]);
    expect(api.calls).toEqual([]);
  });

  it("кнопка «Включить»: answerCallbackQuery и правка того же сообщения", async () => {
    const { bot, api, calls } = setup(new FakeApi().link("4242"));
    await bot.handleUpdate(callbackUpdate(CALLBACK.on) as never);
    expect(api.links.get("4242")?.enabled).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(["answerCallbackQuery", "editMessageText"]);
    expect(calls[1]!.payload).toMatchObject({ chat_id: 4242, message_id: 10, text: TEXT.remindersOn(18) });
  });

  it("задание дня: /daily → дуэль с кнопками; ответ кнопкой — правка сообщения, из ответа не утекает ничего личного", async () => {
    const { bot, api, calls } = setup(new FakeApi().link("4242"));
    await bot.handleUpdate(textUpdate("/daily") as never);
    expect(calls.map((c) => c.method)).toEqual(["sendMessage"]);
    const keyboard = calls[0]!.payload["reply_markup"] as { inline_keyboard: { text: string; callback_data: string }[][] };
    expect(keyboard.inline_keyboard.length).toBe(4); // A, B, «Оба/Не знаю», «Отменить»
    const data = keyboard.inline_keyboard[0]![0]!.callback_data;
    calls.length = 0;
    await bot.handleUpdate(callbackUpdate(data) as never);
    expect(calls.map((c) => c.method)).toEqual(["answerCallbackQuery", "editMessageText"]);
    expect(calls[1]!.payload).toMatchObject({ chat_id: 4242, message_id: 10, text: TEXT.duelVoted });
    expect(calls[1]!.payload["reply_markup"]).toBeUndefined();
    for (const pii of USER_PII) expect(JSON.stringify(calls)).not.toContain(pii);
    expect(api.calls).toEqual(["daily 4242", `answer ${data.slice(3, -2)} a`]);
  });

  it("повторное нажатие того же часа («message is not modified») — без нового сообщения", async () => {
    const { bot, calls } = setup(new FakeApi().link("4242", { enabled: true, hour: 19 }), (c) =>
      c.method === "editMessageText" ? { error_code: 400, description: "Bad Request: message is not modified" } : true,
    );
    await bot.handleUpdate(callbackUpdate(CALLBACK.hour(19)) as never);
    expect(calls.map((c) => c.method)).toEqual(["answerCallbackQuery", "editMessageText"]);
  });

  it("команды и кнопка меню «Учиться» → Mini App (только https)", async () => {
    const { bot, calls } = setup();
    await configureBot(bot, { miniAppUrl: URL_APP });
    expect(calls[0]).toEqual({ method: "setMyCommands", payload: { commands: COMMANDS } });
    expect(calls[1]).toEqual({ method: "setChatMenuButton", payload: { menu_button: { type: "web_app", text: "Учиться", web_app: { url: URL_APP } } } });
    calls.length = 0;
    await configureBot(bot, { miniAppUrl: undefined });
    expect(calls.map((c) => c.method)).toEqual(["setMyCommands"]);
  });

  it("отправка напоминания: заблокировал бота (403) или чат удалён — ChatUnreachableError; прочие ошибки — как есть", async () => {
    const out = { text: TEXT.reminder };
    const blocked = setup(undefined, () => ({ error_code: 403, description: "Forbidden: bot was blocked by the user" }));
    await expect(telegramSender(blocked.bot)("4242", out)).rejects.toBeInstanceOf(ChatUnreachableError);
    const gone = setup(undefined, () => ({ error_code: 400, description: "Bad Request: chat not found" }));
    await expect(telegramSender(gone.bot)("4242", out)).rejects.toBeInstanceOf(ChatUnreachableError);
    const busy = setup(undefined, () => ({ error_code: 429, description: "Too Many Requests: retry after 5" }));
    await expect(telegramSender(busy.bot)("4242", out)).rejects.not.toBeInstanceOf(ChatUnreachableError);
    const ok = setup();
    await telegramSender(ok.bot)("4242", out);
    expect(ok.calls[0]).toEqual({ method: "sendMessage", payload: { chat_id: 4242, text: TEXT.reminder } });
  });
});

describe("конфигурация", () => {
  it("без токена конфигурация читается, бот не стартует с понятной подсказкой (без значений переменных)", () => {
    const c = loadConfig({ TELEGRAM_BOT_TOKEN: "", TELEGRAM_MINIAPP_URL: "" });
    expect(c.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(MISSING_TOKEN_MESSAGE).toMatch(/TELEGRAM_BOT_TOKEN не задан/);
    expect(MISSING_TOKEN_MESSAGE).toMatch(/@BotFather/);
    expect(() => loadConfig({ TELEGRAM_BOT_TOKEN: "not-a-real-token-value" })).toThrow(/TELEGRAM_BOT_TOKEN/);
    try {
      loadConfig({ TELEGRAM_BOT_TOKEN: "not-a-real-token-value" });
    } catch (e) {
      expect(String(e)).not.toContain("not-a-real-token-value");
    }
  });

  it("кнопка Mini App — только для https://", () => {
    expect(miniAppUrlFor(loadConfig({ TELEGRAM_MINIAPP_URL: URL_APP }))).toBe(URL_APP);
    expect(miniAppUrlFor(loadConfig({ TELEGRAM_MINIAPP_URL: "http://localhost:3000/miniapp" }))).toBeUndefined();
    expect(miniAppUrlFor(loadConfig({}))).toBeUndefined();
    expect(loadConfig({}).BOT_API_URL).toBe("http://localhost:4000");
  });
});
