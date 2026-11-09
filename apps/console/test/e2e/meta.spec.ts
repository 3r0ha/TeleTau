// Консоль не индексируется и не даёт превью ссылки: noindex в мета и в X-Robots-Tag, robots.txt закрыт,
// Open Graph и Twitter-карточки нет.
import { expect, test } from "@playwright/test";

test("консоль: noindex и без превью ссылки", async ({ page, request }) => {
  await page.route("**/api/session/*", (route) =>
    route.fulfill({
      status: 401,
      headers: { "content-type": "application/problem+json" },
      body: JSON.stringify({ type: "about:blank", title: "Ошибка", status: 401, code: "refresh_invalid" }),
    }),
  );
  const res = await page.goto("/login");
  expect(res?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.locator('meta[property^="og:"], meta[name^="twitter:"]')).toHaveCount(0);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.ico");
  expect((await request.get("/favicon.ico")).status()).toBe(200);
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toMatch(/^Disallow: \/$/m);
});
