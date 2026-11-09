// Снимки ключевых экранов (390 и 1280 px). Запуск:
//   TELETAU_SCREENS=1 pnpm --filter @teletau/web test:a11y -- screens
// Пишет PNG в apps/web/test/screens/ (или TELETAU_SCREENS_DIR). Без TELETAU_SCREENS тесты пропускаются.
import { test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLASS_ID, FOREIGN_CLASS_ID, adultMe, childMe, classDetail, mockBackend, qrPhoto, type World } from "./mock-api";
import { chooseTheme } from "./theme";

const OUT = process.env.TELETAU_SCREENS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../screens");
const WIDTHS = [390, 1280] as const;

test.skip(!process.env.TELETAU_SCREENS, "снимки — только по TELETAU_SCREENS=1");

interface Shot {
  name: string;
  world?: Partial<World>;
  go: (page: Page) => Promise<void>;
  dark?: boolean;
  fullPage?: boolean;
}

const teacher = adultMe();

const SHOTS: Shot[] = [
  { name: "01-start", go: (p) => open(p, "/") },
  // Стартовая страница целиком: герой, полоса мест, разделы о продукте, для школ, приложение, подвал.
  { name: "01b-start-full", fullPage: true, go: (p) => open(p, "/") },
  { name: "01c-start-dark", dark: true, go: (p) => open(p, "/") },
  { name: "02-student-scan", go: (p) => open(p, "/student") },
  {
    name: "03-qr-card-revoked",
    world: { qr: { ok: false, status: 403, code: "card_revoked" } },
    go: async (p) => {
      await open(p, "/student");
      await p.getByLabel("Фото карточки").setInputFiles(await qrPhoto("TT1.0123456789.ABCDEFGHJKMNPQRSTVWXYZ0123.6V"));
      await p.getByText("Эта карточка больше не действует").waitFor();
    },
  },
  { name: "03b-q-old-link", go: (p) => open(p, "/q#TT1.0123456789.ABCDEFGHJKMNPQRSTVWXYZ0123.6V", "Карточку сканируют на сайте") },
  {
    name: "04-student-code",
    go: async (p) => {
      await open(p, "/student/code");
      await p.getByLabel("Код класса: символ 1 из 6").fill("K7Q4MZ");
    },
  },
  {
    name: "05-student-code-nickname",
    go: async (p) => {
      await open(p, "/student/code");
      await p.getByLabel("Код класса: символ 1 из 6").fill("K7Q4MZ");
      await p.getByRole("button", { name: "Дальше" }).click();
      await p.getByRole("radio").nth(1).check();
    },
  },
  {
    name: "06-student-wait",
    go: async (p) => {
      await open(p, "/student/code");
      await p.getByLabel("Код класса: символ 1 из 6").fill("K7Q4MZ");
      await p.getByRole("button", { name: "Дальше" }).click();
      await p.getByRole("radio").first().check();
      await p.getByRole("button", { name: "Отправить заявку" }).click();
      await p.getByRole("heading", { name: "Ждём учителя" }).waitFor();
    },
  },
  { name: "07-student-nickname", world: { account: childMe({ nickname: undefined }) }, go: (p) => open(p, "/student/nickname", "Выбери ник") },
  { name: "08-student-class", world: { account: childMe() }, go: (p) => open(p, "/student/class", "Ты в классе 5 «Б»") },
  { name: "08-student-class-dark", dark: true, world: { account: childMe() }, go: (p) => open(p, "/student/class", "Ты в классе 5 «Б»") },
  { name: "08b-student-class-bee", world: { account: childMe({ uiMode: "bee" }) }, go: (p) => open(p, "/student/class", "Ты в классе 5 «Б»") },
  {
    name: "07b-student-nickname-bee-selected",
    world: { account: childMe({ uiMode: "bee", nickname: undefined }) },
    go: async (p) => {
      await open(p, "/student/nickname", "Выбери ник");
      await p.getByRole("radio").nth(1).check();
    },
  },
  { name: "09-teacher-login", go: (p) => open(p, "/teacher/login") },
  {
    name: "10-teacher-code",
    go: async (p) => {
      await open(p, "/teacher/login");
      await p.getByLabel("Электронная почта").fill("teacher@school7.example");
      await p.getByRole("button", { name: "Получить код" }).click();
      await p.getByText("Введите код").waitFor();
    },
  },
  {
    name: "11-teacher-terms",
    world: { account: adultMe({ teacherStatus: "none", roles: [], classes: [], pendingConsents: ["terms", "privacy", "consent_adult"] }) },
    go: (p) => open(p, "/teacher/terms", "Примите условия"),
  },
  {
    name: "12-teacher-apply-school",
    world: { account: adultMe({ teacherStatus: "none", roles: [], classes: [] }) },
    go: async (p) => {
      await open(p, "/teacher/apply", "Расскажите о себе");
      await p.getByLabel("Фамилия, имя, отчество").fill("Учитель Демонстрационный");
      await p.getByLabel("Должность").fill("Учитель башкирского языка");
      await p.getByRole("button", { name: "Дальше" }).click();
      await p.getByRole("radio", { name: /Уфа/ }).check();
      await p.getByRole("button", { name: "Дальше" }).click();
      await p.getByRole("radio", { name: /Школа № 7/ }).check();
    },
  },
  { name: "13-teacher-pending", world: { account: adultMe({ teacherStatus: "pending", roles: [], classes: [] }) }, go: (p) => open(p, "/teacher/pending", "Заявка на проверке") },
  { name: "14-teacher-classes", world: { account: teacher }, go: (p) => open(p, "/teacher", "5 «Б»") },
  { name: "15-teacher-classes-empty", world: { account: teacher, classes: [] }, go: (p) => open(p, "/teacher", "Первый урок") },
  { name: "16-class", fullPage: true, world: { account: teacher }, go: (p) => open(p, `/teacher/classes/${CLASS_ID}`, "Места") },
  { name: "16-class-dark", dark: true, world: { account: teacher }, go: (p) => open(p, `/teacher/classes/${CLASS_ID}`, "Места") },
  {
    name: "17-class-code-board",
    world: { account: teacher },
    go: async (p) => {
      await open(p, `/teacher/classes/${CLASS_ID}`, "Места");
      await p.getByRole("button", { name: "Показать код класса" }).click();
      await p.getByText("K7Q-4MZ").waitFor();
    },
  },
  {
    name: "18-join-requests",
    world: { account: teacher },
    go: async (p) => {
      await open(p, `/teacher/classes/${CLASS_ID}`, "Места");
      await p.getByRole("button", { name: "Посмотреть" }).click();
      await p.getByRole("dialog").getByText("Тёплый ветер").waitFor();
    },
  },
  {
    name: "19b-create-class",
    world: { account: teacher },
    go: async (p) => {
      await open(p, "/teacher", "5 «Б»");
      await p.getByRole("button", { name: "Создать класс" }).first().click();
      await p.getByRole("dialog", { name: "Новый класс" }).waitFor();
    },
  },
  {
    name: "19-issue-cards",
    world: { account: teacher, classDetail: classDetail({ seats: [] , pendingJoinRequestCount: 0 }) },
    go: async (p) => {
      await open(p, `/teacher/classes/${CLASS_ID}`, "Первый урок");
      await p.getByRole("button", { name: "Выпустить карточки" }).first().click();
      await p.getByRole("button", { name: /Выпустить 24 карточки/ }).click();
      await p.getByText("Карточки готовы").waitFor();
    },
  },
  {
    // После выпуска карточек: шаг «Покажите код на доске» — следующий, PDF под рукой.
    name: "19c-class-ready-for-lesson",
    fullPage: true,
    world: { account: teacher, classDetail: classDetail({ seats: [], pendingJoinRequestCount: 0 }) },
    go: async (p) => {
      await open(p, `/teacher/classes/${CLASS_ID}`, "Первый урок");
      await p.getByRole("button", { name: "Выпустить карточки" }).first().click();
      await p.getByRole("button", { name: /Выпустить 24 карточки/ }).click();
      await p.getByRole("dialog").getByRole("button", { name: "Закрыть" }).click();
      await p.getByText(/PDF доступен до/).waitFor();
    },
  },
  {
    name: "20-seat-dialog",
    world: { account: teacher },
    go: async (p) => {
      await open(p, `/teacher/classes/${CLASS_ID}`, "Места");
      await p.getByRole("button", { name: /Место №03/ }).click();
      await p.getByRole("button", { name: "Перевыпустить карточку" }).click();
    },
  },
  { name: "21-no-access", world: { account: teacher }, go: (p) => open(p, `/teacher/classes/${FOREIGN_CLASS_ID}`, "Нет доступа") },
  {
    name: "22-offline",
    world: { account: teacher },
    go: async (p) => {
      await p.route(`**/api/v1/classes/${CLASS_ID}`, (r) => r.abort("internetdisconnected"));
      await open(p, `/teacher/classes/${CLASS_ID}`, "Нет связи");
    },
  },
];

async function open(page: Page, path: string, waitText?: string) {
  await page.goto(path);
  if (waitText) await page.getByText(waitText, { exact: false }).first().waitFor();
  else await page.waitForLoadState("networkidle");
}

for (const width of WIDTHS) {
  for (const shot of SHOTS) {
    if (shot.dark && width !== 390) continue;
    test(`${shot.name} @${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 860 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      if (shot.dark) await chooseTheme(page, "dark");
      await mockBackend(page, shot.world);
      await shot.go(page);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}/${shot.name}-${width}.png`, fullPage: Boolean(shot.fullPage) && width > 390 });
    });
  }
}
