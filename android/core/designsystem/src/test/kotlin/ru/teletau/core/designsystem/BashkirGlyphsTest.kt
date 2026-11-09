package ru.teletau.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.BasicText
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.text.intl.LocaleList
import androidx.compose.ui.unit.sp
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Башкирские формы Ҫ и Ҙ (docs/05 §4): у Nunito они включаются OpenType `locl` языковой системы BSH. Тест рисует
 * одни и те же буквы стилем башкирского текста из API ([TeleTauText.bashkir], локаль `ba`) и с локалью `cv` (чувашская
 * форма с седилью) — картинки обязаны различаться, иначе шейпер не применил `locl` и ребёнок видит чужую форму буквы.
 * Снимок рядом — `bashkir_glyphs.png` (сверху ba, снизу cv).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "w820dp-h220dp-mdpi")
class BashkirGlyphsTest {
    @get:Rule
    val compose = createComposeRule()

    private val special = listOf("Ҫ", "ҫ", "Ҙ", "ҙ")
    private val others = listOf("Ә", "ө", "ү", "ғ", "ҡ", "ң", "һ")
    private val locales = listOf("ba", "cv")
    private val NOISE = 12

    private fun diff(a: ImageBitmap, b: ImageBitmap): Int {
        if (a.width != b.width || a.height != b.height) return Int.MAX_VALUE
        val pa = a.toPixelMap()
        val pb = b.toPixelMap()
        var n = 0
        for (x in 0 until a.width) for (y in 0 until a.height) if (pa[x, y] != pb[x, y]) n++
        return n
    }

    @Test
    fun bashkirLocale_selectsBashkirFormsOfEsAndZe() {
        compose.setContent {
            Column(Modifier.background(Color.White)) {
                locales.forEach { loc ->
                    Row {
                        (special + others).forEach { ch ->
                            // Ячейка фиксированной ширины: соседние буквы разной ширины не сдвигают глиф на доли пикселя.
                            Box(Modifier.size(width = 72.dp, height = 96.dp).testTag("$ch-$loc")) {
                                BasicText(ch, style = TeleTauText.bashkir(64.sp).copy(color = Color.Black, localeList = LocaleList(loc)))
                            }
                        }
                    }
                }
            }
        }
        compose.onRoot().captureRoboImage("bashkir_glyphs.png")
        fun img(ch: String, loc: String) = compose.onNodeWithTag("$ch-$loc").captureToImage()
        // Другой глиф — сотни пикселей разницы; одинаковый — единицы (сглаживание краёв). Прочие буквы — только для
        // снимка: у чувашской системы шрифта свои формы и других букв (например, ғ), сравнивать их с ba незачем.
        for (ch in special) assertTrue("$ch: формы для ba и cv совпали — locl BSH не применён", diff(img(ch, "ba"), img(ch, "cv")) > NOISE * 5)
    }
}
