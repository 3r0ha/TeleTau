import { describe, expect, it } from "vitest";
import { ApiProblem, describeProblem, fieldErrors, isNetworkError } from "../src/problem";

describe("describeProblem: понятный текст по Problem Details", () => {
  it("ветвится по code, детям — на «ты», взрослым — на «вы»", () => {
    expect(describeProblem(new ApiProblem(403, { code: "card_revoked" }), "child")).toMatch(/Возьми у учителя новую/);
    expect(describeProblem(new ApiProblem(401, { code: "otp_invalid" }), "adult")).toMatch(/Проверьте/);
    expect(describeProblem(new ApiProblem(429, { code: "rate_limited" }), "child")).toMatch(/Подожди/);
  });

  it("заблокированный аккаунт — причина названа, а не «Сессия завершена» (M2-UX5)", () => {
    expect(describeProblem(new ApiProblem(401, { code: "account_blocked" }), "adult")).toMatch(/Аккаунт заблокирован/);
  });

  it("неизвестный code обрабатывается по статусу (контракт: список открыт)", () => {
    expect(describeProblem(new ApiProblem(403, { code: "something_new" }))).toBe("Нет доступа.");
    expect(describeProblem(new ApiProblem(500, {}))).toMatch(/Что-то пошло не так/);
  });

  it("сеть недоступна — отдельный текст", () => {
    const e = new TypeError("Failed to fetch");
    expect(isNetworkError(e)).toBe(true);
    expect(describeProblem(e, "child")).toMatch(/интернет/);
  });
});

describe("ошибки сети и таймауты (M1-24)", () => {
  it("истёкший таймаут запроса (AbortSignal.timeout) и 503 от BFF — это «нет связи»", () => {
    expect(isNetworkError(new DOMException("The operation timed out.", "TimeoutError"))).toBe(true);
    expect(isNetworkError(new ApiProblem(503, { code: "api_unavailable" }))).toBe(true);
    expect(describeProblem(new DOMException("timeout", "TimeoutError"))).toMatch(/Нет связи/);
    expect(isNetworkError(new ApiProblem(503, { code: "documents_unavailable" }))).toBe(false);
  });

  it("английский текст валидатора пользователю не показывается, русский errors[].detail — показывается (M1-34)", () => {
    const en = new ApiProblem(422, { errors: [{ pointer: "/id", detail: 'must match format "uuid"' }] } as never);
    expect(describeProblem(en)).toBe("Проверьте введённые данные.");
    const ru = new ApiProblem(422, { errors: [{ pointer: "/id", detail: "Неверный идентификатор" }] } as never);
    expect(describeProblem(ru)).toBe("Проверьте поле: Неверный идентификатор");
  });

  it("новые коды ошибок контракта M1 раунда 2 — понятным текстом", () => {
    expect(describeProblem(new ApiProblem(401, { code: "card_reissued" }), "child")).toMatch(/новая карточка/);
    expect(describeProblem(new ApiProblem(401, { code: "session_revoked" }), "child")).toMatch(/Вход завершён/);
    expect(describeProblem(new ApiProblem(429, { code: "staff_locked" }))).toMatch(/Вход закрыт на час/);
    expect(describeProblem(new ApiProblem(409, { code: "request_in_progress" }))).toMatch(/Уже выполняется/);
    expect(describeProblem(new ApiProblem(422, { code: "idempotency_key_reused" }))).toMatch(/Обновите страницу/);
    expect(describeProblem(new ApiProblem(503, { code: "documents_unavailable" }))).toMatch(/Документы/);
  });
});

describe("fieldErrors: ошибки полей тела запроса из 422 validation_failed (M1-38)", () => {
  it("указатель /поле → имя поля и русский текст; параметры, вложенные поля и чужие статусы — нет", () => {
    const e = new ApiProblem(422, {
      code: "validation_failed",
      errors: [
        { pointer: "/position", detail: "Не короче 2 символов" },
        { pointer: "/position", detail: "Второе сообщение того же поля не перезаписывает первое" },
        { pointer: "/letter", detail: "must match pattern" },
        { pointer: "#/query/q", detail: "Неверный формат" },
        { pointer: "/device/appVersion", detail: "Недопустимые управляющие символы" },
      ],
    });
    expect(fieldErrors(e)).toEqual({ position: "Не короче 2 символов", letter: "Проверьте это поле." });
    expect(fieldErrors(new ApiProblem(409, { errors: [{ pointer: "/letter", detail: "Ошибка" }] }))).toEqual({});
    expect(fieldErrors(new TypeError("Failed to fetch"))).toEqual({});
  });
});
