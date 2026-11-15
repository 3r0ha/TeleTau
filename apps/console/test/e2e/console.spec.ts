// Консоль: вход сотрудника (e-mail → код → TOTP), очередь заявок учителей, журнал аудита — axe и основные действия.
// API и BFF сессии — сетевые моки по контракту; сквозные тесты с настоящим API — в e2e/.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Problem, Schema } from "@teletau/contracts";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, accept", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-expose-headers": "retry-after" };
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

const moderator: Schema<"Me"> = { id: "0193f7a4-0000-7000-8000-0000000m0001", kind: "staff", roles: ["moderator"], locale: "ru", teacherStatus: "none", classes: [], pendingConsents: [], profile: { email: "moderator@teletau.example" } };

const school: Schema<"SchoolRef"> = { id: "0193f7a4-0000-7000-8000-00000000a001", shortNameRu: "Школа № 7", districtId: "0193f7a4-0000-7000-8000-00000000d001" };
const verifications = (): Schema<"TeacherVerification">[] => [
  { id: "0193f7a4-0000-7000-8000-0000000v0001", status: "pending", applicant: { accountId: "0193f7a4-0000-7000-8000-0000000a0001", email: "teacher@school7.example", fullName: "Учитель Демонстрационный" }, school, position: "Учитель башкирского языка", createdAt: "2026-11-03T04:12:00Z" },
  { id: "0193f7a4-0000-7000-8000-0000000v0002", status: "pending", applicant: { accountId: "0193f7a4-0000-7000-8000-0000000a0002", email: "second@school3.example", fullName: "Второй Учитель Тестовый" }, school: { ...school, shortNameRu: "Демонстрационная школа", isDemo: true }, position: "Учитель родного языка", createdAt: "2026-11-03T05:40:00Z" },
];
/** Длинная очередь: n заявок «на проверке» после двух основных; ФИО одной длины — имя не входит в другое. */
const queueOf = (n: number): Schema<"TeacherVerification">[] =>
  Array.from({ length: n }, (_, i) => {
    const no = String(i + 1).padStart(3, "0");
    return {
      id: `0193f7a4-0000-7000-8000-${(0x10000 + i).toString(16).padStart(12, "0")}`,
      status: "pending",
      applicant: { accountId: `0193f7a4-0000-7000-8000-${(0x20000 + i).toString(16).padStart(12, "0")}`, email: `queue${no}@school.example`, fullName: `Учитель Очереди ${no}` },
      school,
      position: "Учитель башкирского языка",
      createdAt: new Date(Date.parse("2026-11-03T06:00:00Z") + i * 60_000).toISOString(),
    };
  });
const audit: Schema<"AuditEntry">[] = [
  { id: "0193f7a4-0000-7000-8000-0000000l0001", at: "2026-11-03T06:01:00Z", action: "teacher_verification.approved", actor: { accountId: moderator.id, kind: "staff", roles: ["moderator"] }, target: { type: "teacher_verification", id: "0193f7a4-0000-7000-8000-0000000v0003" } },
  { id: "0193f7a4-0000-7000-8000-0000000l0002", at: "2026-11-03T05:58:00Z", action: "card.issued", actor: { accountId: "0193f7a4-0000-7000-8000-0000000a0001", kind: "adult", roles: ["teacher"] }, target: { type: "class", id: "0193f7a4-0000-7000-8000-00000000c005" }, metadata: { count: 24, seats: "1-24" } },
  { id: "0193f7a4-0000-7000-8000-0000000l0003", at: "2026-11-03T05:50:00Z", action: "session.refresh_reuse_detected", target: { type: "session", id: "0193f7a4-0000-7000-8000-0000000z0001" }, metadata: { reason: "refresh_reuse" } },
  { id: "0193f7a4-0000-7000-8000-0000000l0004", at: "2026-11-03T05:45:00Z", action: "staff.login", actor: { accountId: moderator.id, kind: "staff", roles: ["moderator"] } },
];

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
const problem = (route: Route, status: number, code: string) =>
  route.fulfill({ status, headers: { ...CORS, "content-type": "application/problem+json" }, body: JSON.stringify({ type: "about:blank", title: "Ошибка", status, code } satisfies Problem) });

