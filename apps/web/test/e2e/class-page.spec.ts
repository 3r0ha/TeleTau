// Страница класса: диалог места без карточки, доска с кодом класса — адрес сайта и QR корня сайта,
// код на доске для читалки, одно слово «сайт» на старой ссылке карточки /q, закрытая доска гасит код
// на сервере, текст отзыва согласия.
import { expect, test, type Locator, type Page } from "@playwright/test";
import jsQR from "jsqr";
import { CLASS_ID, adultMe, mockBackend, type World } from "./mock-api";

/** Распознать QR так же, как камера: снимок элемента на экране → пиксели → jsQR. */
async function decodeQr(page: Page, target: Locator): Promise<string | null> {
  const png = await target.screenshot();
  const { width, height, data } = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: pixels.width, height: pixels.height, data: Array.from(pixels.data) };
  }, png.toString("base64"));
  return jsQR(Uint8ClampedArray.from(data), width, height)?.data ?? null;
}

test.describe("место без карточки (вход по коду класса)", () => {
  test("«Выпустить карточку»: честное предупреждение — ученик выйдет на всех устройствах", async ({ page }) => {
    const w = await mockBackend(page, { account: adultMe() });
    w.classDetail.seats!.push({
      number: 25,
      cardStatus: "none",
      cardVersion: 0,
      student: { accountId: "0193f7a4-0000-7000-8000-0000000s0025", nickname: "Тёплый ветер", joinedAt: new Date().toISOString() },
    });
    await page.goto(`/teacher/classes/${CLASS_ID}`);
    await page.getByRole("button", { name: /^Место №25/ }).click();
    const dialog = page.getByRole("dialog", { name: "Место №25" });
    await expect(dialog.getByText("Нет, вход по коду")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Перевыпустить/ })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Выпустить карточку", exact: true }).click();
    await expect(dialog.getByText(/Ученик выйдет на всех устройствах, прогресс сохранится/)).toBeVisible();
    await expect(dialog.getByText(/Старая карточка/)).toHaveCount(0);
    await dialog.getByRole("button", { name: "Выпустить карточку", exact: true }).click();
    await expect(page.getByText("Карточка №25 выпущена")).toBeVisible();
  });

  test("место с карточкой — по-прежнему «Перевыпустить карточку»", async ({ page }) => {
    await mockBackend(page, { account: adultMe() });
    await page.goto(`/teacher/classes/${CLASS_ID}`);
    await page.getByRole("button", { name: /^Место №03/ }).click();
    const dialog = page.getByRole("dialog", { name: "Место №03" });
    await dialog.getByRole("button", { name: "Перевыпустить карточку", exact: true }).click();
    await expect(dialog.getByText(/Старая карточка перестанет работать/)).toBeVisible();
    await expect(dialog.getByText("Ученик выйдет на всех устройствах")).toBeVisible();
  });
});

test.describe("доска с кодом класса", () => {
  test("адрес сайта крупно и QR корня сайта (с текстовой альтернативой); код для читалки — без aria-label на span", async ({ page, baseURL }) => {
    await mockBackend(page, { account: adultMe() });
    await page.goto(`/teacher/classes/${CLASS_ID}`);
    await page.getByRole("button", { name: "Показать код класса" }).click();
    const board = page.getByRole("dialog", { name: "Код класса 5 «Б»" });
    await board.getByText("K7Q-4MZ").waitFor();
    const host = new URL(baseURL!).host;

    await expect(board.getByText(host, { exact: true })).toBeVisible();
    await expect(board.getByText(/Открой сайт/)).toBeVisible();
    const qr = board.getByRole("img", { name: new RegExp(`QR-код.*${host.replace(/[.]/g, "\\.")}`) });
    await expect(qr).toBeVisible();
    // Только адрес сайта, без секретов: камера телефона откроет главную страницу.
    expect(await decodeQr(page, qr)).toBe(`${new URL(baseURL!).origin}/`);

    // Код читается посимвольно скрытым текстом; aria-label на элементе без роли (ARIA 1.2) не используется.
    await expect(board.locator(".board__code [aria-label]")).toHaveCount(0);
    await expect(board.locator(".board__code .tt-visually-hidden")).toHaveText("K 7 Q 4 M Z");
    await expect(board.locator(".board__code span").first()).toHaveText("K7Q-4MZ");
  });
});

