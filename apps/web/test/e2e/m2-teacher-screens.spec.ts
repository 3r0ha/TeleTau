// Снимки экранов учителя и Telegram Mini App — для сверки с прототипом (prototypes/trail-expedition: 17-class, 10/11
// дуэль) глазами. Запуск: TELETAU_SCREENS=1 pnpm --filter @teletau/web test:a11y -- m2-teacher-screens
// Пишет PNG в apps/web/test/screens/m2/ (или TELETAU_SCREENS_DIR/m2): 390×844 при плотности 2, как снимки ученика; учитель —
// ещё и 1280 (ноутбук).
import { test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLASS_ID, SCHOOL, adultMe, childMe, classDetail, mockBackend, type World } from "./mock-api";
import { CURRENT_NODE, learnWorld } from "./mock-learn";
import { demoSeats } from "./mock-teacher";
import { chooseTheme } from "./theme";

const OUT = resolve(process.env.TELETAU_SCREENS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../screens"), "m2");

test.skip(!process.env.TELETAU_SCREENS, "снимки — только по TELETAU_SCREENS=1");
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

const DARK_TG = { bg_color: "#17212b", text_color: "#f5f5f5" };
const LIGHT_TG = { bg_color: "#ffffff", text_color: "#000000" };
const tgLaunch = (theme: Record<string, string>, platform = "android") =>
  `/miniapp#${new URLSearchParams({ tgWebAppData: "query_id=x", tgWebAppVersion: "7.10", tgWebAppPlatform: platform, tgWebAppThemeParams: JSON.stringify(theme) }).toString()}`;

async function progress(page: Page) {
  await page.goto(`/teacher/classes/${CLASS_ID}/progress`);
  await page.getByText("№07 · Смелая пчела").waitFor();
}

async function tasks(page: Page) {
  await page.goto(`/teacher/classes/${CLASS_ID}/assignments`);
  await page.getByRole("heading", { name: "«Моя школа»" }).waitFor();
}

async function seatCard(page: Page) {
  await page.goto(`/teacher/classes/${CLASS_ID}/seats/7`);
  await page.getByRole("heading", { name: "Пройденные уроки" }).waitFor();
}

const ufaDayIn = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yekaterinburg" }).format(new Date(Date.now() + days * 86_400_000));

/** Тропа демо-ученика с заданием учителя «Моя школа» (выполнено или нет). */
function withTask(done: boolean) {
  const learn = learnWorld();
  learn.course = { ...learn.course, assignments: [{ id: "0193f7a4-0000-7000-8000-0000000a5001", kind: "lesson", lessonId: "u01-moya-shkola", titleRu: "Моя школа", placeRu: "Уфа", dueOn: ufaDayIn(2), done }] };
  return learn;
}

async function duel(page: Page) {
  await page.goto("/teacher/duels");
  await page.getByRole("radio", { name: "Һаумыһығыҙ!" }).waitFor();
}

async function voted(page: Page) {
  await duel(page);
  await page.getByRole("radio", { name: "Һаумыһығыҙ!" }).click();
  await page.getByRole("button", { name: "Отдать голос" }).click();
  await page.getByRole("region", { name: "Голоса по группам" }).waitFor();
}

interface Shot {
  name: string;
  world?: Partial<World>;
  go: (page: Page) => Promise<void>;
  dark?: boolean;
  width?: number;
  fullPage?: boolean;
  telegram?: boolean;
  scrollTo?: string;
  /** Печатная версия (media print). */
  print?: boolean;
}

const teacher: Partial<World> = { account: adultMe(), classDetail: classDetail({ seats: demoSeats() }) };

const SHOTS: Shot[] = [
  { name: "40-teacher-progress", world: teacher, go: progress },
  { name: "40b-teacher-progress-students", world: teacher, go: progress, scrollTo: "#pupils-title" },
  { name: "40c-teacher-progress-dark", world: teacher, go: progress, dark: true },
  { name: "40d-teacher-progress-1280", world: teacher, go: progress, width: 1280, fullPage: true },
  { name: "41-teacher-duel", world: teacher, go: duel },
  { name: "41b-teacher-duel-1280", world: teacher, go: duel, width: 1280 },
  { name: "42-teacher-duel-voted", world: teacher, go: voted, scrollTo: "#votes-title" },
  { name: "42b-teacher-duel-voted-1280", world: teacher, go: voted, width: 1280, fullPage: true },
  { name: "42c-teacher-duel-voted-dark", world: teacher, go: voted, dark: true, scrollTo: "#votes-title" },
  {
    name: "43-teacher-duels-empty",
    world: { ...teacher, teacher: { progress: () => undefined as never, assignments: { active: [], past: [] }, items: [], judgments: new Map() } },
    go: async (p) => (await p.goto("/teacher/duels"), await p.getByRole("heading", { name: "Все пары оценены" }).waitFor()),
  },
  { name: "44-teacher-class-tabs-1280", world: teacher, width: 1280, go: async (p) => (await p.goto(`/teacher/classes/${CLASS_ID}`), await p.getByText("Смелая пчела").waitFor()) },
  // Задания классу, карточка ученика, отчёт (ADR 0021).
  { name: "45-teacher-assignments", world: teacher, go: tasks },
  { name: "45b-teacher-assignments-1280", world: teacher, go: tasks, width: 1280, fullPage: true },
  { name: "45c-teacher-assignments-dark", world: teacher, go: tasks, dark: true },
  { name: "45d-teacher-give-assignment", world: teacher, go: async (p) => (await tasks(p), await p.getByRole("button", { name: "Дать задание" }).click(), await p.getByRole("radio", { name: "Моя школа" }).waitFor()) },
  { name: "45e-teacher-give-assignment-1280", world: teacher, width: 1280, go: async (p) => (await tasks(p), await p.getByRole("button", { name: "Дать задание" }).click(), await p.getByRole("radio", { name: "Моя школа" }).waitFor()) },
  { name: "46-teacher-seat-card", world: teacher, go: seatCard },
  { name: "46b-teacher-seat-card-1280", world: teacher, go: seatCard, width: 1280, fullPage: true },
  { name: "46c-teacher-seat-card-dark", world: teacher, go: seatCard, dark: true, fullPage: true },
  { name: "47-teacher-progress-print", world: teacher, go: progress, width: 900, fullPage: true, print: true },
  { name: "47b-teacher-progress-toolbar-1280", world: teacher, go: progress, width: 1280 },
  { name: "48-student-trail-assignment", world: { account: childMe(), learn: withTask(false) }, go: async (p) => (await p.goto("/learn"), await p.getByRole("button", { name: /^Задание учителя/ }).waitFor()) },
  { name: "48b-student-trail-assignment-dark", dark: true, world: { account: childMe(), learn: withTask(false) }, go: async (p) => (await p.goto("/learn"), await p.getByRole("button", { name: /^Задание учителя/ }).waitFor()) },
  { name: "48c-student-trail-assignment-done", world: { account: childMe(), learn: withTask(true) }, go: async (p) => (await p.goto("/learn"), await p.getByText("Задание учителя выполнено").waitFor()) },
  {
    name: "50-miniapp-login-telegram",
    telegram: true,
    go: async (p) => (await p.goto(tgLaunch(LIGHT_TG, "ios")), await p.getByRole("button", { name: "Сканировать карточку" }).waitFor()),
  },
  // Тёмная тема Telegram: Mini App всё равно светлая.
  {
    name: "51-miniapp-trail-telegram",
    telegram: true,
    world: { account: childMe() },
    go: async (p) => (await p.goto(tgLaunch(DARK_TG)), await p.getByRole("button", { name: CURRENT_NODE }).waitFor()),
  },
  {
    name: "52-miniapp-league-telegram",
    telegram: true,
    world: { account: childMe() },
    go: async (p) => {
      await p.goto(tgLaunch(LIGHT_TG));
      await p.getByRole("button", { name: CURRENT_NODE }).waitFor();
      await p.getByRole("link", { name: "Лига", exact: true }).click();
      await p.getByRole("heading", { name: "Лига Донника" }).waitFor();
    },
  },
];

// Путь учителя на трёх ширинах (ноутбук, большой монитор, телефон): главная → класс (обзор, прогресс, задания) →
// карточка ученика → дуэли. Запуск: TELETAU_SCREENS=1 pnpm --filter @teletau/web test:a11y -- m2-teacher-screens -g "путь учителя"
const soloClass: Partial<World> = {
  ...teacher,
  classes: [{ id: CLASS_ID, title: "5 «Б»", grade: 5, letter: "Б", program: "native", academicYear: 2026, school: SCHOOL, myRole: "teacher", studentCount: 22, seatCount: 24 }],
};
const twoClasses: Partial<World> = { ...teacher };
const WALK: Shot[] = [
  { name: "home-one-class", world: soloClass, go: async (p) => (await p.goto("/teacher"), await p.getByText("№04 Ясный ручей").first().waitFor()), fullPage: true },
  { name: "home-two-classes", world: twoClasses, go: async (p) => (await p.goto("/teacher"), await p.getByText("№04 Ясный ручей").first().waitFor()), fullPage: true },
  { name: "class-overview", world: teacher, go: async (p) => (await p.goto(`/teacher/classes/${CLASS_ID}`), await p.getByText("Смелая пчела").first().waitFor()), fullPage: true },
  { name: "class-progress", world: teacher, go: progress, fullPage: true },
  { name: "class-assignments", world: teacher, go: tasks, fullPage: true },
  { name: "seat-card", world: teacher, go: seatCard, fullPage: true },
  { name: "duels", world: teacher, go: duel },
  { name: "duels-voted", world: teacher, go: voted, fullPage: true },
];
for (const width of [1280, 1440, 390]) for (const w of WALK) SHOTS.push({ ...w, name: `walk-${width}-${w.name}`, width });

for (const shot of SHOTS) {
  test(`M2 учитель и Mini App ${shot.name}`, async ({ page }) => {
    if (shot.width) await page.setViewportSize({ width: shot.width, height: 860 });
    await page.emulateMedia({ reducedMotion: "reduce", ...(shot.print ? { media: "print" as const } : {}) });
    if (shot.dark) await chooseTheme(page, "dark");
    if (shot.telegram) {
      await page.addInitScript(() => {
        (window as unknown as { TelegramWebviewProxy: unknown }).TelegramWebviewProxy = { postEvent: () => undefined };
      });
    }
    await mockBackend(page, shot.world ?? {});
    await shot.go(page);
    if (shot.scrollTo) await page.locator(shot.scrollTo).evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${shot.name}.png`, fullPage: shot.fullPage });
  });
}
