package ru.teletau.core.bashkirtext

import java.text.Normalizer

/**
 * Нормализация и сравнение башкирского текста — порт `packages/bashkir-text/src/normalize.ts`
 * один в один (алгоритм v3). Правила — `contracts/shared/bashkir-homoglyphs.json` (таблицы
 * сгенерированы в [BashkirTable]), векторы — `contracts/test-vectors/bashkir-text/`.
 *
 * Вся обработка идёт по кодовым точкам Юникода, а не по UTF-16.
 */
public object BashkirText {
    private const val SPACE = 0x20

    /** Не более стольких применений при поиске неподвижной точки (на практике хватает двух). */
    private const val MAX_FIXPOINT_STEPS = 4

    /**
     * Каноническая форма башкирского текста (алгоритм v3): NFC → удаление невидимых → NFC →
     * последовательности → двойники в кириллических словах → пробелы → NFC. Регистр сохраняется.
     */
    public fun normalize(input: String): String {
        var cps = removeInvisible(nfc(input).codePoints().toArray())
        cps = nfc(fromCodePoints(cps)).codePoints().toArray()
        cps = replaceSequences(cps)
        cps = mapLettersInCyrillicWords(cps)
        cps = normalizeSpaces(cps)
        return nfc(fromCodePoints(cps))
    }

    /** Форма для точного сравнения: неподвижная точка NFC(нижний регистр(normalize(s))). */
    public fun toComparable(input: String): String = fixpoint(input) { s ->
        nfc(fromCodePoints(normalize(s).codePoints().map { BashkirTable.LOWER_MAP[it] ?: it }.toArray()))
    }

    /** Свёртка особых букв (ҡ→к, ғ→г, …): неподвижная точка NFC(foldMap(toComparable(s))). */
    public fun fold(input: String): String = fixpoint(input) { s ->
        nfc(fromCodePoints(toComparable(s).codePoints().map { BashkirTable.FOLD_MAP[it] ?: it }.toArray()))
    }

    // ── Шаги алгоритма ──────────────────────────────────────────────────────────────

    /**
     * Шаг 2: невидимые символы. ZWJ/ZWNJ удаляются только рядом с буквами — эмодзи-последовательности сохраняются.
     * «Рядом» = ближайшая слева или справа кодовая точка, не являющаяся ZWJ/ZWNJ, — буква или знак.
     * Линейно: два прохода вместо квадратичного просмотра всей цепочки для каждого соединителя.
     */
    private fun removeInvisible(input: IntArray): IntArray {
        val cps = input.filter { it !in BashkirTable.REMOVE }.toIntArray()
        val size = cps.size
        val wordOnLeft = BooleanArray(size)
        var lastIsWord = false
        for (i in 0 until size) {
            val cp = cps[i]
            if (cp in BashkirTable.REMOVE_NEAR_LETTERS) wordOnLeft[i] = lastIsWord else lastIsWord = isWordCp(cp)
        }
        val keep = BooleanArray(size) { true }
        var nextIsWord = false
        for (i in size - 1 downTo 0) {
            val cp = cps[i]
            if (cp in BashkirTable.REMOVE_NEAR_LETTERS) keep[i] = !(wordOnLeft[i] || nextIsWord) else nextIsWord = isWordCp(cp)
        }
        val out = IntArray(size)
        var n = 0
        for (i in 0 until size) if (keep[i]) out[n++] = cps[i]
        return out.copyOf(n)
    }

    private fun replaceSequences(cps: IntArray): IntArray {
        val out = IntArray(cps.size)
        var n = 0
        var i = 0
        while (i < cps.size) {
            val a = cps[i]
            val replacement = if (i + 1 < cps.size) {
                val b = cps[i + 1]
                BashkirTable.SEQUENCES.firstOrNull { (x, y) -> x == a && y == b }?.third
            } else {
                null
            }
            if (replacement != null) {
                out[n++] = replacement
                i += 2
            } else {
                out[n++] = a
                i++
            }
        }
        return out.copyOf(n)
    }

    /** Замена двойников — только внутри слов, где есть хотя бы одна кириллическая кодовая точка. */
    private fun mapLettersInCyrillicWords(cps: IntArray): IntArray {
        val out = cps.copyOf()
        var i = 0
        while (i < cps.size) {
            if (!isWordCp(cps[i])) {
                i++
                continue
            }
            var j = i
            while (j < cps.size && isWordCp(cps[j])) j++
            if ((i until j).any { isCyrillic(cps[it]) }) {
                for (k in i until j) out[k] = BashkirTable.LETTER_MAP[cps[k]] ?: cps[k]
            }
            i = j
        }
        return out
    }

    /** Любой пробельный символ → пробел, подряд идущие схлопываются, края обрезаются. */
    private fun normalizeSpaces(cps: IntArray): IntArray {
        val out = IntArray(cps.size)
        var n = 0
        for (cp in cps) {
            if (cp in BashkirTable.WHITESPACE) {
                if (n > 0 && out[n - 1] != SPACE) out[n++] = SPACE
            } else {
                out[n++] = cp
            }
        }
        if (n > 0 && out[n - 1] == SPACE) n--
        return out.copyOf(n)
    }

    // ── Вспомогательное ─────────────────────────────────────────────────────────────

    private inline fun fixpoint(input: String, step: (String) -> String): String {
        var current = step(input)
        for (n in 1 until MAX_FIXPOINT_STEPS) {
            val next = step(current)
            if (next == current) break
            current = next
        }
        return current
    }

    private fun nfc(s: String): String = Normalizer.normalize(s, Normalizer.Form.NFC)

    private fun fromCodePoints(cps: IntArray): String = buildString(cps.size) { for (cp in cps) appendCodePoint(cp) }

    /** Слово — максимальная последовательность кодовых точек категорий Юникода L* и M*. */
    private fun isWordCp(cp: Int): Boolean = cp >= 0 && when (Character.getType(cp).toByte()) {
        Character.UPPERCASE_LETTER,
        Character.LOWERCASE_LETTER,
        Character.TITLECASE_LETTER,
        Character.MODIFIER_LETTER,
        Character.OTHER_LETTER,
        Character.NON_SPACING_MARK,
        Character.ENCLOSING_MARK,
        Character.COMBINING_SPACING_MARK,
        -> true
        else -> false
    }

    private fun isCyrillic(cp: Int): Boolean = cp in BashkirTable.CYRILLIC_FROM..BashkirTable.CYRILLIC_TO
}
