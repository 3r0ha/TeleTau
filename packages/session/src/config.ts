/** Базовый адрес API (контракт packages/contracts). NEXT_PUBLIC_* подставляется в клиентскую сборку при `next build`. */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");

/** Обработчики сессии (BFF) — на origin самого приложения; refresh-токен живёт в httpOnly cookie с этим путём. */
export const SESSION_PATH = "/api/session";

/**
 * Таймауты браузера (docs/06-architecture.md §6.8): запрос к API и к BFF дольше — ошибка «Нет связи», а не вечное
 * ожидание (зависшее TCP-соединение в мобильной сети держало бы опрос страницы класса минутами).
 * BFF ждёт API меньше (BFF_API_TIMEOUT_MS, 10 с), чтобы браузер успел получить от него понятный ответ 503.
 */
export const BROWSER_REQUEST_TIMEOUT_MS = 15_000;

/** Скачивание PDF карточек: сервер рендерит до 40 карточек — дольше обычного запроса. */
export const DOWNLOAD_TIMEOUT_MS = 60_000;
