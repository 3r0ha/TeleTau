// Свой мост Telegram Mini Apps (docs/plans/M2.md §3 «Ч5») — без скрипта telegram-web-app.js с telegram.org: строгая CSP
// пускает только свои скрипты, а чужой скрипт на странице ребёнка — лишний риск. Протокол — как у официального скрипта
// (core.telegram.org/api/web-events):
// - параметры запуска приходят в адресе после `#`: tgWebAppVersion, tgWebAppPlatform, tgWebAppThemeParams, tgWebAppData;
// - события веба → клиент: мобильные клиенты — window.TelegramWebviewProxy.postEvent(тип, JSON), Telegram Desktop —
//   window.external.notify(JSON), Telegram Web — postMessage родительскому окну https://web.telegram.org;
// - события клиента → веб: window.Telegram.WebView.receiveEvent(тип, данные) (и TelegramGameProxy), в Telegram Web —
//   message от родительского окна.
//
// ПДн детей (CLAUDE.md, правила 5 и 13): tgWebAppData (initData) содержит имя, фамилию, ник и фото из профиля Telegram.
// Мост сразу убирает его из адреса страницы (и истории), не кладёт в sessionStorage и не разбирает — держит строку
// только в памяти вкладки и отдаёт ровно один раз (takeInitData): после входа TelegramProvider отправляет её в одну
// операцию — POST /api/v1/telegram/link (ADR 0020), где API проверяет подпись и берёт из неё только user.id для
// привязки чата с ботом. Больше initData не уходит никуда. Вход — по QR-карточке через тот же BFF, что в вебе.

/** Origin Telegram Web — единственный сайт, которому разрешено встраивать /miniapp (frame-ancestors, security.ts). */
export const TELEGRAM_WEB_ORIGIN = "https://web.telegram.org";

/** Ключ sessionStorage: параметры запуска без initData — переживают перезагрузку страницы внутри Telegram. */
export const LAUNCH_STORAGE_KEY = "tt-tg-launch";

export type ColorScheme = "light" | "dark";

/** Параметры запуска, которые нужны вебу. initData сюда не попадает намеренно (он — отдельно, только в памяти). */
export interface LaunchParams {
  /** Версия Bot API клиента: «7.10». */
  version: string;
  /** android, ios, tdesktop, macos, weba, webk, unigram… */
  platform: string;
  /** Цвета темы Telegram (bg_color, text_color, …): из них берём только светлая она или тёмная. */
  themeParams: Record<string, string>;
}

/** События веба → клиент Telegram (только те, что нужны каркасу). */
export interface OutgoingEvents {
  web_app_ready: undefined;
  web_app_expand: undefined;
  web_app_request_theme: undefined;
  web_app_setup_back_button: { is_visible: boolean };
  web_app_open_scan_qr_popup: { text?: string };
  web_app_close_scan_qr_popup: undefined;
  web_app_set_header_color: { color: string };
  web_app_set_background_color: { color: string };
}

/** События клиента Telegram → веб. */
export interface IncomingEvents {
  back_button_pressed: undefined;
  theme_changed: { theme_params: Record<string, string> };
  qr_text_received: { data: string };
  scan_qr_popup_closed: undefined;
}

export type IncomingType = keyof IncomingEvents;
type ReceiveFn = (eventType: string, eventData?: unknown) => void;

/** С какой версии Bot API клиент понимает событие (core.telegram.org/bots/webapps). */
const MIN_VERSION: Partial<Record<keyof OutgoingEvents, string>> = {
  web_app_setup_back_button: "6.1",
  web_app_set_background_color: "6.1",
  web_app_set_header_color: "6.9",
  web_app_open_scan_qr_popup: "6.4",
  web_app_close_scan_qr_popup: "6.4",
};

/** Сканер QR Telegram есть только в мобильных клиентах; в Telegram Web и Desktop — вход по камере браузера или фото. */
const SCANNER_PLATFORMS = new Set(["android", "android_x", "ios"]);

