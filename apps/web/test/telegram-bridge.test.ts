// Свой мост Telegram Mini Apps (app/_components/telegram/telegram-bridge.ts): параметры запуска из #tgWebApp…,
// события веба → клиент и клиент → веб, тема по colorScheme. Главное для ПДн детей: initData сразу уходит из адреса,
// не хранится (ни в sessionStorage, ни в параметрах запуска, ни в событиях клиенту) и отдаётся ровно один раз — для
// привязки чата POST /api/v1/telegram/link после входа (ADR 0020).
import { describe, expect, it } from "vitest";
import {
  LAUNCH_STORAGE_KEY,
  TELEGRAM_WEB_ORIGIN,
  colorSchemeOf,
  connectTelegram,
  isColorDark,
  parseLaunchParams,
  readInitData,
  stripLaunchParams,
  versionAtLeast,
  type TelegramWindow,
} from "../app/_components/telegram/telegram-bridge";

// Цвета темы Telegram — данные клиента, а не цвета интерфейса: интерфейс берёт только токены.
const DARK_THEME = { bg_color: "#17212b", text_color: "#f5f5f5", button_color: "#5288c1" };
const LIGHT_THEME = { bg_color: "#ffffff", text_color: "#000000" };
// initData с профилем (как присылает Telegram): имя, ник и фото — ПДн, которых не должно быть нигде.
const INIT_DATA = new URLSearchParams({
  query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
  user: JSON.stringify({ id: 279058397, first_name: "Айгуль", last_name: "Тестова", username: "aigul_test", photo_url: "https://t.me/i/userpic/1.jpg" }),
  auth_date: "1730700000",
  hash: "c501b71e775f74ce10e377dea85a7ea24ecd640b223ea86dfe453e0eaed2e2b2",
}).toString();

function launchHash(opts: { version?: string; platform?: string; theme?: Record<string, string>; extra?: string } = {}) {
  const p = new URLSearchParams();
  p.set("tgWebAppData", INIT_DATA);
  p.set("tgWebAppVersion", opts.version ?? "7.10");
  p.set("tgWebAppPlatform", opts.platform ?? "android");
  p.set("tgWebAppThemeParams", JSON.stringify(opts.theme ?? DARK_THEME));
  p.set("tgWebAppStartParam", "demo");
  return `#${p.toString()}${opts.extra ?? ""}`;
}

interface Fake {
  win: TelegramWindow;
  sent: { type: string; data: string }[];
  urls: string[];
  storage: Map<string, string>;
  messageListeners: ((e: MessageEvent) => void)[];
  parentMessages: { msg: string; origin: string }[];
}

function fakeWindow(opts: { hash?: string; native?: boolean; iframe?: boolean; desktop?: boolean; storage?: Map<string, string> } = {}): Fake {
  const sent: Fake["sent"] = [];
  const urls: string[] = [];
  const storage = opts.storage ?? new Map<string, string>();
  const messageListeners: Fake["messageListeners"] = [];
  const parentMessages: Fake["parentMessages"] = [];
  const self = {};
  const parent = opts.iframe ? { postMessage: (msg: string, origin: string) => parentMessages.push({ msg, origin }) } : self;
  const location = { hash: opts.hash ?? "", pathname: "/miniapp", search: "" };
  const win: TelegramWindow = {
    location,
    history: {
      state: { __NA: true },
      replaceState: (_data, _unused, url) => {
        urls.push(url ?? "");
        const i = (url ?? "").indexOf("#");
        location.hash = i >= 0 ? (url ?? "").slice(i) : "";
      },
    },
    sessionStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => void storage.set(k, v) },
    parent,
    self,
    ...(opts.native ? { TelegramWebviewProxy: { postEvent: (type: string, data: string) => void sent.push({ type, data }) } } : {}),
    ...(opts.desktop ? { external: { notify: (msg: string) => void sent.push({ type: "notify", data: msg }) } } : {}),
    addEventListener: (_t, fn) => void messageListeners.push(fn),
    removeEventListener: (_t, fn) => void messageListeners.splice(messageListeners.indexOf(fn), 1),
  };
  return { win, sent, urls, storage, messageListeners, parentMessages };
}

