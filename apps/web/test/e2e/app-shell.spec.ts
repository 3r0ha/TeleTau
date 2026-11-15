// Веб как приложение (собранное приложение, моки API):
// - установка на экран: манифест отдаётся и валиден для Chromium, иконки на месте и нужного размера, мета для iOS,
//   CSP пропускает манифест, иконки и service worker;
// - превью ссылки: Open Graph и Twitter-карточка с картинкой 1200×630;
// - сбой экрана — «Что-то пошло не так» без технических подробностей;
// - без сети — «Нет связи» из кеша service worker, в кеше только статика и сама страница.
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { childMe, mockBackend } from "./mock-api";

const tokens = JSON.parse(readFileSync(new URL("../../../../packages/design-tokens/build/json/tokens.json", import.meta.url), "utf8")) as {
  light: Record<string, string>;
};

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

/** Размер PNG из заголовка IHDR. */
function pngSize(bytes: Buffer): string {
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

async function getPng(request: APIRequestContext, url: string): Promise<string> {
  const res = await request.get(url);
  expect(res.status(), url).toBe(200);
  expect(res.headers()["content-type"], url).toBe("image/png");
  return pngSize(await res.body());
}

/** Нарушения CSP: событие securitypolicyviolation и сообщения консоли «Refused to …». */
async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  const messages: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) messages.push(m.text());
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.violatedDirective}: ${e.blockedURI || "inline"}`));
  });
  return async () => [...messages, ...(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []))];
}

const meta = (page: Page, key: string) => page.locator(`meta[property="${key}"], meta[name="${key}"]`).getAttribute("content");

test.describe("установка на экран", () => {
  test("манифест отдаётся и валиден: старт ученика, standalone, цвета токенов, иконки 192, 512 и maskable", async ({ page, request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/manifest+json");
    const manifest = (await res.json()) as Record<string, unknown> & { icons: ManifestIcon[] };
    expect(manifest).toMatchObject({
      name: "ТелеТау — Башкирская языковая школа",
      short_name: "ТелеТау",
      start_url: "/learn",
      scope: "/",
      display: "standalone",
      lang: "ru",
      background_color: tokens.light["color.bg"],
      theme_color: tokens.light["color.bg"],
    });
    expect(manifest.icons.map((i) => `${i.sizes} ${i.purpose ?? "any"}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);

    // Разбор манифеста самим Chromium: без ошибок, сайт можно установить.
    await mockBackend(page);
    await page.goto("/student");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
    const cdp = await page.context().newCDPSession(page);
    const parsed = (await cdp.send("Page.getAppManifest")) as { url: string; errors: unknown[] };
    expect(parsed.url).toMatch(/\/manifest\.webmanifest$/);
    expect(parsed.errors).toEqual([]);
    const { installabilityErrors } = (await cdp.send("Page.getInstallabilityErrors")) as { installabilityErrors: unknown[] };
    expect(installabilityErrors).toEqual([]);
    await cdp.detach();
  });

  test("иконки доступны и нужного размера; apple-touch-icon и мета для iOS", async ({ page, request }) => {
    const manifest = (await (await request.get("/manifest.webmanifest")).json()) as { icons: ManifestIcon[] };
    for (const icon of manifest.icons) expect(await getPng(request, icon.src), icon.src).toBe(icon.sizes);
    expect(await getPng(request, "/icons/apple-touch-icon.png")).toBe("180x180");
    const favicon = await request.get("/favicon.ico");
    expect(favicon.status()).toBe(200);

    await mockBackend(page);
    await page.goto("/student");
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/apple-touch-icon.png");
    await expect(page.locator('link[rel="icon"][href="/icons/icon-192.png"]')).toHaveCount(1);
    expect(await meta(page, "apple-mobile-web-app-title")).toBe("ТелеТау");
    expect(await meta(page, "mobile-web-app-capable")).toBe("yes");
  });

  test("CSP пропускает манифест, иконки и service worker; нарушений CSP нет", async ({ page }) => {
    const violations = await watchCsp(page);
    await mockBackend(page);
    const res = await page.goto("/student");
    const csp = res?.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("manifest-src 'self'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("img-src 'self'");
    // Браузер под этой CSP загружает манифест и все его иконки.
    const sizes = await page.evaluate(async () => {
      const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href;
      const manifest = (await (await fetch(href)).json()) as { icons: { src: string }[] };
      const urls = [...manifest.icons.map((i) => i.src), document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')!.href];
      return Promise.all(
        urls.map(async (src) => {
          const img = new Image();
          img.src = src;
          await img.decode();
          return `${img.naturalWidth}x${img.naturalHeight}`;
        }),
      );
    });
    expect(sizes).toEqual(["192x192", "512x512", "512x512", "180x180"]);
    // Сам service worker тоже проходит proxy.ts: отдаётся как скрипт.
    const sw = await page.request.get("/sw.js");
    expect(sw.status()).toBe(200);
    expect(sw.headers()["content-type"]).toContain("javascript");
    expect(await violations()).toEqual([]);
  });
});

