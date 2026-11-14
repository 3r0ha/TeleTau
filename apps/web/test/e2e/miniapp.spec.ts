// Каркас Telegram Mini App на моках API (docs/plans/M2.md §3 «Ч5»): /miniapp в обычном браузере и «в Telegram» —
// мобильный клиент подменён window.TelegramWebviewProxy, события клиента — window.Telegram.WebView.receiveEvent.
// Проверяем: параметры запуска и тема, web_app_ready/expand, системная «Назад», вход по сканеру QR Telegram через тот же
// BFF, initData уходит только в привязку чата (POST /api/v1/telegram/link, один раз после входа — ADR 0020), заголовки
// встраивания только для /miniapp/*.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { generateQrCard } from "@teletau/auth-codes";
import { createRequire } from "node:module";
import { API, adultMe, childMe, mockBackend, qrPhoto } from "./mock-api";
import { CURRENT_NODE } from "./mock-learn";
import { settleAnimations } from "./settle";

const tokens = createRequire(import.meta.url)("@teletau/design-tokens/tokens.json") as { dark: Record<string, string>; light: Record<string, string> };

// Тема и initData — данные клиента Telegram (не цвета интерфейса): интерфейс красится только токенами.
const DARK = { bg_color: "#17212b", text_color: "#f5f5f5", button_color: "#5288c1" };
const LIGHT = { bg_color: "#ffffff", text_color: "#000000" };
const USER = { id: 279058397, first_name: "Айгуль", last_name: "Тестова", username: "aigul_test" };
const INIT_DATA = new URLSearchParams({ query_id: "AAHdF6IQAAAAAN0XohDhrOrc", user: JSON.stringify(USER), auth_date: "1730700000", hash: "c501b71e775f74ce" }).toString();
const PII = /Айгуль|%D0%90%D0%B9%D0%B3%D1%83%D0%BB%D1%8C|aigul_test|279058397|query_id|tgWebAppData/;

function launch(theme: Record<string, string>, platform = "android") {
  const p = new URLSearchParams({ tgWebAppData: INIT_DATA, tgWebAppVersion: "7.10", tgWebAppPlatform: platform, tgWebAppThemeParams: JSON.stringify(theme) });
  return `/miniapp#${p.toString()}`;
}

/** «Мобильный клиент Telegram»: события веба копятся в window.__tg. */
async function inTelegram(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __tg: [string, unknown][]; TelegramWebviewProxy: unknown };
    w.__tg = [];
    w.TelegramWebviewProxy = { postEvent: (type: string, data: string) => w.__tg.push([type, data ? JSON.parse(data) : data]) };
  });
}

const events = (page: Page) => page.evaluate(() => (window as unknown as { __tg: [string, unknown][] }).__tg);
const receive = (page: Page, type: string, data?: unknown) =>
  page.evaluate(([t, d]) => (window as unknown as { Telegram: { WebView: { receiveEvent: (t: string, d?: unknown) => void } } }).Telegram.WebView.receiveEvent(t as string, d), [type, data] as const);
const lastBackButton = async (page: Page) => {
  const all = (await events(page)).filter(([t]) => t === "web_app_setup_back_button");
  return (all.at(-1)?.[1] as { is_visible: boolean } | undefined)?.is_visible;
};

