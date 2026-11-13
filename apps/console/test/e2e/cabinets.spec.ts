// Консоль: кабинет министерства «Республика» и «Словарь для Фонда» + «Спорные случаи» (ADR 0023, ТЗ хакатона §4.4/§5) —
// axe, сортировка, переход к школам района, скрытые малые группы, скачивание CSV и JSON, доступ по ролям. API и BFF
// сессии — сетевые моки по контракту. Пары словаря — из демо-контента (content/corpus/duels/01-ufa.yaml, needs_native_review).
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { Problem, Schema } from "@teletau/contracts";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const tokens = createRequire(import.meta.url)("@teletau/design-tokens/tokens.json") as { light: Record<string, string> };
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, accept", "access-control-allow-methods": "GET, POST, OPTIONS" };
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const uuid = (n: number) => `0193f7a4-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;

const staff = (roles: string[], n: number): Schema<"Me"> => ({
  id: uuid(0x900 + n),
  kind: "staff",
  roles: roles.filter((r) => r === "moderator" || r === "admin") as Schema<"Role">[],
  staffRoles: roles,
  locale: "ru",
  teacherStatus: "none",
  classes: [],
  pendingConsents: [],
  profile: { email: `${roles[0]}@demo.teletau.local` },
});
const ministry = staff(["ministry"], 1);
const fund = staff(["fund"], 2);
const moderator = staff(["moderator"], 3);

const week = { start: "2026-11-02", end: "2026-11-08" };
const weeks: Schema<"RepublicWeek">[] = [
  [184, 61],
  [236, 74],
  [301, 92],
  [354, 108],
  [402, 121],
  [468, 139],
  [517, 152],
  [312, 118],
].map(([lessons, active], i) => {
  const start = new Date(Date.UTC(2026, 8, 14 + 7 * i));
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return { week: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }, lessons: lessons!, active: active! };
});

const act = (students: number, activeWeek: number, lessonsWeek: number, lessonsTotal: number): Schema<"LearnerActivity"> => ({ students, activeWeek, lessonsWeek, lessonsTotal });
const district = (n: number, nameRu: string, kind: Schema<"DistrictKind">, connected: number, total: number, classes: number, activity: Schema<"LearnerActivity">): Schema<"RepublicDistrictRow"> => ({
  districtId: uuid(0xd00 + n),
  nameRu,
  kind,
  schools: { connected, total },
  classes,
  activity,
});
const districts: Schema<"RepublicDistrictRow">[] = [
  district(1, "Уфа", "urban_okrug", 4, 132, 9, act(214, 168, 196, 2410)),
  district(2, "Стерлитамак", "urban_okrug", 2, 31, 4, act(88, 61, 70, 905)),
  district(3, "Баймакский район", "municipal_district", 3, 38, 4, act(71, 52, 63, 811)),
  district(4, "Бурзянский район", "municipal_district", 1, 14, 1, { suppression: "small_group" }),
  district(5, "Учалинский район", "municipal_district", 1, 33, 1, { suppression: "complementary" }),
  district(6, "Абзелиловский район", "municipal_district", 0, 29, 0, act(0, 0, 0, 0)),
  district(7, "Белорецкий район", "municipal_district", 0, 41, 0, act(0, 0, 0, 0)),
];
const summary: Schema<"RepublicSummary"> = {
  asOf: "2026-11-05T09:20:00Z",
  week,
  smallGroupThreshold: 5,
  districts: { connected: 5, total: 63 },
  schools: { connected: 11, total: 1691 },
  classes: 19,
  students: { school: { value: 388 }, self: { value: 27 } },
  teachersVerified: 14,
  learners: act(415, 312, 351, 4688),
  wordsLearned: 3940,
  votes: 2615,
  pairsAccepted: 4,
  weeks,
};
const districtList: Schema<"RepublicDistrictList"> = { asOf: summary.asOf, week, smallGroupThreshold: 5, items: districts, selfLearners: act(27, 19, 22, 260), total: summary.learners };
const ufa: Schema<"RepublicDistrictDetail"> = {
  asOf: summary.asOf,
  week,
  smallGroupThreshold: 5,
  district: districts[0]!,
  items: [
    { schoolId: uuid(0x501), shortNameRu: "Гимназия № 3", classes: 3, activity: act(76, 63, 72, 880) },
    { schoolId: uuid(0x502), shortNameRu: "Лицей № 1", classes: 3, activity: act(81, 64, 79, 902) },
    { schoolId: uuid(0x503), shortNameRu: "Школа № 44", classes: 1, activity: { suppression: "small_group" } },
    { schoolId: uuid(0x504), shortNameRu: "Школа № 158", classes: 2, activity: { suppression: "complementary" } },
  ],
  weeks: weeks.map((w) => ({ ...w, lessons: Math.round(w.lessons * 0.42), active: Math.round(w.active * 0.5) })),
};
const tinyDistrict: Schema<"RepublicDistrictDetail"> = { ...ufa, district: districts[3]!, items: [], weeks: [] };

const votes = (child: [number, number, number], adult: [number, number, number], teacher: [number, number, number]) => ({
  child: { votesFor: child[0], both: child[1], total: child[2] },
  adult: { votesFor: adult[0], both: adult[1], total: adult[2] },
  teacher: { votesFor: teacher[0], both: teacher[1], total: teacher[2] },
});
const pair = (n: number, sourceRu: string, textBa: string, title: string, url: string, v: Schema<"FundPair">["votes"], decidedAt: string, extra: Partial<Schema<"FundPair">> = {}): Schema<"FundPair"> => ({
  itemId: uuid(0x700 + n),
  variantId: uuid(0x800 + n),
  sourceRu,
  kind: "phrase",
  textBa,
  review: "needs_native_review",
  origin: "import",
  sources: [{ title, url, license: "CC BY-SA 4.0" }],
  main: true,
  tags: [],
  votes: v,
  decidedAt,
  decidedBy: "rule",
  rulesVersion: "duel-v0",
  preliminary: true,
  ...extra,
});
const dictionary: Schema<"FundDictionary"> = {
  generatedAt: "2026-11-05T09:20:00Z",
  items: [
    pair(1, "Здравствуйте!", "Һаумыһығыҙ!", "Tatoeba: башкирские предложения (bak) с русскими переводами", "https://tatoeba.org/ru/sentences/show/2839364", votes([14, 2, 23], [3, 0, 3], [1, 0, 1]), "2026-11-04T14:30:00Z", { sources: [{ title: "Tatoeba: башкирские предложения (bak) с русскими переводами", url: "https://tatoeba.org/ru/sentences/show/2839364", locator: "предложение №2839364", license: "CC BY 2.0 FR" }] }),
    pair(2, "Как Вас зовут?", "Исемегеҙ кем?", "Викигид: Башкирский разговорник", "https://ru.wikivoyage.org/", votes([9, 1, 17], [2, 1, 3], [1, 0, 1]), "2026-11-04T11:05:00Z", { kind: "sentence", tags: ["children_prefer"] }),
    pair(3, "Хорошо, спасибо.", "Рәхмәт, һәйбәт.", "Викигид: Башкирский разговорник", "https://ru.wikivoyage.org/", votes([11, 0, 19], [4, 0, 5], [0, 0, 0]), "2026-11-03T16:40:00Z"),
    pair(4, "Хорошо, спасибо.", "Рәхмәт, яҡшы.", "Викигид: Башкирский разговорник", "https://ru.wikivoyage.org/", votes([6, 0, 19], [1, 0, 5], [0, 0, 0]), "2026-11-03T16:40:00Z", { itemId: uuid(0x703), main: false }),
  ],
};

const escVariant = (n: number, text: string, v: Schema<"EscalatedVariant">["votes"]): Schema<"EscalatedVariant"> => ({
  variantId: uuid(0x900 + n),
  text,
  review: "needs_native_review",
  origin: "import",
  votes: v,
});
const escalated: Schema<"FundEscalated"> = {
  generatedAt: "2026-11-05T09:20:00Z",
  items: [
    {
      itemId: uuid(0xa01),
      sourceRu: "До свидания!",
      kind: "phrase",
      variants: [escVariant(1, "Һау булыгыҙ!", votes([7, 1, 12], [2, 0, 2], [0, 0, 0])), escVariant(2, "Күргәнсә!", votes([5, 0, 12], [0, 1, 2], [1, 0, 1]))],
      lastVoteAt: "2026-11-05T08:12:00Z",
    },
  ],
};

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
const problem = (route: Route, status: number, code: string) =>
  route.fulfill({ status, headers: { ...CORS, "content-type": "application/problem+json" }, body: JSON.stringify({ type: "about:blank", title: "Ошибка", status, code } satisfies Problem) });

/** Моки BFF и API: вошедший `account`; операции раздела — только своей роли (как x-access), чужой — 403. */
async function mock(page: Page, account: Schema<"Me">, opts: { empty?: boolean } = {}) {
  const roles = account.staffRoles ?? account.roles;
  const requests: string[] = [];
  await page.route("**/api/session/*", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").pop();
    if (action === "refresh") return json(route, 200, { accessToken: "test-access", accessTokenExpiresAt: inMinutes(15), account });
    if (action === "logout") return route.fulfill({ status: 204 });
    return problem(route, 404, "not_found");
  });
  await page.route(`${API}/api/v1/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(req.url()).pathname.replace("/api/v1", "");
    requests.push(path);
    if (path.startsWith("/ministry/") && !roles.includes("ministry")) return problem(route, 403, "forbidden");
    if (path.startsWith("/fund/") && !roles.includes("fund")) return problem(route, 403, "forbidden");
    if (path === "/ministry/summary") return json(route, 200, summary);
    if (path === "/ministry/districts") return json(route, 200, districtList);
    if (path === `/ministry/districts/${districts[0]!.districtId}`) return json(route, 200, ufa);
    if (path === `/ministry/districts/${districts[3]!.districtId}`) return json(route, 200, tinyDistrict);
    if (path === "/fund/dictionary") return json(route, 200, opts.empty ? { generatedAt: dictionary.generatedAt, items: [] } : dictionary);
    if (path === "/fund/escalated") return json(route, 200, opts.empty ? { generatedAt: escalated.generatedAt, items: [] } : escalated);
    return problem(route, 404, "not_found");
  });
  return { requests };
}