test("превью ссылки: Open Graph и Twitter-карточка с картинкой 1200×630", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/");
  expect(await meta(page, "og:title")).toBe("ТелеТау — Башкирская языковая школа");
  expect(await meta(page, "og:description")).toBe("Башкирский язык каждый день: короткие уроки для детей и взрослых.");
  expect(await meta(page, "og:type")).toBe("website");
  expect(await meta(page, "og:site_name")).toBe("ТелеТау");
  expect(await meta(page, "og:locale")).toBe("ru_RU");
  const image = (await meta(page, "og:image")) ?? "";
  expect(image).toMatch(/^https?:\/\/[^/]+\/og-image\.jpg$/);
  expect(await meta(page, "og:image:width")).toBe("1200");
  expect(await meta(page, "og:image:height")).toBe("630");
  expect(await meta(page, "og:image:alt")).toBeTruthy();
  expect(await meta(page, "twitter:card")).toBe("summary_large_image");
  expect(await meta(page, "twitter:title")).toBe("ТелеТау — Башкирская языковая школа");
  expect(await meta(page, "twitter:image")).toBe(image);

  const res = await page.request.get(new URL(image).pathname);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/jpeg");
  const size = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    return `${img.naturalWidth}x${img.naturalHeight}`;
  }, new URL(image).pathname);
  expect(size).toBe("1200x630");
});

test.describe("сбой экрана", () => {
  test("сервер прислал неожиданный ответ — «Что-то пошло не так», без технических подробностей", async ({ page }) => {
    // Аккаунт без списка классов: экран ученика падает при отрисовке.
    await mockBackend(page, { account: { ...childMe(), classes: null as never } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/learn");
    const alert = page.getByRole("alert").filter({ has: page.getByRole("heading", { name: "Что-то пошло не так" }) });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("button", { name: "Попробовать ещё раз" })).toBeVisible();
    await expect(alert.getByRole("link", { name: "На главную" })).toHaveAttribute("href", "/");
    const text = (await page.locator("body").innerText()).toLowerCase();
    for (const technical of ["typeerror", "cannot read", "undefined", "null", "digest", "stack", "error"]) {
      expect(text, technical).not.toContain(technical);
    }
    await alert.getByRole("link", { name: "На главную" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(alert).toHaveCount(0);
  });
});

test.describe("без сети", () => {
  test.use({ serviceWorkers: "allow" });

  test("«Нет связи» по открытому адресу, «Попробовать ещё раз» его перезагружает; в кеше только статика", async ({ page, context }) => {
    await mockBackend(page);
    await page.goto("/student");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
      return urls;
    });
    expect(cached).toContain("/offline");
    expect(cached.some((p) => p.endsWith(".css"))).toBe(true);
    for (const path of cached) expect(path, path).toMatch(/^\/(offline$|_next\/static\/)/);

    await context.setOffline(true);
    await page.goto("/learn");
    await expect(page.getByRole("heading", { name: "Нет связи" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/learn");
    // Стили и картинка — из кеша: иллюстрация загружена, кнопка оформлена.
    await expect.poll(() => page.locator(".tt-empty__art").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    const retry = page.getByRole("link", { name: "Попробовать ещё раз" });
    expect(await retry.evaluate((a) => getComputedStyle(a).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    // Скриптов у офлайн-страницы нет.
    expect(await page.locator("script").count()).toBe(0);

    await context.setOffline(false);
    await retry.click();
    await expect(page.getByRole("heading", { name: "Нет связи" })).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/offline/);
  });
});
