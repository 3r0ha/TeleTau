package ru.teletau.core.authcodes

/** Вид карточки, которую прочитал сканер: место класса (`TT1`) или личная карточка «Учусь сам» (`TP1`). */
public enum class LoginCardKind(public val code: String) { SEAT("seat"), PERSONAL("personal") }

/** Карточка входа: вид, идентификатор (у карточки места — `seat`), секрет и каноническая полезная нагрузка. */
public data class LoginCard(val kind: LoginCardKind, val handle: String, val secret: String, val payload: String) {
    /** Секрет не попадает в логи (CLAUDE.md, правило 5). */
    override fun toString(): String = "LoginCard(kind=$kind, handle=$handle)"
}

public sealed interface LoginCardParseResult {
    public data class Ok(val card: LoginCard) : LoginCardParseResult
    public data class Error(val error: QrParseError) : LoginCardParseResult
}

/**
 * Личная карточка входа `TP1.<handle>.<secret>.<check>` и общий разбор сканера — порт
 * `packages/auth-codes/src/login-card.ts` (ADR 0022); векторы — `contracts/test-vectors/login-card/`.
 */
public object LoginCardCodec {
    public const val PREFIX: String = "TP1"
    /** Разделитель назначения в контрольной сумме: подмена префикса TT1 ↔ TP1 всегда даёт `bad_checksum`. */
    private const val DOMAIN = "P"
    private const val CHECK_MODULUS = 1021
    private val VERSION_PREFIX = Regex("^T[TP][0-9]+$")

    /** Как [QrCardCodec.checksum], но по строке `P + handle + secret`. */
    public fun personalChecksum(handle: String, secret: String): String {
        var r = 0
        for (ch in DOMAIN + handle + secret) {
            val v = requireNotNull(Crockford.value(ch)) { "auth-codes: символ не из алфавита Crockford" }
            r = (r * 32 + v) % CHECK_MODULUS
        }
        return "${Crockford.ALPHABET[r / 32]}${Crockford.ALPHABET[r % 32]}"
    }

    public fun buildPersonalPayload(handle: String, secret: String): String {
        require(handle.length == QrCardCodec.SEAT_LENGTH && Crockford.isCrockford(handle)) { "auth-codes: handle — 10 символов Crockford" }
        require(secret.length == QrCardCodec.SECRET_LENGTH && Crockford.isCrockford(secret)) { "auth-codes: secret — 26 символов Crockford" }
        return "$PREFIX.$handle.$secret.${personalChecksum(handle, secret)}"
    }

    /** Личная карточка из 36 готовых байтов: 10 — идентификатор, 26 — секрет (для векторов; выпускает сервер). */
    public fun personalFromRandomBytes(bytes: ByteArray): LoginCard {
        require(bytes.size == QrCardCodec.SEAT_LENGTH + QrCardCodec.SECRET_LENGTH) { "auth-codes: нужно 36 байт" }
        val handle = Crockford.symbolsFromBytes(bytes.copyOfRange(0, QrCardCodec.SEAT_LENGTH))
        val secret = Crockford.symbolsFromBytes(bytes.copyOfRange(QrCardCodec.SEAT_LENGTH, bytes.size))
        return LoginCard(LoginCardKind.PERSONAL, handle, secret, buildPersonalPayload(handle, secret))
    }

    /**
     * Разбор того, что прочитал сканер «Я ученик → Сканировать карточку»: карточка места `TT1.…` (и ссылка `…/q#TT1.…`
     * ранних карточек) или личная `TP1.…`. Префикс определяет вид и контрольную сумму; шаги — как у [QrCardCodec.parse].
     */
    public fun parse(input: String): LoginCardParseResult {
        val hash = input.indexOf('#')
        val normalized = Crockford.normalizeCodeInput(if (hash >= 0) input.substring(hash + 1) else input)
        if (normalized.isEmpty()) return LoginCardParseResult.Error(QrParseError.EMPTY)
        val parts = normalized.split('.')
        val prefix = parts[0]
        val kind = when (prefix) {
            QrCardCodec.PREFIX -> LoginCardKind.SEAT
            PREFIX -> LoginCardKind.PERSONAL
            else -> return LoginCardParseResult.Error(if (VERSION_PREFIX.matches(prefix)) QrParseError.UNSUPPORTED_VERSION else QrParseError.UNKNOWN_PREFIX)
        }
        if (parts.size != 4) return LoginCardParseResult.Error(QrParseError.INVALID_FORMAT)
        val (_, handle, secret, check) = parts
        if (!Crockford.isCrockford(handle) || !Crockford.isCrockford(secret) || !Crockford.isCrockford(check)) {
            return LoginCardParseResult.Error(QrParseError.INVALID_CHARACTER)
        }
        if (handle.length != QrCardCodec.SEAT_LENGTH || secret.length != QrCardCodec.SECRET_LENGTH || check.length != QrCardCodec.CHECK_LENGTH) {
            return LoginCardParseResult.Error(QrParseError.INVALID_FORMAT)
        }
        val expected = if (kind == LoginCardKind.SEAT) QrCardCodec.checksum(handle, secret) else personalChecksum(handle, secret)
        if (expected != check) return LoginCardParseResult.Error(QrParseError.BAD_CHECKSUM)
        return LoginCardParseResult.Ok(LoginCard(kind, handle, secret, "$prefix.$handle.$secret.$check"))
    }
}