async function axe(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

const SHOTS = process.env.TELETAU_SCREENS ? (process.env.TELETAU_SCREENS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../web/test/screens")) : null;
async function shot(page: Page, name: string, fullPage = true) {
  if (!SHOTS) return;
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 860 });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/console-${name}-${width}.png`, fullPage });
  }
  await page.setViewportSize({ width: 1280, height: 860 });
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("Республика: сводка крупными числами, динамика по неделям и таблица районов; axe", async ({ page }) => {
  await mock(page, ministry);
  await page.goto("/");
  await page.waitForURL("**/republic");
  await page.getByRole("heading", { name: "Республика Башкортостан" }).waitFor();
  await expect(page.getByText("Неделя 2 нояб. – 8 нояб.")).toBeVisible();
  const reach = page.getByRole("definition").filter({ hasText: "из 63" });
  await expect(reach).toContainText("5");
  await expect(page.getByText("из 1 691")).toBeVisible();
  // У сотрудника министерства только свой раздел: ни заявок учителей, ни журнала аудита в меню.
  await expect(page.getByRole("link", { name: "Заявки учителей" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Журнал аудита" })).toHaveCount(0);

  // Скрытые малые группы: «< 5» и «скрыто», чисел нет; пояснение под таблицей.
  const table = page.getByRole("table", { name: /Районы и городские округа/ });
  await expect(table.getByRole("row", { name: /Бурзянский район/ })).toContainText("< 5");
  await expect(table.getByRole("row", { name: /Учалинский район/ })).toContainText("скрыто");
  await expect(page.getByText("меньше 5 учеников, числа скрыты")).toBeVisible();
  // По умолчанию — подключённые районы; «Все районы» — и неподключённые.
  await expect(table.getByRole("row", { name: /Белорецкий район/ })).toHaveCount(0);
  await axe(page, "республика");
  await shot(page, "06-republic");
  await page.getByRole("button", { name: "Все районы" }).click();
  await expect(table.getByRole("row", { name: /Белорецкий район/ })).toBeVisible();

  // Сортировка: по ученикам (по убыванию) — Уфа первой; по названию — по алфавиту.
  const firstCell = () => table.locator("tbody tr").first().locator("td").first();
  await expect(firstCell()).toContainText("Уфа");
  await table.getByRole("button", { name: "Район или округ" }).click();
  await expect(table.getByRole("columnheader", { name: "Район или округ" })).toHaveAttribute("aria-sort", "ascending");
  await expect(firstCell()).toContainText("Абзелиловский район");
  await table.getByRole("button", { name: "Уроков за неделю" }).click();
  await expect(table.getByRole("columnheader", { name: "Уроков за неделю" })).toHaveAttribute("aria-sort", "descending");
  await expect(firstCell()).toContainText("Уфа");

  // Диаграмма: другая мера, фокус на столбце — число в строке над диаграммой; таблица по неделям.
  const chart = page.getByRole("region", { name: "По неделям" });
  await expect(chart.getByText("312 уроков")).toBeVisible();
  await chart.getByRole("button", { name: "Занимались" }).click();
  await expect(chart.getByText("занимались 118 учеников")).toBeVisible();
  await chart.getByRole("img", { name: /Неделя 26 окт\. – 1 нояб\.: занимались 152 ученика/ }).focus();
  await expect(chart.getByText("занимались 152 ученика")).toBeVisible();
  await chart.getByText("Числа по неделям").click();
  await expect(chart.getByRole("table")).toContainText("517");
  await axe(page, "республика: таблица по неделям");
});

test("район: школы в той же таблице, «< 5» и «скрыто»; малый район — числа скрыты целиком", async ({ page }) => {
  await mock(page, ministry);
  await page.goto("/republic");
  await page.getByRole("link", { name: "Уфа" }).click();
  await page.waitForURL(`**/republic/${districts[0]!.districtId}`);
  await page.getByRole("heading", { name: "Уфа", level: 1 }).waitFor();
  const table = page.getByRole("table", { name: /Школы района/ });
  await expect(table.locator("tbody tr").first()).toContainText("Лицей № 1");
  await expect(table.getByRole("row", { name: /Школа № 44/ })).toContainText("< 5");
  await expect(table.getByRole("row", { name: /Школа № 158/ })).toContainText("скрыто");
  await expect(page.getByRole("region", { name: "По неделям" })).toBeVisible();
  await axe(page, "район");
  await shot(page, "07-district");
  await page.getByRole("link", { name: "Республика" }).click();
  await page.getByRole("heading", { name: "Республика Башкортостан" }).waitFor();

  await page.goto(`/republic/${districts[3]!.districtId}`);
  await expect(page.getByRole("heading", { name: "В районе меньше 5 учеников" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await axe(page, "малый район");
});

test("словарь для Фонда: пары с голосами по группам, «Предварительно», скачать CSV и JSON; axe", async ({ page }) => {
  await mock(page, fund);
  await page.goto("/");
  await page.waitForURL("**/fund");
  await page.getByRole("heading", { name: "Словарь для Фонда" }).waitFor();
  await expect(page.getByText("Предварительно.")).toBeVisible();
  const row = page.getByRole("row", { name: /Здравствуйте!/ });
  await expect(row).toContainText("Һаумыһығыҙ!");
  await expect(row).toContainText("Дети 14 из 23");
  await expect(row).toContainText("Учителя 1 из 1");
  await expect(row).toContainText("ждёт проверки носителем");
  await expect(row.getByRole("link", { name: /Tatoeba/ })).toHaveAttribute("href", "https://tatoeba.org/ru/sentences/show/2839364");
  await expect(page.getByRole("row", { name: /Рәхмәт, яҡшы/ })).toContainText("второй вариант");
  await axe(page, "словарь");
  await shot(page, "08-fund");

  // Скачивание — из раздела словаря (ниже на странице есть ещё «Спорные случаи»).
  const dict = page.getByRole("region", { name: "Словарь для Фонда" });
  const [csv] = await Promise.all([page.waitForEvent("download"), dict.getByRole("button", { name: "Скачать таблицу (CSV)" }).click()]);
  expect(csv.suggestedFilename()).toBe("teletau-slovar-fond-2026-11-05.csv");
  const text = readFileSync((await csv.path())!, "utf8");
  expect(text.startsWith("\uFEFFРусский исходник;Башкирский вариант;")).toBe(true);
  expect(text).toContain("Здравствуйте!;Һаумыһығыҙ!;словосочетание;да;предварительно;ждёт проверки носителем;14;2;23;3;0;3;1;0;1;04.11.2026;голосование;duel-v0;из источника;");
  expect(text.trim().split("\r\n")).toHaveLength(1 + dictionary.items.length);

  const [file] = await Promise.all([page.waitForEvent("download"), dict.getByRole("button", { name: "Скачать данные (JSON)" }).click()]);
  expect(file.suggestedFilename()).toBe("teletau-slovar-fond-2026-11-05.json");
  const body = JSON.parse(readFileSync((await file.path())!, "utf8")) as Schema<"FundDictionary"> & { note: string };
  expect(body.items).toEqual(dictionary.items);
  // Пояснение — для людей, без терминов разработки (ADR, вехи, названия правил).
  expect(body.note).toMatch(/preliminary/);
  expect(body.note).toMatch(/экспертами/);
  expect(body.note).not.toMatch(/ADR|duel-v0|M4|Consensus Engine/);
});

test("спорные случаи: два варианта с голосами групп и датой последнего голоса, скачать CSV и JSON; axe", async ({ page }) => {
  await mock(page, fund);
  await page.goto("/fund");
  const disputes = page.getByRole("region", { name: "Спорные случаи" });
  await disputes.getByRole("heading", { name: "Спорные случаи" }).waitFor();
  const row = disputes.getByRole("row", { name: /До свидания!/ });
  await expect(row).toContainText("Һау булыгыҙ!");
  await expect(row).toContainText("Күргәнсә!");
  await expect(row).toContainText("вариант 1");
  await expect(row).toContainText("вариант 2");
  await expect(row).toContainText("Дети 7 из 12");
  await expect(row).toContainText("Взрослые 2 из 2");
  await expect(row).toContainText("Учителя 1 из 1");
  await expect(row).toContainText("05.11.2026");
  await axe(page, "спорные случаи");
  await shot(page, "09-fund-escalated");

  const [csv] = await Promise.all([page.waitForEvent("download"), disputes.getByRole("button", { name: "Скачать таблицу (CSV)" }).click()]);
  expect(csv.suggestedFilename()).toBe("teletau-spory-fond-2026-11-05.csv");
  const text = readFileSync((await csv.path())!, "utf8");
  expect(text.startsWith("\uFEFFРусский исходник;Башкирский вариант;")).toBe(true);
  expect(text).toContain("До свидания!;Һау булыгыҙ!;словосочетание;ждёт проверки носителем;из источника;7;1;12;2;0;2;0;0;0;05.11.2026;");
  expect(text).toContain("До свидания!;Күргәнсә!;словосочетание;ждёт проверки носителем;из источника;5;0;12;0;1;2;1;0;1;05.11.2026;");
  expect(text.trim().split("\r\n")).toHaveLength(1 + escalated.items[0]!.variants.length);

  const [file] = await Promise.all([page.waitForEvent("download"), disputes.getByRole("button", { name: "Скачать данные (JSON)" }).click()]);
  expect(file.suggestedFilename()).toBe("teletau-spory-fond-2026-11-05.json");
  const body = JSON.parse(readFileSync((await file.path())!, "utf8")) as Schema<"FundEscalated"> & { note: string };
  expect(body.items).toEqual(escalated.items);
  expect(body.note).toMatch(/разошлись/);
  expect(body.note).toMatch(/носителям/);
  expect(body.note).not.toMatch(/ADR|duel-v0|эскалаци/i);
});

test("шапка: без выбора — светлая, даже в тёмной системе; значок темы переключает светлую и тёмную и запоминает выбор", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mock(page, ministry);
  await page.goto("/");
  await page.waitForURL("**/republic");
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-theme", /./);
  const root = await html.evaluate((el) => {
    const style = getComputedStyle(el);
    return { bg: style.getPropertyValue("--tt-color-bg").trim().toUpperCase(), scheme: style.colorScheme };
  });
  expect(root).toEqual({ bg: tokens.light["color.bg"]!.toUpperCase(), scheme: "light" });
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", tokens.light["color.bg"]!);
  await page.getByRole("button", { name: "Тёмная тема" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Светлая тема" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("словарь и споры пусты — понятные пустые состояния без кнопок скачивания", async ({ page }) => {
  await mock(page, fund, { empty: true });
  await page.goto("/fund");
  await expect(page.getByRole("heading", { name: "Принятых пар пока нет" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Спорных случаев нет" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Скачать таблицу (CSV)" })).toHaveCount(0);
  await axe(page, "пустой словарь");
});

test("доступ по ролям: Фонд не видит «Республику», министерство — словарь и заявки, модератор — новые разделы", async ({ page }) => {
  await mock(page, fund);
  await page.goto("/republic");
  await expect(page.getByRole("heading", { name: "Раздел недоступен" })).toBeVisible();
  await page.getByRole("link", { name: "К своему разделу" }).click();
  await page.waitForURL("**/fund");

  await page.unrouteAll();
  await mock(page, ministry);
  for (const path of ["/fund", "/verifications", "/audit"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Раздел недоступен" })).toBeVisible();
  }
  await axe(page, "раздел недоступен");

  await page.unrouteAll();
  const { requests } = await mock(page, moderator);
  await page.goto("/republic");
  await expect(page.getByRole("heading", { name: "Раздел недоступен" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Заявки учителей" }).first()).toBeVisible();
  expect(requests.filter((p) => p.startsWith("/ministry/"))).toEqual([]);
});
