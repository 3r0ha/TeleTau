package ru.teletau.app

import android.content.Context
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import ru.teletau.core.network.models.DeviceInfo
import ru.teletau.core.network.models.DevicePlatform
import ru.teletau.core.session.InMemoryTokenStore
import ru.teletau.core.session.TeleTauClient
import ru.teletau.feature.student.StudentEnvironment
import ru.teletau.feature.student.common.MediaSpeaker
import ru.teletau.feature.student.common.PrefsThemeSetting
import ru.teletau.feature.student.common.Speaker
import ru.teletau.feature.student.common.SynthSounds
import ru.teletau.feature.student.common.ThemeSetting
import ru.teletau.feature.student.common.UiSounds
import java.util.UUID

/**
 * Окружение экранов ученика: адреса API и сайта (экран «Адрес сервера» для показа), клиент API на общем движке OkHttp,
 * сессия в Keystore, идентификатор установки (`DeviceInfo.installId` — один раз на установку) и память профиля.
 */
class AppEnvironment(context: Context) : StudentEnvironment {
    private val settings = context.getSharedPreferences("teletau.settings", Context.MODE_PRIVATE)
    private val engine: HttpClientEngine = OkHttp.create()
    private val store = KeystoreTokenStore(context)

    private val installId: String = settings.getString(INSTALL_ID, null) ?: UUID.randomUUID().toString().also {
        settings.edit().putString(INSTALL_ID, it).apply()
    }
    private val device = DeviceInfo(installId = installId, platform = DevicePlatform.android, appVersion = BuildConfig.VERSION_NAME)

    private val _apiBaseUrl = MutableStateFlow(settings.getString(API_URL, null) ?: BuildConfig.DEFAULT_API_URL)
    override val apiBaseUrl: StateFlow<String> = _apiBaseUrl.asStateFlow()

    private val _webBase = MutableStateFlow(settings.getString(WEB_URL, null))
    override val webBaseOverride: StateFlow<String?> = _webBase.asStateFlow()

    override val speaker: Speaker = MediaSpeaker(context.applicationContext)

    override val sounds: UiSounds = SynthSounds(
        context.applicationContext,
        initial = settings.getBoolean(SOUNDS, true),
        save = { on -> settings.edit().putBoolean(SOUNDS, on).apply() },
        speaking = { speaker.playing.value != null },
    )

    override val theme: ThemeSetting = PrefsThemeSetting(settings)

    private val _client = MutableStateFlow(build(_apiBaseUrl.value))
    override val client: StateFlow<TeleTauClient> = _client.asStateFlow()

    private fun build(url: String) = TeleTauClient(url, engine, store, device)

    override fun setServer(apiUrl: String, webUrl: String?) {
        settings.edit().putString(API_URL, apiUrl).putString(WEB_URL, webUrl).commit()
        _webBase.value = webUrl
        if (apiUrl == _apiBaseUrl.value) return
        // Сессия принадлежит серверу: на другом адресе её refresh-токен не действует.
        store.clear()
        _apiBaseUrl.value = apiUrl
        _client.value = build(apiUrl)
    }

    override fun probe(url: String): TeleTauClient = TeleTauClient(url, engine, InMemoryTokenStore(), device)

    override val appVersion: String = BuildConfig.VERSION_NAME

    override fun cellsSeen(accountId: String): Pair<Int, Int>? =
        settings.getString("cells.$accountId", null)?.split(',')?.takeIf { it.size == 2 }?.let { (m, h) -> (m.toIntOrNull() ?: return null) to (h.toIntOrNull() ?: return null) }

    override fun saveCellsSeen(accountId: String, matured: Int, honey: Int) {
        settings.edit().putString("cells.$accountId", "$matured,$honey").apply()
    }

    override fun introSeen(accountId: String): Boolean = settings.getBoolean("intro.$accountId", false)

    override fun saveIntroSeen(accountId: String) {
        settings.edit().putBoolean("intro.$accountId", true).apply()
    }

    private companion object {
        const val INSTALL_ID = "device.installId"
        const val API_URL = "api.baseUrl"
        const val WEB_URL = "web.baseUrl"
        const val SOUNDS = "ui.sounds"
    }
}