describe("параметры запуска", () => {
  it("читает версию, платформу и тему из #tgWebApp…, initData — нет", () => {
    const p = parseLaunchParams(launchHash())!;
    expect(p).toEqual({ version: "7.10", platform: "android", themeParams: DARK_THEME });
    expect(JSON.stringify(p)).not.toMatch(/Айгуль|aigul|userpic|query_id|auth_date/);
  });

  it("обычный адрес — не Telegram", () => {
    expect(parseLaunchParams("")).toBeNull();
    expect(parseLaunchParams("#step=nick")).toBeNull();
  });

  it("тема: только цвета #rrggbb — остальное отбрасывается", () => {
    const hash = launchHash({ theme: { bg_color: "17212B", text_color: "red; background:url(x)", "bad-key": "#ffffff" } });
    expect(parseLaunchParams(hash)!.themeParams).toEqual({ bg_color: "#17212b" });
    expect(parseLaunchParams("#tgWebAppVersion=7.0&tgWebAppThemeParams=%7Bbroken")!.themeParams).toEqual({});
  });

  it("stripLaunchParams убирает все tgWebApp…, свои параметры хеша остаются", () => {
    expect(stripLaunchParams(launchHash())).toBe("");
    expect(stripLaunchParams(launchHash({ extra: "&step=nick" }))).toBe("#step=nick");
    expect(stripLaunchParams("#step=nick")).toBe("#step=nick");
  });

  it("сравнение версий — по числам: 7.10 ≥ 6.9, 6.2 < 6.4", () => {
    expect(versionAtLeast("7.10", "6.9")).toBe(true);
    expect(versionAtLeast("6.4", "6.4")).toBe(true);
    expect(versionAtLeast("6.2", "6.4")).toBe(false);
    expect(versionAtLeast("6", "6.1")).toBe(false);
  });
});

describe("тема по colorScheme", () => {
  it("тёмная — по цвету фона (HSP < 120, как у telegram-web-app.js)", () => {
    expect(isColorDark(DARK_THEME.bg_color)).toBe(true);
    expect(isColorDark(LIGHT_THEME.bg_color)).toBe(false);
    expect(colorSchemeOf(DARK_THEME)).toBe("dark");
    expect(colorSchemeOf(LIGHT_THEME)).toBe("light");
    expect(colorSchemeOf({})).toBe("light");
  });

  it("theme_changed меняет схему и запоминается во вкладке (без initData)", () => {
    const f = fakeWindow({ hash: launchHash({ theme: LIGHT_THEME }), native: true });
    const bridge = connectTelegram(f.win);
    expect(bridge.colorScheme).toBe("light");
    const seen: string[] = [];
    bridge.on("theme_changed", (d) => seen.push(colorSchemeOf(d.theme_params)));
    f.win.Telegram!.WebView!.receiveEvent!("theme_changed", { theme_params: DARK_THEME });
    expect(seen).toEqual(["dark"]);
    expect(bridge.colorScheme).toBe("dark");
    expect(JSON.parse(f.storage.get(LAUNCH_STORAGE_KEY)!).themeParams).toEqual(DARK_THEME);
  });
});

