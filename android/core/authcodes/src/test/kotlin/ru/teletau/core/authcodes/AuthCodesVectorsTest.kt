package ru.teletau.core.authcodes

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DynamicContainer
import org.junit.jupiter.api.DynamicNode
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.name
import kotlin.io.path.readText

/**
 * Общие векторы `contracts/test-vectors/qr-card` и `class-code` — те же, что проходит эталон TS (`@teletau/auth-codes`).
 * `expected` сравнивается целиком, как структура: лишние или недостающие поля — ошибка (README наборов).
 * Векторы не правятся под реализацию: расхождение — ошибка порта.
 */
class AuthCodesVectorsTest {

    private companion object {
        /** Версии наборов, которые реализует порт. Новый набор или версия — явно принять здесь. */
        val SUPPORTED_VERSIONS: Map<String, Int> = mapOf(
            "qr-card/parse.json" to 2,
            "qr-card/build.json" to 2,
            "qr-card/generate.json" to 2,
            "class-code/parse.json" to 1,
            "class-code/generate.json" to 1,
            "login-card/parse.json" to 2,
            "login-card/build.json" to 2,
            "login-card/generate.json" to 2,
        )

        val root: Path by lazy {
            Path.of(System.getProperty("teletau.repoRoot") ?: error("Не задано системное свойство teletau.repoRoot"), "contracts", "test-vectors")
        }

        fun hex(s: String): ByteArray = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

        fun qrParse(input: JsonElement): JsonObject = when (val r = QrCardCodec.parse(input.jsonPrimitive.content)) {
            is QrParseResult.Ok -> buildJsonObject {
                put("ok", true); put("seat", r.card.seat); put("secret", r.card.secret); put("payload", r.card.payload)
            }
            is QrParseResult.Error -> buildJsonObject { put("ok", false); put("error", r.error.code) }
        }

        fun qrBuild(input: JsonElement): JsonObject {
            val o = input.jsonObject
            val payload = QrCardCodec.buildPayload(o.str("seat"), o.str("secret"))
            return buildJsonObject { put("payload", payload); put("link", QrCardCodec.buildLink(o.str("baseUrl"), payload)) }
        }

        fun qrGenerate(input: JsonElement): JsonObject {
            val card = QrCardCodec.fromRandomBytes(hex(input.jsonPrimitive.content))
            return buildJsonObject { put("seat", card.seat); put("secret", card.secret); put("payload", card.payload) }
        }

        fun classParse(input: JsonElement): JsonObject = when (val r = ClassCodeCodec.parse(input.jsonPrimitive.content)) {
            is ClassCodeParseResult.Ok -> buildJsonObject { put("ok", true); put("code", r.code.code); put("display", r.code.display) }
            is ClassCodeParseResult.Error -> buildJsonObject { put("ok", false); put("error", r.error.code) }
        }

        fun classGenerate(input: JsonElement): JsonObject {
            val code = ClassCodeCodec.fromRandomBytes(hex(input.jsonPrimitive.content))
            return buildJsonObject { put("code", code.code); put("display", code.display) }
        }

        fun loginParse(input: JsonElement): JsonObject = when (val r = LoginCardCodec.parse(input.jsonPrimitive.content)) {
            is LoginCardParseResult.Ok -> buildJsonObject {
                put("ok", true); put("kind", r.card.kind.code); put("handle", r.card.handle); put("secret", r.card.secret); put("payload", r.card.payload)
            }
            is LoginCardParseResult.Error -> buildJsonObject { put("ok", false); put("error", r.error.code) }
        }

        fun personalBuild(input: JsonElement): JsonObject {
            val o = input.jsonObject
            return buildJsonObject { put("payload", LoginCardCodec.buildPersonalPayload(o.str("handle"), o.str("secret"))) }
        }

        fun personalGenerate(input: JsonElement): JsonObject {
            val card = LoginCardCodec.personalFromRandomBytes(hex(input.jsonPrimitive.content))
            return buildJsonObject { put("handle", card.handle); put("secret", card.secret); put("payload", card.payload) }
        }

        val FUNCTIONS: Map<String, (JsonElement) -> JsonObject> = mapOf(
            "parseLoginCard" to ::loginParse,
            "buildPersonalCard" to ::personalBuild,
            "personalCardFromRandomBytes" to ::personalGenerate,
            "parseQrPayload" to ::qrParse,
            "buildQrCard" to ::qrBuild,
            "qrCardFromRandomBytes" to ::qrGenerate,
            "parseClassCode" to ::classParse,
            "classCodeFromRandomBytes" to ::classGenerate,
        )

        fun JsonObject.str(key: String): String = getValue(key).jsonPrimitive.content

        fun suiteFiles(): List<Path> = listOf("qr-card", "class-code", "login-card").flatMap { dir ->
            Files.list(root.resolve(dir)).use { s -> s.filter { it.name.endsWith(".json") }.sorted().toList() }
        }

        fun key(path: Path): String = "${path.parent.name}/${path.name}"
    }

