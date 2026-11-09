// Возрастные режимы, размер шрифта браузера, выбранное состояние и фокус — в браузере,
// по вычисленным стилям и размерам.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { CLASS_ID, adultMe, childMe, mockBackend } from "./mock-api";

const tokens = JSON.parse(readFileSync(createRequire(import.meta.url).resolve("@teletau/design-tokens/tokens.json"), "utf8")) as { light: Record<string, string> };
/** Цвет токена светлой темы в виде, который возвращает getComputedStyle. */
const rgb = (token: string) => {
  const hex = tokens.light[token]!;
  return `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
};

const TARGETS = ".tt-btn, .tt-icon-btn, .tt-link-btn, .tt-tab, .tt-choice__box, .seat";

/** Видимые цели нажатия меньше min по высоте или ширине. */
async function smallTargets(page: Page, min: number) {
  return page.locator(TARGETS).evaluateAll(
    (els, m) =>
      els
        .filter((e) => (e as HTMLElement).offsetParent !== null)
        .map((e) => ({ text: (e.textContent ?? e.getAttribute("aria-label") ?? "").trim().slice(0, 30), h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width }))
        .filter((r) => r.h < m - 0.5 || r.w < m - 0.5),
    min,
  );
}

const mode = (page: Page) => page.evaluate(() => document.documentElement.dataset.mode ?? null);

test.describe("M1-16: режим «Пчёлка» (1–4 класс)", () => {
  test("ученик с uiMode=bee: data-mode на <html>, все цели нажатия ≥ 56 px, текст крупнее", async ({ page }) => {
    await mockBackend(page, { account: childMe({ uiMode: "bee", nickname: undefined }) });
    await page.goto("/student/nickname");
    await page.getByRole("radio").first().waitFor();
    await expect.poll(() => mode(page)).toBe("bee");
    expect(await smallTargets(page, 56)).toEqual([]);
    const body = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    expect(body).toBe(18); // 16 px × fontScale.bee 1,125

    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Выбрать" }).click();
    await expect(page.getByRole("heading", { name: "Ты в классе 5 «Б»" })).toBeVisible();
    expect(await smallTargets(page, 56)).toEqual([]);
  });

  test("экраны входа ученика до входа — тоже «Пчёлка» (возраст ещё неизвестен); ячейки кода не ниже 56 px", async ({ page }) => {
    await mockBackend(page);
    for (const path of ["/student", "/student/code", "/q"]) {
      await page.goto(path);
      await page.locator("h1").first().waitFor();
      await expect.poll(() => mode(page), path).toBe("bee");
      expect(await smallTargets(page, 56), path).toEqual([]);
    }
    await page.goto("/student/code");
    const cell = await page.getByLabel("Код класса: символ 1 из 6").boundingBox();
    expect(cell!.height).toBeGreaterThanOrEqual(56);
  });

  test("5–8 класс — «Бортник» (обычные цели 44 px); учитель — без детского режима", async ({ page }) => {
    await mockBackend(page, { account: childMe({ uiMode: "bortnik" }) });
    await page.goto("/student/class");
    await expect(page.getByRole("heading", { name: "Ты в классе 5 «Б»" })).toBeVisible();
    await expect.poll(() => mode(page)).toBe("bortnik");
    const exit = await page.getByRole("button", { name: "Выйти" }).boundingBox();
    expect(exit!.height).toBe(44);

    const teacherPage = await page.context().newPage();
    await mockBackend(teacherPage, { account: adultMe() });
    await teacherPage.goto(`/teacher/classes/${CLASS_ID}`);
    await expect(teacherPage.getByRole("heading", { name: "Места" })).toBeVisible();
    expect(await mode(teacherPage)).toBeNull();
    expect(await smallTargets(teacherPage, 44)).toEqual([]);
  });
});

test.describe("M1-32: размер шрифта браузера", () => {
  test("при html{font-size:32px} текст растёт вдвое, а вёрстка на 320 px не даёт горизонтальной прокрутки", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await mockBackend(page, { account: adultMe() });
    for (const path of ["/", "/student", "/student/code", "/teacher/login", "/teacher", `/teacher/classes/${CLASS_ID}`]) {
      await page.goto(path);
      await page.locator("h1").first().waitFor();
      await page.waitForLoadState("networkidle");
      const before = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector("h1")!).fontSize));
      // Настройка «размер шрифта» браузера меняет font-size корня; размеры шрифтов — в rem (токены).
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "32px";
      });
      const after = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector("h1")!).fontSize));
      expect(after, path).toBeGreaterThan(before * 1.5);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  /** Шрифт 200 % (корень 32 px) и горизонтальная прокрутка страницы. */
  const overflowAt200 = async (page: Page) => {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "32px";
    });
    return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  };

  test("M1-42: условия, ввод кода из письма, профиль и /q — без горизонтальной прокрутки при 200 % на 320 px", async ({ page }) => {
    const cases: [string, Parameters<typeof mockBackend>[1], (p: Page) => Promise<unknown>][] = [
      ["/teacher/terms", { account: adultMe({ teacherStatus: "none", roles: [], classes: [], pendingConsents: ["terms", "privacy", "consent_adult"] }) }, (p) => p.getByRole("heading", { name: "Примите условия" }).waitFor()],
      [
        "/teacher/login",
        {},
        async (p) => {
          await p.getByLabel("Электронная почта").fill("uchitel.bashkirskogo.yazyka@school7.example");
          await p.getByRole("button", { name: "Получить код" }).click();
          await p.getByRole("heading", { name: "Введите код" }).waitFor();
        },
      ],
      ["/teacher/profile", { account: adultMe({ profile: { email: "uchitel.bashkirskogo.yazyka@school7.example", fullName: "Учитель Демонстрационный" } }) }, (p) => p.getByText("uchitel.bashkirskogo.yazyka@school7.example").waitFor()],
      ["/q", {}, (p) => p.locator("h1").first().waitFor()],
    ];
    for (const [path, world, ready] of cases) {
      const p = await page.context().newPage();
      await p.setViewportSize({ width: 320, height: 640 });
      await mockBackend(p, world);
      await p.goto(path);
      await ready(p);
      await p.waitForLoadState("networkidle");
      expect(await overflowAt200(p), path).toBeLessThanOrEqual(0);
      await p.close();
    }
  });

  test("M1-42: ссылка «К основному содержимому» не видна без фокуса (и при 200 %), с фокусом — видна", async ({ page }) => {
    // Узкий экран: при 200 % текст ссылки переносится на несколько строк, и она выше фиксированного отступа.
    await page.setViewportSize({ width: 375, height: 700 });
    await mockBackend(page);
    await page.goto("/");
    await page.locator("h1").first().waitFor();
    const skip = page.getByRole("link", { name: "К основному содержимому" });
    for (const size of ["16px", "32px"]) {
      await page.evaluate((s) => {
        document.documentElement.style.fontSize = s;
      }, size);
      const box = await skip.boundingBox();
      expect(box!.y + box!.height, size).toBeLessThanOrEqual(0);
    }
    await skip.focus();
    const focused = await skip.boundingBox();
    expect(focused!.y).toBeGreaterThanOrEqual(0);
  });
});

test.describe("M1-12: выбранное состояние и фокус видны не только бледным цветом", () => {
  test("выбранная плитка — граница accent.text и галочка; невыбранная — без галочки", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await mockBackend(page, { account: childMe({ nickname: undefined }) });
    await page.goto("/student/nickname");
    const radios = page.getByRole("radio");
    await radios.first().check();
    const style = await page.locator(".tt-choice").first().locator(".tt-choice__box").evaluate((el) => {
      const s = getComputedStyle(el);
      const check = getComputedStyle(el.querySelector(".tt-choice__check")!);
      return { border: s.borderTopColor, check: check.visibility };
    });
    expect(style).toEqual({ border: rgb("color.accent.text"), check: "visible" });
    const other = await page.locator(".tt-choice").nth(1).locator(".tt-choice__check").evaluate((el) => getComputedStyle(el).visibility);
    expect(other).toBe("hidden");
  });

  test("на медовой панели «код на доску» кольцо фокуса тёмное (text.onFill)", async ({ page }) => {
    await mockBackend(page, { account: adultMe() });
    await page.goto(`/teacher/classes/${CLASS_ID}`);
    await page.getByRole("button", { name: "Показать код класса" }).click();
    await page.getByText("K7Q-4MZ").waitFor();
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineColor);
    expect(outline).toBe(rgb("color.text.onFill"));
  });

  test("текущий раздел в навигации — сплошная граница accent.text", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await mockBackend(page, { account: adultMe() });
    await page.goto("/teacher");
    await expect(page.getByRole("heading", { name: "Мои классы" })).toBeVisible();
    const border = await page.locator('.tt-tab[aria-current="page"]').evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(border).toBe(rgb("color.accent.text"));
  });
});
