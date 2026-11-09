// На моках API по контракту (mock-api.ts, mock-learn.ts): повторение слов с «Парами», «Мой словарь», цель дня,
// «Послушать». Башкирские строки — из очереди проверки (строки прототипа №12–14); новых нет.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { childMe, mockBackend } from "./mock-api";
import { CURRENT_NODE, learnWorld } from "./mock-learn";
import { settleAnimations } from "./settle";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectAccessible(page: Page, label: string, disable: string[] = []) {
  await settleAnimations(page);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).disableRules(disable).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

/** Мир, где у ученика 5 слов к повторению. */
function dueWorld() {
  const learn = learnWorld();
  learn.course.review = { due: 5 };
  return learn;
}

test.describe("M2b: цель дня", () => {
  test("в шапке тропы — сота цели дня «0 из 2 сот», для читалки — одна фраза", async ({ page }) => {
    await mockBackend(page, { account: childMe() });
    await page.goto("/learn");
    const goal = page.locator(".learn-top .tt-goal");
    await expect(goal).toContainText("0 из 2");
    await expect(goal).toContainText("сот");
    await expect(page.getByText("Цель дня: 0 из 2", { exact: true })).toBeAttached();
  });
});

test.describe("M2b: повторение слов", () => {
  test("слов к повторению нет — карточки «Повторить» на тропе нет", async ({ page }) => {
    await mockBackend(page, { account: childMe() });
    await page.goto("/learn");
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Повторить \d/ })).toHaveCount(0);
  });

  test("«Повторить 5 слов» → выбор с «Послушать» → ввод → «Пары» (ошибка и повтор) → итог с целью дня → тропа без карточки", async ({ page }) => {
    // Без анимаций: axe проверяет контраст листа ответа, а не кадр его появления.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const w = await mockBackend(page, { account: childMe(), learn: dueWorld() });
    await page.goto("/learn");
    await expect(page.getByRole("heading", { name: "Повторить 5 слов" })).toBeVisible();
    // В интерфейсе нет технических слов о повторении.
    await expect(page.locator("body")).not.toContainText(/FSRS|интервал|алгоритм/i);
    await expectAccessible(page, "тропа с повторением", ["target-size"]);
    await page.getByRole("button", { name: "Начать", exact: true }).click();

    // Выбор: метка «Повторение», слово с кнопкой «Послушать».
    await expect(page.getByRole("heading", { name: "Что значит это слово?" })).toBeVisible();
    await expect(page.getByText("Повторение", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Послушать" })).toBeVisible();
    // Озвучка — со своего сайта: файл из public/audio, к upload.wikimedia.org запросов нет.
    const audioRequests: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "media" || /\.(ogg|m4a)(\?|$)/.test(r.url())) audioRequests.push(r.url());
    });
    await page.getByRole("button", { name: "Послушать" }).click();
    await expect.poll(() => audioRequests.length).toBeGreaterThan(0);
    expect(audioRequests.every((u) => new URL(u).pathname.startsWith("/audio/") && !u.includes("wikimedia"))).toBe(true);
    const local = await page.request.get(new URL(audioRequests[0]!).pathname);
    expect(local.status()).toBe(200);
    expect(local.headers()["content-type"]).toMatch(/^audio\//);
    await expect(page.locator(".word-card [lang=ba]")).toHaveText("Сәләм!");
    await expectAccessible(page, "повторение: выбор");
    await page.getByRole("radio", { name: "Привет!" }).click();
    await page.getByRole("button", { name: "Проверить" }).click();
    await expect(page.getByRole("heading", { name: "Верно!" })).toBeVisible();
    await page.getByRole("button", { name: "Дальше" }).click();

    await page.getByRole("textbox").fill("Рәхмәт!");
    await page.getByRole("button", { name: "Проверить" }).click();
    await page.getByRole("button", { name: "Дальше" }).click();

    // «Пары»: «Проверить» недоступна, пока соединены не все; соединённое снимается нажатием.
    await expect(page.getByRole("heading", { name: "Соедини пары" })).toBeVisible();
    const words = page.getByRole("list", { name: "Слова" });
    const translations = page.getByRole("list", { name: "Переводы" });
    const link = async (ba: string, ru: string) => {
      await words.getByRole("button", { name: new RegExp(`^${ba}`) }).click();
      await translations.getByRole("button", { name: new RegExp(`^${ru}`) }).click();
    };
    await link("Сәләм!", "Привет!");
    await expect(words.getByRole("button", { name: "Сәләм!", exact: true })).toHaveAccessibleDescription("пара 1");
    await expect(page.getByRole("button", { name: "Проверить" })).toBeDisabled();
    await expectAccessible(page, "повторение: пары");
    // Перепутали два перевода.
    await link("Хәйерле көн", "школа");
    await link("мәктәп", "Добрый день");
    await link("Рәхмәт!", "Спасибо!");
    await page.getByRole("button", { name: "Проверить" }).click();
    await expect(page.getByRole("heading", { name: "Пока не так" })).toBeVisible();
    await expect(page.locator(".pairs-fix")).toContainText("Хәйерле көн — «Добрый день»");
    await expect(page.locator(".pairs-fix")).toContainText("мәктәп — «школа»");
    await expect(page.locator(".pairs-fix")).not.toContainText("Сәләм!");
    await expect(words.getByRole("button", { name: "Сәләм!", exact: true })).toHaveAccessibleDescription("пара 1, верно");
    await expect(words.getByRole("button", { name: "Хәйерле көн", exact: true })).toHaveAccessibleDescription("пара 2, не так");
    await expectAccessible(page, "повторение: пары, не так");
    await page.getByRole("button", { name: "Дальше" }).click();

    // Вернулось в конце — соединяем верно.
    await expect(page.getByText("Ещё раз", { exact: true })).toBeVisible();
    await link("Хәйерле көн", "Добрый день");
    await link("Сәләм!", "Привет!");
    await link("мәктәп", "школа");
    await link("Рәхмәт!", "Спасибо!");
    await page.getByRole("button", { name: "Проверить" }).click();
    await expect(page.getByRole("heading", { name: /Верно!|Точно!/ })).toBeVisible();
    await page.getByRole("button", { name: "Дальше" }).click();

    await expect(page.getByRole("heading", { name: "Повторение пройдено!" })).toBeVisible();
    await expect(page.getByText("Цель дня выполнена", { exact: true })).toBeVisible();
    await expectAccessible(page, "итог повторения");
    const firstAttempts = w.learn.attempts.filter((a) => a.result.firstAttempt).map((a) => a.result.verdict);
    expect(firstAttempts).toEqual(["correct", "correct", "wrong"]);
    // Первая сота дня продлила серию: экран серии — цель дня уже выполнена.
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page.getByText("Приходи завтра, чтобы не прервать серию.")).toBeVisible();
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page.getByRole("button", { name: CURRENT_NODE })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Повторить \d/ })).toHaveCount(0);
    await expect(page.locator(".learn-top .tt-goal")).toContainText("2 из 2");
  });

  test("всё открытое пройдено, но есть слова к повторению — «Повторить» над «На сегодня всё»", async ({ page }) => {
    const learn = dueWorld();
    learn.course.units[0]!.nodes.forEach((n) => (n.state = "done"));
    await mockBackend(page, { account: childMe(), learn });
    await page.goto("/learn");
    await expect(page.getByRole("heading", { name: "Повторить 5 слов" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "На сегодня всё" })).toBeVisible();
    await expectAccessible(page, "всё пройдено, есть повторение");
  });
});

