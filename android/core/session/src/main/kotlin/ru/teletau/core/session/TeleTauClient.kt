package ru.teletau.core.session

import io.ktor.client.HttpClientConfig
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.api.Send
import io.ktor.client.plugins.api.createClientPlugin
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.Json
import ru.teletau.core.network.apis.CompetitionApi
import ru.teletau.core.network.apis.ConsensusApi
import ru.teletau.core.network.apis.IdentityApi
import ru.teletau.core.network.apis.LearningApi
import ru.teletau.core.network.apis.ProgressApi
import ru.teletau.core.network.apis.PublicApi
import ru.teletau.core.network.apis.SystemApi
import ru.teletau.core.network.infrastructure.HttpResponse
import ru.teletau.core.network.models.AgeBand
import ru.teletau.core.network.models.ClassCodeLoginRequest
import ru.teletau.core.network.models.LoginCardLoginRequest
import ru.teletau.core.network.models.SelfSignupRequest
import ru.teletau.core.network.models.ClassCodeLoginStatus
import ru.teletau.core.network.models.ClassCodeLoginTicket
import ru.teletau.core.network.models.DeviceInfo
import ru.teletau.core.network.models.GetPublicLeaderboardPeriodParameter
import ru.teletau.core.network.models.LogoutRequest
import ru.teletau.core.network.models.Me
import ru.teletau.core.network.models.PhraseOfDay
import ru.teletau.core.network.models.Problem
import ru.teletau.core.network.models.PublicLeaderboard
import ru.teletau.core.network.models.PublicLeaderboardPeriod
import ru.teletau.core.network.models.QrLoginRequest
import ru.teletau.core.network.models.RefreshRequest
import java.io.IOException
import java.nio.channels.UnresolvedAddressException

/**
 * JSON клиента: ответы открыты для новых полей (контракт — клиенты обязаны игнорировать неизвестные), поля без
 * значения не отправляются (сервер не принимает `null` и лишние поля — `additionalProperties: false`).
 */
public val TeleTauJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
}

/**
 * Клиент API приложения: сгенерированные операции контракта ([IdentityApi], [LearningApi]…) на одном движке Ktor,
 * сессия с single-flight обновлением ([SessionManager]) и вход ученика. Других путей к API у экранов нет.
 */
public class TeleTauClient(
    public val baseUrl: String,
    engine: HttpClientEngine,
    store: TokenStore,
    public val device: DeviceInfo,
    clock: () -> Long = System::currentTimeMillis,
) {
    private val publicConfig: (HttpClientConfig<*>) -> Unit = { it.common() }

    /** Операции без токена: вход, обновление, опрос заявки. Отдельный клиент — обновление не зацикливается. */
    private val publicIdentity = IdentityApi(baseUrl, engine, publicConfig)

    public val session: SessionManager = SessionManager(
        store = store,
        refresh = { token -> apiCall { publicIdentity.refreshSession(RefreshRequest(refreshToken = token, deviceInstallId = device.installId)) } },
        clock = clock,
    )

    private val authedConfig: (HttpClientConfig<*>) -> Unit = {
        it.common()
        it.install(TeleTauAuth) { session = this@TeleTauClient.session }
    }

    public val identity: IdentityApi = IdentityApi(baseUrl, engine, authedConfig)
    public val learning: LearningApi = LearningApi(baseUrl, engine, authedConfig)
    public val progress: ProgressApi = ProgressApi(baseUrl, engine, authedConfig)
    public val competition: CompetitionApi = CompetitionApi(baseUrl, engine, authedConfig)
    public val consensus: ConsensusApi = ConsensusApi(baseUrl, engine, authedConfig)
    public val system: SystemApi = SystemApi(baseUrl, engine, publicConfig)

    /** Вход по QR-карточке (полезная нагрузка уже проверена `QrCardCodec`). Возвращает аккаунт. */
    public suspend fun loginWithQr(payload: String): Me {
        val auth = apiCall { publicIdentity.loginWithQrCard(QrLoginRequest(payload = payload, device = device)) }
        session.establish(auth)
        return auth.account
    }

    /** Вход по личной карточке «Учусь сам» (`TP1.…`, полезная нагрузка уже проверена `LoginCardCodec`). */
    public suspend fun loginWithLoginCard(payload: String): Me {
        val auth = apiCall { publicIdentity.loginWithLoginCard(LoginCardLoginRequest(payload = payload, device = device)) }
        session.establish(auth)
        return auth.account
    }

    /** «Учусь сам» (ADR 0022): аккаунт без школы и без ПДн — устройство, ник из словаря и возрастной диапазон. */
    public suspend fun startSelf(nicknameId: String, ageBand: AgeBand, dailyGoal: Int?): Me {
        val auth = apiCall { publicIdentity.createSelfLearner(SelfSignupRequest(device = device, nicknameId = nicknameId, ageBand = ageBand, dailyGoal = dailyGoal)) }
        session.establish(auth)
        return auth.account
    }

    /** Заявка на вход по коду класса с ником из словаря. */
    public suspend fun requestClassCode(code: String, nicknameId: String): ClassCodeLoginTicket =
        apiCall { publicIdentity.requestClassCodeLogin(ClassCodeLoginRequest(code = code, nicknameId = nicknameId, device = device)) }

    /** Опрос заявки. Учитель одобрил — сессия устанавливается здесь же. */
    public suspend fun pollClassCode(requestId: String, pollToken: String): ClassCodeLoginStatus {
        val status = apiCall { publicIdentity.getClassCodeLoginStatus(requestId, pollToken, device.installId) }
        status.session?.let(session::establish)
        return status
    }

    /** Выйти на этом устройстве: сервер отзывает семейство сессии; без сети — выходим локально. */
    public suspend fun logout() {
        try {
            if (session.hasStoredSession()) apiCallUnit { identity.logout(LogoutRequest()) }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Сессия на сервере истечёт сама; на устройстве её больше нет.
        }
        session.end()
    }

    // ── фраза дня (публичная витрина без регистрации, ТЗ §3.6) ──

    /** Операции витрины без токена: адрес и движок те же, сессия не нужна. */
    private val publicShowcase: PublicApi = PublicApi(baseUrl, engine, publicConfig)

    /** Фраза дня (веб `/`): принятая пара «башкирский ← русский». Пар нет — только дата, [PhraseOfDay.pair] пуст. */
    public suspend fun getPhraseOfDay(): PhraseOfDay = apiCall { publicShowcase.getPhraseOfDay() }

    /** Доска почёта (ТЗ §4.5): топ школ и классов за период. Публичная — без токена, только агрегаты (правило 13). */
    public suspend fun getPublicLeaderboard(period: PublicLeaderboardPeriod = PublicLeaderboardPeriod.week): PublicLeaderboard =
        apiCall { publicShowcase.getPublicLeaderboard(GetPublicLeaderboardPeriodParameter.entries.first { it.value == period.value }) }

    private fun HttpClientConfig<*>.common() {
        expectSuccess = false
        install(ContentNegotiation) { json(TeleTauJson) }
        install(HttpTimeout) {
            connectTimeoutMillis = 10_000
            requestTimeoutMillis = 20_000
            socketTimeoutMillis = 20_000
        }
        defaultRequest { header(HttpHeaders.Accept, "application/json") }
    }
}

