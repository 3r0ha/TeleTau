package ru.teletau.feature.student

import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import ru.teletau.core.designsystem.ThemeChoice
import ru.teletau.feature.student.common.DefaultThemeSetting
import ru.teletau.feature.student.common.PrefsThemeSetting

/** «Тёмная тема» в SharedPreferences: без выбора — светлая, даже в тёмной системе; выбор сохраняется и читается после перезапуска. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ThemeSettingTest {
    private fun prefs() = RuntimeEnvironment.getApplication().getSharedPreferences("teletau.settings.theme-test", Context.MODE_PRIVATE)
        .also { it.edit().clear().commit() }

    @Test
    @Config(qualifiers = "night")
    fun noChoice_isLight_evenInDarkSystem() {
        val setting = PrefsThemeSetting(prefs())
        assertEquals(ThemeChoice.Light, setting.choice.value)
        assertFalse(setting.choice.value.isDark)
        assertEquals(ThemeChoice.Light, DefaultThemeSetting.choice.value)
    }

    @Test
    fun choice_isSavedAndReadBack() {
        val prefs = prefs()
        val setting = PrefsThemeSetting(prefs)
        setting.setDark(true)
        assertEquals(ThemeChoice.Dark, setting.choice.value)
        // Новый экземпляр над тем же файлом — как после перезапуска приложения.
        assertEquals(ThemeChoice.Dark, PrefsThemeSetting(prefs).choice.value)
        assertTrue(PrefsThemeSetting(prefs).choice.value.isDark)

        setting.setDark(false)
        assertEquals(ThemeChoice.Light, setting.choice.value)
        assertEquals(ThemeChoice.Light, PrefsThemeSetting(prefs).choice.value)
        assertFalse(PrefsThemeSetting(prefs).choice.value.isDark)
    }

    @Test
    fun unknownValue_fallsBackToLight() {
        val prefs = prefs()
        prefs.edit().putString(PrefsThemeSetting.KEY, "sepia").commit()
        assertEquals(ThemeChoice.Light, PrefsThemeSetting(prefs).choice.value)
    }
}