test.describe("M2: Mini App в обычном браузере", () => {
  test("/miniapp → вход по карточке (веб-сканер) → тропа; вкладки — под /miniapp", async ({ page }) => {
    await mockBackend(page, { qr: { ok: true, account: childMe() } });
    await page.goto("/miniapp");
    await page.waitForURL("**/miniapp/student");
    await expect(page.getByRole("button", { name: "Загрузить фото" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ввести код класса" })).toHaveAttribute("href", "/miniapp/student/code");
    await page.getByLabel("Фото карточки").setInputFiles(await qrPhoto(generateQrCard().payload));
    await page.waitForURL("**/miniapp/learn");
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
    await expect(page.getByRole("link", { name: "Лига", exact: true })).toHaveAttribute("href", "/miniapp/league");
    await page.getByRole("link", { name: "Класс", exact: true }).click();
    await page.waitForURL("**/miniapp/hive");
    await expect(page.getByRole("heading", { name: /Улей 5/ })).toBeVisible();
    // Вне Telegram без выбора тема светлая: data-theme не ставится.
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
    // В Mini App тема всегда светлая — выключателя темы в профиле нет.
    await page.getByRole("link", { name: "Профиль", exact: true }).click();
    await page.waitForURL("**/miniapp/me");
    await expect(page.getByRole("switch", { name: "Звуки" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Тёмная тема" })).toHaveCount(0);
  });

  test("вход по коду класса не уходит из /miniapp", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/miniapp/student/code");
    await expect(page.getByRole("link", { name: "Назад" })).toHaveAttribute("href", "/miniapp/student");
    await page.getByLabel("Код класса: символ 1 из 6").fill("K7Q4MZ");
    await page.getByRole("button", { name: "Дальше" }).click();
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await page.waitForURL("**/miniapp/student/wait");
  });

  test("встраивать можно только /miniapp/* и только Telegram Web; остальные страницы — никому", async ({ request }) => {
    const mini = await request.get("/miniapp/learn");
    expect(mini.headers()["content-security-policy"]).toContain("frame-ancestors https://web.telegram.org");
    expect(mini.headers()["x-frame-options"]).toBeUndefined();
    for (const path of ["/learn", "/teacher", "/student"]) {
      const res = await request.get(path);
      expect(res.headers()["content-security-policy"], path).toContain("frame-ancestors 'none'");
      expect(res.headers()["x-frame-options"], path).toBe("DENY");
    }
  });
});

test.describe("M2: Mini App в Telegram", () => {
  test("тёмная тема Telegram и тёмная система — Mini App светлая, ready/expand, шапка в цвет светлого фона; initData убран из адреса и ушёл только в привязку", async ({ page }) => {
    await inTelegram(page);
    const urls: string[] = [];
    page.on("request", (r) => urls.push(`${r.method()} ${r.url()}\n${r.postData() ?? ""}`));
    await mockBackend(page, { account: childMe() });
    const linked: unknown[] = [];
    await page.route(`${API}/api/v1/telegram/link`, async (route) => {
      if (route.request().method() === "OPTIONS") return route.fallback(); // предзапрос CORS — общий мок
      linked.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
        body: JSON.stringify({ reminders: { enabled: false, hour: 18 } }),
      });
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(launch(DARK));
    await page.waitForURL("**/miniapp/learn");
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const sent = await events(page);
    const types = sent.map(([t]) => t);
    expect(types).toContain("web_app_ready");
    expect(types).toContain("web_app_expand");
    expect(sent).toContainEqual(["web_app_set_header_color", { color: tokens.light["color.bg"] }]);
    expect(sent).toContainEqual(["web_app_set_background_color", { color: tokens.light["color.bg"] }]);
    // На тропе «Назад» нет — системная кнопка Telegram закрывает Mini App.
    expect(await lastBackButton(page)).toBe(false);
    expect(page.url()).not.toMatch(/tgWebApp/);
    // initData — ровно один раз и только в POST /api/v1/telegram/link (как есть: подпись проверяет API).
    await expect.poll(() => linked).toEqual([{ initData: INIT_DATA }]);
    const withPii = urls.filter((u) => PII.test(u) && !u.startsWith("OPTIONS "));
    expect(withPii.map((u) => u.split("\n")[0])).toEqual([`POST ${API}/api/v1/telegram/link`]);
    expect(JSON.stringify(sent)).not.toMatch(PII);
    expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toMatch(PII);

    // Смена темы Telegram экран не меняет: Mini App всегда светлая.
    await receive(page, "theme_changed", { theme_params: DARK });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect((await events(page)).filter(([t]) => t === "web_app_set_header_color")).toEqual([["web_app_set_header_color", { color: tokens.light["color.bg"] }]]);
  });

  test("вход сканером QR Telegram: web_app_open_scan_qr_popup → qr_text_received → тот же BFF → тропа", async ({ page }) => {
    await inTelegram(page);
    const w = await mockBackend(page, { qr: { ok: true, account: childMe() } });
    await page.goto(launch(LIGHT, "ios"));
    await page.waitForURL("**/miniapp/student");
    await expect(page.getByRole("heading", { name: "Покажи карточку камере" })).toBeVisible();
    await settleAnimations(page);
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

    await page.getByRole("button", { name: "Сканировать карточку" }).click();
    expect((await events(page)).filter(([t]) => t === "web_app_open_scan_qr_popup")).toEqual([["web_app_open_scan_qr_popup", { text: "Наведи на QR-код карточки" }]]);
    const card = generateQrCard().payload;
    await receive(page, "qr_text_received", { data: card });
    await page.waitForURL("**/miniapp/learn");
    expect(w.qrPayloads).toEqual([card]);
    expect((await events(page)).map(([t]) => t)).toContain("web_app_close_scan_qr_popup");
  });

  test("чужой QR — понятная ошибка, BFF не вызывается", async ({ page }) => {
    await inTelegram(page);
    const w = await mockBackend(page);
    await page.goto(launch(LIGHT, "android"));
    await page.getByRole("button", { name: "Сканировать карточку" }).click();
    await receive(page, "qr_text_received", { data: "https://example.com/not-a-card" });
    await expect(page.getByText("Это не карточка ученика")).toBeVisible();
    expect(w.qrPayloads).toEqual([]);
  });

  test("системная «Назад»: с вкладки — на тропу; в уроке — «Уже уходишь?»", async ({ page }) => {
    await inTelegram(page);
    await mockBackend(page, { account: childMe() });
    await page.goto(launch(LIGHT));
    await page.waitForURL("**/miniapp/learn");
    await page.getByRole("link", { name: "Лига", exact: true }).click();
    await page.waitForURL("**/miniapp/league");
    await expect.poll(() => lastBackButton(page)).toBe(true);
    await receive(page, "back_button_pressed");
    await page.waitForURL("**/miniapp/learn");
    await expect.poll(() => lastBackButton(page)).toBe(false);

    await page.getByRole("button", { name: CURRENT_NODE }).click();
    await expect(page.getByRole("heading", { name: "Новое слово" })).toBeVisible();
    await expect.poll(() => lastBackButton(page)).toBe(true);
    await receive(page, "back_button_pressed");
    await expect(page.getByRole("dialog", { name: "Уже уходишь?" })).toBeVisible();
  });

  test("параметры Telegram, но без клиента (ссылку открыли в браузере) — обычный веб-вход по камере или фото", async ({ page }) => {
    await mockBackend(page);
    await page.goto(launch(LIGHT, "weba"));
    await page.waitForURL("**/miniapp/student");
    await expect(page.getByRole("button", { name: "Загрузить фото" })).toBeVisible();
  });

  test("вход по почте: новый адрес → код → ник → «Начать» ведёт на тропу, чат привязывается (ADR 0020)", async ({ page }) => {
    await inTelegram(page);
    const w = await mockBackend(page);
    const linked: string[] = [];
    await page.route(`${API}/api/v1/telegram/link`, async (route) => {
      if (route.request().method() === "OPTIONS") return route.fallback(); // предзапрос CORS — общий мок
      linked.push(route.request().postData() ?? "");
      return route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
        body: JSON.stringify({ reminders: { enabled: false, hour: 18 } }),
      });
    });
    await page.goto(launch(LIGHT));
    await page.waitForURL("**/miniapp/student");
    // Кнопка почтового входа — на экране входа Mini App; новая почта — аккаунт создастся после кода.
    await page.getByRole("link", { name: "Войти по почте" }).click();
    await page.waitForURL("**/miniapp/student/email");
    await page.getByLabel("Электронная почта").fill("grown@mail.example");
    await page.getByRole("button", { name: "Получить код" }).click();
    await page.getByLabel("Код из письма: символ 1 из 4").fill("0000");
    await expect(page.getByRole("heading", { name: "Выбери ник" })).toBeVisible();
    // Взрослому без класса — подпись про дуэли, не «увидят в классе».
    await expect(page.getByText("Так тебя увидят в дуэлях")).toBeVisible();
    // Регрессия (кнопка застревала в загрузке): «Начать» доступна сразу после выбора ника.
    await page.getByRole("radio").first().check();
    const start = page.getByRole("button", { name: "Начать", exact: true });
    await expect(start).toBeEnabled();
    await start.click();
    await page.waitForURL("**/miniapp/learn");
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
    expect(w.account).toMatchObject({ kind: "adult", ageBand: "adult", dailyGoal: 2, teacherStatus: "none" });
    // initData ушла в привязку ровно один раз — чат связан, «Задание дня» придёт сюда.
    expect(linked).toHaveLength(1);
    expect(linked[0]).toContain("hash=");
  });

  test("вошедший без ника: /miniapp ведёт на выбор пути, а не в 404; «Учиться» → ник → тропа", async ({ page }) => {
    // Регрессия: StudentShell отправляет взрослого без ника на paths.welcome, а маршрута /miniapp/welcome не было.
    await mockBackend(page, { account: adultMe({ nickname: undefined, teacherStatus: "none", roles: [], classes: [] }) });
    await page.goto("/miniapp");
    await page.waitForURL("**/miniapp/welcome");
    await expect(page.getByRole("heading", { name: "Что дальше?" })).toBeVisible();
    await page.getByRole("button", { name: "Учиться" }).click();
    await expect(page.getByRole("heading", { name: "Выбери ник" })).toBeVisible();
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Начать", exact: true }).click();
    await page.waitForURL("**/miniapp/learn");
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
  });
});
