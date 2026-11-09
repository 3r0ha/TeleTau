// Безопасность веба на собранном приложении (next start) с моками API:
// - секрет карточки не попадает ни в адрес, ни в историю браузера; /q секрет не принимает;
// - CSP с nonce и заголовки безопасности; на ключевых экранах нет нарушений CSP.
import { expect, test, type Page } from "@playwright/test";
import { generateQrCard } from "@teletau/auth-codes";
import { CLASS_ID, adultMe, mockBackend, qrPhoto } from "./mock-api";

/** Все записи истории вкладки (CDP, Chromium): адреса, по которым можно вернуться «Назад» или из меню истории. */
async function historyUrls(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  const { entries } = (await cdp.send("Page.getNavigationHistory")) as { entries: { url: string }[] };
  await cdp.detach();
  return entries.map((e) => e.url);
}

/** Собирает нарушения CSP (событие securitypolicyviolation и сообщения консоли «Refused to …»). */
async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  const console: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) console.push(m.text());
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.violatedDirective}: ${e.blockedURI || "inline"}`));
  });
  return async () => [...console, ...(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []))];
}

test.describe("M1-02: секрет QR-карточки", () => {
  test("вход по фото карточки: в BFF уходит сырая нагрузка, в адресах и истории вкладки нет TT1.", async ({ page }) => {
    const w = await mockBackend(page);
    const card = generateQrCard();
    const visited: string[] = [];
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) visited.push(f.url());
    });

    await page.goto("/");
    await page.getByRole("link", { name: "У меня есть карточка или код" }).click();
    await expect(page.getByRole("heading", { name: "Покажи карточку камере" })).toBeVisible();
    await page.getByLabel("Фото карточки").setInputFiles(await qrPhoto(card.payload));
    await page.waitForURL("**/student/nickname");
    expect(page.url()).not.toContain("TT1");
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Выбрать" }).click();
    await expect(page.getByRole("heading", { name: "Ты в классе 5 «Б»" })).toBeVisible();

    expect(w.qrPayloads).toEqual([card.payload]);
    const history = await historyUrls(page);
    expect(history.length).toBeGreaterThan(1);
    for (const url of [...visited, ...history, page.url()]) {
      expect(url, url).not.toContain("TT1");
      expect(url, url).not.toContain(card.secret);
    }
  });

  test("старая ссылка /q#TT1.… секрет не принимает: вход не выполняется, показана инструкция", async ({ page }) => {
    const w = await mockBackend(page);
    const card = generateQrCard();
    await page.goto(`/q#${card.payload}`);
    await expect(page.getByRole("heading", { name: "Карточку сканируют на сайте" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Сканировать карточку" })).toHaveAttribute("href", "/student");
    await expect(page).toHaveTitle("Вход по карточке · ТелеТау");
    await page.waitForLoadState("networkidle");
    expect(w.qrPayloads).toEqual([]);
    expect(w.account).toBeNull();
    // Фрагмент стёрт из адресной строки (сама запись истории с ним создана браузером при открытии ссылки).
    expect(page.url()).not.toContain("#");
    await page.getByRole("link", { name: "Сканировать карточку" }).click();
    await expect(page).toHaveURL(/\/student$/);
  });

  test("ссылка-карточка (старый формат) из фото тоже принимается сканером — но в BFF уходит только нагрузка", async ({ page }) => {
    const w = await mockBackend(page);
    const card = generateQrCard();
    await page.goto("/student");
    await page.getByLabel("Фото карточки").setInputFiles(await qrPhoto(`http://localhost:3000/q#${card.payload}`));
    await page.waitForURL("**/student/nickname");
    expect(w.qrPayloads).toEqual([card.payload]);
  });

  test("сессия, завершённая перевыпуском карточки (401 session_revoked), — понятное объяснение на экране входа", async ({ page }) => {
    await mockBackend(page, { refreshProblem: { status: 401, code: "session_revoked" } });
    await page.goto("/student/class");
    await page.waitForURL(/\/student$/);
    await expect(page.getByText("Вход завершён. Войди снова по карточке.")).toBeVisible();
  });
});

test.describe("M1-11: заголовки безопасности и CSP", () => {
  test("страница: CSP с nonce, запрет встраивания, камера только этому сайту; inline-скрипты — с тем же nonce", async ({ page, request }) => {
    const res = await request.get("/student");
    const h = res.headers();
    const csp = h["content-security-policy"]!;
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toMatch(/style-src 'self' 'nonce-/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self' http://localhost:4000");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["permissions-policy"]).toMatch(/^camera=\(self\), microphone=\(\)/);
    // next start — production: HSTS есть (по http браузер его игнорирует, RFC 6797 §8.1).
    expect(h["strict-transport-security"]).toMatch(/^max-age=\d+; includeSubDomains$/);

    const nonce = /'nonce-([^']+)'/.exec(csp)![1]!;
    const html = await res.text();
    const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]!);
    expect(scripts.length).toBeGreaterThan(0);
    for (const attrs of scripts) expect(attrs, attrs).toContain(`nonce="${nonce}"`);
    // Атрибутов style в разметке нет: строгая CSP их бы не применила.
    expect(html).not.toMatch(/\sstyle="/);

    // Новый nonce на каждый запрос.
    const again = (await request.get("/student")).headers()["content-security-policy"]!;
    expect(again).not.toBe(csp);
    await page.close();
  });

  test("BFF сессии тоже отдаёт nosniff и запрет встраивания", async ({ request }) => {
    const res = await request.post("/api/session/refresh", { headers: { origin: "http://localhost:3055" } });
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
  });

  test("на ключевых экранах ученика и учителя нет нарушений CSP", async ({ page }) => {
    const violations = await watchCsp(page);
    await mockBackend(page, { account: adultMe() });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goto("/student/code");
    await page.getByLabel("Код класса: символ 1 из 6").fill("K7Q4MZ");
    await page.getByRole("button", { name: "Дальше" }).click();
    await page.getByRole("radio").first().waitFor();
    await page.goto(`/teacher/classes/${CLASS_ID}`);
    await expect(page.getByRole("heading", { name: "Места" })).toBeVisible();
    await page.getByRole("button", { name: "Показать код класса" }).click();
    await page.getByText("K7Q-4MZ").waitFor();
    await page.goto("/teacher/classes/not-a-uuid");
    await expect(page.getByRole("heading", { name: "Класс не найден" })).toBeVisible();
    await page.goto("/no-such-page");
    await expect(page.getByRole("heading", { name: "Такой страницы нет" })).toBeVisible();
    expect(await violations()).toEqual([]);
  });
});
