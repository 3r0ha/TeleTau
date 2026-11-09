// Общие шаги сквозных тестов: доступность (axe), вход учителя и модератора через настоящие экраны, PDF карточек.
import { createHmac, randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Download, type Page } from "@playwright/test";
import { parseQrPayload } from "@teletau/auth-codes";
import { Redis } from "ioredis";
import QRCode from "qrcode";
import { generate } from "otplib";
// Тот же разбор PDF, что в тестах API (ADR 0018 §6): pdfjs-dist достаёт картинки, jsQR декодирует QR.
import { scanPdf, type PdfScan } from "../../apps/api/test/support/pdf-qr.js";
import { stack } from "./env.js";

/** Уникальная метка прогона теста: адреса e-mail и ФИО не пересекаются между прогонами и повторами (`--repeat-each`). */
export const runId = () => `${Date.now().toString(36)}${randomInt(1296).toString(36)}`;

/**
 * Та же метка кириллицей — для ФИО: API принимает в ФИО только буквы, пробел, дефис и апостроф,
 * поэтому латиница и цифры метки переводятся в русские буквы один к одному (уникальность сохраняется).
 */
const RU_ALPHABET = "абвгдежзиклмнопрстуфхцчшщэюяёйъыь";
export const cyrillicTag = (run: string) =>
  run.replace(/[0-9a-z]/g, (c) => RU_ALPHABET[parseInt(c, 36)] ?? "а").replace(/^./, (c) => c.toUpperCase());

