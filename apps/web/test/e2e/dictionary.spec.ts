// Публичный словарь (/dictionary, ТЗ §5): витрина принятых пар без входа. Заголовок и счётчики пар по языковым
// парам, две секции ba-ru и ba-kz («башкирское слово — исходник», источник подписью), поиск фильтрует по обеим
// сторонам. Пустой ответ или молчащий API — «Словарь скоро наполнится», страница живая. Данные — свой page.route
// поверх mockBackend (как в соседних тестах): адрес печатает сид демо-мира (teletau.study/dictionary).
import { expect, test, type Page } from "@playwright/test";
import type { Schema } from "@teletau/contracts";
import { API, mockBackend } from "./mock-api";

type Entry = Schema<"PublicDictionaryEntry">;

/** Пара словаря, как демо-корпус: исходник и башкирский вариант, источник один на все строки. */
function entry(fragmentId: string, langPair: "ba-ru" | "ba-kz", translation: string, textBa: string): Entry {
  return { fragmentId, langPair, translation, textBa, sources: [{ title: "Демо-корпус ТелеТау" }], confirmed: true, status: "confirmed" };
}

const RU: Entry[] = [
  entry("0193f7a4-0000-7000-8000-00000000f001", "ba-ru", "Привет", "Сәләм"),
  entry("0193f7a4-0000-7000-8000-00000000f002", "ba-ru", "Спасибо", "Рәхмәт"),
  entry("0193f7a4-0000-7000-8000-00000000f003", "ba-ru", "Вода", "Һыу"),
];

const KZ: Entry[] = [
  entry("0193f7a4-0000-7000-8000-00000000f011", "ba-kz", "ана", "инә"),
  entry("0193f7a4-0000-7000-8000-00000000f012", "ba-kz", "су", "һыу"),
  entry("0193f7a4-0000-7000-8000-00000000f013", "ba-kz", "Рахмет", "Рәхмәт"),
];

/** Подменить GET /public/dictionary поверх mockBackend: поздний page.route приоритетнее раннего. */
async function mockDictionary(page: Page, items: Entry[]) {
  await mockBackend(page);
  await page.route(`${API}/api/v1/public/dictionary`, (route) =>
    route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
      body: JSON.stringify({ generatedAt: "2026-11-14T06:00:00.000Z", langPair: "ba-ru", items } satisfies Schema<"PublicDictionary">),
    }),
  );
}

test.describe("публичный словарь", () => {
  test("заголовок, счётчики пар и две секции: башкирское слово — исходник, источник подписью", async ({ page }) => {
    await mockDictionary(page, [...RU, ...KZ]);
    await page.goto("/dictionary");
    await expect(page.getByRole("heading", { name: "Словарь", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.locator(".page-lead")).toHaveText("Русско-башкирский: 3 пары · Казахско-башкирский: 3 пары");

    const ru = page.getByRole("region", { name: "Русско-башкирский" });
    await expect(ru).toBeVisible();
    await expect(ru.getByRole("columnheader", { name: "Башкирский" })).toBeVisible();
    await expect(ru.getByRole("columnheader", { name: "Русский" })).toBeVisible();
    await expect(ru.locator("tbody tr")).toHaveCount(3);
    const ruRow = ru.locator("tr").filter({ hasText: "Привет" });
    await expect(ruRow.locator("[lang='ba']")).toHaveText("Сәләм");
    await expect(ruRow).toContainText("Демо-корпус ТелеТау");

    const kz = page.getByRole("region", { name: "Казахско-башкирский" });
    await expect(kz.getByRole("columnheader", { name: "Казахский" })).toBeVisible();
    await expect(kz.locator("tbody tr")).toHaveCount(3);
    await expect(kz.locator("tr").filter({ hasText: "ана" }).locator("[lang='ba']")).toHaveText("инә");
  });

  test("поиск фильтрует по обеим сторонам, без учёта регистра; очистка возвращает всё", async ({ page }) => {
    await mockDictionary(page, [...RU, ...KZ]);
    await page.goto("/dictionary");
    const search = page.getByLabel("Поиск");

    // Башкирская сторона: «һыу» — и в русской, и в казахской секции.
    await search.fill("һыу");
    await expect(page.getByRole("region", { name: "Русско-башкирский" }).locator("tbody tr")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Казахско-башкирский" }).locator("tbody tr")).toHaveCount(1);

    // Исходник (русская сторона), в нижнем регистре.
    await search.fill("привет");
    await expect(page.getByRole("region", { name: "Русско-башкирский" }).locator("tbody tr")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Казахско-башкирский" })).toHaveCount(0);

    // Нет совпадений — «Ничего не нашлось.»
    await search.fill("неттакогослова");
    await expect(page.getByText("Ничего не нашлось.")).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(0);

    await search.fill("");
    await expect(page.locator("tbody tr")).toHaveCount(6);
    await expect(page.getByText("Ничего не нашлось.")).toHaveCount(0);
  });

  test("пустой ответ — «Словарь скоро наполнится», страница живая", async ({ page }) => {
    await mockDictionary(page, []);
    await page.goto("/dictionary");
    await expect(page.getByRole("heading", { name: "Словарь", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Словарь скоро наполнится" })).toBeVisible();
    await expect(page.locator(".page-lead")).toHaveCount(0);
    await expect(page.locator("tbody")).toHaveCount(0);
  });

  test("API молчит (мок без словаря) — витрина живая, не 500", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/dictionary");
    await expect(page.getByRole("heading", { name: "Словарь", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Словарь скоро наполнится" })).toBeVisible();
  });

  test("в подвале лендинга — ссылка «Словарь»", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Словарь" })).toHaveAttribute("href", "/dictionary");
  });
});
