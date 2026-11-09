package ru.teletau.core.authcodes

/**
 * Base32 Crockford и нормализация ручного ввода — порт `packages/auth-codes/src/crockford.ts` (ADR 0016).
 * Формат и шаги — `contracts/test-vectors/qr-card/README.md`; поведение закреплено общими векторами.
 */
public object Crockford {
    /** 32 символа без I, L, O, U. Значение символа — его индекс. */
    public const val ALPHABET: String = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

    /** Значение символа канонического алфавита или null. */
    public fun value(ch: Char): Int? = ALPHABET.indexOf(ch).takeIf { it >= 0 }

    /** Все символы строки — из канонического алфавита (после нормализации). */
    public fun isCrockford(s: String): Boolean = s.all { ALPHABET.indexOf(it) >= 0 }

    /** Символ = байт & 31: из равномерных байтов — равномерные символы. */
    public fun symbolsFromBytes(bytes: ByteArray): String =
        buildString(bytes.size) { bytes.forEach { append(ALPHABET[it.toInt() and 31]) } }

    /** Удаляемые символы: пробелы (включая неразрывные) и дефисы/тире. */
    private val REMOVED: Set<Int> = setOf(
        0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x2007, 0x202f,
        0x002d, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2212,
    )

    /**
     * Замены после перевода ASCII в верхний регистр: O→0, I→1, L→1 и кириллические двойники латинских букв и цифр.
     * Башкирские буквы (Ҡ, Ҙ, Ө…) намеренно не заменяются: это другие буквы, а не двойники.
     */
    private val SUBSTITUTE: Map<Int, String> = mapOf(
        0x4f to "0", 0x49 to "1", 0x4c to "1",
        0x0410 to "A", 0x0412 to "B", 0x0421 to "C", 0x0415 to "E", 0x041d to "H", 0x041a to "K",
        0x041c to "M", 0x041e to "0", 0x0420 to "P", 0x0422 to "T", 0x0425 to "X", 0x0423 to "Y", 0x0417 to "3",
        0x0430 to "A", 0x0432 to "B", 0x0441 to "C", 0x0435 to "E", 0x043d to "H", 0x043a to "K",
        0x043c to "M", 0x043e to "0", 0x0440 to "P", 0x0442 to "T", 0x0445 to "X", 0x0443 to "Y", 0x0437 to "3",
    )

    /**
     * Нормализация ручного ввода (общая для полезной нагрузки QR и кода класса): 1) удалить пробелы и дефисы;
     * 2) ASCII a–z → A–Z (без таблиц Unicode платформы); 3) замены двойников. Остальное сохраняется — его
     * отвергает проверка алфавита. Обход — по кодовым точкам, как в эталоне.
     */
    public fun normalizeCodeInput(input: String): String {
        val out = StringBuilder(input.length)
        var i = 0
        while (i < input.length) {
            val cp = input.codePointAt(i)
            i += Character.charCount(cp)
            if (cp in REMOVED) continue
            val upper = if (cp in 0x61..0x7a) cp - 0x20 else cp
            val sub = SUBSTITUTE[upper]
            if (sub != null) out.append(sub) else out.appendCodePoint(upper)
        }
        return out.toString()
    }
}
