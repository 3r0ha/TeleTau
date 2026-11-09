// Ошибки на моках API:
// - короткий 429 (`Retry-After` ≤ 5 с) на входе по QR и по коду класса повторяется молча; длинный — прежний текст;
// - полная очередь заявок класса (429 join_queue_full) — понятный текст ребёнку;
// - сбой сервера или сети — сообщение role="alert", а не ошибка верного поля;
// - «Показать ещё» в списке школ — один запрос за раз, без дублей.
import { expect, test, type Page } from "@playwright/test";
import { generateQrCard } from "@teletau/auth-codes";
import { CLASS_ID, adultMe, mockBackend, qrPhoto, type Failure } from "./mock-api";

/** Тексты всех role="alert", которые появлялись на странице (до перехода внутри сайта включительно). */
async function recordAlerts(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __alerts: string[] }).__alerts = seen;
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('[role="alert"]')) {
        const text = el.textContent?.trim();
        if (text && !seen.includes(text)) seen.push(text);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  return () => page.evaluate(() => (window as unknown as { __alerts?: string[] }).__alerts ?? []);
}

const toCodeNick = async (page: Page) => {
  await page.goto("/student/code");
  await page.getByLabel("Код класса: символ 1 из 6").fill("K7Q4MZ");
  await page.getByRole("button", { name: "Дальше" }).click();
  await page.getByRole("radio").first().check();
};

test.describe("M1-55: Retry-After — короткий 429 повторяется молча", () => {
  test("вход по QR: 429 Retry-After: 1, затем 200 — ник без текста ошибки", async ({ page }) => {
    const alerts = await recordAlerts(page);
    const w = await mockBackend(page, { bffReplies: { qr: [{ status: 429, code: "rate_limited", retryAfter: 1 }] } });
    await page.goto("/student");
    await page.getByLabel("Фото карточки").setInputFiles(await qrPhoto(generateQrCard().payload));
    await page.waitForURL("**/student/nickname");
    expect(w.bffCalls["qr"]).toBe(2);
    expect(await alerts()).toEqual([]);
  });

  test("вход по QR: 429 Retry-After: 60 — сразу прежний текст «Подожди минуту», без повтора", async ({ page }) => {
    const w = await mockBackend(page, { bffReplies: { qr: [{ status: 429, code: "rate_limited", retryAfter: 60 }] } });
    await page.goto("/student");
    await page.getByLabel("Фото карточки").setInputFiles(await qrPhoto(generateQrCard().payload));
    await expect(page.getByText("Много попыток. Подожди минуту.")).toBeVisible();
    expect(w.bffCalls["qr"]).toBe(1);
  });

  test("вход по QR: короткий 429 трижды подряд — «Секунду…», а не «Подожди минуту»", async ({ page }) => {
    const short = { status: 429, code: "rate_limited", retryAfter: 1 } as const;
    const w = await mockBackend(page, { bffReplies: { qr: [short, short, short] } });
    await page.goto("/student");
    await page.getByLabel("Фото карточки").setInputFiles(await qrPhoto(generateQrCard().payload));
    await expect(page.getByText("Секунду, много входов. Попробуй ещё раз.")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Подожди минуту/)).toHaveCount(0);
    expect(w.bffCalls["qr"]).toBe(3);
  });

  test("заявка по коду класса: 429 Retry-After: 1, затем 202 — ожидание учителя без текста ошибки", async ({ page }) => {
    const alerts = await recordAlerts(page);
    const w = await mockBackend(page, { bffReplies: { "class-code": [{ status: 429, code: "rate_limited", retryAfter: 1 }] } });
    await toCodeNick(page);
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await expect(page.getByRole("heading", { name: "Ждём учителя" })).toBeVisible();
    expect(w.bffCalls["class-code"]).toBe(2);
    expect(await alerts()).toEqual([]);
  });

  test("заявка по коду класса: 429 Retry-After: 60 — «Подожди минуту», без повтора", async ({ page }) => {
    const w = await mockBackend(page, { bffReplies: { "class-code": [{ status: 429, code: "rate_limited", retryAfter: 60 }] } });
    await toCodeNick(page);
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Много попыток. Подожди минуту." })).toBeVisible();
    expect(w.bffCalls["class-code"]).toBe(1);
  });
});

test.describe("M1-49: в классе уже 40 заявок ждут решения", () => {
  test("429 join_queue_full — текст для ребёнка, без повтора, ник и код не теряются", async ({ page }) => {
    const w = await mockBackend(page, { bffReplies: { "class-code": [{ status: 429, code: "join_queue_full", retryAfter: 1 }] } });
    await toCodeNick(page);
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "У учителя много заявок. Попробуй чуть позже." })).toBeVisible();
    expect(w.bffCalls["class-code"]).toBe(1);
    // Повтор с того же шага, когда учитель разобрал очередь.
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await expect(page.getByRole("heading", { name: "Ждём учителя" })).toBeVisible();
  });
});

