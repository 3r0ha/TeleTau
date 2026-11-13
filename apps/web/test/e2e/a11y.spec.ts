// Доступность экранов онбординга (axe, WCAG 2.2 A/AA: без серьёзных и критических нарушений) в светлой и тёмной теме,
// клавиатура, диалог с фокус-ловушкой, а также ключевые правила потоков: у ребёнка нет ни одного поля ПДн.
// API — моки по контракту (mock-api.ts). Вход по карточке и секрет в истории — security.spec.ts.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { generateQrCard } from "@teletau/auth-codes";
import { CLASS_ID, FOREIGN_CLASS_ID, adultMe, childMe, mockBackend, qrPhoto, type World } from "./mock-api";
import { settleAnimations } from "./settle";
import { chooseTheme } from "./theme";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoSeriousViolations(page: Page, label: string) {
  await settleAnimations(page);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`).join("\n");
  expect(serious, `${label}: нарушения axe\n${report}`).toEqual([]);
}

interface Screen {
  name: string;
  world?: Partial<World>;
  open: (page: Page) => Promise<void>;
}

const teacher = adultMe();
const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first().waitFor();

const SCREENS: Screen[] = [
  { name: "старт", open: async (p) => (await p.goto("/"), heading(p, "Учи башкирский")) },
  { name: "сканер карточки", open: async (p) => (await p.goto("/student"), heading(p, "Покажи карточку камере")) },
  { name: "старая ссылка карточки /q", open: async (p) => (await p.goto(`/q#${generateQrCard().payload}`), heading(p, "Карточку сканируют на сайте")) },
  {
    name: "сканер: карточка отозвана",
    world: { qr: { ok: false, status: 403, code: "card_revoked" } },
    open: async (p) => {
      await p.goto("/student");
      await p.getByLabel("Фото карточки").setInputFiles(await qrPhoto(generateQrCard().payload));
      await p.getByText("Эта карточка больше не действует").waitFor();
    },
  },
  { name: "ученик в классе, режим «Пчёлка»", world: { account: childMe({ uiMode: "bee" }) }, open: async (p) => (await p.goto("/student/class"), heading(p, "Ты в классе 5 «Б»")) },
  {
    name: "перевыпуск карточки: предупреждение",
    world: { account: adultMe() },
    open: async (p) => {
      await p.goto(`/teacher/classes/${CLASS_ID}`);
      await p.getByRole("button", { name: /Место №03/ }).click();
      await p.getByRole("button", { name: "Перевыпустить карточку" }).click();
      await p.getByText("Ученик выйдет на всех устройствах").waitFor();
    },
  },
  { name: "код класса", open: async (p) => (await p.goto("/student/code"), heading(p, "Введи код класса")) },
  {
    name: "код класса: выбор ника",
    open: async (p) => {
      await p.goto("/student/code");
      await p.getByLabel("Код класса: символ 1 из 6").fill("K7Q4MZ");
      await p.getByRole("button", { name: "Дальше" }).click();
      await p.getByRole("radio").first().waitFor();
    },
  },
  {
    name: "ожидание подтверждения",
    open: async (p) => {
      await p.goto("/student/code");
      await p.getByLabel("Код класса: символ 1 из 6").fill("K7Q4MZ");
      await p.getByRole("button", { name: "Дальше" }).click();
      await p.getByRole("radio").first().check();
      await p.getByRole("button", { name: "Отправить заявку" }).click();
      await heading(p, "Ждём учителя");
    },
  },
  { name: "выбор ника", world: { account: childMe({ nickname: undefined }) }, open: async (p) => (await p.goto("/student/nickname"), p.getByRole("radio").first().waitFor()) },
  { name: "ученик в классе", world: { account: childMe() }, open: async (p) => (await p.goto("/student/class"), heading(p, "Ты в классе 5 «Б»")) },
  { name: "вход учителя", open: async (p) => (await p.goto("/teacher/login"), heading(p, "Вход по почте")) },
  {
    name: "код из письма",
    open: async (p) => {
      await p.goto("/teacher/login");
      await p.getByLabel("Электронная почта").fill("teacher@school7.example");
      await p.getByRole("button", { name: "Получить код" }).click();
      await heading(p, "Введите код");
    },
  },
  {
    name: "принятие условий",
    world: { account: adultMe({ teacherStatus: "none", roles: [], classes: [], pendingConsents: ["terms", "privacy"] }) },
    open: async (p) => (await p.goto("/teacher/terms"), heading(p, "Примите условия")),
  },
  { name: "заявка учителя: профиль", world: { account: adultMe({ teacherStatus: "none", roles: [], classes: [] }) }, open: async (p) => (await p.goto("/teacher/apply"), heading(p, "Расскажите о себе")) },
  { name: "заявка на проверке", world: { account: adultMe({ teacherStatus: "pending", roles: [], classes: [] }) }, open: async (p) => (await p.goto("/teacher/pending"), heading(p, "Заявка на проверке")) },
  { name: "мои классы", world: { account: teacher }, open: async (p) => (await p.goto("/teacher"), heading(p, "Мои классы")) },
  {
    name: "мои классы: пусто",
    world: { account: teacher, classes: [] },
    open: async (p) => {
      await p.goto("/teacher");
      await heading(p, "Первый урок");
      // Опечатка в адресе почты молча создавала пустой аккаунт — пустой онбординг советует проверить адрес (M2-UX4).
      await p.getByText("Проверьте адрес почты").waitFor();
    },
  },
  { name: "страница класса", world: { account: teacher }, open: async (p) => (await p.goto(`/teacher/classes/${CLASS_ID}`), heading(p, "Места")) },
  {
    name: "код класса на доску",
    world: { account: teacher },
    open: async (p) => {
      await p.goto(`/teacher/classes/${CLASS_ID}`);
      await p.getByRole("button", { name: "Показать код класса" }).click();
      await p.getByText("K7Q-4MZ").waitFor();
    },
  },
  {
    name: "заявки на вход",
    world: { account: teacher },
    open: async (p) => {
      await p.goto(`/teacher/classes/${CLASS_ID}`);
      await p.getByRole("button", { name: "Посмотреть" }).click();
      await p.getByRole("dialog").getByText("Тёплый ветер").waitFor();
    },
  },
  { name: "чужой класс", world: { account: teacher }, open: async (p) => (await p.goto(`/teacher/classes/${FOREIGN_CLASS_ID}`), heading(p, "Нет доступа")) },
];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe, тема ${scheme}`, () => {
    for (const s of SCREENS) {
      test(s.name, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        if (scheme === "dark") await chooseTheme(page, "dark");
        await mockBackend(page, s.world);
        await s.open(page);
        await expectNoSeriousViolations(page, s.name);
      });
    }
  });
}

test.describe("потоки и клавиатура", () => {
  test("у ребёнка нет ни одного поля ПДн: только ячейки кода и выбор ника", async ({ page }) => {
    await mockBackend(page);
    for (const path of ["/student", "/student/code"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const fields = await page.locator("input:not([type=radio]):not([type=file]), textarea, select").evaluateAll((els) =>
        els.map((e) => ({ type: e.getAttribute("type"), autocomplete: e.getAttribute("autocomplete"), label: e.getAttribute("aria-label") })),
      );
      for (const f of fields) {
        expect(["email", "tel"]).not.toContain(f.type);
        expect(f.autocomplete ?? "").not.toMatch(/name|email|tel|bday|address/);
        expect(f.label ?? "").toMatch(/^Код класса/);
      }
    }
  });

  test("вход по коду класса: после одобрения учителем ученик попадает в класс", async ({ page }) => {
    await mockBackend(page, { joinStatuses: ["pending", "approved"] });
    await page.goto("/student/code");
    // Вставка кода целиком в первую ячейку: ячейки заполняются, ввод в русской раскладке нормализуется (К → K, М → M).
    await page.getByLabel("Код класса: символ 1 из 6").focus();
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData("text", "к7q-4мz");
      document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect(page.getByLabel("Код класса: символ 6 из 6")).toHaveValue("Z");
    await page.getByRole("button", { name: "Дальше" }).click();
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await heading(page, "Ждём учителя");
    await heading(page, "Ты в классе 5 «Б»");
  });

  test("неверный код класса возвращает к вводу с понятной ошибкой", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/student/code");
    await page.getByLabel("Код класса: символ 1 из 6").fill("AAAAAA");
    await page.getByRole("button", { name: "Дальше" }).click();
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await expect(page.getByText("Код не подходит")).toBeVisible();
  });

  test("учитель: e-mail → демо-код 0000 → условия → заявка (район, школа) → ожидание", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/teacher/login");
    await page.getByLabel("Электронная почта").fill("teacher@school7.example");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Демо: код")).toBeVisible();
    await page.keyboard.type("0000");
    // Заявка учителя — только по выбору (ADR 0022): после кода — «Учиться» или «Я учитель».
    await heading(page, "Что дальше?");
    await page.getByRole("link", { name: /Я учитель/ }).click();
    await heading(page, "Примите условия");
    await page.getByRole("button", { name: "Принять", exact: true }).click();
    await heading(page, "Расскажите о себе");
    await page.getByLabel("Фамилия, имя, отчество").fill("Учитель Демонстрационный");
    await page.getByLabel("Должность").fill("Учитель башкирского языка");
    await page.getByRole("button", { name: "Дальше" }).click();
    await page.getByRole("radio", { name: /Уфа/ }).check();
    await page.getByRole("button", { name: "Дальше" }).click();
    await page.getByRole("radio", { name: /Школа № 7/ }).check();
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await heading(page, "Заявка на проверке");
  });

  test("неверный код из письма — ошибка у поля, ячейки очищаются", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/teacher/login");
    await page.getByLabel("Электронная почта").fill("teacher@school7.example");
    await page.getByRole("button", { name: "Получить код" }).click();
    await page.getByLabel("Код из письма: символ 1 из 4").fill("1234");
    await expect(page.getByText("Неверный код")).toBeVisible();
    await expect(page.getByLabel("Код из письма: символ 1 из 4")).toHaveValue("");
  });

  test("диалог места: открывается с клавиатуры, Tab не выходит за пределы, Esc закрывает и возвращает фокус", async ({ page }) => {
    await mockBackend(page, { account: teacher });
    await page.goto(`/teacher/classes/${CLASS_ID}`);
    const seat = page.getByRole("button", { name: /Место №03/ });
    await seat.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Место №03" });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(seat).toBeFocused();
  });

  test("новый ученик появляется на странице класса без перезагрузки (опрос раз в 3 с)", async ({ page }) => {
    const w = await mockBackend(page, { account: teacher });
    await page.goto(`/teacher/classes/${CLASS_ID}`);
    await heading(page, "Места");
    const seat13 = w.classDetail.seats!.find((s) => s.number === 13)!;
    seat13.student = { accountId: "0193f7a4-0000-7000-8000-0000000s0013", nickname: "Тёплый ветер", joinedAt: new Date().toISOString() };
    await expect(page.getByRole("button", { name: /Место №13: Тёплый ветер/ })).toBeVisible({ timeout: 5000 });
  });

  test("цели нажатия кнопок и ссылок-кнопок — не меньше 44 px", async ({ page }) => {
    await mockBackend(page, { account: teacher });
    for (const path of ["/", "/student", "/student/code", "/teacher/login", `/teacher/classes/${CLASS_ID}`]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const small = await page.locator(".tt-btn, .tt-icon-btn, .tt-link-btn, .tt-tab, .tt-choice__box, .tt-code__cell, .seat").evaluateAll((els) =>
        els
          .filter((e) => (e as HTMLElement).offsetParent !== null)
          .map((e) => ({ text: (e.textContent ?? e.getAttribute("aria-label") ?? "").trim().slice(0, 30), h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width }))
          .filter((r) => r.h < 44 || r.w < 44),
      );
      expect(small, path).toEqual([]);
    }
  });
});