test.describe("M2b: «Мой словарь»", () => {
  test("из профиля — словарь: «повторить» сначала, «выучено» потом, «Послушать» у слов с записью; «Повторить» начинает повторение", async ({ page }) => {
    await mockBackend(page, { account: childMe(), learn: dueWorld() });
    await page.goto("/me");
    const entry = page.getByRole("link", { name: /Мой словарь/ });
    await expect(entry).toContainText("Повторить 3 слова");
    await entry.click();
    await page.waitForURL("**/me/words");
    await expect(page.getByRole("heading", { name: "Мой словарь", level: 1 })).toBeVisible();
    await expect(page.locator(".words__head .page-lead")).toHaveText("7 слов");
    const review = page.getByRole("region", { name: "На повторение", exact: true });
    const learned = page.getByRole("region", { name: "Выучено", exact: true });
    await expect(review.getByRole("listitem")).toHaveCount(3);
    await expect(learned.getByRole("listitem")).toHaveCount(4);
    await expect(review.getByRole("listitem").first()).toContainText("Сәләм!");
    await expect(review.getByRole("listitem").first()).toContainText("Привет!");
    await expect(review.locator("[lang=ba]").first()).toHaveText("Сәләм!");
    await expect(page.getByRole("button", { name: "Послушать: Сәләм!" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Послушать: Рәхмәт!" })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/FSRS|интервал|алгоритм/i);
    await expectAccessible(page, "мой словарь");

    await page.getByRole("link", { name: "Начать", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Что значит это слово?" })).toBeVisible();
    expect(new URL(page.url()).search).toBe("");
  });

  test("пустой словарь — приглашение на тропу", async ({ page }) => {
    const learn = learnWorld();
    learn.words = { summary: { total: 0, learned: 0, review: 0 }, words: [] };
    await mockBackend(page, { account: childMe(), learn });
    await page.goto("/me/words");
    await expect(page.getByRole("heading", { name: "Слов пока нет" })).toBeVisible();
    await expect(page.getByRole("link", { name: "На тропу" })).toBeVisible();
    await expectAccessible(page, "пустой словарь");
  });

  test("Mini App: словарь открывается под /miniapp", async ({ page }) => {
    await mockBackend(page, { account: childMe(), learn: dueWorld() });
    await page.goto("/miniapp/me/words");
    await expect(page.getByRole("heading", { name: "Мой словарь", level: 1 })).toBeVisible();
    await expect(page.locator(".words__back")).toHaveAttribute("href", "/miniapp/me");
    await expect(page.getByRole("link", { name: "Начать", exact: true })).toHaveAttribute("href", "/miniapp/learn?review=1");
  });
});