test.describe("M1-60: сбой сервера или сети — не ошибка верного поля", () => {
  const cases: [string, Failure, RegExp][] = [
    ["500", { status: 500, code: "internal" }, /Что-то пошло не так/],
    ["обрыв сети", "offline", /Нет связи\. Проверьте интернет/],
  ];

  for (const [label, failure, text] of cases) {
    test(`вход учителя, почта: ${label} — поле без aria-invalid и фокуса, текст в role="alert"`, async ({ page }) => {
      await mockBackend(page, { failures: { "POST /auth/otp/request": failure } });
      await page.goto("/teacher/login");
      const email = page.getByLabel("Электронная почта");
      await email.fill("teacher@school7.example");
      await page.getByRole("button", { name: "Получить код" }).click();
      await expect(page.getByRole("alert").filter({ hasText: text })).toBeVisible();
      await expect(email).not.toHaveAttribute("aria-invalid", "true");
      await expect(email).not.toBeFocused();
    });

    test(`вход учителя, код из письма: ${label} — ячейки кода не помечены неверными`, async ({ page }) => {
      await mockBackend(page, { bffReplies: { otp: [failure === "offline" ? "offline" : { status: 500, code: "internal" }] } });
      await page.goto("/teacher/login");
      await page.getByLabel("Электронная почта").fill("teacher@school7.example");
      await page.getByRole("button", { name: "Получить код" }).click();
      await page.getByLabel("Код из письма: символ 1 из 4").fill("0000");
      await expect(page.getByRole("alert").filter({ hasText: text })).toBeVisible();
      await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
    });

    test(`выпуск карточек: ${label} — число не помечено неверным, текст в role="alert"`, async ({ page }) => {
      await mockBackend(page, { account: adultMe(), failures: { [`POST /classes/${CLASS_ID}/seats`]: failure } });
      await page.goto(`/teacher/classes/${CLASS_ID}`);
      await page.getByRole("button", { name: "Выпустить карточки" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Выпустить карточки" });
      const count = dialog.getByLabel("Сколько карточек");
      await count.fill("4");
      await dialog.getByRole("button", { name: "Выпустить 4 карточки" }).click();
      await expect(dialog.getByRole("alert").filter({ hasText: text })).toBeVisible();
      await expect(count).not.toHaveAttribute("aria-invalid", "true");
      await expect(count).not.toBeFocused();
    });
  }

  test("неверный код из письма — по-прежнему ошибка у ячеек кода", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/teacher/login");
    await page.getByLabel("Электронная почта").fill("teacher@school7.example");
    await page.getByRole("button", { name: "Получить код" }).click();
    await page.getByLabel("Код из письма: символ 1 из 4").fill("1234");
    await expect(page.getByText("Неверный код. Проверьте цифры.")).toBeVisible();
    await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
  });
});

test.describe("M1-50: «Показать ещё» в списке школ", () => {
  test("двойной щелчок — один запрос страницы, школы без дублей; затем последняя страница", async ({ page }) => {
    await mockBackend(page, {
      account: adultMe({ teacherStatus: "none", roles: [], classes: [], profile: { email: "teacher@school7.example" } }),
      schoolPages: { pageSize: 3, extra: 4, slowMs: 400 },
    });
    const pages: string[] = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (r.method() === "GET" && url.pathname.endsWith("/api/v1/schools")) pages.push(url.searchParams.get("cursor") ?? "first");
    });
    await page.goto("/teacher/apply");
    await page.getByLabel("Фамилия, имя, отчество").fill("Учитель Демонстрационный");
    await page.getByLabel("Должность").fill("Учитель башкирского языка");
    await page.getByRole("button", { name: "Дальше" }).click();
    await page.getByRole("radio", { name: /Уфа/ }).check();
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page.getByRole("heading", { name: "Выберите школу" })).toBeVisible();
    const schools = page.getByRole("radio");
    await expect(schools).toHaveCount(3);
    const more = page.getByRole("button", { name: "Показать ещё" });
    await more.dblclick();
    await expect(more).toHaveAttribute("aria-busy", "true");
    await expect(schools).toHaveCount(6);
    await page.waitForTimeout(800);
    await expect(schools).toHaveCount(6);
    await more.click();
    await expect(schools).toHaveCount(7);
    await expect(more).toHaveCount(0);
    expect(pages).toEqual(["first", "offset-3", "offset-6"]);
  });
});