describe("initData — только в памяти и один раз в привязку", () => {
  it("takeInitData: строка запуска как есть — один раз; потом null", () => {
    const f = fakeWindow({ hash: launchHash(), native: true });
    const bridge = connectTelegram(f.win);
    expect(bridge.takeInitData()).toBe(INIT_DATA);
    expect(bridge.takeInitData()).toBeNull();
  });

  it("не видна снаружи моста: ни в JSON, ни в свойствах, ни в параметрах запуска", () => {
    const bridge = connectTelegram(fakeWindow({ hash: launchHash(), native: true }).win);
    expect(JSON.stringify(bridge)).not.toMatch(/Айгуль|aigul|query_id|auth_date/);
    expect(Object.values(bridge).map(String).join(" ")).not.toMatch(/Айгуль|aigul|query_id/);
    expect(JSON.stringify(bridge.launch)).not.toMatch(/Айгуль|aigul|query_id|auth_date/);
  });

  it("вне Telegram, после перезагрузки (хеша нет) и без tgWebAppData — привязывать нечего", () => {
    expect(connectTelegram(fakeWindow({ hash: launchHash() }).win).takeInitData()).toBeNull();
    const storage = new Map<string, string>();
    connectTelegram(fakeWindow({ hash: launchHash(), native: true, storage }).win);
    const reloaded = connectTelegram(fakeWindow({ native: true, storage }).win);
    expect(reloaded.inTelegram).toBe(true);
    expect(reloaded.takeInitData()).toBeNull();
    expect(readInitData("#tgWebAppVersion=7.10&tgWebAppPlatform=ios")).toBeNull();
    expect(readInitData("#step=nick")).toBeNull();
    expect(readInitData(launchHash())).toBe(INIT_DATA);
  });

  it("уходит из адреса сразу, состояние истории Next.js сохраняется; в sessionStorage — только версия, платформа, тема", () => {
    const f = fakeWindow({ hash: launchHash(), native: true });
    connectTelegram(f.win);
    expect(f.urls).toEqual(["/miniapp"]);
    expect(f.win.location.hash).toBe("");
    const stored = f.storage.get(LAUNCH_STORAGE_KEY)!;
    expect(JSON.parse(stored)).toEqual({ version: "7.10", platform: "android", themeParams: DARK_THEME });
    expect(stored).not.toMatch(/Айгуль|aigul|query_id|hash|tgWebAppData|demo/);
  });

  it("ни одно событие клиенту не несёт initData", () => {
    const f = fakeWindow({ hash: launchHash(), native: true });
    const bridge = connectTelegram(f.win);
    bridge.ready();
    bridge.expand();
    bridge.setBackButton(true);
    bridge.openScanQr("Наведи камеру на QR-код карточки");
    expect(f.sent.map((s) => s.data).join("\n")).not.toMatch(/Айгуль|aigul|query_id|auth_date/);
  });

  it("после перезагрузки внутри Telegram (хеша уже нет) параметры берутся из вкладки", () => {
    const storage = new Map<string, string>();
    connectTelegram(fakeWindow({ hash: launchHash({ platform: "ios" }), native: true, storage }).win);
    const again = connectTelegram(fakeWindow({ native: true, storage }).win);
    expect(again.inTelegram).toBe(true);
    expect(again.platform).toBe("ios");
  });
});

describe("события веба → клиент", () => {
  it("мобильный клиент: TelegramWebviewProxy.postEvent(тип, JSON), без данных — пустая строка", () => {
    const f = fakeWindow({ hash: launchHash(), native: true });
    const bridge = connectTelegram(f.win);
    bridge.ready();
    bridge.expand();
    bridge.setBackButton(true);
    bridge.openScanQr("Наведи камеру на QR-код карточки");
    expect(f.sent).toEqual([
      { type: "web_app_ready", data: '""' },
      { type: "web_app_expand", data: '""' },
      { type: "web_app_setup_back_button", data: '{"is_visible":true}' },
      { type: "web_app_open_scan_qr_popup", data: '{"text":"Наведи камеру на QR-код карточки"}' },
    ]);
  });

  it("Telegram Web: postMessage родителю только на https://web.telegram.org", () => {
    const f = fakeWindow({ hash: launchHash({ platform: "weba" }), iframe: true });
    const bridge = connectTelegram(f.win);
    bridge.ready();
    expect(f.parentMessages).toEqual([{ msg: JSON.stringify({ eventType: "web_app_ready", eventData: "" }), origin: TELEGRAM_WEB_ORIGIN }]);
  });

  it("Telegram Desktop: window.external.notify(JSON)", () => {
    const f = fakeWindow({ hash: launchHash({ platform: "tdesktop" }), desktop: true });
    connectTelegram(f.win).setBackButton(false);
    expect(f.sent).toEqual([{ type: "notify", data: JSON.stringify({ eventType: "web_app_setup_back_button", eventData: { is_visible: false } }) }]);
  });

  it("старый клиент: событие новее его версии не отправляется", () => {
    const f = fakeWindow({ hash: launchHash({ version: "6.0" }), native: true });
    const bridge = connectTelegram(f.win);
    expect(bridge.openScanQr("x")).toBe(false);
    bridge.setBackButton(true);
    bridge.ready();
    expect(f.sent.map((s) => s.type)).toEqual(["web_app_ready"]);
  });

  it("сканер QR — только в мобильных клиентах 6.4+", () => {
    expect(connectTelegram(fakeWindow({ hash: launchHash({ platform: "ios" }), native: true }).win).canScanQr).toBe(true);
    expect(connectTelegram(fakeWindow({ hash: launchHash({ platform: "android", version: "6.2" }), native: true }).win).canScanQr).toBe(false);
    expect(connectTelegram(fakeWindow({ hash: launchHash({ platform: "weba" }), iframe: true }).win).canScanQr).toBe(false);
  });

  it("обычный браузер (/miniapp без Telegram) — моста нет, события не отправляются, адрес не трогается", () => {
    const f = fakeWindow({ hash: "#step=nick" });
    const bridge = connectTelegram(f.win);
    expect(bridge.inTelegram).toBe(false);
    expect(bridge.colorScheme).toBeNull();
    expect(bridge.post("web_app_ready")).toBe(false);
    expect(f.urls).toEqual([]);
    expect(f.win.Telegram).toBeUndefined();
  });

  it("параметры в адресе, но не во фрейме и без клиента — не Telegram (ссылку открыли в браузере)", () => {
    const bridge = connectTelegram(fakeWindow({ hash: launchHash() }).win);
    expect(bridge.inTelegram).toBe(false);
  });
});