type Failure = "offline" | { status: number; code: string };

/**
 * Моки BFF и API. extraPending — ещё столько заявок в очереди (страницы по limit, курсор — смещение);
 * slowPagesMs — задержка ответа на «Показать ещё»; failures — сбой операции «МЕТОД /путь» (без /api/v1).
 */
async function mock(
  page: Page,
  opts: { loggedIn?: boolean; extraPending?: number; slowPagesMs?: number; pageSize?: number; keyset?: boolean; failures?: Record<string, Failure>; audit?: Schema<"AuditEntry">[] } = {},
) {
  const log = opts.audit ?? audit;
  let account: Schema<"Me"> | null = opts.loggedIn ? moderator : null;
  let queue = [...verifications(), ...queueOf(opts.extraPending ?? 0)];
  const decisions: string[] = [];
  /** Запросы очереди: курсор каждого (первая страница — "first") и запросы журнала аудита. */
  const queueRequests: string[] = [];
  const auditRequests: string[] = [];
  const failures = opts.failures ?? {};
  await page.route("**/api/session/*", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").pop();
    const session = () => ({ accessToken: "test-access", accessTokenExpiresAt: inMinutes(15), account });
    if (action === "refresh") return account ? json(route, 200, session()) : problem(route, 401, "refresh_invalid");
    if (action === "logout") return (account = null), route.fulfill({ status: 204 });
    if (action === "otp") {
      const failure = failures["BFF otp"];
      if (failure === "offline") return route.abort("internetdisconnected");
      if (failure) return problem(route, failure.status, failure.code);
      const body = route.request().postDataJSON() as { code: string; totp?: string };
      if (body.code !== "0000") return problem(route, 401, "otp_invalid");
      if (body.totp !== "123456") return problem(route, 401, body.totp ? "totp_invalid" : "totp_required");
      account = moderator;
      return json(route, 200, session());
    }
    return problem(route, 404, "not_found");
  });
  await page.route(`${API}/api/v1/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const path = url.pathname.replace("/api/v1", "");
    const failure = failures[`${req.method()} ${path}`];
    if (failure === "offline") return route.abort("internetdisconnected");
    if (failure) return problem(route, failure.status, failure.code);
    if (path === "/auth/otp/request") return json(route, 202, { challengeId: "0193f7a4-0000-7000-8000-0000000o0001", expiresAt: inMinutes(10), resendAfterSeconds: 30, codeLength: 4 });
    if (path === "/moderation/teacher-verifications") {
      const status = url.searchParams.get("status") ?? "pending";
      const limit = opts.pageSize ?? Number(url.searchParams.get("limit") ?? 50);
      const cursor = url.searchParams.get("cursor");
      queueRequests.push(cursor ?? "first");
      const all = queue.filter((v) => v.status === status);
      if (cursor && opts.slowPagesMs) await new Promise((r) => setTimeout(r, opts.slowPagesMs));
      if (opts.keyset) {
        // Курсор — последняя показанная заявка (как у API): решения на прежних страницах не сдвигают следующие.
        const after = cursor ? queue.findIndex((x) => x.id === cursor.replace("after-", "")) : -1;
        const rest = all.filter((v) => queue.indexOf(v) > after);
        const items = rest.slice(0, limit);
        return json(route, 200, { items, ...(rest.length > limit ? { nextCursor: `after-${items[items.length - 1]!.id}` } : {}) });
      }
      const start = cursor ? Number(cursor.replace("offset-", "")) : 0;
      const next = start + limit < all.length ? `offset-${start + limit}` : undefined;
      return json(route, 200, { items: all.slice(start, start + limit), ...(next ? { nextCursor: next } : {}) });
    }
    const m = /^\/moderation\/teacher-verifications\/([^/]+)\/(approve|reject)$/.exec(path);
    if (m) {
      const v = queue.find((x) => x.id === m[1])!;
      decisions.push(`${m[2]}:${m[1]}`);
      queue = queue.map((x) => (x.id === m[1] ? { ...x, status: m[2] === "approve" ? "approved" : "rejected" } : x));
      return json(route, 200, { ...v, status: m[2] === "approve" ? "approved" : "rejected" });
    }
    if (path === "/admin/audit-log") {
      const action = url.searchParams.get("action");
      auditRequests.push(url.searchParams.get("cursor") ?? "first");
      if (url.searchParams.get("cursor") && opts.slowPagesMs) await new Promise((r) => setTimeout(r, opts.slowPagesMs));
      return json(route, 200, { items: log.filter((e) => !action || e.action === action), ...(url.searchParams.get("cursor") ? {} : { nextCursor: "page-2" }) });
    }
    return problem(route, 404, "not_found");
  });
  return { decisions, queueRequests, auditRequests };
}

async function axe(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

const SHOTS = process.env.TELETAU_SCREENS ? (process.env.TELETAU_SCREENS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../web/test/screens")) : null;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 860 });
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${SHOTS}/console-${name}-${width}.png` });
  }
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("вход сотрудника: e-mail → код 0000 → TOTP → очередь; axe на каждом шаге", async ({ page }) => {
  await mock(page);
  await page.goto("/verifications");
  await page.waitForURL("**/login");
  await page.getByRole("heading", { name: "Вход сотрудника" }).waitFor();
  await axe(page, "почта");
  await shot(page, "01-login");
  await page.getByLabel("Рабочая почта").fill("moderator@teletau.example");
  await page.getByRole("button", { name: "Получить код" }).click();
  await expect(page.getByText("Демо: код")).toBeVisible();
  await axe(page, "код из письма");
  await page.keyboard.type("0000");
  await page.getByRole("heading", { name: "Код из приложения" }).waitFor();
  await axe(page, "TOTP");
  await shot(page, "02-totp");
  await page.keyboard.type("000000");
  await expect(page.getByText("Неверный код из приложения-аутентификатора")).toBeVisible();
  await page.keyboard.type("123456");
  await page.getByRole("heading", { name: "Заявки учителей" }).waitFor();
});