test.describe("одно слово — «сайт»", () => {
  test("старая ссылка карточки /q не говорит «приложение»", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/q");
    await expect(page.locator("h1")).toContainText("сайт");
    await expect(page.getByText(/приложени/)).toHaveCount(0);
  });
});

test.describe("закрытая доска гасит код класса на сервере", () => {
  const JOIN_CODE = `/classes/${CLASS_ID}/join-code`;
  const deletes = (w: World) => w.calls.filter((c) => c === `DELETE ${JOIN_CODE}`).length;

  const openBoard = async (page: Page) => {
    await page.goto(`/teacher/classes/${CLASS_ID}`);
    await page.getByRole("button", { name: "Показать код класса" }).click();
    const board = page.getByRole("dialog", { name: "Код класса 5 «Б»" });
    await board.getByText("K7Q-4MZ").waitFor();
    return board;
  };

  const closers: [string, (page: Page, board: Locator) => Promise<unknown>][] = [
    ["кнопкой «Закрыть код класса»", (_page, board) => board.getByRole("button", { name: "Закрыть код класса" }).click()],
    ["«Назад»", (page) => page.goBack()],
    ["Esc", (page) => page.keyboard.press("Escape")],
  ];
  for (const [how, close] of closers) {
    test(`закрытие доски ${how} — DELETE /classes/{id}/join-code`, async ({ page }) => {
      const w = await mockBackend(page, { account: adultMe() });
      const board = await openBoard(page);
      expect(deletes(w)).toBe(0);
      const sent = page.waitForRequest((r) => r.method() === "DELETE" && r.url().endsWith(`/api/v1${JOIN_CODE}`));
      await close(page, board);
      await sent;
      await expect(board).toBeHidden();
      await expect.poll(() => deletes(w)).toBe(1);
      await expect(page.getByText(/Не удалось закрыть код/)).toHaveCount(0);
    });
  }

  test("доска → «Заявки»: код действует, пока открыты заявки с доски; закрыли заявки — DELETE", async ({ page }) => {
    const w = await mockBackend(page, { account: adultMe() });
    const board = await openBoard(page);
    await board.getByRole("button", { name: /^Заявки/ }).click();
    const requests = page.getByRole("dialog", { name: "Заявки на вход" });
    await expect(requests).toBeVisible();
    await requests.getByRole("button", { name: "Принять: Тёплый ветер" }).click();
    await expect(page.getByText("Тёплый ветер — в классе, место №25")).toBeVisible();
    expect(deletes(w)).toBe(0);
    await requests.getByRole("button", { name: "Закрыть" }).click();
    await expect(requests).toBeHidden();
    await expect.poll(() => deletes(w)).toBe(1);
  });

  test("постоянный код (стенд показа): «Код постоянный», без таймера и «Новый код»; закрытие — без DELETE и ошибок", async ({ page }) => {
    const w = await mockBackend(page, { account: adultMe(), permanentJoinCode: true });
    await page.goto(`/teacher/classes/${CLASS_ID}`);
    await page.getByRole("button", { name: "Показать код класса" }).click();
    const board = page.getByRole("dialog", { name: "Код класса 5 «Б»" });
    await expect(board.getByText("000-000")).toBeVisible();
    await expect(board.getByText("Код постоянный")).toBeVisible();
    await expect(board.getByText(/Действует ещё/)).toHaveCount(0);
    await expect(board.getByRole("button", { name: "Новый код" })).toHaveCount(0);
    await board.getByRole("button", { name: "Закрыть код класса" }).click();
    await expect(board).toBeHidden();
    await page.waitForTimeout(300);
    expect(deletes(w)).toBe(0);
    await expect(page.getByText(/Не удалось закрыть код/)).toHaveCount(0);
  });

  test("заявки с панели класса, без доски — кода нет, DELETE не нужен", async ({ page }) => {
    const w = await mockBackend(page, { account: adultMe() });
    await page.goto(`/teacher/classes/${CLASS_ID}`);
    await page.getByRole("button", { name: "Посмотреть" }).click();
    const requests = page.getByRole("dialog", { name: "Заявки на вход" });
    await expect(requests.getByText("Тёплый ветер")).toBeVisible();
    await requests.getByRole("button", { name: "Закрыть" }).click();
    await expect(requests).toBeHidden();
    await page.waitForTimeout(300);
    expect(deletes(w)).toBe(0);
  });

  for (const [label, failure] of [
    ["500", { status: 500, code: "internal" }],
    ["обрыв сети", "offline"],
  ] as const) {
    test(`DELETE не прошёл (${label}) — доска закрыта, учитель видит, до какого времени код действует; повтор`, async ({ page }) => {
      const w = await mockBackend(page, { account: adultMe(), failures: { [`DELETE ${JOIN_CODE}`]: failure } });
      const board = await openBoard(page);
      await board.getByRole("button", { name: "Закрыть код класса" }).click();
      await expect(board).toBeHidden();
      const alert = page.getByRole("alert").filter({ hasText: "Не удалось закрыть код класса K7Q-4MZ." });
      await expect(alert).toContainText(/Он сам перестанет действовать в \d{2}:\d{2}\./);
      expect(deletes(w)).toBe(1);

      delete w.failures[`DELETE ${JOIN_CODE}`];
      await alert.getByRole("button", { name: "Закрыть код ещё раз" }).click();
      await expect(alert).toHaveCount(0);
      expect(deletes(w)).toBe(2);
    });
  }
});

