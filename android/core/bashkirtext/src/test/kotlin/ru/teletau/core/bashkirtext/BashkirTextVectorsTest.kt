package ru.teletau.core.bashkirtext

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DynamicContainer
import org.junit.jupiter.api.DynamicNode
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import java.nio.file.Files
import java.nio.file.Path
import java.text.Normalizer
import kotlin.io.path.name
import kotlin.io.path.readText

/**
 * Общие тест-векторы из `contracts/test-vectors/bashkir-text` (все JSON-наборы каталога) — те же, что проходят
 * TS (`pnpm vectors`) и Swift. Каждый кейс — отдельный динамический тест «id: note».
 * Векторы не правятся под реализацию: расхождение — ошибка порта.
 */
class BashkirTextVectorsTest {

    private class VectorCase(val id: String, val input: String, val expected: String, val note: String)

    private class VectorSuite(
        val file: String,
        val suite: String,
        val version: Int,
        val function: String,
        val cases: List<VectorCase>,
    )

    private companion object {
        /**
         * Версии наборов, которые реализует этот порт. Новая версия набора = новое поведение = обновить порт.
         * Набор, которого нет в этом списке, — ошибка: его нужно явно принять во всех трёх портах.
         */
        val SUPPORTED_VERSIONS: Map<String, Int> = mapOf(
            "normalize.json" to 3,
            "fold.json" to 4,
            "comparable.json" to 4,
            "normalize-table.json" to 2,
            "fuzz-normalize.json" to 2,
            "fuzz-comparable.json" to 2,
            "fuzz-fold.json" to 2,
        )

        val FUNCTIONS: Map<String, (String) -> String> = mapOf(
            "normalize" to BashkirText::normalize,
            "toComparable" to BashkirText::toComparable,
            "fold" to BashkirText::fold,
        )

        val vectorsDir: Path by lazy {
            val root = System.getProperty("teletau.repoRoot")
                ?: error("Не задано системное свойство teletau.repoRoot (передаётся из Gradle, см. build.gradle.kts)")
            Path.of(root, "contracts", "test-vectors", "bashkir-text")
        }

        val suites: List<VectorSuite> by lazy {
            Files.list(vectorsDir).use { stream ->
                stream.filter { it.name.endsWith(".json") }.sorted().toList()
            }.map(::readSuite)
        }

        fun readSuite(path: Path): VectorSuite {
            val root = Json.parseToJsonElement(path.readText()).jsonObject
            return VectorSuite(
                file = path.name,
                suite = root.string("suite"),
                version = root.getValue("version").jsonPrimitive.int,
                function = root.string("function"),
                cases = root.getValue("cases").jsonArray.map { element ->
                    val case = element.jsonObject
                    VectorCase(case.string("id"), case.string("input"), case.string("expected"), case.string("note"))
                },
            )
        }

        fun JsonObject.string(key: String): String = getValue(key).jsonPrimitive.content

        /** Алфавит для свойств — тот же, что в TS- и Swift-тестах. */
        val ALPHABET: List<String> = buildList {
            listOf(
                "абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБЕЁКОРСТХ",
                "әөүғҡңҙҫһӘӨҮҒҠҢҘҪҺ",
                "aeopcxyhkqAEOPCXYHKQ",
                "äöüçğñðəɵÄÖÜÇĞÑÐƏƟ",
                "қҥұґӻӡӧӓӱҟӄӈ",
            ).forEach { group -> group.codePoints().forEach { add(String(Character.toChars(it))) } }
            addAll(
                listOf(
                    "̀", "́", "̆", "̈", "̧",
                    "​", "‌", "‍", "⁠", "﻿", "­",
                    " ", "\t", "\n", " ", " ",
                    "🐝", "👨", "👩", "-", ".", "1", "Σ", "İ", "ß",
                ),
            )
        }

        /** 2000 строк из детерминированного генератора (SplitMix64) — одни и те же при каждом запуске. */
        val PROPERTY_INPUTS: List<String> by lazy {
            var state = 20_261_102L
            fun next(): Long {
                state += -0x61c8864680b583ebL
                var z = state
                z = (z xor (z ushr 30)) * -0x40a7b892e31b1a47L
                z = (z xor (z ushr 27)) * -0x6b2fb644ecceee15L
                return z xor (z ushr 31)
            }
            fun nextInt(bound: Int): Int = ((next() ushr 1) % bound).toInt()
            List(2000) { buildString { repeat(nextInt(41)) { append(ALPHABET[nextInt(ALPHABET.size)]) } } }
        }

        fun escaped(s: String): String = s.codePoints().toArray().joinToString("") { cp ->
            if (cp in 0x20..0x7E) cp.toChar().toString() else "\\u{%04X}".format(cp)
        }

        fun codePointCount(s: String): Int = s.codePointCount(0, s.length)
    }

    @Test
    fun `directory contains exactly the suites known to this port`() {
        assertEquals(SUPPORTED_VERSIONS.keys.sorted(), suites.map { it.file }, "Наборы в $vectorsDir")
        suites.forEach { suite ->
            check(suite.function in FUNCTIONS) { "${suite.file}: неизвестная функция ${suite.function}" }
            check(suite.version == SUPPORTED_VERSIONS[suite.file]) {
                "${suite.file}: версия набора ${suite.version}, порт реализует ${SUPPORTED_VERSIONS[suite.file]} — обновите BashkirText"
            }
            check(suite.cases.isNotEmpty()) { "${suite.file}: пустой набор" }
        }
    }

