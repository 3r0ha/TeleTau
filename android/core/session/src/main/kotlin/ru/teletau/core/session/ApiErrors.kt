package ru.teletau.core.session

import ru.teletau.core.network.models.Problem

/**
 * Ошибка API в формате RFC 9457 (контракт, схема `Problem`). Клиент ветвится по [code], а не по `title`;
 * неизвестный `code` обрабатывается по [status] (список кодов открыт).
 */
public class ApiProblem(
    public val status: Int,
    public val problem: Problem?,
    /** `Retry-After` в секундах (429, 503), если сервер его прислал. */
    public val retryAfter: Int? = null,
) : Exception(problem?.title ?: "HTTP $status") {
    public val code: String? get() = problem?.code
}

/** Сервер недоступен: нет сети, таймаут, обрыв соединения. Сессия при этом не теряется. */
public class NetworkFailure(cause: Throwable) : Exception("Нет связи с сервером", cause)

/** Сессии нет или она закончилась (refresh отклонён) — нужно войти заново. */
public class SessionEnded(public val reason: String?) : Exception("Сессия завершена")

/** `Retry-After` (RFC 9110 §10.2.3): только число секунд; дата HTTP — редкость для нашего API, её не разбираем. */
internal fun parseRetryAfter(header: String?): Int? = header?.trim()?.takeIf { it.isNotEmpty() && it.all(Char::isDigit) }?.toIntOrNull()

/** Короткий отказ по частоте — очередь, а не блокировка: повторить через секунду. */
public fun Throwable.isShortRateLimit(): Boolean =
    this is ApiProblem && status == 429 && (code == null || code == "rate_limited") && (retryAfter ?: Int.MAX_VALUE) <= 5