test.describe("отзыв согласия — вход на место закрыт, ученик выйдет на всех устройствах", () => {
  const revoke = async (page: Page, seat: string) => {
    await page.goto(`/teacher/classes/${CLASS_ID}`);
    await page.getByRole("button", { name: new RegExp(`^Место №${seat}`) }).click();
    const dialog = page.getByRole("dialog", { name: `Место №${seat}` });
    await dialog.getByRole("button", { name: "Отозвать согласие", exact: true }).click();
    return dialog;
  };

  test("место с учеником и карточкой", async ({ page }) => {
    await mockBackend(page, { account: adultMe() });
    const dialog = await revoke(page, "03");
    await expect(dialog.getByRole("alert")).toHaveText("Вход на место будет закрыт, ученик выйдет на всех устройствах.");
    await expect(dialog.locator("b", { hasText: "ученик выйдет на всех устройствах" })).toBeVisible();
    await dialog.getByRole("button", { name: "Отозвать согласие", exact: true }).click();
    await expect(page.getByText("Согласие №03 отозвано")).toBeVisible();
  });

  test("место без карточки (ученик вошёл по коду класса) — ни слова о карточке", async ({ page }) => {
    const w = await mockBackend(page, { account: adultMe() });
    w.classDetail.seats!.push({
      number: 25,
      cardStatus: "none",
      cardVersion: 0,
      student: { accountId: "0193f7a4-0000-7000-8000-0000000s0025", nickname: "Тёплый ветер", joinedAt: new Date().toISOString() },
      consent: { consentId: "0193f7a4-0000-7000-8000-0000000e0025", status: "given", documentVersion: "2026-11-01", givenAt: new Date().toISOString() },
    });
    const dialog = await revoke(page, "25");
    await expect(dialog.getByRole("alert")).toContainText("Вход на место будет закрыт, ученик выйдет на всех устройствах");
    await expect(dialog.getByRole("alert")).not.toContainText("карточк");
    await dialog.getByRole("button", { name: "Отозвать согласие", exact: true }).click();
    await expect(page.getByText("Согласие №25 отозвано")).toBeVisible();
  });

  test("место без ученика — «вход на место», без «выйдет»", async ({ page }) => {
    await mockBackend(page, { account: adultMe() });
    const dialog = await revoke(page, "15");
    await expect(dialog.getByRole("alert")).toHaveText("Вход на место будет закрыт.");
    await dialog.getByRole("button", { name: "Отозвать согласие", exact: true }).click();
    await expect(page.getByText("Согласие №15 отозвано", { exact: true })).toBeVisible();
  });
});
