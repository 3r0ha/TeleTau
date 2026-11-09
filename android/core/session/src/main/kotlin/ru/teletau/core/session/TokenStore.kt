package ru.teletau.core.session

/**
 * Что сессия хранит между запусками. Refresh-токен — секрет: Android-реализация шифрует его ключом Android Keystore
 * (`:app`, `KeystoreTokenStore`). Access-токен живёт только в памяти.
 */
public data class StoredSession(
    val refreshToken: String,
    val refreshTokenExpiresAt: String,
    /** Аккаунт (`Me`) в JSON — чтобы показать ник и класс до первого ответа сервера. ПДн детей в нём нет (ADR 0009). */
    val accountJson: String?,
) {
    override fun toString(): String = "StoredSession(refreshTokenExpiresAt=$refreshTokenExpiresAt)"
}

public interface TokenStore {
    public fun load(): StoredSession?
    public fun save(session: StoredSession)
    public fun clear()
}

/** Хранилище в памяти — для тестов и превью. */
public class InMemoryTokenStore(initial: StoredSession? = null) : TokenStore {
    @Volatile private var value: StoredSession? = initial
    override fun load(): StoredSession? = value
    override fun save(session: StoredSession) { value = session }
    override fun clear() { value = null }
}
