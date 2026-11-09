// Пошаговые сценарии и навигация: «Назад» браузера возвращает на предыдущий шаг
// без потери введённого, у каждой страницы и шага свой заголовок вкладки, фокус переходит на заголовок шага, на
// экранах-тупиках есть выход.
import { expect, test, type Page } from "@playwright/test";
import { CLASS_ID, adultMe, childMe, mockBackend } from "./mock-api";

const activeHeading = (page: Page) => page.evaluate(() => (document.activeElement?.tagName === "H1" ? document.activeElement.textContent : null));

test.describe("M1-14/M1-15: код класса → ник", () => {
  test("шаг в адресе; «Назад» браузера возвращает к коду, код сохранён; заголовок и фокус следуют за шагом", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/student");
    await page.getByRole("link", { name: "Ввести код класса" }).click();
    await expect(page.getByRole("heading", { name: "Введи код класса" })).toBeVisible();
    await expect(page).toHaveTitle("Код класса · ТелеТау");

    await page.getByLabel("Код класса: символ 1 из 6").fill("K7Q4MZ");
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page).toHaveURL(/\/student\/code\?step=nick$/);
    await expect(page.getByRole("heading", { name: "Выбери ник" })).toBeVisible();
    await expect(page).toHaveTitle("Выбери ник · ТелеТау");
    await expect.poll(() => activeHeading(page)).toBe("Выбери ник");

    await page.goBack();
    await expect(page).toHaveURL(/\/student\/code$/);
    await expect(page.getByRole("heading", { name: "Введи код класса" })).toBeVisible();
    await expect(page.getByLabel("Код класса: символ 6 из 6")).toHaveValue("Z");
    await expect(page).toHaveTitle("Код класса · ТелеТау");

    // Вперёд — снова шаг ника; стрелка «Назад» экрана — та же запись истории, что и у браузера.
    await page.goForward();
    await expect(page.getByRole("heading", { name: "Выбери ник" })).toBeVisible();
    await page.getByRole("button", { name: "Назад к коду" }).click();
    await expect(page).toHaveURL(/\/student\/code$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/student$/);
  });

  test("стрелка «Назад» стоит на одном месте на обоих шагах (верхняя панель)", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/student/code");
    const back = page.locator(".tt-topbar__inner > :first-child");
    const before = await back.boundingBox();
    await page.getByLabel("Код класса: символ 1 из 6").fill("K7Q4MZ");
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page.getByRole("button", { name: "Назад к коду" })).toBeVisible();
    const after = await page.getByRole("button", { name: "Назад к коду" }).boundingBox();
    expect(after).toEqual(before);
  });

  test("открытый напрямую шаг ника без кода — возврат к вводу кода", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/student/code?step=nick");
    await expect(page.getByRole("heading", { name: "Введи код класса" })).toBeVisible();
    await expect(page).toHaveURL(/\/student\/code$/);
  });
});

test.describe("M1-14/M1-15: заявка учителя", () => {
  test("«Назад» браузера между шагами не стирает введённое; черновик переживает перезагрузку", async ({ page }) => {
    await mockBackend(page, { account: adultMe({ teacherStatus: "none", roles: [], classes: [], profile: { email: "teacher@school7.example" } }) });
    await page.goto("/teacher/apply");
    await expect(page.getByRole("heading", { name: "Расскажите о себе" })).toBeVisible();
    await expect(page).toHaveTitle("Расскажите о себе · ТелеТау");
    await page.getByLabel("Фамилия, имя, отчество").fill("Учитель Демонстрационный");
    await page.getByLabel("Должность").fill("Учитель башкирского языка");
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page).toHaveURL(/step=2$/);
    await expect(page).toHaveTitle("Выберите район · ТелеТау");
    await expect.poll(() => activeHeading(page)).toBe("Выберите район");
    await page.getByRole("radio", { name: /Уфа/ }).check();
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page).toHaveURL(/step=3$/);
    await expect(page.getByRole("heading", { name: "Выберите школу" })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole("heading", { name: "Выберите район" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Уфа/ })).toBeChecked();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Выберите район" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Уфа/ })).toBeChecked();

    await page.goBack();
    await expect(page.getByRole("heading", { name: "Расскажите о себе" })).toBeVisible();
    await expect(page.getByLabel("Фамилия, имя, отчество")).toHaveValue("Учитель Демонстрационный");
    await expect(page.getByLabel("Должность")).toHaveValue("Учитель башкирского языка");
  });

  test("шаг из адреса без заполненного профиля — на первый шаг", async ({ page }) => {
    await mockBackend(page, { account: adultMe({ teacherStatus: "none", roles: [], classes: [] }) });
    await page.goto("/teacher/apply?step=3");
    await expect(page.getByRole("heading", { name: "Расскажите о себе" })).toBeVisible();
  });
});

