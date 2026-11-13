import type { Problem } from "@teletau/contracts";

/** Ошибка API в формате RFC 9457. Клиент ветвится по `code`, а не по `title` (контракт, схема Problem). */
export class ApiProblem extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly problem: Partial<Problem>;
  /**
   * Через сколько секунд можно повторить запрос — заголовок `Retry-After` ответа (429, 409 `request_in_progress`, 503).
   * Нет заголовка или он нечитаем — undefined (docs/07 §2 «Ошибки»).
   */
  readonly retryAfter: number | undefined;

  constructor(status: number, problem: Partial<Problem> = {}, opts: { retryAfter?: number } = {}) {
    super(problem.title ?? `HTTP ${status}`);
    this.name = "ApiProblem";
    this.status = status;
    this.code = problem.code;
    this.problem = problem;
    this.retryAfter = opts.retryAfter;
  }
}

/**
 * Заголовок `Retry-After` (RFC 9110 §10.2.3) → секунды: число секунд или дата HTTP (тогда — сколько до неё осталось,
 * не меньше 0). Пусто или нечитаемо — undefined.
 */
export function parseRetryAfter(header: string | null | undefined, now: number = Date.now()): number | undefined {
  const value = header?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  if (!/[A-Za-z]/.test(value)) return undefined;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
}

/**
 * Короткий отказ по частоте: 429 `rate_limited` с `Retry-After` не больше SHORT_RETRY_AFTER_SECONDS. Так сервер
 * отвечает, когда мешают только попытки, которые ещё проверяются (ADR 0016): это очередь, а не блокировка за
 * подбор. Такой запрос вход молча повторяет (retry.ts), а если не помогло — просит подождать секунду, а не минуту.
 */
export const SHORT_RETRY_AFTER_SECONDS = 5;

export function isShortRateLimit(e: unknown): boolean {
  return (
    e instanceof ApiProblem &&
    e.status === 429 &&
    (e.code === undefined || e.code === "rate_limited") &&
    e.retryAfter !== undefined &&
    e.retryAfter <= SHORT_RETRY_AFTER_SECONDS
  );
}

/**
 * Сеть недоступна: fetch не дошёл до сервера, истёк таймаут запроса (AbortSignal.timeout → TimeoutError)
 * или BFF не дождался API (503 api_unavailable).
 */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  if (typeof DOMException !== "undefined" && e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) return true;
  return e instanceof ApiProblem && e.code === "api_unavailable";
}

/** Тело ошибки и ответ → ApiProblem с `retryAfter` из заголовка (API открывает его в CORS, BFF передаёт как есть). */
export function toApiProblem(error: unknown, response: Pick<Response, "status" | "headers">): ApiProblem {
  const p = error && typeof error === "object" ? (error as Partial<Problem>) : {};
  return new ApiProblem(response.status, p, { retryAfter: parseRetryAfter(response.headers.get("retry-after")) });
}

/** Кому показываем текст: детям — на «ты», взрослым — на «вы» (docs/05-design-system.md §12). */
export type Audience = "child" | "adult";

const CHILD: Record<string, string> = {
  card_invalid: "Карточка не найдена. Покажи её учителю.",
  card_revoked: "Эта карточка больше не действует. Возьми у учителя новую.",
  card_reissued: "У тебя новая карточка. Войди по ней.",
  session_revoked: "Вход завершён. Войди снова по карточке.",
  consent_revoked: "Вход по этой карточке закрыт. Подойди к учителю.",
  class_archived: "Этот класс закрыт. Подойди к учителю.",
  payload_invalid: "Это не карточка ученика. Покажи свою карточку.",
  class_code_not_found: "Код не подходит. Проверь буквы или попроси новый код.",
  rate_limited: "Много попыток. Подожди минуту.",
  join_queue_full: "У учителя много заявок. Попробуй чуть позже.",
  nickname_not_allowed: "Этот ник нельзя выбрать. Выбери другой.",
  join_request_closed: "Заявка закрыта. Введи код ещё раз.",
  request_in_progress: "Отправляем, подожди секунду.",
  // Уроки, мотивация, дуэли (коды — в описании схемы Problem в openapi.yaml)
  lesson_locked: "Этот урок пока закрыт. Сначала пройди предыдущий.",
  run_completed: "Этот урок уже пройден.",
  run_incomplete: "Ответь на все задания урока.",
  already_voted: "Твой голос за эту пару уже учтён.",
  vote_required: "Сначала проголосуй сам — потом увидишь голоса других.",
  content_unavailable: "Уроки ещё не загрузились. Попробуй позже.",
  not_implemented: "Эта возможность ещё не готова.",
  // Telegram (ADR 0020; аудитория «child» — Mini App и бот)
  init_data_invalid: "Открой приложение кнопкой в боте ещё раз.",
  init_data_expired: "Запуск устарел. Открой приложение кнопкой в боте ещё раз.",
  telegram_unavailable: "Бот ТелеТау пока не подключён.",
  chat_not_linked: "Сначала войди в «Учиться», потом попроси снова.",
  // «Учусь сам» (ADR 0022)
  already_in_class: "Ты уже в классе.",
  login_card_unavailable: "Входи по карточке от учителя.",
};

