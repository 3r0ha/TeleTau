package ru.teletau.core.designsystem

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Заголовки не рвут слова посередине («башкирска / я»): [fitText] уменьшает шрифт, пока самое длинное слово не встанет
 * целиком, и только если не помогло — включает перенос по слогам; [fitBlock] решает, помещается ли надпись вывески в
 * ровный фон или уходит под картинку.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "w400dp-h400dp-mdpi")
class FitTextTest {
    @get:Rule
    val compose = createComposeRule()

    private fun measurer(fontScale: Float = 1f): TextMeasurer {
        var m: TextMeasurer? = null
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(1f, fontScale)) { m = rememberTextMeasurer() }
        }
        compose.waitForIdle()
        return m!!
    }

    @Test
    fun words_breakOnlyBetweenWordsAndAfterHyphen() {
        assertEquals(listOf("Башкирская", "деревня"), unbreakableWords("Башкирская деревня"))
        assertEquals(listOf("Шульган-", "Таш"), unbreakableWords("Шульган-Таш"))
        assertEquals(listOf("Вчера,", "сегодня,", "завтра"), unbreakableWords("Вчера, сегодня,  завтра"))
    }

    @Test
    fun longWord_shrinksUntilItFitsWhole_insteadOfBreaking() {
        val m = measurer(fontScale = 1.3f)
        val style = TeleTauText.title1
        val word = m.measure("Башкирская", style, softWrap = false).size.width
        // Ширина на 20 % меньше слова: шрифт мельчает, переноса по слогам нет.
        val fit = fitText(m, "Башкирская деревня", style, (word * 0.8f).toInt(), Constraints.Infinity, maxLines = 2, minScale = 0.6f)
        assertTrue("шрифт уменьшен: ${fit.scale}", fit.scale < 1f && fit.scale >= 0.6f)
        assertTrue("без переноса по слогам", !fit.hyphens)
        val shrunk = m.measure("Башкирская", style.scaledBy(fit.scale), softWrap = false).size.width
        assertTrue("слово целиком: $shrunk ≤ ${(word * 0.8f).toInt()}", shrunk <= (word * 0.8f).toInt())
        // Хватает ширины — шрифт не трогаем.
        assertEquals(1f, fitText(m, "Башкирская деревня", style, word * 3, Constraints.Infinity, 2, 0.6f).scale)
    }

    @Test
    fun tooNarrowEvenAtMinScale_fallsBackToHyphens() {
        val m = measurer()
        val word = m.measure("Башкирская", TeleTauText.title1, softWrap = false).size.width
        val fit = fitText(m, "Башкирская", TeleTauText.title1, word / 3, Constraints.Infinity, maxLines = 2, minScale = 0.6f)
        assertEquals(0.6f, fit.scale)
        assertTrue("перенос по слогам с дефисом", fit.hyphens)
    }

    @Test
    fun signBlock_fitsInCalmAreaOrGoesBelow() {
        val m = measurer()
        val items = listOf("Башкирская деревня" to TeleTauText.title3, "Еда" to TeleTauText.headline)
        assertNotNull("на 412 dp помещается", fitBlock(m, items, maxWidth = 160, maxHeight = 120, extraHeight = 34))
        assertNull("в узкий ровный фон не помещается — под картинку", fitBlock(m, items, maxWidth = 60, maxHeight = 60, extraHeight = 34))
    }
}
