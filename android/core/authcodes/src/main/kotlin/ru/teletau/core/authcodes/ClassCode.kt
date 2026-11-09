package ru.teletau.core.authcodes

/** Код класса: 6 символов Crockford, живёт 15 минут, вход по нему одобряет учитель (ADR 0016). */
public data class ClassCode(
    /** Канонический вид без разделителей. */
    val code: String,
    /** Для показа: `ABC-DEF`. */
    val display: String,
)

public enum class ClassCodeParseError(public val code: String) {
    EMPTY("empty"),
    INVALID_CHARACTER("invalid_character"),
    INVALID_LENGTH("invalid_length"),
}

public sealed interface ClassCodeParseResult {
    public data class Ok(val code: ClassCode) : ClassCodeParseResult
    public data class Error(val error: ClassCodeParseError) : ClassCodeParseResult
}

/** Порт `packages/auth-codes/src/class-code.ts`; векторы — `contracts/test-vectors/class-code/`. */
public object ClassCodeCodec {
    public const val LENGTH: Int = 6

    public fun format(code: String): String = "${code.take(3)}-${code.drop(3)}"

    public fun fromRandomBytes(bytes: ByteArray): ClassCode {
        require(bytes.size == LENGTH) { "auth-codes: нужно $LENGTH байт" }
        val code = Crockford.symbolsFromBytes(bytes)
        return ClassCode(code, format(code))
    }

    /** Нормализация → алфавит → длина (недопустимый символ важнее неверной длины). */
    public fun parse(input: String): ClassCodeParseResult {
        val code = Crockford.normalizeCodeInput(input)
        if (code.isEmpty()) return ClassCodeParseResult.Error(ClassCodeParseError.EMPTY)
        if (!Crockford.isCrockford(code)) return ClassCodeParseResult.Error(ClassCodeParseError.INVALID_CHARACTER)
        if (code.length != LENGTH) return ClassCodeParseResult.Error(ClassCodeParseError.INVALID_LENGTH)
        return ClassCodeParseResult.Ok(ClassCode(code, format(code)))
    }
}
