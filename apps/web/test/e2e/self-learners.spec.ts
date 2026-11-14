// «Учусь сам» (ADR 0022) на моках API по контракту: старт с тремя путями, онбординг без ПДн (возраст диапазоном → ник
// → тропа; цель дня — в профиле), выбор взрослого после входа по почте, личная карточка входа (показать, перевыпустить, войти
// тем же сканером), «Вступить в класс», «Сохранить прогресс по почте». Доступность (axe) новых экранов — в светлой и
// тёмной теме; снимки — по TELETAU_SCREENS=1 в apps/web/test/screens/self/.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_LOGIN_CARD, adultMe, mockBackend, qrPhoto, soloMe, type World } from "./mock-api";
import { settleAnimations } from "./settle";
import { chooseTheme } from "./theme";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const OUT = resolve(process.env.TELETAU_SCREENS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../screens"), "self");
const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first().waitFor();

async function expectNoSeriousViolations(page: Page, label: string) {
  await settleAnimations(page);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`).join("\n");
  expect(serious, `${label}: нарушения axe\n${report}`).toEqual([]);
}

/** Онбординг «Учусь сам» до шага ника (последний шаг: «Начать» сразу ведёт на тропу). */
async function toNick(page: Page, age: string) {
  await page.goto("/");
  await page.getByRole("link", { name: "Начать", exact: true }).first().click();
  await heading(page, "Сколько тебе лет?");
  await page.getByRole("radio", { name: age }).check();
  await page.getByRole("button", { name: "Дальше" }).click();
  await heading(page, "Выбери ник");
  await page.getByRole("radio").first().check();
}

test.describe("«Учусь сам» — потоки", () => {
  test("старт: «Начать» — «Учусь сам», «У меня есть карточка или код» — вход ученика, «Кабинет учителя» — вход учителя", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Начать", exact: true }).first()).toHaveAttribute("href", "/self");
    await expect(page.getByRole("link", { name: "У меня есть карточка или код" })).toHaveAttribute("href", "/student");
    await expect(page.getByRole("main").getByRole("link", { name: "Кабинет учителя" })).toHaveAttribute("href", "/teacher/login?as=teacher");
  });

  test("онбординг: возраст → ник → тропа; ни одного поля ПДн, в BFF — только ник и диапазон", async ({ page }) => {
    const w = await mockBackend(page);
    await toNick(page, "11–14 лет");
    await expect(page.locator("input[type=email], input[type=tel], input[name*=name i]")).toHaveCount(0);
    await page.getByRole("button", { name: "Начать", exact: true }).click();
    await page.waitForURL("**/learn");
    expect(w.selfSignups).toEqual([{ nicknameId: expect.stringMatching(/^nick:/), ageBand: "age_11_14" }]);
    await expect(page.locator("html")).toHaveAttribute("data-mode", "bortnik");
  });

  test("онбординг: системная «Назад» с шага ника возвращает к возрасту, выбор не теряется", async ({ page }) => {
    const w = await mockBackend(page);
    await toNick(page, "7–10 лет");
    await page.goBack();
    await heading(page, "Сколько тебе лет?");
    await expect(page.getByRole("radio", { name: "7–10 лет" })).toBeChecked();
    await page.getByRole("button", { name: "Дальше" }).click();
    await heading(page, "Выбери ник");
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Начать", exact: true }).click();
    await page.waitForURL("**/learn");
    expect(w.selfSignups[0]).toEqual({ nicknameId: expect.any(String), ageBand: "age_7_10" });
  });

  test("взрослый после входа по почте: выбор «Учиться» → ник → тропа (цель дня — 2 по умолчанию); «Я учитель» → условия", async ({ page }) => {
    const w = await mockBackend(page);
    await page.goto("/teacher/login");
    await page.getByLabel("Электронная почта").fill("grown@mail.example");
    await page.getByRole("button", { name: "Получить код" }).click();
    await page.getByLabel("Код из письма: символ 1 из 4").fill("0000");
    await heading(page, "Что дальше?");
    await expect(page.getByRole("link", { name: /Я учитель/ })).toHaveAttribute("href", "/teacher/terms");
    await page.getByRole("button", { name: /Учиться/ }).click();
    await heading(page, "Выбери ник");
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Начать", exact: true }).click();
    await page.waitForURL("**/learn");
    expect(w.account).toMatchObject({ kind: "adult", ageBand: "adult", dailyGoal: 2, teacherStatus: "none" });
    expect(w.calls).not.toContain("POST /teacher/verification");
  });

  test("со стартовой «Кабинет учителя»: после кода — сразу условия, без повторного «Учиться / Я учитель»", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: "Кабинет учителя" }).click();
    await page.getByLabel("Электронная почта").fill("new.teacher@school.example");
    await page.getByRole("button", { name: "Получить код" }).click();
    await page.getByLabel("Код из письма: символ 1 из 4").fill("0000");
    await heading(page, "Примите условия");
    await expect(page).toHaveURL(/\/teacher\/terms$/);
  });

  test("карточка входа: сделать → QR и «Сохранить картинку»; новая — с подтверждением", async ({ page }) => {
    const w = await mockBackend(page, { account: soloMe() });
    await page.goto("/me");
    await page.getByRole("link", { name: /Моя карточка входа/ }).click();
    await heading(page, "Сделай карточку входа");
    await page.getByRole("button", { name: "Сделать карточку" }).click();
    await expect(page.getByRole("img", { name: "QR-код карточки входа" })).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Сохранить картинку" }).click();
    expect((await download).suggestedFilename()).toBe("teletau-karta-1.png");
    await page.getByRole("button", { name: "Сделать новую карточку" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Сделать новую" }).click();
    await expect(page.getByText("Выпуск 2")).toBeVisible();
    expect(w.loginCard?.version).toBe(2);
  });

  test("тот же сканер входа ученика принимает личную карточку TP1 и ведёт на тропу", async ({ page }) => {
    const w = await mockBackend(page, { loginCard: DEMO_LOGIN_CARD });
    await page.goto("/student");
    await page.getByLabel("Фото карточки").setInputFiles(await qrPhoto(DEMO_LOGIN_CARD.payload));
    await page.waitForURL("**/learn");
    expect(w.cardPayloads).toEqual([DEMO_LOGIN_CARD.payload]);
    expect(w.qrPayloads).toEqual([]);
  });

  test("отозванная личная карточка — свой текст, без «покажи учителю»", async ({ page }) => {
    await mockBackend(page, { loginCard: null, bffReplies: { card: [{ status: 403, code: "card_revoked" }] } });
    await page.goto("/student");
    await page.getByLabel("Фото карточки").setInputFiles(await qrPhoto(DEMO_LOGIN_CARD.payload));
    await expect(page.getByText("ты сделал новую")).toBeVisible();
  });

  test("«Класс» без класса → «Вступить в класс» по коду → ждём учителя → улей класса", async ({ page }) => {
    await mockBackend(page, { account: soloMe(), classJoinStatuses: ["pending", "approved"] });
    await page.goto("/hive");
    await page.getByRole("link", { name: "Вступить в класс" }).click();
    await page.getByLabel("Код класса: символ 1 из 6").fill("K7Q4MZ");
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await heading(page, "Ждём учителя");
    await page.waitForURL("**/hive");
    await heading(page, /Улей 5/);
  });

  test("профиль без карточки: «Выйти» сначала предлагает сделать карточку", async ({ page }) => {
    await mockBackend(page, { account: soloMe() });
    await page.goto("/me");
    await page.getByRole("button", { name: "Выйти" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Сначала сделай карточку" })).toBeVisible();
  });

  test("профиль: подтверждение «Выйти» — на стартовую страницу, не застревая на /me", async ({ page }) => {
    const w = await mockBackend(page, { account: soloMe({ loginCard: "issued" }) });
    await page.goto("/me");
    await expect(page.getByRole("heading", { name: "Мудрая сова" })).toBeVisible();
    await page.getByRole("button", { name: "Выйти" }).click();
    await page.getByRole("dialog", { name: "Уже уходишь?" }).getByRole("button", { name: "Выйти", exact: true }).click();
    // Гард useRequireAccount и кнопка «Выйти» реагируют на один выход одновременно: раньше два конкурирующих
    // router.replace (на /student и на /) взаимно отменяли навигацию, и /me оставался со скелетом загрузки.
    await page.waitForURL((u) => u.pathname === "/");
    expect(w.logouts).toBe(1);
  });

  test("взрослый «Учусь сам» сохраняет прогресс по почте; карточки после этого нет", async ({ page }) => {
    const grown = adultMe({ roles: [], teacherStatus: "none", classes: [], profile: undefined, nickname: "Мудрая сова", uiMode: "keeper", ageBand: "adult", loginCard: "none" });
    const w = await mockBackend(page, { account: grown });
    await page.goto("/me");
    await page.getByRole("link", { name: /Сохранить прогресс по почте/ }).click();
    await page.getByLabel("Электронная почта").fill("grown@mail.example");
    await page.getByRole("button", { name: "Получить код" }).click();
    await page.getByLabel("Код из письма: символ 1 из 4").fill("0000");
    await page.waitForURL("**/me");
    expect(w.account?.profile?.email).toBe("grown@mail.example");
    await expect(page.getByRole("link", { name: /Моя карточка входа/ })).toHaveCount(0);
  });

  test("ребёнок привязывает почту: адрес не возвращается, карточка отзывается (ADR 0022 §10)", async ({ page }) => {
    const w = await mockBackend(page, { account: soloMe({ loginCard: "issued" }) });
    await page.goto("/me");
    await page.getByRole("link", { name: /Сохранить прогресс по почте/ }).click();
    await page.getByLabel("Электронная почта").fill("kid@mail.example");
    await page.getByRole("button", { name: "Получить код" }).click();
    await page.getByLabel("Код из письма: символ 1 из 4").fill("0000");
    await page.waitForURL("**/me");
    expect(w.account?.emailLogin).toBe(true);
    expect(w.account?.profile).toBeUndefined();
    await expect(page.getByRole("link", { name: /Сохранить прогресс по почте/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Моя карточка входа/ })).toHaveCount(0);
  });

  test("ребёнок с привязанной почтой входит по ней — сразу на тропу, без выхода", async ({ page }) => {
    const w = await mockBackend(page, {});
    w.otpAccount = soloMe({ loginCard: undefined, emailLogin: true });
    await page.goto("/teacher/login");
    await page.getByLabel("Электронная почта").fill("kid@mail.example");
    await page.getByRole("button", { name: "Получить код" }).click();
    await page.getByLabel("Код из письма: символ 1 из 4").fill("0000");
    await page.waitForURL("**/learn");
    expect(w.logouts).toBe(0);
  });

  test("цель дня меняется в профиле", async ({ page }) => {
    const w = await mockBackend(page, { account: soloMe() });
    await page.goto("/me");
    await page.getByRole("button", { name: "Изменить" }).click();
    await page.getByRole("dialog").getByRole("radio", { name: /1 урок в день/ }).check();
    await page.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByText("1 урок в день")).toBeVisible();
    expect(w.account?.dailyGoal).toBe(1);
  });
});

interface Screen {
  name: string;
  world?: Partial<World>;
  open: (page: Page) => Promise<void>;
  width?: number;
  dark?: boolean;
}

const SCREENS: Screen[] = [
  { name: "50-start", open: async (p) => (await p.goto("/"), heading(p, "Учи башкирский")) },
  { name: "50b-start-1280", width: 1280, open: async (p) => (await p.goto("/"), heading(p, "Учи башкирский")) },
  { name: "50c-start-dark", dark: true, open: async (p) => (await p.goto("/"), heading(p, "Учи башкирский")) },
  { name: "51-self-age", open: async (p) => (await p.goto("/self"), heading(p, "Сколько тебе лет?")) },
  {
    name: "52-self-nick",
    open: async (p) => {
      await p.goto("/self");
      await p.getByRole("radio", { name: "15–17 лет" }).check();
      await p.getByRole("button", { name: "Дальше" }).click();
      await heading(p, "Выбери ник");
      await p.getByRole("radio").first().waitFor();
    },
  },
  { name: "53-self-nick-picked", open: (p) => toNick(p, "11–14 лет") },
  {
    name: "54-adult-welcome",
    world: { account: adultMe({ roles: [], teacherStatus: "none", classes: [], pendingConsents: ["terms", "privacy", "consent_adult"] }) },
    open: async (p) => (await p.goto("/welcome"), heading(p, "Что дальше?")),
  },
  { name: "55-card-none", world: { account: soloMe() }, open: async (p) => (await p.goto("/me/card"), heading(p, "Сделай карточку входа")) },
  { name: "56-card", world: { account: soloMe({ loginCard: "issued" }), loginCard: DEMO_LOGIN_CARD }, open: async (p) => (await p.goto("/me/card"), heading(p, "Моя карточка входа")) },
  { name: "56b-card-dark", dark: true, world: { account: soloMe({ loginCard: "issued" }), loginCard: DEMO_LOGIN_CARD }, open: async (p) => (await p.goto("/me/card"), heading(p, "Моя карточка входа")) },
  { name: "57-profile-solo", world: { account: soloMe({ loginCard: "issued" }) }, open: async (p) => (await p.goto("/me"), heading(p, "Мудрая сова")) },
  { name: "58-hive-no-class", world: { account: soloMe() }, open: async (p) => (await p.goto("/hive"), heading(p, "Класса пока нет")) },
  { name: "59-join-class", world: { account: soloMe() }, open: async (p) => (await p.goto("/hive/join"), heading(p, "Введи код класса")) },
  {
    name: "60-save-email",
    world: { account: adultMe({ roles: [], teacherStatus: "none", classes: [], profile: undefined, nickname: "Мудрая сова", uiMode: "keeper", ageBand: "adult", loginCard: "issued" }) },
    open: async (p) => (await p.goto("/me/email"), heading(p, "Сохранить прогресс по почте")),
  },
  {
    name: "60b-save-email-child",
    world: { account: soloMe() },
    open: async (p) => (await p.goto("/me/email"), heading(p, "Сохранить прогресс по почте")),
  },
];

test.describe("«Учусь сам» — доступность новых экранов (axe)", () => {
  for (const s of SCREENS.filter((x) => !x.width)) {
    test(s.name, async ({ page }) => {
      if (s.dark) await chooseTheme(page, "dark");
      await mockBackend(page, s.world);
      await s.open(page);
      await expectNoSeriousViolations(page, s.name);
    });
  }
});

test.describe("«Учусь сам» — снимки", () => {
  test.skip(!process.env.TELETAU_SCREENS, "снимки — только по TELETAU_SCREENS=1");
  for (const s of SCREENS) {
    test(s.name, async ({ page }) => {
      await page.setViewportSize({ width: s.width ?? 390, height: s.width ? 860 : 844 });
      if (s.dark) await chooseTheme(page, "dark");
      await mockBackend(page, s.world);
      await s.open(page);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: resolve(OUT, `${s.name}.png`) });
    });
  }
});
