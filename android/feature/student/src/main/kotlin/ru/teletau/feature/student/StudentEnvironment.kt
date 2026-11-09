package ru.teletau.feature.student

import kotlinx.coroutines.flow.StateFlow
import ru.teletau.core.session.TeleTauClient
import ru.teletau.feature.student.common.Speaker
import java.net.URI

/** Что экранам ученика даёт приложение (`:app`): клиент API текущего адреса, настройки и память устройства. */
interface StudentEnvironment {
    /** Клиент API; новый адрес сервера — новый клиент (и новая сессия). */
    val client: StateFlow<TeleTauClient>
    val apiBaseUrl: StateFlow<String>
    /** Адрес сайта, если его задали вручную; null — выводится из адреса API ([webBaseFor]). */
    val webBaseOverride: StateFlow<String?>
    /** Сохранить адреса сервера: API и (необязательно) сайта. */
    fun setServer(apiUrl: String, webUrl: String?)
    /** Клиент для проверки адреса до сохранения. */
    fun probe(url: String): TeleTauClient
    val appVersion: String
    /** Записи носителя («Послушать»). */
    val speaker: Speaker
    /** Сколько вариантов «созрело» и сколько мёда за голоса ученик уже видел в профиле на этом устройстве. */
    fun cellsSeen(accountId: String): Pair<Int, Int>?
    fun saveCellsSeen(accountId: String, matured: Int, honey: Int)
    /** Звуки интерфейса и выключатель «Звуки» (настройка устройства). */
    val sounds: ru.teletau.feature.student.common.UiSounds get() = ru.teletau.feature.student.common.SilentSounds
    /** Выключатель «Тёмная тема» (настройка устройства); без выбора — светлая. */
    val theme: ru.teletau.feature.student.common.ThemeSetting get() = ru.teletau.feature.student.common.DefaultThemeSetting
    /** Видел ли ученик знакомство с пчелой на этом устройстве (хранится только номер аккаунта, без ПДн). */
    fun introSeen(accountId: String): Boolean = true
    fun saveIntroSeen(accountId: String) = Unit
    /** Время (подменяется в тестах). */
    fun now(): Long = System.currentTimeMillis()
}

/**
 * Адрес сайта по адресу API, если его не задали: тот же компьютер, порт веба 3000 рядом с портом API 4000
 * (docs/demo/M2.md); иначе — тот же адрес без пути.
 */
fun webBaseFor(apiUrl: String): String = runCatching {
    val u = URI(apiUrl.trim())
    val port = if (u.port == 4000) 3000 else u.port
    URI(u.scheme ?: "http", null, u.host, port, null, null, null).toString().trimEnd('/')
}.getOrDefault(apiUrl.trim().trimEnd('/'))
