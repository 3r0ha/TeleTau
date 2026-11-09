package ru.teletau.core.designsystem

import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** Стартовый экран: доступность (роли, описания, цель нажатия, прокрутка) и башкирские кодовые точки. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class StartScreenSemanticsTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun startScreen_isAccessible() {
        var clicks = 0
        composeRule.setContent {
            TeleTauTheme(darkTheme = false) { StartScreen(onStart = { clicks++ }) }
        }

        composeRule.onNodeWithText("ТелеТау").assert(isHeading())
        composeRule.onNodeWithContentDescription("Медовая ячейка сот")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Image))
        composeRule.onNodeWithText("Начать")
            .assertHasClickAction()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
            .assertHeightIsAtLeast(TeleTauSize.touchMin)
            .performClick()
        assertEquals(1, clicks)
        composeRule.onNode(hasScrollAction()).assertExists()
    }

    @Test
    fun glyphLine_usesCorrectBashkirCodePoints() {
        // CLAUDE.md, правило 7: только правильные кодовые точки (никаких двойников из соседних алфавитов).
        val expected = intArrayOf(
            0x04D8, 0x04D9, 0x04E8, 0x04E9, 0x04AE, 0x04AF, 0x0492, 0x0493, 0x04A0,
            0x04A1, 0x04A2, 0x04A3, 0x0498, 0x0499, 0x04AA, 0x04AB, 0x04BA, 0x04BB,
        ).toList()
        val line = RuntimeEnvironment.getApplication().getString(R.string.teletau_start_glyph_line)
        val letters = line.codePoints().toArray().filter { Character.isLetter(it) }
        assertEquals(expected, letters)
    }
}