/** Окно браузера — столько, сколько нужно мосту (в тестах — подделка). */
export interface TelegramWindow {
  location: { hash: string; pathname: string; search: string };
  history: { state: unknown; replaceState(data: unknown, unused: string, url?: string): void };
  sessionStorage?: Pick<Storage, "getItem" | "setItem">;
  parent: unknown;
  self: unknown;
  TelegramWebviewProxy?: { postEvent(eventType: string, eventData: string): void };
  external?: unknown;
  Telegram?: { WebView?: { receiveEvent?: ReceiveFn } & Record<string, unknown> } & Record<string, unknown>;
  TelegramGameProxy?: { receiveEvent?: ReceiveFn };
  TelegramGameProxy_receiveEvent?: ReceiveFn;
  addEventListener(type: "message", listener: (e: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (e: MessageEvent) => void): void;
}

/** Параметр tgWebApp… → поле LaunchParams. Всё прочее (tgWebAppData, tgWebAppStartParam, …) отбрасывается. */
function readParams(search: URLSearchParams): LaunchParams | null {
  const version = search.get("tgWebAppVersion");
  const platform = search.get("tgWebAppPlatform");
  if (!version && !platform) return null;
  return { version: version ?? "6.0", platform: platform ?? "unknown", themeParams: parseTheme(search.get("tgWebAppThemeParams")) };
}

/** Цвета темы: только строки вида #rrggbb (остальное — мусор или попытка подсунуть что-то в CSS). */
export function parseTheme(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  return sanitizeTheme(parsed);
}

function sanitizeTheme(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, color] of Object.entries(value as Record<string, unknown>)) {
    if (/^[a-z_]{1,40}$/.test(key) && typeof color === "string" && /^#?[0-9a-f]{6}$/i.test(color)) {
      out[key] = color.startsWith("#") ? color.toLowerCase() : `#${color.toLowerCase()}`;
    }
  }
  return out;
}

/** Параметры запуска из `location.hash` («#tgWebAppData=…&tgWebAppVersion=7.10&…»). Не Telegram — null. */
export function parseLaunchParams(hash: string): LaunchParams | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.includes("tgWebApp")) return null;
  return readParams(new URLSearchParams(raw));
}

/**
 * initData как есть (`Telegram.WebApp.initData`) из `#tgWebAppData=…` — для одной операции привязки (ADR 0020).
 * Не Telegram или параметра нет — null. Строку не разбираем: подпись и содержимое проверяет только API.
 */
export function readInitData(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.includes("tgWebAppData")) return null;
  const value = new URLSearchParams(raw).get("tgWebAppData");
  return value ? value : null;
}

/** Хеш адреса без параметров Telegram — в первую очередь без tgWebAppData с профилем пользователя. */
export function stripLaunchParams(hash: string): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.includes("tgWebApp")) return hash;
  const rest = new URLSearchParams(raw);
  for (const key of [...rest.keys()]) if (key.startsWith("tgWebApp")) rest.delete(key);
  const left = rest.toString();
  return left ? `#${left}` : "";
}

/** Тёмный ли цвет: та же формула воспринимаемой яркости (HSP < 120), что у telegram-web-app.js. */
export function isColorDark(hex: string): boolean {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return false;
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((x) => parseInt(x, 16)) as [number, number, number];
  return Math.sqrt(0.299 * r * r + 0.587 * g * g + 0.114 * b * b) < 120;
}

/** Светлая или тёмная тема Telegram — по цвету фона (как colorScheme у официального скрипта). */
export function colorSchemeOf(theme: Record<string, string>): ColorScheme {
  return theme.bg_color && isColorDark(theme.bg_color) ? "dark" : "light";
}

