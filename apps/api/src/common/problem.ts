// Ошибки API в формате RFC 9457 (Problem Details). Клиенты ветвятся по `code` (перечень — схема Problem в контракте),
// `title` — понятная человеку фраза на русском, одинаковая для всех случаев с этим кодом.
import type { Schema } from "@teletau/contracts";

export type FieldError = Schema<"FieldError">;

/** Заголовки для кодов ошибок. Новые коды добавляются и в описание схемы Problem в openapi.yaml. */
const TITLES: Record<string, string> = {
  unauthenticated: "Нужно войти",
  token_expired: "Срок действия входа истёк — обновите сессию",
  forbidden: "Нет доступа",
  not_found: "Не найдено",
  validation_failed: "Запрос не прошёл проверку",
  bad_request: "Запрос не разобран",
  rate_limited: "Слишком много попыток — подождите и попробуйте снова",
  card_invalid: "Карточка не подошла",
  card_revoked: "Эта карточка больше не действует — попросите у учителя новую",
  consent_revoked: "Родитель отозвал согласие: вход по этой карточке заблокирован. Обратитесь к учителю",
  class_archived: "Класс в архиве",
  payload_invalid: "Это не QR-код карточки «ТелеТау»",
  class_code_not_found: "Код класса не подошёл",
  otp_invalid: "Неверный код",
  otp_expired: "Код устарел — запросите новый",
  otp_attempts_exceeded: "Попытки закончились — запросите новый код",
  totp_required: "Нужен код из приложения-аутентификатора",
  totp_invalid: "Неверный код из приложения-аутентификатора",
  email_login_unavailable: "Вход по e-mail временно недоступен",
  refresh_invalid: "Сессия недействительна — войдите снова",
  refresh_reused: "Сессия отозвана из соображений безопасности — войдите снова",
  session_revoked: "Сессия завершена — войдите снова",
  account_blocked: "Аккаунт заблокирован — обратитесь к администрации",
  nickname_not_allowed: "Ник есть только у учеников",
  teacher_not_verified: "Учитель ещё не подтверждён",
  school_not_allowed: "Можно выбрать только школу из одобренной заявки",
  class_exists: "Такой класс уже есть",
  seat_limit_exceeded: "В классе не больше 99 мест",
  print_job_expired: "Срок печати истёк — перевыпустите карточки",
  print_job_replaced: "Карточки этого задания уже заменены новым выпуском — скачайте PDF нового выпуска",
  join_request_closed: "Заявка уже решена или истекла",
  consent_required: "Сначала примите условия",
  verification_pending: "Заявка уже на рассмотрении",
  already_verified: "Учитель уже подтверждён",
  already_decided: "Заявка уже решена",
  document_not_current: "Документ не действующей версии",
  consent_exists: "Согласие уже отмечено",
  consent_already_revoked: "Согласие уже отозвано",
  request_in_progress: "Этот запрос ещё выполняется — повторите чуть позже",
  idempotency_key_reused: "Ключ повтора уже использован для другого запроса",
  documents_unavailable: "Документы временно недоступны — попробуйте позже",
  staff_locked: "Вход временно заблокирован после неверных кодов — попробуйте через час",
  payload_too_large: "Слишком большой запрос",
  join_queue_full: "В классе слишком много заявок — подождите, пока учитель их разберёт",
  service_unavailable: "Сервис временно недоступен",
  internal: "Внутренняя ошибка",
  // Уроки, мотивация, дуэли (коды — в описании схемы Problem в openapi.yaml)
  not_implemented: "Эта возможность ещё не готова",
  lesson_locked: "Этот урок пока закрыт — сначала пройди предыдущий",
  run_conflict: "Этот идентификатор урока уже занят",
  run_completed: "Урок уже завершён",
  run_incomplete: "Ответь на все задания урока",
  exercise_not_in_run: "Такого задания нет в этом уроке",
  answer_type_mismatch: "Ответ не подходит к заданию",
  already_voted: "Голос за эту пару уже учтён",
  vote_required: "Голоса видны после своего голоса",
  content_unavailable: "Курс ещё не загружен",
  // Задания учителя (ADR 0021)
  assignment_limit: "У класса уже два активных задания",
  assignment_exists: "Такое задание уже выдано",
  // Telegram (ADR 0020)
  init_data_invalid: "Не удалось проверить запуск из Telegram — откройте приложение кнопкой в боте ещё раз",
  init_data_expired: "Запуск из Telegram устарел — откройте приложение кнопкой в боте ещё раз",
  telegram_unavailable: "Telegram-бот пока не подключён",
  chat_not_linked: "Чат Telegram не привязан",
  // Ежедневное задание бота (ADR 0024)
  dialog_not_found: "Задание не найдено",
  dialog_closed: "Задание уже закрыто",
  // Самостоятельное обучение (ADR 0022)
  login_card_unavailable: "Карточка входа для этого аккаунта не нужна",
  email_in_use: "Эта почта уже занята другим аккаунтом",
  email_already_set: "Почта уже привязана",
  already_in_class: "Ты уже в классе",
};

export const problemTitle = (code: string): string => TITLES[code] ?? code;

/** Ошибка с известным кодом: ProblemFilter превращает её в application/problem+json. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
    readonly errors?: FieldError[],
    /** Для 429: через сколько секунд можно повторить (заголовок Retry-After). */
    readonly retryAfterSeconds?: number,
  ) {
    super(`${status} ${code}`);
  }
}

export const unauthorized = (code = "unauthenticated") => new ApiError(401, code);
export const forbidden = (code = "forbidden", detail?: string) => new ApiError(403, code, detail);
export const notFound = (code = "not_found") => new ApiError(404, code);
export const conflict = (code: string, detail?: string, retryAfterSeconds?: number) => new ApiError(409, code, detail, undefined, retryAfterSeconds);
export const gone = (code: string) => new ApiError(410, code);
export const unprocessable = (code: string, errors?: FieldError[]) => new ApiError(422, code, undefined, errors);
export const tooManyRequests = (retryAfterSeconds: number, code = "rate_limited") =>
  new ApiError(429, code, undefined, undefined, Math.max(1, Math.ceil(retryAfterSeconds)));
export const unavailable = (code = "service_unavailable") => new ApiError(503, code);
/** 501: операция контракта объявлена, но ещё не реализована (каркасы модулей). */
export const notImplemented = () => new ApiError(501, "not_implemented");
/** 422 по одному полю тела запроса (JSON Pointer, RFC 6901). */
export const invalidField = (pointer: string, detail: string) => unprocessable("validation_failed", [{ pointer, detail }]);
