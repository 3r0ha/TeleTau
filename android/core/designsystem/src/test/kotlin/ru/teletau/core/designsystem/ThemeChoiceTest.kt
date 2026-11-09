package ru.teletau.core.designsystem

import androidx.compose.ui.test.junit4.v2.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Выбор «Тёмная тема»: без выбора — светлая, даже в тёмной системе; [TeleTauTheme] отдаёт палитру выбора. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ThemeChoiceTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun choice_isDarkOnlyForDark() {
        assertTrue(ThemeChoice.Dark.isDark)
        assertFalse(ThemeChoice.Light.isDark)
        assertEquals(ThemeChoice.Dark, ThemeChoice.of(dark = true))
        assertEquals(ThemeChoice.Light, ThemeChoice.of(dark = false))
    }

    @Test
    @Config(qualifiers = "night")
    fun theme_withoutChoice_isLight_evenInDarkSystem() {
        var colors: TeleTauColors? = null
        var dark: Boolean? = null
        compose.setContent {
            TeleTauTheme {
                colors = TeleTauTheme.colors
                dark = TeleTauTheme.isDark
            }
        }
        compose.waitForIdle()
        assertSame(TeleTauLightColors, colors)
        assertEquals(false, dark)
    }

    @Test
    fun theme_providesPaletteOfChoice() {
        var colors: TeleTauColors? = null
        var dark: Boolean? = null
        // Robolectric по умолчанию — светлая система; выбор «тёмная» должен дать тёмную палитру.
        compose.setContent {
            TeleTauTheme(darkTheme = ThemeChoice.Dark.isDark) {
                colors = TeleTauTheme.colors
                dark = TeleTauTheme.isDark
            }
        }
        compose.waitForIdle()
        assertSame(TeleTauDarkColors, colors)
        assertEquals(true, dark)
    }
}