    @Test
    fun `case ids are unique within each suite`() {
        suites.forEach { suite ->
            val ids = suite.cases.map { it.id }
            assertEquals(ids.size, ids.toSet().size, "${suite.file}: повторяющиеся id")
        }
    }

    @TestFactory
    fun vectors(): List<DynamicNode> = suites.map { suite ->
        val fn = FUNCTIONS[suite.function] ?: error("${suite.file}: неизвестная функция ${suite.function}")
        DynamicContainer.dynamicContainer(
            suite.suite,
            suite.cases.map { case ->
                DynamicTest.dynamicTest("${case.id}: ${case.note}") {
                    assertEquals(
                        case.expected,
                        fn(case.input),
                        "${suite.suite} ${case.id}: ${case.note} — input \"${escaped(case.input)}\"",
                    )
                }
            },
        )
    }

    @TestFactory
    fun `normalize, toComparable and fold are idempotent and return NFC on 2000 seeded strings`(): List<DynamicTest> =
        FUNCTIONS.map { (name, fn) ->
            DynamicTest.dynamicTest(name) {
                PROPERTY_INPUTS.forEach { input ->
                    val once = fn(input)
                    assertEquals(once, fn(once), "$name не идемпотентна на \"${escaped(input)}\"")
                    assertEquals(Normalizer.normalize(once, Normalizer.Form.NFC), once, "$name(\"${escaped(input)}\") не в NFC")
                }
            }
        }

    /** Длинные цепочки ZWJ/ZWNJ: удаление обязано быть линейным — квадратичное на таких длинах не уложится в тест. */
    @Test
    fun `joiner chains of 200 000 are processed correctly`() {
        val zwj = "‍"
        val zwnj = "‌"
        assertEquals(200_000, codePointCount(BashkirText.normalize(zwj.repeat(200_000))), "соединители без соседей-букв сохраняются")
        assertEquals("ҡы", BashkirText.normalize("ҡ" + (zwj + zwnj).repeat(100_000) + "ы"))
        val emoji = "🐝" + zwj.repeat(100_000) + "🍯"
        for (out in listOf(BashkirText.normalize(emoji), BashkirText.toComparable(emoji), BashkirText.fold(emoji))) {
            assertEquals(100_002, codePointCount(out))
        }
    }

    /**
     * Линейность проверяется отношением времени t(4n)/t(n), а не абсолютным порогом:
     * равномерное замедление машины (загруженный CI) отношение не меняет. Линейный алгоритм даёт ≈4, квадратичный ≈16;
     * порог 8 — посередине в логарифмической шкале.
     */
    @TestFactory
    fun `joiner chains are processed in linear time`(): List<DynamicTest> {
        val zwj = "‍"
        val zwnj = "‌"
        val chains: List<Triple<String, (Int) -> String, (String) -> Int>> = listOf(
            Triple("ZWJ without letter neighbours", { n -> zwj.repeat(n) }, { s -> codePointCount(BashkirText.normalize(s)) }),
            Triple("ZWJ/ZWNJ between letters", { n -> "ҡ" + (zwj + zwnj).repeat(n / 2) + "ы" }, { s -> codePointCount(BashkirText.normalize(s)) }),
            Triple("ZWJ between emoji", { n -> "🐝" + zwj.repeat(n) + "🍯" }, { s ->
                codePointCount(BashkirText.normalize(s)) + codePointCount(BashkirText.toComparable(s)) + codePointCount(BashkirText.fold(s))
            }),
        )
        return chains.map { (name, make, run) ->
            DynamicTest.dynamicTest("$name: t(4n)/t(n) < 8") {
                val ratio = growthRatio(5_000, make, run)
                println("bashkir-text perf: $name — t(4n)/t(n) = ${"%.2f".format(ratio)}")
                check(ratio < 8) { "$name: t(4n)/t(n) = $ratio" }
            }
        }
    }

    /**
     * Время вызова — минимум по многим одиночным замерам, малый и большой вход чередуются: вытеснение потока
     * и сборка мусора время только увеличивают, поэтому минимум устойчив к загрузке машины.
     */
    private fun growthRatio(n: Int, make: (Int) -> String, run: (String) -> Int, samples: Int = 25, budgetMs: Double = 3_000.0): Double {
        val small = make(n)
        val big = make(4 * n)
        var sink = 0
        repeat(3) { sink += run(small) + run(big) } // прогрев JIT
        var bestSmall = Double.MAX_VALUE
        var bestBig = Double.MAX_VALUE
        val start = System.nanoTime()
        var i = 0
        while (i < samples && (System.nanoTime() - start) / 1_000_000.0 < budgetMs) {
            var t = System.nanoTime()
            sink += run(small)
            bestSmall = minOf(bestSmall, (System.nanoTime() - t) / 1_000_000.0)
            t = System.nanoTime()
            sink += run(big)
            bestBig = minOf(bestBig, (System.nanoTime() - t) / 1_000_000.0)
            i++
        }
        check(sink != Int.MIN_VALUE)
        return bestBig / bestSmall
    }

    @Test
    fun `long input of 200 000 code points`() {
        val long = "ә".repeat(100_000) + "Ҡ".repeat(100_000)
        assertEquals(200_000, codePointCount(BashkirText.normalize(long)))
        assertEquals(200_000, codePointCount(BashkirText.toComparable(long)))
        assertEquals("а".repeat(100_000) + "к".repeat(100_000), BashkirText.fold(long))
    }
}