    @Test
    fun everySuiteIsDeclared() {
        assertEquals(SUPPORTED_VERSIONS.keys, suiteFiles().map(::key).toSet(), "Наборы qr-card/class-code и SUPPORTED_VERSIONS расходятся")
    }

    @TestFactory
    fun vectors(): List<DynamicNode> = suiteFiles().map { path ->
        val suite = Json.parseToJsonElement(path.readText()).jsonObject
        val name = key(path)
        assertEquals(SUPPORTED_VERSIONS[name], suite.getValue("version").jsonPrimitive.int, "$name: версия набора не поддержана портом")
        val fn = FUNCTIONS[suite.str("function")] ?: error("$name: порт не знает функцию ${suite.str("function")}")
        DynamicContainer.dynamicContainer(
            name,
            suite.getValue("cases").jsonArray.map { element ->
                val case = element.jsonObject
                DynamicTest.dynamicTest("${case.str("id")}: ${case["note"]?.jsonPrimitive?.content.orEmpty()}") {
                    assertEquals(case.getValue("expected"), fn(case.getValue("input")), case.str("id"))
                }
            },
        )
    }

    /** SplitMix64 с тем же seed, что fast-check в эталоне (README: порты повторяют свойства своим генератором). */
    private class SplitMix64(private var state: Long) {
        fun next(): Long {
            state += -0x61c8864680b583ebL
            var z = state
            z = (z xor (z ushr 30)) * -0x40a7b892e31b1a47L
            z = (z xor (z ushr 27)) * -0x6b2fb644ecceee15L
            return z xor (z ushr 31)
        }
        fun bytes(n: Int): ByteArray = ByteArray(n) { next().toByte() }
        fun below(n: Int): Int = ((next() ushr 1) % n).toInt()
    }

    @Test
    fun properties_roundTripAndChecksumCatchesTypos() {
        val rnd = SplitMix64(20261103L)
        repeat(2000) {
            val card = QrCardCodec.fromRandomBytes(rnd.bytes(36))
            // Сборка и разбор взаимно обратны — в том числе через ссылку и в нижнем регистре.
            assertEquals(QrParseResult.Ok(card), QrCardCodec.parse(card.payload))
            assertEquals(QrParseResult.Ok(card), QrCardCodec.parse(QrCardCodec.buildLink("https://teletau.study", card.payload).lowercase()))
            // Любая замена одного символа места или секрета — bad_checksum.
            val body = card.seat + card.secret
            val i = rnd.below(body.length)
            val other = Crockford.ALPHABET[(Crockford.value(body[i])!! + 1 + rnd.below(31)) % 32]
            val typo = body.substring(0, i) + other + body.substring(i + 1)
            val broken = "TT1.${typo.take(10)}.${typo.drop(10)}.${card.payload.takeLast(2)}"
            assertEquals(QrParseResult.Error(QrParseError.BAD_CHECKSUM), QrCardCodec.parse(broken))
            // Нормализация идемпотентна, разбор не бросает на произвольной строке.
            val junk = String(CharArray(rnd.below(40)) { (rnd.below(0x500) + 0x20).toChar() })
            assertEquals(Crockford.normalizeCodeInput(junk), Crockford.normalizeCodeInput(Crockford.normalizeCodeInput(junk)))
            QrCardCodec.parse(junk)
            ClassCodeCodec.parse(junk)
        }
    }

    @Test
    fun properties_prefixSwapIsAlwaysCaught() {
        // Свойство эталона (seed 20261105): подмена префикса TT1 ↔ TP1 всегда даёт bad_checksum.
        val rnd = SplitMix64(20261105L)
        repeat(2000) {
            val personal = LoginCardCodec.personalFromRandomBytes(rnd.bytes(36))
            assertEquals(LoginCardParseResult.Ok(personal), LoginCardCodec.parse(personal.payload.lowercase()))
            assertEquals(LoginCardParseResult.Error(QrParseError.BAD_CHECKSUM), LoginCardCodec.parse("TT1" + personal.payload.drop(3)))
            val seat = QrCardCodec.fromRandomBytes(rnd.bytes(36))
            assertEquals(LoginCardParseResult.Error(QrParseError.BAD_CHECKSUM), LoginCardCodec.parse("TP1" + seat.payload.drop(3)))
        }
    }

    @Test
    fun secretIsNotPrinted() {
        val card = QrCardCodec.fromRandomBytes(ByteArray(36) { it.toByte() })
        assert(!card.toString().contains(card.secret)) { "Секрет карточки не должен попадать в toString (логи)" }
        assertEquals(JsonPrimitive(card.seat), JsonPrimitive(card.seat))
    }
}
