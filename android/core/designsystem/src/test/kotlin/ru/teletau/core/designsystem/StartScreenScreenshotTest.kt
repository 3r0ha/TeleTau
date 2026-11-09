package ru.teletau.core.designsystem

import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Снапшоты стартового экрана (Roborazzi + Robolectric, JVM без эмулятора).
 * Эталоны — `src/test/snapshots`: запись `recordRoborazziDebug`, сверка `verifyRoborazziDebug`.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "w360dp-h800dp-xhdpi")
class StartScreenScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun startScreen_light() = capture(darkTheme = false, name = "start_screen_light")

    @Test
    fun startScreen_dark() = capture(darkTheme = true, name = "start_screen_dark")

    @Test
    @Config(fontScale = 2f)
    fun startScreen_light_fontScale200() = capture(darkTheme = false, name = "start_screen_light_font200")

    private fun capture(darkTheme: Boolean, name: String) {
        composeRule.setContent {
            TeleTauTheme(darkTheme = darkTheme) { StartScreen() }
        }
        // Путь — относительно roborazzi.outputDir (gradle.properties: filePathStrategy).
        composeRule.onRoot().captureRoboImage("$name.png")
    }
}
