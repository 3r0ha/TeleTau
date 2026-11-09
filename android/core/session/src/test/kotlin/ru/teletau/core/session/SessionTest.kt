package ru.teletau.core.session

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import ru.teletau.core.network.models.DeviceInfo
import ru.teletau.core.network.models.DevicePlatform
import java.io.IOException
import java.util.concurrent.atomic.AtomicInteger

/** Сессия: single-flight обновление, конец сессии, сеть, токен только где нужен, Problem Details. */
class SessionTest {

    private val device = DeviceInfo(installId = "0f8d4c3e-8a3b-4b6e-9e3f-2a1b3c4d5e6f", platform = DevicePlatform.android, appVersion = "test")

    private fun me(nick: String = "Смелая пчела") = """
        {"id":"7d3f0c7e-1111-4a8b-9c2d-000000000007","kind":"child","roles":["student"],"locale":"ru","teacherStatus":"none",
         "classes":[{"id":"5b000000-0000-4000-8000-000000000005","title":"5 «Б»","schoolName":"Демо-школа № 1","role":"student","seatNumber":7}],
         "pendingConsents":[],"nickname":"$nick","uiMode":"bortnik","futureField":{"x":1}}
    """.trimIndent()

    private fun authSession(access: String, refresh: String) = """
        {"accessToken":"$access","accessTokenExpiresAt":"2099-01-01T00:00:00Z","refreshToken":"$refresh",
         "refreshTokenExpiresAt":"2099-02-01T00:00:00Z","tokenType":"Bearer","account":${me()}}
    """.trimIndent()

    private fun MockRequestHandleScope.json(body: String, status: HttpStatusCode = HttpStatusCode.OK): HttpResponseData =
        respond(body, status, headersOf(HttpHeaders.ContentType, "application/json"))

    private fun MockRequestHandleScope.problem(status: Int, code: String, retryAfter: String? = null): HttpResponseData {
        val headers = buildList {
            add(HttpHeaders.ContentType to listOf("application/problem+json"))
            retryAfter?.let { add(HttpHeaders.RetryAfter to listOf(it)) }
        }
        return respond("""{"type":"about:blank","title":"Ошибка","status":$status,"code":"$code"}""", HttpStatusCode.fromValue(status), headersOf(*headers.toTypedArray()))
    }

    private fun stored(refresh: String = "ttr_old_refresh_token_000") = InMemoryTokenStore(StoredSession(refresh, "2099-02-01T00:00:00Z", null))

    private fun client(store: TokenStore, handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData) =
        TeleTauClient("http://api.test", MockEngine(handler), store, device)

    @Test
    fun concurrent401_triggerExactlyOneRefresh() = runTest {
        val refreshes = AtomicInteger()
        val store = stored()
        val client = client(store) { req ->
            when (req.url.encodedPath) {
                "/api/v1/auth/refresh" -> {
                    refreshes.incrementAndGet()
                    val body = String(req.body.toByteArray())
                    assertTrue(body.contains("ttr_old_refresh_token_000") && body.contains(device.installId), body)
                    assertNull(req.headers[HttpHeaders.Authorization], "refresh уходит без access-токена")
                    delay(50)
                    json(authSession("A2", "ttr_new_refresh_token_001"))
                }
                "/api/v1/me" -> if (req.headers[HttpHeaders.Authorization] == "Bearer A2") json(me()) else problem(401, "token_expired")
                else -> error("неожиданный путь ${req.url}")
            }
        }
        // Сессия с токеном A1, который сервер уже не принимает.
        client.session.establish(TeleTauJson.decodeFromString(ru.teletau.core.network.models.AuthSession.serializer(), authSession("A1", "ttr_old_refresh_token_000")))
        val results = (1..5).map { async { apiCall { client.identity.getMe() } } }.awaitAll()
        assertEquals(1, refreshes.get(), "refresh — строго один на все одновременные 401")
        assertTrue(results.all { it.nickname == "Смелая пчела" })
        assertEquals("ttr_new_refresh_token_001", store.load()?.refreshToken)
        assertTrue(client.session.state.value is SessionState.Authenticated)
    }

