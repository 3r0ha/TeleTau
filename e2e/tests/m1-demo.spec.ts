// Сценарий демо (docs/demo/M1.md) целиком, против настоящего стека: у каждого участника — свой контекст браузера.
// Учитель (e-mail → 0000 → условия → профиль → заявка) → модератор в консоли (e-mail → 0000 → TOTP) одобряет →
// учитель создаёт класс, выпускает 24 карточки и скачивает PDF → QR из PDF декодируется в полезную нагрузку TT1.… →
// ученик во втором контексте: «У меня есть карточка или код» → «Загрузить фото карточки» → ник (< 30 с),
// секрета нет ни в адресах, ни в истории вкладки → учитель видит его без перезагрузки (≤ 5 с) → вход по коду
// класса: ученик подаёт заявку, учитель закрывает код (код погашен на сервере — новая заявка по нему не
// проходит, поданная осталась) и одобряет → второй учитель открывает чужой класс: «Нет доступа» и 403 API →
// перевыпуск карточки (сессия по старой карточке завершена, старая карточка — понятная ошибка) → отзыв согласия
// (вход блокируется). На ключевых экранах — axe.
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { Schema } from "@teletau/contracts";
import { stack } from "../support/env.js";
import {
  approveTeacher,
  cardPhoto,
  expectAccessible,
  expectCardPayload,
  expectNoCardSecret,
  heading,
  loginModerator,
  registerTeacher,
  resetLoginLimits,
  runId,
  cyrillicTag,
  scanDownload,
  trackUrls,
} from "../support/stack.js";

/** Порог критерия приёмки 2: от экрана входа ученика с карточкой в руках до экрана класса. */
const STUDENT_LOGIN_LIMIT_MS = 30_000;
/** Порог критерия приёмки 3: учитель видит ученика без перезагрузки. */
const TEACHER_SEES_LIMIT_MS = 5_000;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function newPage(browser: Browser): Promise<Page> {
  const s = stack();
  const context = await browser.newContext({ baseURL: s.webUrl, locale: "ru-RU", timezoneId: "Asia/Yekaterinburg" });
  return context.newPage();
}

/** Ники, которые API предложил на этом экране (GET /nicknames/suggest): первый — не из `taken`. */
async function suggestedNickname(page: Page, trigger: () => Promise<unknown>, taken: string[] = []): Promise<string> {
  const response = page.waitForResponse((r) => r.url().includes("/api/v1/nicknames/suggest") && r.ok());
  await trigger();
  const { items } = (await (await response).json()) as Schema<"NicknameSuggestions">;
  const nick = items.map((n) => n.text).find((t) => !taken.includes(t));
  if (!nick) throw new Error("все предложенные ники заняты");
  return nick;
}

test.beforeAll(async () => {
  await resetLoginLimits();
});