test.describe("M1-15: у каждой страницы свой заголовок вкладки", () => {
  test("заголовки различаются и описывают страницу", async ({ page }) => {
    const titles = new Map<string, string>();
    const open = async (path: string, account: Parameters<typeof mockBackend>[1]) => {
      const ctx = await page.context().newPage();
      await mockBackend(ctx, account);
      await ctx.goto(path);
      await ctx.locator("h1").first().waitFor();
      await ctx.waitForLoadState("networkidle");
      titles.set(path, await ctx.title());
      await ctx.close();
    };
    await open("/", {});
    await open("/student", {});
    await open("/student/code", {});
    await open("/q", {});
    await open("/teacher/login", {});
    await open("/student/nickname", { account: childMe({ nickname: undefined }) });
    await open("/student/class", { account: childMe() });
    await open("/teacher", { account: adultMe() });
    await open("/teacher/profile", { account: adultMe() });
    await open(`/teacher/classes/${CLASS_ID}`, { account: adultMe() });
    await open("/teacher/pending", { account: adultMe({ teacherStatus: "pending", roles: [], classes: [] }) });
    expect(Object.fromEntries(titles)).toEqual({
      "/": "ТелеТау — Башкирская языковая школа",
      "/student": "Вход ученика · ТелеТау",
      "/student/code": "Код класса · ТелеТау",
      "/q": "Вход по карточке · ТелеТау",
      "/teacher/login": "Вход для учителя · ТелеТау",
      "/student/nickname": "Выбери ник · ТелеТау",
      "/student/class": "Мой класс · ТелеТау",
      "/teacher": "Мои классы · ТелеТау",
      "/teacher/profile": "Профиль · ТелеТау",
      [`/teacher/classes/${CLASS_ID}`]: "5 «Б» · ТелеТау",
      "/teacher/pending": "Заявка на проверке · ТелеТау",
    });
  });
});

test.describe("M1-13: выход с экранов-тупиков", () => {
  test("выбор ника: «Это не моя карточка» — выход", async ({ page }) => {
    const w = await mockBackend(page, { account: childMe({ nickname: undefined }) });
    await page.goto("/student/nickname");
    await page.getByRole("button", { name: "Это не моя карточка" }).click();
    await page.waitForURL(/\/student$/);
    expect(w.logouts).toBe(1);
  });

  for (const [path, account, heading] of [
    ["/teacher/terms", adultMe({ teacherStatus: "none", roles: [], classes: [], pendingConsents: ["terms"] }), "Примите условия"],
    ["/teacher/apply", adultMe({ teacherStatus: "none", roles: [], classes: [] }), "Расскажите о себе"],
    ["/teacher/pending", adultMe({ teacherStatus: "pending", roles: [], classes: [] }), "Заявка на проверке"],
  ] as const) {
    test(`${path}: «Выйти» в верхней панели`, async ({ page }) => {
      const w = await mockBackend(page, { account });
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await page.getByRole("banner").getByRole("button", { name: "Выйти" }).click();
      await page.waitForURL((u) => u.pathname === "/");
      expect(w.logouts).toBe(1);
    });
  }
});