/** «7.10» ≥ «6.9»: версии сравниваются по числам, а не строкой. */
export function versionAtLeast(version: string, min: string): boolean {
  const a = version.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const b = min.split(".").map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

type Transport = (eventType: string, eventData: unknown) => void;

function detectTransport(win: TelegramWindow, launched: boolean): Transport | null {
  const proxy = win.TelegramWebviewProxy;
  if (proxy && typeof proxy.postEvent === "function") {
    return (type, data) => proxy.postEvent(type, JSON.stringify(data));
  }
  const external = win.external as { notify?: (msg: string) => void } | undefined;
  if (launched && external && typeof external.notify === "function") {
    return (type, data) => external.notify!(JSON.stringify({ eventType: type, eventData: data }));
  }
  const parent = win.parent as { postMessage?: (msg: string, origin: string) => void } | null | undefined;
  if (launched && parent && parent !== win.self && typeof parent.postMessage === "function") {
    // Адресат — только Telegram Web: другие сайты встроить /miniapp не могут (frame-ancestors), но и писать им незачем.
    return (type, data) => parent.postMessage!(JSON.stringify({ eventType: type, eventData: data }), TELEGRAM_WEB_ORIGIN);
  }
  return null;
}

type Listener<K extends IncomingType> = (data: IncomingEvents[K]) => void;

/**
 * Мост с клиентом Telegram. Вне Telegram (обычный браузер) `inTelegram` — false, отправка событий ничего не делает,
 * и /miniapp работает как обычный веб.
 */
export class TelegramBridge {
  private readonly listeners = new Map<IncomingType, Set<Listener<IncomingType>>>();
  private readonly cleanup: (() => void)[] = [];
  private theme: Record<string, string>;
  private qrOpen = false;
  /** initData этого запуска — только в памяти (поле #: не попадает ни в JSON, ни в перечисление свойств); один раз. */
  #initData: string | null;

  constructor(
    private readonly win: TelegramWindow,
    readonly launch: LaunchParams | null,
    private readonly transport: Transport | null,
    initData: string | null = null,
  ) {
    this.theme = launch?.themeParams ?? {};
    this.#initData = initData;
    if (this.inTelegram) this.install();
  }

  /**
   * initData этого запуска — один раз, для POST /api/v1/telegram/link после входа (ADR 0020); повторный вызов — null.
   * Вне Telegram (ссылку с параметрами открыли в браузере) — всегда null: привязывать нечего.
   */
  takeInitData(): string | null {
    const value = this.inTelegram ? this.#initData : null;
    this.#initData = null;
    return value;
  }

  /**
   * Посмотреть initData не расходуя: проба входа по привязке (ADR 0020) до показа экрана карточки. Вход не удался —
   * initData остаётся для привязки после входа карточкой (takeInitData в TelegramProvider). Вне Telegram — null.
   */
  peekInitData(): string | null {
    return this.inTelegram ? this.#initData : null;
  }

  get inTelegram(): boolean {
    return this.transport !== null && this.launch !== null;
  }

  get platform(): string {
    return this.launch?.platform ?? "unknown";
  }

  get version(): string {
    return this.launch?.version ?? "0";
  }

  get themeParams(): Record<string, string> {
    return this.theme;
  }

  /** Тема Telegram; вне Telegram — null. */
  get colorScheme(): ColorScheme | null {
    return this.inTelegram ? colorSchemeOf(this.theme) : null;
  }

  /** Понимает ли клиент событие (по версии Bot API). */
  supports(event: keyof OutgoingEvents): boolean {
    if (!this.inTelegram) return false;
    const min = MIN_VERSION[event];
    return !min || versionAtLeast(this.version, min);
  }

  /** Сканер QR Telegram доступен: мобильный клиент Bot API 6.4+. */
  get canScanQr(): boolean {
    return this.supports("web_app_open_scan_qr_popup") && SCANNER_PLATFORMS.has(this.platform);
  }

  /** Отправить событие клиенту. Вне Telegram или в старом клиенте — false (ничего не отправлено). */
  post<K extends keyof OutgoingEvents>(type: K, ...rest: OutgoingEvents[K] extends undefined ? [] : [OutgoingEvents[K]]): boolean {
    if (!this.transport || !this.supports(type)) return false;
    const data: unknown = rest[0];
    // Как у telegram-web-app.js: событие без данных отправляется с пустой строкой.
    this.transport(type, data === undefined ? "" : data);
    return true;
  }

  on<K extends IncomingType>(type: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(listener as Listener<IncomingType>);
    return () => set.delete(listener as Listener<IncomingType>);
  }

  ready(): void {
    this.post("web_app_ready");
  }

  expand(): void {
    this.post("web_app_expand");
  }

  setBackButton(visible: boolean): void {
    this.post("web_app_setup_back_button", { is_visible: visible });
  }

  /** Цвета шапки и фона Telegram под фон приложения (значения — из дизайн-токенов, их передаёт вызывающий). */
  setColors(background: string): void {
    this.post("web_app_set_header_color", { color: background });
    this.post("web_app_set_background_color", { color: background });
  }

  /** Открыть сканер QR Telegram. Текст — подсказка над камерой. */
  openScanQr(text?: string): boolean {
    const sent = this.post("web_app_open_scan_qr_popup", text ? { text } : {});
    this.qrOpen = sent;
    return sent;
  }

  closeScanQr(): void {
    if (!this.qrOpen) return;
    this.qrOpen = false;
    this.post("web_app_close_scan_qr_popup");
  }

  /** Событие от клиента (вызывают клиенты Telegram и обработчик message в Telegram Web). */
  receive(eventType: string, eventData?: unknown): void {
    switch (eventType) {
      case "back_button_pressed":
      case "scan_qr_popup_closed":
        if (eventType === "scan_qr_popup_closed") this.qrOpen = false;
        this.emit(eventType, undefined);
        return;
      case "theme_changed": {
        const params = sanitizeTheme((eventData as { theme_params?: unknown } | undefined)?.theme_params);
        this.theme = params;
        this.remember();
        this.emit("theme_changed", { theme_params: params });
        return;
      }
      case "qr_text_received": {
        const data = (eventData as { data?: unknown } | undefined)?.data;
        // Текст QR — только пока открыт наш сканер; дальше его проверяет @teletau/auth-codes (TT1.…).
        if (this.qrOpen && typeof data === "string") this.emit("qr_text_received", { data });
        return;
      }
      default:
        return;
    }
  }

  destroy(): void {
    for (const fn of this.cleanup.splice(0)) fn();
    this.listeners.clear();
  }

  private emit<K extends IncomingType>(type: K, data: IncomingEvents[K]): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) (fn as Listener<K>)(data);
  }

  /** Параметры без initData — в sessionStorage вкладки: после перезагрузки внутри Telegram хеша уже нет. */
  private remember(): void {
    if (!this.launch) return;
    const saved: LaunchParams = { version: this.launch.version, platform: this.launch.platform, themeParams: this.theme };
    try {
      this.win.sessionStorage?.setItem(LAUNCH_STORAGE_KEY, JSON.stringify(saved));
    } catch {
      /* приватный режим — переживём без перезагрузки */
    }
  }

  private install(): void {
    const receive: ReceiveFn = (type, data) => this.receive(type, data);
    const win = this.win;
    const prev = { telegram: win.Telegram, game: win.TelegramGameProxy, gameFn: win.TelegramGameProxy_receiveEvent };
    win.Telegram = { ...win.Telegram, WebView: { ...win.Telegram?.WebView, receiveEvent: receive } };
    win.TelegramGameProxy = { receiveEvent: receive };
    win.TelegramGameProxy_receiveEvent = receive;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== win.parent || e.origin !== TELEGRAM_WEB_ORIGIN || typeof e.data !== "string") return;
      let msg: unknown;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      const { eventType, eventData } = (msg ?? {}) as { eventType?: unknown; eventData?: unknown };
      if (typeof eventType === "string") this.receive(eventType, eventData);
    };
    win.addEventListener("message", onMessage);
    this.cleanup.push(() => {
      win.removeEventListener("message", onMessage);
      win.Telegram = prev.telegram;
      win.TelegramGameProxy = prev.game;
      win.TelegramGameProxy_receiveEvent = prev.gameFn;
    });
    this.remember();
  }
}