test("демо M1 целиком: учитель → модератор → класс и PDF → ученик по QR и по коду → защита", async ({ browser }) => {
  const timings: Record<string, number> = {};
  const RUN = runId();
  const teacher = await newPage(browser);
  const a11y = (page: Page) => (label: string) => expectAccessible(page, label);
  const first = { email: `e2e.teacher.${RUN}@school.example.org`, fullName: `Учитель Сквозной ${cyrillicTag(RUN)}` };
  const second = { email: `e2e.other.${RUN}@school.example.org`, fullName: `Учитель Второй ${cyrillicTag(RUN)}`, school: 2 };

  // ── §1. Учитель регистрируется; второй учитель (для проверки доступа в §6) — тоже, в своём контексте ──
  const verificationId = await test.step("§1 учитель: e-mail → 0000 → условия → профиль → заявка", () => registerTeacher(teacher, first, a11y(teacher)));
  const other = await newPage(browser);
  await test.step("§1 второй учитель подаёт заявку", () => registerTeacher(other, second));

  await test.step("документы открываются страницей веба (LegalDocument.url)", async () => {
    const doc = await newPage(browser);
    await doc.goto("/legal/terms/2026-11-01");
    await expect(heading(doc, "Пользовательское соглашение")).toBeVisible();
    await expect(doc.locator('article [lang="ba"]').first()).toHaveText("ТелеТау");
    await expectAccessible(doc, "условия использования");
    expect((await doc.goto("/legal/terms/1999-01-01"))?.status()).toBe(404);
    await doc.context().close();
  });

  // ── §2. Модератор подтверждает учителя ──
  const moderator = await newPage(browser);
  await test.step("§2 модератор: e-mail → 0000 → TOTP → одобрить обе заявки", async () => {
    await loginModerator(moderator, a11y(moderator));
    await approveTeacher(moderator, first.fullName);
    await approveTeacher(moderator, second.fullName);
  });
  await test.step("§2 в журнале аудита — запись о решении", async () => {
    await moderator.getByRole("link", { name: "Журнал аудита" }).first().click();
    await expect(heading(moderator, "Журнал аудита")).toBeVisible();
    await moderator.getByLabel("Действие").selectOption("teacher_verification.approved");
    await expect(moderator.getByRole("cell", { name: new RegExp(`…${verificationId.slice(-8)}`) })).toBeVisible();
    await expectAccessible(moderator, "консоль: журнал аудита");
  });

  // ── §3. Учитель создаёт класс, выпускает 24 карточки и скачивает PDF ──
  await test.step("§3 после одобрения страница ожидания сама открывает кабинет", async () => {
    await expect(heading(teacher, "Первый урок")).toBeVisible({ timeout: 25_000 });
    await expectAccessible(teacher, "мои классы: пусто");
  });
  const classId = await test.step("§3 создать класс 5 «Б», программа «Родной язык»", async () => {
    await teacher.getByRole("button", { name: "Создать класс" }).first().click();
    const dialog = teacher.getByRole("dialog", { name: "Новый класс" });
    await expect(dialog.getByRole("radio", { name: "Родной язык" })).toBeChecked();
    await dialog.getByLabel("Литера").fill("б");
    await dialog.getByRole("button", { name: "Создать класс" }).click();
    await teacher.waitForURL(/\/teacher\/classes\/[0-9a-f-]{36}$/);
    await expect(heading(teacher, "5 «Б»")).toBeVisible();
    return teacher.url().split("/").pop()!;
  });

  const cards = await test.step("§3 выпустить 24 карточки → «Скачать PDF» → 3 страницы карточек + бланк согласия", async () => {
    await teacher.getByRole("button", { name: "Выпустить карточки" }).first().click();
    const issue = teacher.getByRole("dialog", { name: "Выпустить карточки" });
    await expect(issue.getByLabel("Сколько карточек")).toHaveValue("24");
    await expectAccessible(teacher, "выпуск карточек");
    await issue.getByRole("button", { name: "Выпустить 24 карточки" }).click();
    const ready = teacher.getByRole("dialog", { name: "Карточки готовы" });
    await expect(ready.getByText("Выпущено 24 карточки: №01–№24.")).toBeVisible();
    const [download] = await Promise.all([teacher.waitForEvent("download"), ready.getByRole("button", { name: "Скачать PDF" }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    const pdf = await scanDownload(download);
    expect(pdf.pages).toBe(4);
    expect(pdf.qr.map((page) => page.length)).toEqual([8, 8, 8, 0]);
    const all = pdf.qr.flat();
    for (const payload of all) expectCardPayload(payload);
    expect(new Set(all).size).toBe(24);
    expect(pdf.text[3]).toContain("Согласие родителя");
    // ПДн в PDF нет: ни ФИО и почты учителя, ни автора в метаданных.
    expect(pdf.text.join(" ")).not.toContain(first.fullName);
    expect(pdf.text.join(" ")).not.toContain(first.email);
    expect(pdf.author).toBeUndefined();
    await ready.getByRole("button", { name: "Закрыть" }).click();
    await expect(heading(teacher, "Места")).toBeVisible();
    await expectAccessible(teacher, "страница класса");
    return all;
  });

  // ── §4. Ученик входит по QR-карточке во втором контексте браузера ──
  const student = await newPage(browser);
  const studentUrls = trackUrls(student);
  const card = cards[0]!;
  let nickname = "";
  let seat = "";
  await test.step("§4 ученик: «У меня есть карточка или код» → фото карточки → ник → «Ты в классе» меньше чем за 30 с; секрета нет в адресах и истории", async () => {
    await student.goto("/");
    await student.getByRole("link", { name: "У меня есть карточка или код" }).click();
    await expect(heading(student, "Покажи карточку камере")).toBeVisible();
    const started = Date.now();
    const photo = await cardPhoto(card);
    nickname = await suggestedNickname(student, () => student.getByLabel("Фото карточки").setInputFiles(photo));
    await student.waitForURL("**/student/nickname");
    timings["qrToNicknameMs"] = Date.now() - started;
    expect(student.url(), "секрета карточки нет в адресе").not.toContain("TT1.");
    expect(await student.locator("input:not([type=radio])").count(), "у ребёнка не спрашивают ПДн").toBe(0);
    await student.getByRole("radio", { name: nickname }).check();
    const patched = student.waitForResponse((r) => r.url().endsWith("/api/v1/me") && r.request().method() === "PATCH");
    await student.getByRole("button", { name: "Выбрать" }).click();
    expect((await patched).status()).toBe(200);
    const pickedAt = Date.now();
    await expect(heading(student, "Ты в классе 5 «Б»")).toBeVisible();
    timings["studentLoginMs"] = Date.now() - started;
    expect(timings["studentLoginMs"]).toBeLessThan(STUDENT_LOGIN_LIMIT_MS);

    // §4.3: у учителя строка «№NN · ник» появляется без перезагрузки (опрос раз в 3 с).
    const row = teacher.getByRole("button", { name: new RegExp(`^Место №(\\d{2}): ${escapeRe(nickname)}`) });
    await expect(row).toBeVisible({ timeout: TEACHER_SEES_LIMIT_MS });
    timings["teacherSeesMs"] = Date.now() - pickedAt;
    expect(timings["teacherSeesMs"]).toBeLessThanOrEqual(TEACHER_SEES_LIMIT_MS);
    seat = /Место №(\d{2})/.exec((await row.textContent()) ?? "")![1]!;
    // Экран «Ты в классе»: ник и номер места (вёрстка подписи меняется — проверяем сами значения).
    await expect(student.getByText(nickname).first()).toBeVisible();
    await expect(student.getByText(new RegExp(`Номер ${seat}(?!\\d)`)).first()).toBeVisible();
    await expectAccessible(student, "ученик в классе");
    await expectNoCardSecret(student, studentUrls);
  });

  // ── §5. Вход по коду класса (без карточки) с одобрением учителем ──
  await test.step("§5 код класса на доске → ученик вводит код и ник → учитель закрывает код → «Заявки на вход» → «Принять» → ученик в классе", async () => {
    await teacher.getByRole("button", { name: "Показать код класса" }).click();
    const board = teacher.getByRole("dialog", { name: "Код класса 5 «Б»" });
    const code = board.locator(".board__code span").first();
    await expect(code).toHaveText(/^[0-9A-Z]{3}-[0-9A-Z]{3}$/);
    const display = (await code.textContent())!;
    await expect(board.getByText(/Действует ещё 1[45]:\d\d/)).toBeVisible();
    await expectAccessible(teacher, "код класса на доске");

    // Код действует, пока он на доске: ученик подаёт заявку при открытой доске.
    const kid = await newPage(browser);
    await kid.goto("/student");
    await expect(heading(kid, "Покажи карточку камере")).toBeVisible();
    await expectAccessible(kid, "сканер карточки");
    await kid.getByRole("link", { name: "Ввести код класса" }).click();
    await expect(heading(kid, "Введи код класса")).toBeVisible();
    await kid.getByLabel("Код класса: символ 1 из 6").fill(display.replace("-", ""));
    const kidNick = await suggestedNickname(kid, () => kid.getByRole("button", { name: "Дальше" }).click(), [nickname]);
    await kid.getByRole("radio", { name: kidNick }).check();
    await kid.getByRole("button", { name: "Отправить заявку" }).click();
    await expect(heading(kid, "Ждём учителя")).toBeVisible();
    await expectAccessible(kid, "ожидание подтверждения");

    // «Закрыть код класса» гасит код на сервере (DELETE /classes/{id}/join-code).
    const closed = teacher.waitForResponse((r) => r.request().method() === "DELETE" && r.url().endsWith(`/api/v1/classes/${classId}/join-code`));
    await board.getByRole("button", { name: "Закрыть код класса" }).click();
    expect((await closed).status()).toBe(204);
    await expect(board).toBeHidden();
    await expect(teacher.getByText(/Не удалось закрыть код класса/)).toHaveCount(0);

    // Погашенный код больше не принимается — так же, как неверный или устаревший.
    const late = await newPage(browser);
    await late.goto("/student/code");
    await late.getByLabel("Код класса: символ 1 из 6").fill(display.replace("-", ""));
    await late.getByRole("button", { name: "Дальше" }).click();
    await late.getByRole("radio").first().check();
    const refused = late.waitForResponse((r) => r.url().endsWith("/api/session/class-code"));
    await late.getByRole("button", { name: "Отправить заявку" }).click();
    expect((await refused).status()).toBe(404);
    await expect(late.getByText("Код не подходит. Проверь буквы или попроси новый код.")).toBeVisible();
    await late.context().close();

    // Поданная до гашения заявка осталась у учителя.
    await teacher.getByRole("button", { name: "Посмотреть" }).click();
    const requests = teacher.getByRole("dialog", { name: "Заявки на вход" });
    await requests.getByRole("button", { name: `Принять: ${kidNick}` }).click();
    await expect(teacher.getByText(new RegExp(`${escapeRe(kidNick)} — в классе, место №\\d{2}`))).toBeVisible();
    await requests.getByRole("button", { name: "Закрыть" }).click();
    await expect(heading(kid, "Ты в классе 5 «Б»")).toBeVisible({ timeout: 15_000 });
    await expect(teacher.getByRole("button", { name: new RegExp(`^Место №25: ${escapeRe(kidNick)}.*Без карточки`) })).toBeVisible({
      timeout: TEACHER_SEES_LIMIT_MS,
    });
    await kid.context().close();
  });

  // ── §6.1. Второй учитель открывает класс первого по прямой ссылке ──
  await test.step("§6.1 второй учитель: чужой класс — «Нет доступа» и 403 от API", async () => {
    await expect(heading(other, "Первый урок")).toBeVisible({ timeout: 25_000 });
    const denied = other.waitForResponse((r) => r.url().endsWith(`/api/v1/classes/${classId}`) && r.request().method() === "GET");
    await other.goto(`/teacher/classes/${classId}`);
    expect((await denied).status()).toBe(403);
    await expect(heading(other, "Нет доступа")).toBeVisible();
    await expectAccessible(other, "чужой класс");
    await other.context().close();
  });

  // ── §6.3. Перевыпуск карточки: сессия по старой карточке завершена, старая карточка не работает, новая — вход ──
  const seatDialog = teacher.getByRole("dialog", { name: `Место №${seat}` });
  const fresh = await test.step(`§6.3 перевыпустить карточку №${seat} → ученик вышел, старая карточка — понятная ошибка, новая — вход`, async () => {
    await teacher.getByRole("button", { name: new RegExp(`^Место №${seat}: `) }).click();
    await expect(seatDialog).toBeVisible();
    await expectAccessible(teacher, "диалог места");
    await seatDialog.getByRole("button", { name: "Перевыпустить карточку", exact: true }).click();
    await expect(seatDialog.getByText(/Старая карточка перестанет работать/)).toBeVisible();
    await expect(seatDialog.getByText("Ученик выйдет на всех устройствах")).toBeVisible();
    await seatDialog.getByRole("button", { name: "Перевыпустить карточку", exact: true }).click();
    await expect(teacher.getByText(`Карточка №${seat} перевыпущена`)).toBeVisible();
    const [download] = await Promise.all([teacher.waitForEvent("download"), seatDialog.getByRole("button", { name: "Скачать PDF" }).click()]);
    const pdf = await scanDownload(download);
    const reissued = pdf.qr.flat();
    expect(reissued).toHaveLength(1);
    expectCardPayload(reissued[0]!);
    expect(reissued[0]).not.toBe(card);

    // Кто вошёл по старой карточке, больше не в аккаунте — после перезагрузки обновление сессии отклонено.
    await student.reload();
    await student.waitForURL("**/student");
    await expect(heading(student, "Покажи карточку камере")).toBeVisible();
    await expect(student.getByText("Вход завершён. Войди снова по карточке.")).toBeVisible();

    const old = await newPage(browser);
    await old.goto("/student");
    await old.getByLabel("Фото карточки").setInputFiles(await cardPhoto(card));
    await expect(old.getByText("Эта карточка больше не действует. Возьми у учителя новую.")).toBeVisible();
    await expectAccessible(old, "вход по старой карточке");

    // Тот же ученик по новой карточке — через «Загрузить фото карточки»: ник уже выбран — повторный вход ведёт сразу
    // на тропу («Ты в классе» — только при первом входе); место и ник сохранились.
    const again = await old.context().newPage();
    await again.goto("/student");
    await expect(heading(again, "Покажи карточку камере")).toBeVisible();
    await again.getByLabel("Фото карточки").setInputFiles(await cardPhoto(reissued[0]!));
    await again.waitForURL("**/learn");
    await again.goto("/student/class");
    await expect(heading(again, "Ты в классе 5 «Б»")).toBeVisible();
    await expect(again.getByText(nickname).first()).toBeVisible();
    await expect(again.getByText(new RegExp(`Номер ${seat}(?!\\d)`)).first()).toBeVisible();
    return { payload: reissued[0]!, page: again };
  });

  // ── §6.4. Отзыв бумажного согласия: вход по карточке блокируется, текущая сессия ученика завершается ──
  await test.step(`§6.4 отметить и отозвать бумажное согласие места №${seat} → вход по карточке закрыт`, async () => {
    await seatDialog.getByRole("button", { name: "Отметить согласие родителя" }).click();
    await expect(teacher.getByText(`Согласие №${seat} отмечено`)).toBeVisible();
    await seatDialog.getByRole("button", { name: "Отозвать согласие", exact: true }).click();
    // Вход закрывается на место (и по карточке, и по коду класса), ученик выходит на всех устройствах.
    await expect(seatDialog.getByText(new RegExp(`Вход на место будет закрыт, ученик выйдет на всех устройствах`))).toBeVisible();
    await seatDialog.getByRole("button", { name: "Отозвать согласие", exact: true }).click();
    await expect(teacher.getByText(`Согласие №${seat} отозвано`)).toBeVisible();
    await expect(seatDialog.getByText(/^Отозвано/)).toBeVisible();

    await fresh.page.reload();
    await fresh.page.waitForURL("**/student");
    await fresh.page.context().close();

    const blocked = await newPage(browser);
    await blocked.goto("/student");
    await blocked.getByLabel("Фото карточки").setInputFiles(await cardPhoto(fresh.payload));
    await expect(blocked.getByText("Вход по этой карточке закрыт. Подойди к учителю.")).toBeVisible();
    await blocked.context().close();
  });

  for (const page of [teacher, moderator, student]) await page.context().close();

  const sec = (ms: number | undefined) => ((ms ?? NaN) / 1000).toFixed(2);
  console.log(
    `e2e: вход ученика по QR (фото карточки → «Ты в классе») — ${sec(timings["studentLoginMs"])} с, из них до выбора ника — ` +
      `${sec(timings["qrToNicknameMs"])} с (порог 30 с); учитель увидел ученика через ${sec(timings["teacherSeesMs"])} с (порог 5 с)`,
  );
  test.info().annotations.push({ type: "timings", description: JSON.stringify(timings) });
  await test.info().attach("timings.json", { body: JSON.stringify(timings, null, 2), contentType: "application/json" });
});
