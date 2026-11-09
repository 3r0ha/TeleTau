package ru.teletau.core.authcodes

/** QR-карточка ученика: `TT1.<seat>.<secret>.<check>` (ADR 0016). Клиенту нужен только разбор. */
public data class QrCard(
    /** Идентификатор места, 10 символов Crockford. Не секрет. */
    val seat: String,
    /** Секрет, 26 символов Crockford. */
    val secret: String,
    /** Каноническая полезная нагрузка — её и отправляем в `POST /auth/qr`. */
    val payload: String,
) {
    /** Секрет не попадает в логи и отчёты об ошибках (CLAUDE.md, правило 5). */
    override fun toString(): String = "QrCard(seat=$seat)"
}

public enum class QrParseError(public val code: String) {
    EMPTY("empty"),
    UNKNOWN_PREFIX("unknown_prefix"),
    UNSUPPORTED_VERSION("unsupported_version"),
    INVALID_FORMAT("invalid_format"),
    INVALID_CHARACTER("invalid_character"),
    BAD_CHECKSUM("bad_checksum"),
}

public sealed interface QrParseResult {
    public data class Ok(val card: QrCard) : QrParseResult
    public data class Error(val error: QrParseError) : QrParseResult
}

/** Порт `packages/auth-codes/src/qr-card.ts`; векторы — `contracts/test-vectors/qr-card/`. */
public object QrCardCodec {
    public const val PREFIX: String = "TT1"
    public const val SEAT_LENGTH: Int = 10
    public const val SECRET_LENGTH: Int = 26
    public const val CHECK_LENGTH: Int = 2
    public const val LINK_PATH: String = "/q#"
    private const val CHECK_MODULUS = 1021
    private val VERSION_PREFIX = Regex("^TT[0-9]+$")

    /** Контрольная сумма: число из цифр base32 строки `seat + secret` по модулю 1021, двумя символами. */
    public fun checksum(seat: String, secret: String): String {
        var r = 0
        for (ch in seat + secret) {
            val v = requireNotNull(Crockford.value(ch)) { "auth-codes: символ не из алфавита Crockford" }
            r = (r * 32 + v) % CHECK_MODULUS
        }
        return "${Crockford.ALPHABET[r / 32]}${Crockford.ALPHABET[r % 32]}"
    }

    /** Каноническая полезная нагрузка из места и секрета. */
    public fun buildPayload(seat: String, secret: String): String {
        require(seat.length == SEAT_LENGTH && Crockford.isCrockford(seat)) { "auth-codes: seat — $SEAT_LENGTH символов Crockford" }
        require(secret.length == SECRET_LENGTH && Crockford.isCrockford(secret)) { "auth-codes: secret — $SECRET_LENGTH символов Crockford" }
        return "$PREFIX.$seat.$secret.${checksum(seat, secret)}"
    }

    /** Ссылка `<baseUrl>/q#<payload>` (ранние карточки): завершающий `/` не удваивается. */
    public fun buildLink(baseUrl: String, payload: String): String = baseUrl.trimEnd('/') + LINK_PATH + payload

    /** Карточка из 36 готовых байтов: первые 10 — место, остальные 26 — секрет (для векторов). */
    public fun fromRandomBytes(bytes: ByteArray): QrCard {
        require(bytes.size == SEAT_LENGTH + SECRET_LENGTH) { "auth-codes: нужно ${SEAT_LENGTH + SECRET_LENGTH} байт" }
        val seat = Crockford.symbolsFromBytes(bytes.copyOfRange(0, SEAT_LENGTH))
        val secret = Crockford.symbolsFromBytes(bytes.copyOfRange(SEAT_LENGTH, bytes.size))
        return QrCard(seat, secret, buildPayload(seat, secret))
    }

    /**
     * Разбор того, что дал сканер или ввёл человек: ссылка `…/q#<payload>` или сама нагрузка. Порядок: фрагмент после
     * первого `#` → нормализация → префикс/версия → число сегментов → алфавит → длины → контрольная сумма.
     */
    public fun parse(input: String): QrParseResult {
        val hash = input.indexOf('#')
        val raw = if (hash >= 0) input.substring(hash + 1) else input
        val normalized = Crockford.normalizeCodeInput(raw)
        if (normalized.isEmpty()) return QrParseResult.Error(QrParseError.EMPTY)
        val parts = normalized.split('.')
        val prefix = parts[0]
        if (prefix != PREFIX) {
            return QrParseResult.Error(if (VERSION_PREFIX.matches(prefix)) QrParseError.UNSUPPORTED_VERSION else QrParseError.UNKNOWN_PREFIX)
        }
        if (parts.size != 4) return QrParseResult.Error(QrParseError.INVALID_FORMAT)
        val (_, seat, secret, check) = parts
        // Алфавит — раньше длины: после него все символы ASCII, длина одинакова во всех портах.
        if (!Crockford.isCrockford(seat) || !Crockford.isCrockford(secret) || !Crockford.isCrockford(check)) {
            return QrParseResult.Error(QrParseError.INVALID_CHARACTER)
        }
        if (seat.length != SEAT_LENGTH || secret.length != SECRET_LENGTH || check.length != CHECK_LENGTH) {
            return QrParseResult.Error(QrParseError.INVALID_FORMAT)
        }
        if (checksum(seat, secret) != check) return QrParseResult.Error(QrParseError.BAD_CHECKSUM)
        return QrParseResult.Ok(QrCard(seat, secret, "$PREFIX.$seat.$secret.$check"))
    }
}
