package ru.teletau.core.session

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import ru.teletau.core.network.models.AuthSession
import ru.teletau.core.network.models.Me
import java.time.OffsetDateTime

/** Состояние сессии для экранов. */
public sealed interface SessionState {
    /** Сессия ещё не восстановлена (запуск приложения). */
    public data object Unknown : SessionState

    /**
     * Входа нет. [reason] — почему сессия закончилась на сервере (`session_revoked`, `refresh_reused`…), если это
     * случилось не по кнопке «Выйти».
     */
    public data class Anonymous(val reason: String? = null) : SessionState

    public data class Authenticated(val account: Me) : SessionState
}

/**
 * Сессия ученика (ADR 0015): короткоживущий access-токен — в памяти, одноразовый refresh-токен — в [TokenStore]
 * (на Android — зашифрован ключом Keystore). Обновление — строго по одному (single-flight): сколько бы запросов
 * ни получили 401 одновременно, refresh уходит один, остальные ждут его и повторяются с новым токеном (контракт,
 * `refreshSession`: повторное предъявление использованного refresh-токена отзывает всё семейство сессии).
 *
 * Сеть пропала во время обновления — сессия не теряется (тот же refresh-токен уйдёт снова, у сервера на это
 * льготное окно 60 с). Сервер отклонил refresh (401) — сессия закончена: хранилище очищается, состояние —
 * [SessionState.Anonymous] с причиной.
 */
public class SessionManager(
    private val store: TokenStore,
    private val refresh: suspend (refreshToken: String) -> AuthSession,
    private val json: Json = TeleTauJson,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private class Access(val token: String, val expiresAtMillis: Long)

    private val mutex = Mutex()
    @Volatile private var access: Access? = null
    private val _state = MutableStateFlow<SessionState>(SessionState.Unknown)

    public val state: StateFlow<SessionState> = _state.asStateFlow()

    /** Аккаунт, сохранённый с прошлого запуска (ник, класс) — до ответа сервера. */
    public fun cachedAccount(): Me? = store.load()?.accountJson?.let { runCatching { json.decodeFromString(Me.serializer(), it) }.getOrNull() }

    public fun hasStoredSession(): Boolean = store.load() != null

    /** Вход выполнен (QR, заявка по коду класса) или токены обновлены. */
    public fun establish(session: AuthSession) {
        access = Access(session.accessToken, parseInstant(session.accessTokenExpiresAt))
        store.save(StoredSession(session.refreshToken, session.refreshTokenExpiresAt, json.encodeToString(Me.serializer(), session.account)))
        _state.value = SessionState.Authenticated(session.account)
    }

    /** Аккаунт изменился (выбран ник, `GET /me`). */
    public fun updateAccount(account: Me) {
        val stored = store.load() ?: return
        store.save(stored.copy(accountJson = json.encodeToString(Me.serializer(), account)))
        _state.value = SessionState.Authenticated(account)
    }

    /**
     * Восстановить сессию при запуске: есть refresh-токен — обменять его на свежую пару. Нет сети — [NetworkFailure]
     * (состояние остаётся [SessionState.Unknown], экран предлагает повторить).
     */
    public suspend fun restore(): SessionState {
        if (store.load() == null) {
            _state.value = SessionState.Anonymous()
            return _state.value
        }
        refreshLocked(rejected = null)
        return _state.value
    }

    /** Действующий access-токен; истёк — обновить (single-flight). Входа нет — null. */
    public suspend fun validAccessToken(): String? {
        val current = access
        if (current != null && !current.expired()) return current.token
        if (store.load() == null) return null
        return refreshLocked(rejected = current?.token)
    }

    /** Сервер ответил 401 на запрос с токеном [rejected] — обновить, если этого ещё не сделал другой запрос. */
    public suspend fun refreshAfterRejected(rejected: String): String? = refreshLocked(rejected)

    /** Завершить сессию на этом устройстве (кнопка «Выйти» или отказ сервера). */
    public fun end(reason: String? = null) {
        access = null
        store.clear()
        _state.value = SessionState.Anonymous(reason)
    }

    private suspend fun refreshLocked(rejected: String?): String? = mutex.withLock {
        val current = access
        // Пока ждали замок, токен уже обновил другой запрос.
        if (current != null && current.token != rejected && !current.expired()) return@withLock current.token
        val stored = store.load() ?: run {
            if (_state.value is SessionState.Authenticated) end()
            return@withLock null
        }
        try {
            val fresh = refresh(stored.refreshToken)
            establish(fresh)
            fresh.accessToken
        } catch (e: ApiProblem) {
            // 401 refresh_invalid / refresh_reused / session_revoked — сессия закончена. Прочее (429, 503) — не потеря входа.
            if (e.status == 401) {
                end(e.code)
                null
            } else {
                throw e
            }
        }
    }

    private fun Access.expired(): Boolean = clock() >= expiresAtMillis - EXPIRY_SKEW_MILLIS

    private fun parseInstant(value: String): Long =
        runCatching { OffsetDateTime.parse(value).toInstant().toEpochMilli() }.getOrElse { clock() + DEFAULT_ACCESS_TTL_MILLIS }

    private companion object {
        /** Обновляем чуть раньше срока: часы устройства и сервера расходятся. */
        const val EXPIRY_SKEW_MILLIS = 30_000L
        const val DEFAULT_ACCESS_TTL_MILLIS = 10 * 60_000L
    }
}