describe("события клиента → веб", () => {
  it("back_button_pressed — через Telegram.WebView.receiveEvent и TelegramGameProxy", () => {
    const f = fakeWindow({ hash: launchHash(), native: true });
    const bridge = connectTelegram(f.win);
    let pressed = 0;
    const off = bridge.on("back_button_pressed", () => pressed++);
    f.win.Telegram!.WebView!.receiveEvent!("back_button_pressed");
    f.win.TelegramGameProxy!.receiveEvent!("back_button_pressed");
    f.win.TelegramGameProxy_receiveEvent!("back_button_pressed");
    off();
    f.win.Telegram!.WebView!.receiveEvent!("back_button_pressed");
    expect(pressed).toBe(3);
  });

  it("qr_text_received — только пока открыт наш сканер; закрытие сканера — по web_app_close_scan_qr_popup", () => {
    const f = fakeWindow({ hash: launchHash(), native: true });
    const bridge = connectTelegram(f.win);
    const texts: string[] = [];
    bridge.on("qr_text_received", (d) => texts.push(d.data));
    f.win.Telegram!.WebView!.receiveEvent!("qr_text_received", { data: "TT1.before" });
    bridge.openScanQr();
    f.win.Telegram!.WebView!.receiveEvent!("qr_text_received", { data: "TT1.card" });
    bridge.closeScanQr();
    bridge.closeScanQr();
    f.win.Telegram!.WebView!.receiveEvent!("qr_text_received", { data: "TT1.after" });
    expect(texts).toEqual(["TT1.card"]);
    expect(f.sent.filter((s) => s.type === "web_app_close_scan_qr_popup")).toHaveLength(1);
  });

  it("scan_qr_popup_closed — пользователь закрыл сканер: событие и больше никаких текстов", () => {
    const f = fakeWindow({ hash: launchHash(), native: true });
    const bridge = connectTelegram(f.win);
    let closed = 0;
    bridge.on("scan_qr_popup_closed", () => closed++);
    bridge.openScanQr();
    f.win.Telegram!.WebView!.receiveEvent!("scan_qr_popup_closed");
    const texts: string[] = [];
    bridge.on("qr_text_received", (d) => texts.push(d.data));
    f.win.Telegram!.WebView!.receiveEvent!("qr_text_received", { data: "TT1.late" });
    expect(closed).toBe(1);
    expect(texts).toEqual([]);
  });

  it("Telegram Web: message принимается только от родителя с origin https://web.telegram.org", () => {
    const f = fakeWindow({ hash: launchHash({ platform: "weba" }), iframe: true });
    const bridge = connectTelegram(f.win);
    let pressed = 0;
    bridge.on("back_button_pressed", () => pressed++);
    const data = JSON.stringify({ eventType: "back_button_pressed" });
    const send = (source: unknown, origin: string, payload: unknown = data) => f.messageListeners.forEach((fn) => fn({ source, origin, data: payload } as MessageEvent));
    send(f.win.parent, TELEGRAM_WEB_ORIGIN);
    send(f.win.parent, "https://evil.example");
    send({}, TELEGRAM_WEB_ORIGIN);
    send(f.win.parent, TELEGRAM_WEB_ORIGIN, "{not json");
    expect(pressed).toBe(1);
  });

  it("destroy снимает обработчики и возвращает глобальные объекты", () => {
    const f = fakeWindow({ hash: launchHash({ platform: "weba" }), iframe: true });
    const bridge = connectTelegram(f.win);
    expect(f.messageListeners).toHaveLength(1);
    bridge.destroy();
    expect(f.messageListeners).toHaveLength(0);
    expect(f.win.Telegram).toBeUndefined();
  });
});
