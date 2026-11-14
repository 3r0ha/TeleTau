// Стартовая страница — лендинг (app/page.tsx) на моках API: куда ведут кнопки, «Войти» в шапке, кнопка Android по
// ANDROID_APK_URL (основной сервер — с адресом, второй — без, test/e2e/servers.ts), вход уже открыт → «Продолжить»,
// axe в светлой и тёмной теме, нет горизонтальной прокрутки на 320 px.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adultMe, childMe, mockBackend } from "./mock-api";
import { NO_APK_PORT, TEST_APK_URL } from "./servers";
import { settleAnimations } from "./settle";
import { chooseTheme } from "./theme";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const TITLE = "Учи башкирский — легко и каждый день";

async function expectNoSeriousViolations(page: Page, label: string) {
  await settleAnimations(page);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`).join("\n");
  expect(serious, `${label}: нарушения axe\n${report}`).toEqual([]);
}

const hero = (page: Page) => page.getByRole("region", { name: TITLE });

test.describe("стартовая страница", () => {
  test("один h1, разделы с h2; кнопки героя, раздел для школ и подвал ведут куда нужно", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE);
    for (const name of ["Места тропы", "Мёд и серия", "Путь по родным местам", "Помоги языку", "Лига и класс", "Для школ", "Учись где удобно", "Первый урок — пять минут"]) {
      await expect(page.getByRole("heading", { level: 2, name, exact: true })).toHaveCount(1);
    }
    await expect(hero(page).getByRole("link", { name: "Начать", exact: true })).toHaveAttribute("href", "/self");
    await expect(hero(page).getByRole("link", { name: "У меня есть карточка или код" })).toHaveAttribute("href", "/student");
    await expect(page.getByRole("region", { name: "Для школ" }).getByRole("link", { name: "Кабинет учителя" })).toHaveAttribute("href", "/teacher/login?as=teacher");
    await expect(page.getByRole("region", { name: "Первый урок — пять минут" }).getByRole("link", { name: "Начать" })).toHaveAttribute("href", "/self");
    const places = page.getByRole("region", { name: "Места тропы" }).getByRole("listitem");
    await expect(places).toHaveCount(6);
    await expect(places.first()).toContainText("Уфа");

    const foot = page.getByRole("contentinfo");
    await expect(foot.getByRole("link", { name: "Начать" })).toHaveAttribute("href", "/self");
    await expect(foot.getByRole("link", { name: "Войти по карточке" })).toHaveAttribute("href", "/student");
    await expect(foot.getByRole("link", { name: "Кабинет учителя" })).toHaveAttribute("href", "/teacher/login?as=teacher");
    await expect(foot.getByRole("link", { name: "Условия" })).toHaveAttribute("href", /^\/legal\/terms\/\d{4}-\d{2}-\d{2}$/);
    await expect(foot.getByRole("link", { name: "Конфиденциальность" })).toHaveAttribute("href", /^\/legal\/privacy\/\d{4}-\d{2}-\d{2}$/);

    // Картинки с alt; героя браузер грузит первым.
    expect(await page.locator("img:not([alt])").count()).toBe(0);
    await expect(page.locator(".lp-hero__img")).toHaveAttribute("fetchpriority", "high");
    await expect(page.locator("body")).not.toContainText(/ПДн|сервер|алгоритм|скоро/i);
  });

  test("«Начать» открывает «Учусь сам», вторая кнопка — вход по карточке", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    await hero(page).getByRole("link", { name: "Начать", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Сколько тебе лет?" })).toBeVisible();
    await page.goto("/");
    await hero(page).getByRole("link", { name: "У меня есть карточка или код" }).click();
    await expect(page.getByRole("heading", { name: "Покажи карточку камере" })).toBeVisible();
  });

  test("фраза дня и доска почёта: API молчит — вместо фразы «Сәләм!», блоков нет, лендинг цел (пара и доска показываются в e2e с настоящим API)", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    // Моки не перехватывают серверный фетч Next: страница живёт без фразы — пчела здоровается, а не падает.
    await expect(page.locator(".lp-hero__hello")).toHaveText("Сәләм!");
    await expect(page.getByRole("region", { name: "Доска почёта" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Места тропы" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE);
  });

  test("«Войти» в шапке: по карточке или по почте; Esc закрывает и возвращает фокус", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    const toggle = page.getByRole("banner").getByRole("button", { name: "Войти" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("link", { name: "По карточке", exact: true })).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("link", { name: "По карточке", exact: true })).toHaveAttribute("href", "/student");
    await expect(page.getByRole("link", { name: "По почте", exact: true })).toHaveAttribute("href", "/teacher/login");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("link", { name: "По карточке", exact: true })).toBeHidden();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "По карточке", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Покажи карточку камере" })).toBeVisible();
  });

  test("ANDROID_APK_URL задан — кнопка «Скачать для Android» и ссылка в подвале", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Скачать для Android" })).toHaveAttribute("href", TEST_APK_URL);
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Android" })).toHaveAttribute("href", TEST_APK_URL);
    // Только настоящие ссылки: ни iPhone, ни Telegram, ни значков магазинов.
    await expect(page.getByText(/App Store|Google Play|RuStore|iPhone|Telegram/)).toHaveCount(0);
  });

  test("ANDROID_APK_URL пуст — ни кнопки, ни колонки «Приложение» в подвале", async ({ page }) => {
    await mockBackend(page);
    await page.goto(`http://localhost:${NO_APK_PORT}/`);
    await expect(page.getByRole("heading", { level: 2, name: "Учись где удобно" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Android/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Приложение" })).toHaveCount(0);
  });

  test("вход на устройстве уже открыт — «Продолжить» с ником и «Это не я»; выход возвращает «Начать»", async ({ page }) => {
    const w = await mockBackend(page, { account: childMe() });
    await page.goto("/");
    await expect(hero(page).getByText("Смелая пчела")).toBeVisible();
    await expect(hero(page).getByRole("link", { name: "Продолжить" })).toHaveAttribute("href", "/learn");
    await expect(hero(page).getByRole("link", { name: "Начать", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Первый урок — пять минут" }).getByRole("link", { name: "Продолжить" })).toHaveAttribute("href", "/learn");
    await hero(page).getByRole("button", { name: "Это не я" }).click();
    await expect(hero(page).getByRole("link", { name: "Начать", exact: true })).toHaveAttribute("href", "/self");
    expect(w.logouts).toBe(1);
  });

  test("учитель на этом устройстве — «Продолжить» ведёт в кабинет", async ({ page }) => {
    await mockBackend(page, { account: adultMe() });
    await page.goto("/");
    await expect(hero(page).getByRole("link", { name: "Продолжить" })).toHaveAttribute("href", /^\/teacher/);
  });

  for (const dark of [false, true]) {
    for (const width of [390, 1280]) {
      test(`axe без серьёзных нарушений: ${width} px, ${dark ? "тёмная" : "светлая"} тема`, async ({ page }) => {
        await page.setViewportSize({ width, height: width < 600 ? 844 : 860 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        if (dark) await chooseTheme(page, "dark");
        await mockBackend(page);
        await page.goto("/");
        await page.getByRole("heading", { level: 1 }).waitFor();
        await expectNoSeriousViolations(page, `лендинг ${width}`);
        await page.getByRole("banner").getByRole("button", { name: "Войти" }).click();
        await expectNoSeriousViolations(page, `лендинг ${width}: меню «Войти»`);
      });
    }
  }

  test("320 px: без горизонтальной прокрутки, в том числе при крупном шрифте; шапка липкая", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await mockBackend(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.mouse.wheel(0, 1500);
    await expect(page.getByRole("banner")).toBeInViewport();
    await expect(page.getByRole("banner")).toHaveAttribute("data-scrolled", "true");
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "24px";
    });
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  test("разделы ниже экрана проявляются при прокрутке; при «Уменьшении движения» ничего не прячется", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockBackend(page);
    await page.goto("/");
    const final = page.getByRole("region", { name: "Первый урок — пять минут" });
    await expect(final).toHaveAttribute("data-reveal", "wait");
    await final.scrollIntoViewIfNeeded();
    await expect(final).toHaveAttribute("data-reveal", "in");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.getByRole("heading", { level: 1 }).waitFor();
    await expect(page.locator('[data-reveal="wait"]')).toHaveCount(0);
  });
});