function loadSaved(win: TelegramWindow): LaunchParams | null {
  try {
    const raw = win.sessionStorage?.getItem(LAUNCH_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LaunchParams>;
    if (typeof v.version !== "string" || typeof v.platform !== "string") return null;
    return { version: v.version, platform: v.platform, themeParams: sanitizeTheme(v.themeParams) };
  } catch {
    return null;
  }
}

/**
 * Подключиться к Telegram: прочитать параметры запуска (или сохранённые в этой вкладке), убрать их из адреса и
 * выбрать способ связи с клиентом. Вызывать один раз на загрузку страницы — до того, как роутер сменит адрес.
 */
export function connectTelegram(win: TelegramWindow): TelegramBridge {
  const fromHash = parseLaunchParams(win.location.hash);
  // Только из адреса этого запуска: после перезагрузки хеша уже нет, и привязка ждёт следующего открытия Mini App.
  const initData = fromHash ? readInitData(win.location.hash) : null;
  if (fromHash) {
    // initData — ПДн из профиля Telegram: из адреса (и истории браузера) его убираем сразу; Next.js state сохраняем.
    const { pathname, search, hash } = win.location;
    win.history.replaceState(win.history.state, "", `${pathname}${search}${stripLaunchParams(hash)}`);
  }
  let launch = fromHash ?? loadSaved(win);
  // Мобильный клиент без параметров в адресе (например, после перехода внутри приложения) — всё равно Telegram.
  if (!launch && win.TelegramWebviewProxy) launch = { version: "6.0", platform: "unknown", themeParams: {} };
  const transport = launch ? detectTransport(win, true) : null;
  return new TelegramBridge(win, launch, transport, initData);
}