    @Test
    fun restore_exchangesStoredRefreshToken() = runTest {
        val store = stored()
        val client = client(store) { req ->
            assertEquals("/api/v1/auth/refresh", req.url.encodedPath)
            json(authSession("A9", "ttr_rotated_token_0000002"))
        }
        val state = client.session.restore()
        assertEquals("Смелая пчела", (state as SessionState.Authenticated).account.nickname)
        assertEquals("ttr_rotated_token_0000002", store.load()?.refreshToken)
        assertNotNull(client.session.cachedAccount())
    }

    @Test
    fun rejectedRefresh_endsSessionWithReason() = runTest {
        val store = stored()
        val client = client(store) { req ->
            when (req.url.encodedPath) {
                "/api/v1/auth/refresh" -> problem(401, "refresh_reused")
                else -> problem(401, "token_expired")
            }
        }
        val e = assertThrows<ApiProblem> { apiCall { client.learning.getCourse() }.let { } }
        assertEquals(401, e.status)
        assertEquals(SessionState.Anonymous("refresh_reused"), client.session.state.value)
        assertNull(store.load(), "отклонённая сессия стирается с устройства")
    }

    @Test
    fun networkFailureDuringRefresh_keepsSession() = runTest {
        val store = stored()
        val client = client(store) { throw IOException("нет сети") }
        assertThrows<NetworkFailure> { client.session.restore() }
        assertEquals(SessionState.Unknown, client.session.state.value)
        assertEquals("ttr_old_refresh_token_000", store.load()?.refreshToken, "без сети сессия не теряется")
    }

    @Test
    fun qrLogin_isAnonymousAndLaterRequestsCarryToken() = runTest {
        val seen = mutableListOf<Pair<String, String?>>()
        val client = client(InMemoryTokenStore()) { req ->
            seen += req.url.encodedPath to req.headers[HttpHeaders.Authorization]
            when (req.url.encodedPath) {
                "/api/v1/auth/qr" -> {
                    val body = TeleTauJson.parseToJsonElement(String(req.body.toByteArray())).jsonObject
                    assertEquals(setOf("payload", "device"), body.keys)
                    assertEquals(setOf("installId", "platform", "appVersion"), body.getValue("device").jsonObject.keys)
                    json(authSession("A1", "ttr_first_refresh_token_0"))
                }
                "/api/v1/course" -> json("""{"id":"ba-ru","contentVersion":1,"units":[]}""")
                else -> error("неожиданный путь")
            }
        }
        val account = client.loginWithQr("TT1.0123456789.ABCDEFGHJKMNPQRSTVWXYZ0123.6V")
        assertEquals("Смелая пчела", account.nickname)
        apiCall { client.learning.getCourse() }
        assertEquals(listOf("/api/v1/auth/qr" to null, "/api/v1/course" to "Bearer A1"), seen)
    }

    @Test
    fun problemDetails_mapToApiProblem() = runTest {
        val client = client(InMemoryTokenStore()) { req ->
            when (req.url.encodedPath) {
                "/api/v1/auth/class-code" -> problem(404, "class_code_not_found")
                else -> problem(429, "rate_limited", retryAfter = "2")
            }
        }
        val notFound = assertThrows<ApiProblem> { client.requestClassCode("K7Q4MZ", "nick.1") }
        assertEquals("class_code_not_found", notFound.code)
        val limited = assertThrows<ApiProblem> { apiCall { client.identity.suggestNicknames(3) }.let { } }
        assertEquals(2, limited.retryAfter)
        assertTrue(limited.isShortRateLimit())
    }

    @Test
    fun logout_clearsDeviceEvenOffline() = runTest {
        val store = stored()
        val client = client(store) { throw IOException("нет сети") }
        client.logout()
        assertNull(store.load())
        assertEquals(SessionState.Anonymous(null), client.session.state.value)
    }

    @Test
    fun uuid7_isVersion7AndTimeOrdered() {
        val a = Uuid7.next(1_000L)
        val b = Uuid7.next(2_000L)
        assertTrue(Regex("^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$").matches(a), a)
        assertTrue(a < b)
        assertFalse(Uuid7.next() == Uuid7.next())
    }
}