const ADULT: Record<string, string> = {
  otp_invalid: "Неверный код. Проверьте цифры.",
  otp_expired: "Код устарел. Запросите новый.",
  otp_attempts_exceeded: "Попытки закончились. Запросите новый код.",
  totp_required: "Это вход сотрудника. Войдите через консоль.",
  totp_invalid: "Неверный код из приложения-аутентификатора.",
  email_login_unavailable: "Вход по почте временно недоступен. Попробуйте позже.",
  rate_limited: "Слишком много попыток. Подождите минуту.",
  teacher_not_verified: "Классы можно создавать после проверки заявки.",
  school_not_allowed: "Класс можно создать только в школе из заявки.",
  class_exists: "Такой класс уже есть.",
  seat_limit_exceeded: "В классе не больше 99 мест.",
  print_job_expired: "Файл с карточками устарел. Перевыпустите нужные карточки.",
  print_job_replaced: "Эти карточки уже заменены. Скачайте последний PDF.",
  payload_too_large: "Слишком много данных за раз.",
  join_request_closed: "Заявка уже решена или устарела.",
  consent_required: "Сначала примите условия.",
  verification_pending: "Заявка уже на проверке.",
  already_verified: "Вы уже подтверждены.",
  already_decided: "По заявке уже есть решение.",
  document_not_current: "Документ обновился. Обновите страницу.",
  documents_unavailable: "Документы недоступны. Попробуйте через минуту.",
  consent_exists: "Согласие уже отмечено.",
  consent_already_revoked: "Согласие уже отозвано.",
  nickname_not_allowed: "Ник есть только у учеников.",
  refresh_reused: "Сессия завершена. Войдите снова.",
  session_revoked: "Сессия завершена. Войдите снова.",
  account_blocked: "Аккаунт заблокирован. Обратитесь к администрации.",
  request_in_progress: "Уже выполняется. Подождите и обновите страницу.",
  idempotency_key_reused: "Не получилось. Обновите страницу и попробуйте ещё раз.",
  staff_locked: "Слишком много неверных кодов. Вход закрыт на час.",
  assignment_limit: "У класса уже два задания. Снимите одно или дождитесь срока.",
  assignment_exists: "Такое задание уже есть.",
  // Уроки, мотивация, дуэли (коды — в описании схемы Problem в openapi.yaml)
  lesson_locked: "Этот урок пока закрыт — сначала пройдите предыдущий.",
  run_completed: "Урок уже завершён.",
  run_incomplete: "Ответьте на все задания урока.",
  already_voted: "Ваш голос за эту пару уже учтён.",
  vote_required: "Голоса видны после вашего голоса.",
  content_unavailable: "Курс ещё не загружен. Попробуйте позже.",
  not_implemented: "Эта возможность ещё не готова.",
  // «Учусь сам» (ADR 0022)
  email_in_use: "Эта почта уже занята. Укажите другую.",
  email_already_set: "Почта уже сохранена.",
};

/** Понятный текст ошибки API на русском. Неизвестный `code` обрабатывается по статусу (контракт: список открыт). */
export function describeProblem(e: unknown, audience: Audience = "adult"): string {
  const you = audience === "child";
  if (!(e instanceof ApiProblem)) {
    // fetch не дошёл до сервера или истёк таймаут — сети нет, остальное отдаёт ApiProblem.
    return isNetworkError(e) ? (you ? "Нет связи. Проверь интернет." : "Нет связи. Проверьте интернет.") : you ? "Что-то пошло не так. Попробуй ещё раз." : "Что-то пошло не так. Попробуйте ещё раз.";
  }
  // Короткий 429 — очередь, а не блокировка: хватит секунды, а не минуты (важнее словаря кодов).
  if (isShortRateLimit(e)) return you ? "Подожди секунду и попробуй ещё раз." : "Подождите секунду и попробуйте ещё раз.";
  const byCode = e.code ? (you ? CHILD[e.code] : ADULT[e.code]) : undefined;
  if (byCode) return byCode;
  // Сервис недоступен — не «проверьте интернет»: с сетью у человека всё в порядке, лежит наша сторона
  // (BFF не дождался API: 503 api_unavailable, 502 upstream_error; сам API: 503 service_unavailable).
  if (e.status === 502 || e.status === 503) {
    return you ? "ТелеТау временно недоступен. Попробуй через минуту." : "Сервис временно недоступен. Попробуйте через минуту.";
  }
  switch (e.status) {
    case 401:
      return you ? "Нужно войти заново." : "Сессия истекла. Войдите снова.";
    case 403:
      return you ? "Сюда нельзя." : "Нет доступа.";
    case 404:
      return you ? "Ничего не нашлось." : "Не найдено.";
    case 409:
      return you ? "Так сделать сейчас нельзя." : "Действие уже выполнено или сейчас недоступно.";
    case 410:
      return you ? "Это больше недоступно." : "Срок действия истёк.";
    case 422: {
      // `errors[].detail` API пишет по-русски (контракт, Problem); текст не на русском (старый сервер, валидатор
      // без перевода) пользователю не показываем.
      const first = e.problem.errors?.[0]?.detail;
      if (first && /[А-Яа-яЁё]/.test(first)) return you ? first : `Проверьте поле: ${first}`;
      return you ? "Проверь, что всё заполнено." : "Проверьте введённые данные.";
    }
    case 429:
      return you ? CHILD.rate_limited! : ADULT.rate_limited!;
    default:
      return you ? "Что-то пошло не так. Попробуй ещё раз." : "Что-то пошло не так. Попробуйте ещё раз.";
  }
}

/**
 * Ошибки полей тела запроса из ответа 422 (`errors[]`, JSON Pointer `/position` → `position`): форма показывает их
 * у своих полей и переносит фокус на первое неверное. Параметры (`#/query/…`) и вложенные поля сюда не
 * попадают — их показывает describeProblem. Текст не на русском заменяется общим.
 */
export function fieldErrors(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(e instanceof ApiProblem) || e.status !== 422) return out;
  for (const { pointer, detail } of e.problem.errors ?? []) {
    const name = /^\/([A-Za-z][A-Za-z0-9_]*)$/.exec(pointer)?.[1];
    if (name && !(name in out)) out[name] = /[А-Яа-яЁё]/.test(detail) ? detail : "Проверьте это поле.";
  }
  return out;
}