/** Демо-модератор консоли (apps/api/data/README.md). */
export const MODERATOR = { email: "moderator@demo.teletau.local", totpSecret: "KEREZDEMOMODERATORTOTPSECRETAAAA" };
/** Демо-сотрудники кабинета министерства и словаря для Фонда (ADR 0023, apps/api/data/README.md). */
export const MINISTRY = { email: "ministry@demo.teletau.local", totpSecret: "KEREZDEMOMINISTRYTOTPSECRETCCCCC" };
export const FUND = { email: "fund@demo.teletau.local", totpSecret: "KEREZDEMOFUNDTOTPSECRETDDDDDDDDD" };

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** axe (WCAG 2.2 A/AA) на текущем экране: серьёзных и критических нарушений нет. `disable` — правила, неприменимые к экрану. */
export async function expectAccessible(page: Page, label: string, disable: string[] = []): Promise<void> {
  // Контраст проверяется на итоговом кадре: дожидаемся конечных анимаций (появление диалога, тоста).
  // Бесконечные (скелетоны, пчела) не ждём — они не меняют цвета текста.
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((a) => {
      const end = a.effect?.getComputedTiming().endTime;
      return a.playState === "running" && typeof end === "number" && Number.isFinite(end);
    });
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
  const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).disableRules(disable).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`).join("\n");
  expect(serious, `${label}: нарушения axe\n${report}`).toEqual([]);
}

const hmac24 = (value: string) => createHmac("sha256", stack().pepper).update(value, "utf8").digest("hex").slice(0, 24);

/**
 * Лимиты запроса кода переживают прогон (Valkey): 5 на адрес и 30 на IP за 10 минут (ADR 0015 §4). Демо-модератор
 * входит в каждом прогоне, браузер всегда на 127.0.0.1 — как и интеграционные тесты API (harness.resetEmailLimit),
 * сбрасываем счётчики только этих ключей. Формат ключей — RateLimiter и AccountsService.emailSubject.
 */
export async function resetLoginLimits(): Promise<void> {
  const valkey = new Redis(stack().valkeyUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await valkey.connect();
    const ips = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
    await valkey.del(`rl:otp:email:${hmac24(`email:${MODERATOR.email}`)}`, ...ips.map((ip) => `rl:otp:ip:${hmac24(`ip:${ip}`)}`));
  } finally {
    valkey.disconnect();
  }
}

export const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first();

/** Знакомство с пчелой открывается у нового ученика на тропе (до первого урока): закрыть «Пропустить», если оно есть. */
export async function dismissIntro(page: Page): Promise<void> {
  const skip = page.getByRole("button", { name: "Пропустить" });
  await skip.waitFor({ state: "visible", timeout: 8_000 }).then(
    () => skip.click(),
    () => undefined,
  );
}

/** Заголовок карточки «Новое слово» (word_intro): урок сначала показывает новое слово, потом проверяет. */
export const newWordHeading = (page: Page) => heading(page, "Новое слово");

/**
 * Карточка «Новое слово» на экране — проверить, что слово показано по-башкирски, и нажать «Дальше» (ответа у карточки
 * нет). Карточки нет — false.
 */
export async function passNewWord(page: Page): Promise<boolean> {
  if (!(await newWordHeading(page).isVisible())) return false;
  await expect(page.locator(".newword__word")).toHaveAttribute("lang", "ba");
  await page.getByRole("button", { name: "Дальше", exact: true }).click();
  return true;
}

/** Проверка на каждом ключевом экране (axe) — передаётся из сценария. */
export type ScreenCheck = (label: string) => Promise<void>;
const noCheck: ScreenCheck = async () => undefined;

/**
 * Учитель: стартовая → «Кабинет учителя» (раздел «Для школ») → e-mail → демо-код → условия (выбор «Учиться / Я учитель»
 * уже сделан этой кнопкой, ADR 0022) → «Расскажите о себе» → район → школа → заявка.
 * Возвращает id заявки (по нему модератор находит запись в журнале аудита).
 */
export async function registerTeacher(
  page: Page,
  who: { email: string; fullName: string; position?: string; school?: number },
  check: ScreenCheck = noCheck,
): Promise<string> {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await check("старт");
  await page.getByRole("region", { name: "Для школ" }).getByRole("link", { name: "Кабинет учителя" }).click();
  await expect(heading(page, "Вход по почте")).toBeVisible();
  await check("вход учителя: e-mail");
  await page.getByLabel("Электронная почта").fill(who.email);
  await page.getByRole("button", { name: "Получить код" }).click();
  await expect(page.getByText("Демо: код")).toBeVisible();
  await check("вход учителя: код из письма");
  await page.getByLabel("Код из письма: символ 1 из 4").fill(stack().demoCode);

  await expect(heading(page, "Примите условия")).toBeVisible();
  await check("принятие условий");
  // Документы открываются отдельной страницей веба (LegalDocument.url).
  await expect(page.getByRole("link", { name: /Читать/ }).first()).toHaveAttribute("href", /\/legal\/(terms|privacy|consent_adult)\/\d{4}-\d{2}-\d{2}$/);
  await page.getByRole("button", { name: "Принять", exact: true }).click();

  await expect(heading(page, "Расскажите о себе")).toBeVisible();
  await check("заявка учителя: о себе");
  await page.getByLabel("Фамилия, имя, отчество").fill(who.fullName);
  await page.getByLabel("Должность").fill(who.position ?? "Учитель башкирского языка");
  await page.getByRole("button", { name: "Дальше" }).click();

  await expect(heading(page, "Выберите район")).toBeVisible();
  await page.getByLabel("Найти район или город").fill("Демо");
  await page.getByRole("radio", { name: /Демо-район/ }).check();
  await check("заявка учителя: район");
  await page.getByRole("button", { name: "Дальше" }).click();

  await expect(heading(page, "Выберите школу")).toBeVisible();
  await page.getByRole("radio", { name: new RegExp(`Демо-школа № ${who.school ?? 1}\\b`) }).check();
  await check("заявка учителя: школа");
  const verification = page.waitForResponse((r) => r.url().endsWith("/api/v1/teacher/verification") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Отправить заявку" }).click();
  const res = await verification;
  expect(res.status()).toBe(201);
  await expect(heading(page, "Заявка на проверке")).toBeVisible();
  await check("заявка на проверке");
  return ((await res.json()) as { id: string }).id;
}

/**
 * Модератор в консоли: e-mail → демо-код → TOTP демо-секрета. Один код TOTP дважды не принимается (защита от
 * повтора), поэтому, как интеграционные тесты, пробуем соседние шаги окна ±1, а если все заняты — ждём следующий шаг.
 */
export async function loginModerator(page: Page, check: ScreenCheck = noCheck): Promise<void> {
  await loginStaff(page, MODERATOR, "Заявки учителей", check);
  await check("консоль: очередь заявок учителей");
}

/** Сотрудник в консоли (e-mail → демо-код → TOTP); после входа — заголовок своего раздела `landing`. */
export async function loginStaff(page: Page, staff: { email: string; totpSecret: string }, landing: string, check: ScreenCheck = noCheck): Promise<void> {
  const { consoleUrl, demoCode } = stack();
  await page.goto(`${consoleUrl}/login`);
  await expect(heading(page, "Вход сотрудника")).toBeVisible();
  await check("консоль: вход сотрудника");
  await page.getByLabel("Рабочая почта").fill(staff.email);
  await page.getByRole("button", { name: "Получить код" }).click();
  await expect(heading(page, "Код из письма")).toBeVisible();
  await page.getByLabel("Код из письма: символ 1 из 4").fill(demoCode);
  await expect(heading(page, "Код из приложения")).toBeVisible();
  await check("консоль: код TOTP");

  for (let round = 0; round < 2; round++) {
    for (const offset of [0, 30, -30]) {
      const totp = await generate({ secret: staff.totpSecret, epoch: Math.floor(Date.now() / 1000) + offset });
      const verify = page.waitForResponse((r) => r.url().endsWith("/api/session/otp"));
      await page.getByLabel("Код из приложения-аутентификатора: символ 1 из 6").fill(totp);
      if ((await verify).ok()) {
        await expect(heading(page, landing)).toBeVisible();
        return;
      }
      await expect(page.getByText("Неверный код из приложения-аутентификатора")).toBeVisible();
    }
    await page.waitForTimeout(31_000 - ((Date.now() / 1000) % 30) * 1000);
  }
  throw new Error(`${staff.email} не вошёл: все коды TOTP окна заняты`);
}

/** Сколько страниц очереди модератора листать в поиске заявки: по 50 — до 2 000 заявок (очередь любой длины). */
const MAX_QUEUE_PAGES = 40;

/**
 * Модератор одобряет заявку учителя в очереди (старые сверху; при длинной очереди — «Показать ещё»).
 * Устойчиво к длине очереди: каждый клик по «Показать ещё» — один, затем ждём ответ страницы с курсором и
 * выход кнопки из состояния загрузки; во время загрузки повторно не кликаем. Нет заявки — понятная ошибка.
 */
export async function approveTeacher(page: Page, fullName: string): Promise<void> {
  const approve = page.getByRole("button", { name: `Одобрить: ${fullName}`, exact: true });
  const more = page.getByRole("button", { name: "Показать ещё" });
  const rows = page.locator("table tbody tr");
  const tab = page.getByRole("button", { name: "На проверке" });
  if ((await tab.getAttribute("aria-pressed")) !== "true") await tab.click();
  // Первая страница загружена: таблица заявок или «Очередь пуста».
  await expect(rows.first().or(page.getByRole("heading", { name: "Очередь пуста" }))).toBeVisible();

  for (let pages = 1; (await approve.count()) === 0; pages++) {
    if ((await more.count()) === 0) {
      throw new Error(`approveTeacher: заявки «${fullName}» нет в очереди «На проверке» (просмотрено строк: ${await rows.count()}, страниц: ${pages})`);
    }
    if (pages >= MAX_QUEUE_PAGES) throw new Error(`approveTeacher: заявка «${fullName}» не найдена за ${pages} страниц очереди`);
    // 401 — токен обновится и запрос повторится (session/api.ts): ждём итоговый ответ.
    const nextPage = page.waitForResponse((r) => r.request().method() === "GET" && r.status() !== 401 && /\/moderation\/teacher-verifications\?.*cursor=/.test(r.url()));
    await more.click();
    expect((await nextPage).ok(), "страница очереди модератора").toBe(true);
    // Строки добавлены в той же перерисовке, что снимает загрузку (последняя страница — кнопка исчезает).
    await expect(page.locator('button[aria-busy="true"]', { hasText: "Показать ещё" })).toHaveCount(0);
  }

  const decided = page.waitForResponse((r) => r.request().method() === "POST" && /\/moderation\/teacher-verifications\/[^/]+\/approve$/.test(r.url()));
  await approve.click();
  expect((await decided).status()).toBe(200);
  await expect(page.getByText(`Заявка одобрена: ${fullName}`)).toBeVisible();
}

/** PDF из события скачивания → страницы, QR по страницам, текст. */
export async function scanDownload(download: Download): Promise<PdfScan> {
  const path = await download.path();
  return scanPdf(new Uint8Array(await readFile(path)));
}

/**
 * В QR карточки — только полезная нагрузка `TT1.<карточка>.<секрет>.<контроль>`, без адреса сайта (ADR 0016):
 * системная камера не откроет по ней браузер, и секрет не попадёт в историю. Нагрузка проходит векторы (`parseQrPayload`).
 */
export function expectCardPayload(text: string): void {
  expect(text, text).toMatch(/^TT1\./);
  expect(text, text).not.toContain("://");
  expect(parseQrPayload(text).ok, text).toBe(true);
}

/** Фото карточки для «Загрузить фото карточки»: PNG с QR-кодом нагрузки (камеры в headless-браузере нет). */
export async function cardPhoto(payload: string): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  return { name: "card.png", mimeType: "image/png", buffer: await QRCode.toBuffer(payload, { errorCorrectionLevel: "M", margin: 4, width: 640 }) };
}

/** Запоминать адреса, по которым ходила вкладка (основной фрейм). */
export function trackUrls(page: Page): string[] {
  const urls: string[] = [];
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) urls.push(f.url());
  });
  return urls;
}

/**
 * Секрета карточки нет ни в одном адресе вкладки и ни в одной записи её истории (CDP Page.getNavigationHistory):
 * на общем планшете следующий ученик не войдёт под этим через «Назад» или историю браузера.
 */
export async function expectNoCardSecret(page: Page, visited: string[]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const { entries } = (await cdp.send("Page.getNavigationHistory")) as { entries: { url: string }[] };
  await cdp.detach();
  const all = [...visited, ...entries.map((e) => e.url), page.url()];
  expect(all.length).toBeGreaterThan(1);
  for (const url of all) expect(url, url).not.toContain("TT1.");
}