test.describe("M1-30, M1-34: мелочи", () => {
  test("номера в плитках «Класс» — по центру плитки; у литеры подсказка, а не значение-образец", async ({ page }) => {
    // Без анимации появления диалога (масштаб 0,96 → 1 искажает размеры).
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockBackend(page, { account: adultMe() });
    await page.goto("/teacher");
    await page.getByRole("button", { name: "Создать класс" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Новый класс" });
    const tile = dialog.locator(".tt-choice__box").first();
    const text = tile.locator(".tt-choice__text");
    // Дожидаемся конца анимации появления листа: размеры во время масштабирования не итоговые.
    await page.waitForFunction(() => document.getAnimations().every((an) => an.playState !== "running"));
    const [box, t] = [await tile.boundingBox(), await text.boundingBox()];
    expect(Math.abs(box!.x + box!.width / 2 - (t!.x + t!.width / 2))).toBeLessThan(2);
    await expect(dialog.getByLabel("Литера")).not.toHaveAttribute("placeholder");
    await expect(dialog.getByText("Например, А или Б")).toBeVisible();
  });

  test("битый id класса в адресе — «Класс не найден», без запроса к API и без английского текста", async ({ page }) => {
    await mockBackend(page, { account: adultMe() });
    const calls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/v1/classes/not-a-uuid")) calls.push(r.url());
    });
    await page.goto("/teacher/classes/not-a-uuid");
    await expect(page.getByRole("heading", { name: "Класс не найден" })).toBeVisible();
    await expect(page.getByText(/must match/)).toHaveCount(0);
    expect(calls).toEqual([]);
  });

  test("чужой класс: текст без обещания совместного ведения", async ({ page }) => {
    await mockBackend(page, { account: adultMe() });
    await page.goto("/teacher/classes/0193f7a4-0000-7000-8000-00000000c999");
    await expect(page.getByRole("heading", { name: "Нет доступа" })).toBeVisible();
    await expect(page.getByText(/добавить вас в класс/)).toHaveCount(0);
  });

  test("литера класса с башкирской буквой размечена lang=\"ba\"", async ({ page }) => {
    const w = await mockBackend(page, { account: adultMe() });
    w.classes = [{ ...w.classes[0]!, title: "7 «Ә»", letter: "Ә", grade: 7 }];
    await page.goto("/teacher");
    await expect(page.locator('.class-card [lang="ba"]')).toHaveText("Ә");
  });

  test("ожидание заявки: кнопка честно называется «Выйти» (отменить заявку нельзя)", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/student/code");
    await page.getByLabel("Код класса: символ 1 из 6").fill("K7Q4MZ");
    await page.getByRole("button", { name: "Дальше" }).click();
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await expect(page.getByRole("heading", { name: "Ждём учителя" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Отменить заявку" })).toHaveCount(0);
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await page.waitForURL(/\/student$/);
  });
});

test.describe("M1-35: вход на место закрыт во время ожидания", () => {
  const waitForTeacher = async (page: Page) => {
    await page.goto("/student/code");
    await page.getByLabel("Код класса: символ 1 из 6").fill("K7Q4MZ");
    await page.getByRole("button", { name: "Дальше" }).click();
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Отправить заявку" }).click();
  };

  test("согласие отозвано — «Вход закрыт» без слова «карточка», опрос остановлен, заявка забыта", async ({ page }) => {
    const w = await mockBackend(page, { joinPollProblem: { status: 403, code: "consent_revoked" } });
    let polls = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/session/class-code-status")) polls++;
    });
    await waitForTeacher(page);
    const alert = page.getByRole("alert").filter({ hasText: "Вход закрыт" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Подойди к учителю.");
    await expect(alert).not.toContainText("карточк");
    const seen = polls;
    await page.waitForTimeout(2500);
    expect(polls, "после 403 опрос не повторяется").toBe(seen);
    expect(await page.evaluate(() => Object.keys(sessionStorage).concat(Object.keys(localStorage)).filter((k) => /ticket|join/i.test(k)))).toEqual([]);
    w.joinPollProblem = undefined;
    await page.getByRole("link", { name: "Выйти" }).click();
    await page.waitForURL(/\/student$/);
  });

  test("класс в архиве — «Класс закрыт» с текстом для ребёнка", async ({ page }) => {
    await mockBackend(page, { joinPollProblem: { status: 403, code: "class_archived" } });
    await waitForTeacher(page);
    await expect(page.getByRole("alert").filter({ hasText: "Класс закрыт" })).toContainText("Этот класс закрыт");
  });
});

test.describe("M1-38: ошибка проверки — фокус на первом неверном поле, ошибка в его описании", () => {
  /** Поле с ошибкой: в фокусе, aria-invalid, текст ошибки — в доступном описании (aria-describedby). */
  const expectInvalidFocus = async (field: ReturnType<Page["getByLabel"]>, error: RegExp) => {
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAccessibleDescription(error);
  };

  test("вход учителя: неверный адрес почты (проверка в браузере и ответ сервера validation_failed)", async ({ page }) => {
    const w = await mockBackend(page);
    await page.goto("/teacher/login");
    const email = page.getByLabel("Электронная почта");
    await email.fill("не-адрес");
    await page.getByRole("button", { name: "Получить код" }).click();
    await expectInvalidFocus(email, /Проверьте адрес почты/);

    // Enter в самом поле: фокус уже там — ошибку объявляет живая область формы.
    await email.press("Enter");
    await expect(page.locator("form [aria-live]")).toHaveText(/Проверьте адрес почты/);

    w.failures["POST /auth/otp/request"] = { status: 422, code: "validation_failed", errors: [{ pointer: "/email", detail: "Неверный адрес почты" }] };
    await email.fill("teacher@school7.example");
    await page.getByRole("button", { name: "Получить код" }).click();
    await expectInvalidFocus(email, /Неверный адрес почты/);
  });

  test("заявка, шаг 1: пустые ФИО и должность — фокус на ФИО, затем на должности", async ({ page }) => {
    await mockBackend(page, { account: adultMe({ teacherStatus: "none", roles: [], classes: [], profile: { email: "teacher@school7.example" } }) });
    await page.goto("/teacher/apply");
    await page.getByRole("button", { name: "Дальше" }).click();
    await expectInvalidFocus(page.getByLabel("Фамилия, имя, отчество"), /Укажите фамилию, имя и отчество/);
    await page.getByLabel("Фамилия, имя, отчество").fill("Учитель Демонстрационный");
    await page.getByRole("button", { name: "Дальше" }).click();
    await expectInvalidFocus(page.getByLabel("Должность"), /Укажите должность/);
  });

  test("заявка: сервер отклонил должность (validation_failed /position) — возврат на шаг 1, фокус на должности", async ({ page }) => {
    const w = await mockBackend(page, { account: adultMe({ teacherStatus: "none", roles: [], classes: [], profile: { email: "teacher@school7.example" } }) });
    w.failures["POST /teacher/verification"] = { status: 422, code: "validation_failed", errors: [{ pointer: "/position", detail: "Не короче 2 символов" }] };
    await page.goto("/teacher/apply");
    await page.getByLabel("Фамилия, имя, отчество").fill("Учитель Демонстрационный");
    await page.getByLabel("Должность").fill("Уч");
    await page.getByRole("button", { name: "Дальше" }).click();
    await page.getByRole("radio", { name: /Уфа/ }).check();
    await page.getByRole("button", { name: "Дальше" }).click();
    await page.getByRole("radio", { name: /Школа № 7/ }).check();
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await expect(page.getByRole("heading", { name: "Расскажите о себе" })).toBeVisible();
    await expectInvalidFocus(page.getByLabel("Должность"), /Не короче 2 символов/);
    await expect(page.getByLabel("Должность")).toHaveValue("Уч");
  });

  test("новый класс: пустая литера и литера, отклонённая сервером", async ({ page }) => {
    const w = await mockBackend(page, { account: adultMe() });
    await page.goto("/teacher");
    await page.getByRole("button", { name: "Создать класс" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Новый класс" });
    await dialog.getByRole("button", { name: "Создать класс" }).click();
    await expectInvalidFocus(dialog.getByLabel("Литера"), /Укажите литеру класса/);

    w.failures["POST /classes"] = { status: 422, code: "validation_failed", errors: [{ pointer: "/letter", detail: "Литера — 1–3 русские или башкирские буквы или цифры" }] };
    await dialog.getByLabel("Литера").fill("#");
    await dialog.getByRole("button", { name: "Создать класс" }).click();
    await expectInvalidFocus(dialog.getByLabel("Литера"), /Литера — 1–3 русские или башкирские буквы/);
  });

  test("выпуск карточек: число вне диапазона", async ({ page }) => {
    await mockBackend(page, { account: adultMe() });
    await page.goto(`/teacher/classes/${CLASS_ID}`);
    await page.getByRole("button", { name: "Выпустить карточки" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Выпустить карточки" });
    await dialog.getByLabel("Сколько карточек").fill("0");
    await dialog.getByRole("button", { name: "Выпустить карточки" }).click();
    await expectInvalidFocus(dialog.getByLabel("Сколько карточек"), /Введите число от 1 до/);
  });
});

test.describe("M1-45: «Назад» при открытом листе закрывает лист", () => {
  const openClass = async (page: Page) => {
    await mockBackend(page, { account: adultMe() });
    await page.goto("/teacher");
    await page.getByRole("link", { name: /5 «Б»/ }).click();
    await expect(page.getByRole("heading", { name: "Места" })).toBeVisible();
    return page.url();
  };

  test("лист места: «Назад» закрывает лист, адрес прежний; следующий «Назад» — как обычно", async ({ page }) => {
    const classUrl = await openClass(page);
    await page.getByRole("button", { name: /Место №03/ }).click();
    const dialog = page.getByRole("dialog", { name: "Место №03" });
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toBeHidden();
    expect(page.url()).toBe(classUrl);
    await expect(page.getByRole("heading", { name: "Места" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/teacher$/);
    await expect(page.getByRole("heading", { name: "Мои классы" })).toBeVisible();
  });

  test("закрытие крестиком и Esc убирает запись листа из истории", async ({ page }) => {
    await openClass(page);
    const dialog = page.getByRole("dialog", { name: "Место №03" });
    await page.getByRole("button", { name: /Место №03/ }).click();
    await dialog.getByRole("button", { name: "Закрыть" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: /Место №03/ }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.goBack();
    await expect(page).toHaveURL(/\/teacher$/);
  });

  test("доска → «Заявки»: «Назад» закрывает заявки, страница класса остаётся", async ({ page }) => {
    const classUrl = await openClass(page);
    await page.getByRole("button", { name: "Показать код класса" }).click();
    await page.getByText("K7Q-4MZ").waitFor();
    await page.getByRole("dialog").getByRole("button", { name: /^Заявки/ }).click();
    const requests = page.getByRole("dialog", { name: "Заявки на вход" });
    await expect(requests).toBeVisible();
    await page.goBack();
    await expect(requests).toBeHidden();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(page.url()).toBe(classUrl);
    await page.goBack();
    await expect(page).toHaveURL(/\/teacher$/);
  });

  test("создание класса: переход на страницу класса без записи листа в истории", async ({ page }) => {
    await mockBackend(page, { account: adultMe() });
    await page.goto("/teacher");
    await expect(page.getByRole("heading", { name: "Мои классы" })).toBeVisible();
    await page.getByRole("button", { name: "Создать класс" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Новый класс" });
    await dialog.getByLabel("Литера").fill("В");
    await dialog.getByRole("button", { name: "Создать класс" }).click();
    await expect(page).toHaveURL(/\/teacher\/classes\/0193f7a4-0000-7000-8000-00000000c007$/);
    await expect(page.getByRole("heading", { name: "Места" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/teacher$/);
    await expect(page.getByRole("heading", { name: "Мои классы" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("M1-46: заголовок вкладки шага «Введите код»", () => {
  test("после отправки почты заголовок вкладки — шаг ввода кода; «Изменить адрес» возвращает прежний", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/teacher/login");
    await expect(page).toHaveTitle("Вход для учителя · ТелеТау");
    await page.getByLabel("Электронная почта").fill("teacher@school7.example");
    await page.getByRole("button", { name: "Получить код" }).click();
    await expect(page.getByRole("heading", { name: "Введите код" })).toBeVisible();
    await expect(page).toHaveTitle("Введите код · ТелеТау");
    await page.getByRole("button", { name: "Изменить адрес" }).click();
    await expect(page).toHaveTitle("Вход для учителя · ТелеТау");
  });
});