/** Плагин Ktor: Bearer-токен сессии и один повтор после обновления на 401. */
internal class TeleTauAuthConfig {
    var session: SessionManager? = null
}

internal val TeleTauAuth = createClientPlugin("TeleTauAuth", ::TeleTauAuthConfig) {
    val session = requireNotNull(pluginConfig.session) { "TeleTauAuth: не задана сессия" }
    on(Send) { request ->
        val token = session.validAccessToken()
        if (token != null) request.headers[HttpHeaders.Authorization] = "Bearer $token"
        val call = proceed(request)
        if (token == null || call.response.status != HttpStatusCode.Unauthorized) return@on call
        val fresh = session.refreshAfterRejected(token) ?: return@on call
        request.headers[HttpHeaders.Authorization] = "Bearer $fresh"
        proceed(request)
    }
}

/**
 * Выполнить операцию контракта и вернуть тело ответа. Не 2xx — [ApiProblem] (RFC 9457), нет связи —
 * [NetworkFailure]. Отмена корутины пробрасывается как есть.
 */
public suspend fun <T> apiCall(block: suspend () -> HttpResponse<T>): T {
    val response = execute(block)
    return response.body()
}

/** То же для операций без тела ответа (204). */
public suspend fun apiCallUnit(block: suspend () -> HttpResponse<Unit>) {
    execute(block)
}

private suspend fun <T> execute(block: suspend () -> HttpResponse<T>): HttpResponse<T> {
    val response = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: IOException) {
        throw NetworkFailure(e)
    } catch (e: UnresolvedAddressException) {
        throw NetworkFailure(e)
    } catch (e: IllegalArgumentException) {
        // Неверный адрес сервера в настройках (не разобрать URL) — для экрана это «нет связи».
        if (e is kotlinx.serialization.SerializationException) throw e
        throw NetworkFailure(e)
    }
    if (response.success) return response
    val text = try {
        response.response.bodyAsText()
    } catch (e: CancellationException) {
        throw e
    } catch (e: IOException) {
        throw NetworkFailure(e)
    }
    val problem = runCatching { TeleTauJson.decodeFromString(Problem.serializer(), text) }.getOrNull()
    throw ApiProblem(response.status, problem, parseRetryAfter(response.headers["Retry-After"]?.firstOrNull() ?: response.headers["retry-after"]?.firstOrNull()))
}
