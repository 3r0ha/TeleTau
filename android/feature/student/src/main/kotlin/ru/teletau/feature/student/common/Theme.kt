package ru.teletau.feature.student.common

import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import ru.teletau.core.designsystem.ThemeChoice

/** Выключатель «Тёмная тема» в профиле: настройка устройства, на сервер не уходит. */
interface ThemeSetting {
    /** Выбор на устройстве; ещё не выбирали — [ThemeChoice.Light]. */
    val choice: StateFlow<ThemeChoice>
    fun setDark(on: Boolean)
}

/** Выбор в `SharedPreferences` под ключом [KEY] (`"dark"` или `"light"`); ключа нет или значение другое — светлая. */
class PrefsThemeSetting(private val prefs: SharedPreferences) : ThemeSetting {
    private val state = MutableStateFlow(read(prefs))
    override val choice: StateFlow<ThemeChoice> = state.asStateFlow()

    override fun setDark(on: Boolean) {
        val next = ThemeChoice.of(on)
        prefs.edit().putString(KEY, if (on) DARK else LIGHT).apply()
        state.value = next
    }

    companion object {
        const val KEY = "ui.theme"
        private const val DARK = "dark"
        private const val LIGHT = "light"

        fun read(prefs: SharedPreferences): ThemeChoice =
            if (prefs.getString(KEY, null) == DARK) ThemeChoice.Dark else ThemeChoice.Light
    }
}

/** Без хранения: превью, снимки экранов и тесты — светлая тема. */
object DefaultThemeSetting : ThemeSetting {
    override val choice: StateFlow<ThemeChoice> = MutableStateFlow(ThemeChoice.Light).asStateFlow()
    override fun setDark(on: Boolean) = Unit
}