test("очередь заявок: одобрить и отклонить с причиной", async ({ page }) => {
  const { decisions } = await mock(page, { loggedIn: true });
  await page.goto("/verifications");
  await page.getByText("teacher@school7.example").waitFor();
  await axe(page, "очередь");
  await shot(page, "03-queue");
  await page.getByRole("button", { name: "Одобрить: Учитель Демонстрационный" }).click();
  await expect(page.getByText("teacher@school7.example")).toBeHidden();
  await page.getByRole("button", { name: "Отклонить: Второй Учитель Тестовый" }).click();
  const dialog = page.getByRole("dialog", { name: "Отклонить заявку" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Отклонить заявку" }).click();
  await expect(dialog.getByText("Напишите причину")).toBeVisible();
  await axe(page, "диалог отказа");
  await shot(page, "04-reject");
  await dialog.getByLabel("Причина отказа").fill("Школа не совпадает с местом работы");
  await dialog.getByRole("button", { name: "Отклонить заявку" }).click();
  await expect(page.getByText("Очередь пуста")).toBeVisible();
  expect(decisions).toEqual(["approve:0193f7a4-0000-7000-8000-0000000v0001", "reject:0193f7a4-0000-7000-8000-0000000v0002"]);
});

test("журнал аудита: фильтр по действию и страницы", async ({ page }) => {
  await mock(page, { loggedIn: true });
  await page.goto("/audit");
  await page.getByRole("cell", { name: /Заявка учителя одобрена/ }).waitFor();
  await axe(page, "журнал");
  await shot(page, "05-audit");
  await page.getByLabel("Действие").selectOption("card.issued");
  await expect(page.getByRole("cell", { name: /Выпуск карточек/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Заявка учителя одобрена/ })).toBeHidden();
  await page.getByRole("button", { name: "Более ранние" }).click();
  await expect(page.getByText("Страница 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Более новые" }).click();
  await expect(page.getByText("Страница 1", { exact: true })).toBeVisible();
});

test("переключатель статусов: выбранный — сплошная граница (≥ 3:1), не только бледная подложка", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await mock(page, { loggedIn: true });
  await page.goto("/verifications");
  await page.getByText("teacher@school7.example").waitFor();
  const pressed = page.getByRole("button", { name: "На проверке" });
  await expect(pressed).toHaveAttribute("aria-pressed", "true");
  const [on, off] = await Promise.all([
    pressed.evaluate((el) => getComputedStyle(el).borderTopColor),
    page.getByRole("button", { name: "Одобренные" }).evaluate((el) => getComputedStyle(el).borderTopColor),
  ]);
  const accentText = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tt-color-accent-text").trim().toLowerCase());
  const hex = (rgb: string) => "#" + (rgb.match(/\d+/g) ?? []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  expect(hex(on)).toBe(accentText);
  expect(off).not.toBe(on);
});

test("заголовки безопасности: CSP с nonce, камера запрещена, встраивание запрещено; заголовок вкладки у раздела", async ({ page, request }) => {
  const res = await request.get("/login");
  const h = res.headers();
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).not.toContain("unsafe-inline");
  expect(h["permissions-policy"]).toMatch(/^camera=\(\)/);
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(await res.text()).not.toMatch(/\sstyle="/);

  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await mock(page, { loggedIn: true });
  await page.goto("/audit");
  await page.getByRole("cell", { name: /Заявка учителя одобрена/ }).waitFor();
  await expect(page).toHaveTitle("Журнал аудита · Консоль ТелеТау");
  await page.goto("/verifications");
  await page.getByText("teacher@school7.example").waitFor();
  await expect(page).toHaveTitle("Заявки учителей · Консоль ТелеТау");
  expect(violations).toEqual([]);
});

test.describe("ошибка проверки — фокус на неверном поле, ошибка в его описании", () => {
  test("вход сотрудника: неверный адрес почты", async ({ page }) => {
    await mock(page);
    await page.goto("/login");
    const email = page.getByLabel("Рабочая почта");
    await email.fill("moderator");
    await page.getByRole("button", { name: "Получить код" }).click();
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(email).toHaveAccessibleDescription(/Проверьте адрес почты/);
  });

  test("отказ модератора: пустая причина", async ({ page }) => {
    await mock(page, { loggedIn: true });
    await page.goto("/verifications");
    await page.getByRole("button", { name: "Отклонить: Второй Учитель Тестовый" }).click();
    const dialog = page.getByRole("dialog", { name: "Отклонить заявку" });
    await dialog.getByRole("button", { name: "Отклонить заявку" }).click();
    const reason = dialog.getByLabel("Причина отказа");
    await expect(reason).toBeFocused();
    await expect(reason).toHaveAttribute("aria-invalid", "true");
    await expect(reason).toHaveAccessibleDescription(/Напишите причину/);
  });
});

test("«Назад» при открытом диалоге отказа закрывает диалог, страница остаётся", async ({ page }) => {
  await mock(page, { loggedIn: true });
  await page.goto("/verifications");
  await page.getByText("teacher@school7.example").waitFor();
  const url = page.url();
  await page.getByRole("button", { name: "Отклонить: Второй Учитель Тестовый" }).click();
  const dialog = page.getByRole("dialog", { name: "Отклонить заявку" });
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(dialog).toBeHidden();
  expect(page.url()).toBe(url);
  await expect(page.getByRole("heading", { name: "Заявки учителей" })).toBeVisible();
});

test("журнал аудита — роли по-русски, не кодами", async ({ page }) => {
  await mock(page, { loggedIn: true });
  await page.goto("/audit");
  await page.getByRole("cell", { name: /Заявка учителя одобрена/ }).waitFor();
  await expect(page.getByRole("cell", { name: /сотрудник, модератор/ }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: /взрослый, учитель/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /moderator|teacher\b/ })).toHaveCount(0);
});

test.describe("«Показать ещё» и страницы журнала — один запрос за раз, без дублей", () => {
  const ids = (page: Page) => page.locator("tbody tr").evaluateAll((rows) => rows.map((r) => r.querySelector("td b")?.textContent ?? ""));

  test("очередь из 72 заявок: двойной щелчок по «Показать ещё» — один запрос страницы, строк ровно 72, дублей нет", async ({ page }) => {
    const { queueRequests } = await mock(page, { loggedIn: true, extraPending: 70, slowPagesMs: 400 });
    await page.goto("/verifications");
    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(50);
    const more = page.getByRole("button", { name: "Показать ещё" });
    await more.dblclick();
    // Пока страница грузится, кнопка в состоянии загрузки и фокус остаётся на ней.
    await expect(more).toHaveAttribute("aria-busy", "true");
    await expect(more).toBeFocused();
    await expect(more).toHaveCount(0);
    await expect(rows).toHaveCount(72);
    // Второй ответ (если бы ушёл) пришёл бы за это время.
    await page.waitForTimeout(800);
    await expect(rows).toHaveCount(72);
    const names = await ids(page);
    expect(new Set(names).size).toBe(names.length);
    expect(queueRequests).toEqual(["first", "offset-50"]);
  });

  test("очередь: последнюю заявку можно найти и одобрить после нескольких страниц", async ({ page }) => {
    const { queueRequests, decisions } = await mock(page, { loggedIn: true, extraPending: 140 });
    await page.goto("/verifications");
    const more = page.getByRole("button", { name: "Показать ещё" });
    for (const expected of [100, 142]) {
      await more.click();
      await expect(page.locator("tbody tr")).toHaveCount(expected);
    }
    await expect(more).toHaveCount(0);
    await page.getByRole("button", { name: "Одобрить: Учитель Очереди 140" }).click();
    await expect(page.getByText("Заявка одобрена: Учитель Очереди 140")).toBeVisible();
    expect(queueRequests).toEqual(["first", "offset-50", "offset-100"]);
    expect(decisions).toEqual([`approve:${queueOf(140)[139]!.id}`]);
  });

  test("журнал аудита: двойной щелчок по «Более ранние» — страница 2, а не 3", async ({ page }) => {
    const { auditRequests } = await mock(page, { loggedIn: true, slowPagesMs: 400 });
    await page.goto("/audit");
    await page.getByRole("cell", { name: /Заявка учителя одобрена/ }).waitFor();
    await page.getByRole("button", { name: "Более ранние" }).dblclick();
    await expect(page.getByText("Страница 2", { exact: true })).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.getByText("Страница 2", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Более ранние" })).toBeDisabled();
    expect(auditRequests).toEqual(["first", "page-2"]);
  });
});

test.describe("сбой сервера или сети — сообщение, а не ошибка верного поля", () => {
  for (const [label, failure] of [
    ["500", { status: 500, code: "internal" }],
    ["обрыв сети", "offline"],
  ] as const) {
    test(`вход сотрудника, почта: ${label} — у поля нет aria-invalid, текст в role="alert", фокус не на поле`, async ({ page }) => {
      await mock(page, { failures: { "POST /auth/otp/request": failure } });
      await page.goto("/login");
      const email = page.getByLabel("Рабочая почта");
      await email.fill("moderator@teletau.example");
      await page.getByRole("button", { name: "Получить код" }).click();
      await expect(page.getByRole("alert").filter({ hasText: label === "500" ? "Что-то пошло не так" : "Нет связи. Проверьте интернет" })).toBeVisible();
      await expect(email).not.toHaveAttribute("aria-invalid", "true");
      await expect(email).not.toBeFocused();
    });

    test(`вход сотрудника, код из приложения: ${label} — ячейки кода не помечены неверными`, async ({ page }) => {
      await mock(page, { failures: { "BFF otp": failure } });
      await page.goto("/login");
      await page.getByLabel("Рабочая почта").fill("moderator@teletau.example");
      await page.getByRole("button", { name: "Получить код" }).click();
      await page.getByRole("heading", { name: "Код из письма" }).waitFor();
      await page.keyboard.type("0000");
      await page.getByRole("heading", { name: "Код из приложения" }).waitFor();
      await page.keyboard.type("123456");
      await expect(page.getByRole("alert").filter({ hasText: label === "500" ? "Что-то пошло не так" : "Нет связи. Проверьте интернет" })).toBeVisible();
      await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
    });
  }

  test("отказ модератора: 500 — причина не помечена неверной, сообщение в диалоге", async ({ page }) => {
    await mock(page, { loggedIn: true, failures: { "POST /moderation/teacher-verifications/0193f7a4-0000-7000-8000-0000000v0002/reject": { status: 500, code: "internal" } } });
    await page.goto("/verifications");
    await page.getByRole("button", { name: "Отклонить: Второй Учитель Тестовый" }).click();
    const dialog = page.getByRole("dialog", { name: "Отклонить заявку" });
    const reason = dialog.getByLabel("Причина отказа");
    await reason.fill("Школа не совпадает с местом работы");
    await dialog.getByRole("button", { name: "Отклонить заявку" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "Что-то пошло не так" })).toBeVisible();
    await expect(reason).not.toHaveAttribute("aria-invalid", "true");
  });
});

test("журнал аудита: учитель погасил код класса — подпись по-русски и пункт фильтра", async ({ page }) => {
  const closed: Schema<"AuditEntry"> = {
    id: "0193f7a4-0000-7000-8000-0000000l0009",
    at: "2026-11-03T06:10:00Z",
    action: "class.join_code_closed",
    actor: { accountId: "0193f7a4-0000-7000-8000-0000000a0001", kind: "adult", roles: ["teacher"] },
    target: { type: "class", id: "0193f7a4-0000-7000-8000-00000000c005" },
  };
  await mock(page, { loggedIn: true, audit: [closed] });
  await page.goto("/audit");
  await expect(page.getByRole("cell", { name: /Код класса погашен/ })).toBeVisible();
  await page.getByLabel("Действие").selectOption({ label: "Код класса погашен" });
  await expect(page.getByLabel("Действие")).toHaveValue("class.join_code_closed");
  await expect(page.getByRole("cell", { name: /Код класса погашен/ })).toBeVisible();
});

test.describe("вход сотрудника: ошибки по шагам", () => {
  /** Та же сборка с демо-входом без TOTP: «почта → код» (playwright.config.ts, второй сервер). */
  const noTotp = `http://localhost:${Number(process.env.E2E_WEB_PORT ?? 3155) + 1}`;

  for (const [label, failure, text] of [
    ["500", { status: 500, code: "internal" }, "Что-то пошло не так"],
    ["обрыв сети", "offline", "Нет связи. Проверьте интернет"],
    ["лимит попыток", { status: 429, code: "rate_limited" }, "Слишком много попыток"],
  ] as const) {
    test(`без TOTP: сбой входа на шаге кода (${label}) — сообщение видно на этом шаге`, async ({ page }) => {
      await mock(page, { failures: { "BFF otp": failure } });
      await page.goto(`${noTotp}/login`);
      await page.getByLabel("Рабочая почта").fill("moderator@teletau.example");
      await page.getByRole("button", { name: "Получить код" }).click();
      await page.getByRole("heading", { name: "Код из письма" }).waitFor();
      await page.keyboard.type("0000");
      await expect(page.getByRole("alert").filter({ hasText: text })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Код из письма" })).toBeVisible();
      await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
    });
  }

  test("«Изменить адрес» и «Назад к коду из письма» не переносят ошибку прежнего шага", async ({ page }) => {
    await mock(page);
    await page.goto("/login");
    await page.getByLabel("Рабочая почта").fill("moderator@teletau.example");
    await page.getByRole("button", { name: "Получить код" }).click();
    await page.getByRole("heading", { name: "Код из письма" }).waitFor();
    await page.keyboard.type("0000");
    await page.getByRole("heading", { name: "Код из приложения" }).waitFor();
    await page.keyboard.type("000000");
    await expect(page.getByText("Неверный код из приложения-аутентификатора")).toBeVisible();
    await page.getByRole("button", { name: "Назад к коду из письма" }).click();
    await page.getByRole("heading", { name: "Код из письма" }).waitFor();
    await expect(page.getByText("Неверный код из приложения-аутентификатора")).toHaveCount(0);
    await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);

    await page.getByRole("button", { name: "Изменить адрес" }).click();
    const email = page.getByLabel("Рабочая почта");
    await expect(email).toBeVisible();
    await expect(email).not.toHaveAttribute("aria-invalid", "true");
  });
});

test.describe("очередь заявок: решения по страницам", () => {
  test("решена вся первая страница, а заявки ещё есть — следующая страница сама, не «Очередь пуста»", async ({ page }) => {
    await mock(page, { loggedIn: true, extraPending: 1, pageSize: 2, keyset: true });
    await page.goto("/verifications");
    await page.getByText("teacher@school7.example").waitFor();
    await page.getByRole("button", { name: "Одобрить: Учитель Демонстрационный" }).click();
    await expect(page.getByText("teacher@school7.example")).toBeHidden();
    // Нажатая кнопка ушла вместе со строкой — фокус на кнопке следующей заявки, а не на начале страницы.
    await expect(page.getByRole("button", { name: "Одобрить: Второй Учитель Тестовый" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("queue001@school.example")).toBeVisible();
    await expect(page.getByText("Очередь пуста")).toHaveCount(0);
    await page.getByRole("button", { name: "Одобрить: Учитель Очереди 001" }).click();
    await expect(page.getByText("Очередь пуста")).toBeVisible();
  });
});

test("журнал аудита: листание с клавиатуры — фокус остаётся в кнопках страниц", async ({ page }) => {
  await mock(page, { loggedIn: true, slowPagesMs: 300 });
  await page.goto("/audit");
  await page.getByRole("cell", { name: /Заявка учителя одобрена/ }).waitFor();
  const older = page.getByRole("button", { name: "Более ранние" });
  await older.focus();
  await page.keyboard.press("Enter");
  // Пока грузится страница 2, нажатая кнопка в загрузке и с фокусом.
  await expect(older).toHaveAttribute("aria-busy", "true");
  await expect(older).toBeFocused();
  // Страница 2 последняя: «Более ранние» недоступна — фокус на «Более новые».
  await expect(older).toBeDisabled();
  await expect(page.getByRole("button", { name: "Более новые" })).toBeFocused();
});

test("телефон 390: статусы заявок — один ряд, «На проверке» в одну строку", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page, { loggedIn: true });
  await page.goto("/verifications");
  await page.getByText("teacher@school7.example").waitFor();
  const group = page.getByRole("group", { name: "Статус заявок" });
  const boxes = await group.getByRole("button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: Math.round(r.top), h: r.height })));
  expect(new Set(boxes.map((b) => b.top)).size).toBe(1);
  const pending = group.getByRole("button", { name: "На проверке" });
  const lines = await pending.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
  });
  expect(lines).toBe(1);
});
