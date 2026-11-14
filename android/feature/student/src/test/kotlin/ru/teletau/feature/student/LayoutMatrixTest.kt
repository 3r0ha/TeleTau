package ru.teletau.feature.student

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import ru.teletau.core.designsystem.TeleTauSpace
import ru.teletau.core.designsystem.TeleTauTheme
import ru.teletau.core.designsystem.StudentTab
import ru.teletau.core.designsystem.UiMode
import ru.teletau.feature.student.learn.LearnTopBar
import ru.teletau.feature.student.learn.LessonPlace
import ru.teletau.feature.student.learn.PlaceSign
import ru.teletau.feature.student.learn.ResultScreen
import ru.teletau.feature.student.learn.Trail
import ru.teletau.feature.student.login.WelcomeScreen
import ru.teletau.feature.student.preview.Demo
import ru.teletau.feature.student.tabs.FreshHoney
import ru.teletau.feature.student.tabs.LeagueView
import ru.teletau.feature.student.tabs.ProfileView
import java.io.File

/**
 * Сетка вёрстки для ручной сверки: каждый экран — на ширинах 320, 360, 390 и 412 dp рядом, при шрифте 130 % и 200 %.
 * Не эталоны: картинки пишутся в build/matrix и только по запросу —
 * `TELETAU_MATRIX=1 ./gradlew :feature:student:recordRoborazziDebug --tests '*LayoutMatrixTest*'`.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "w1600dp-h3100dp-mdpi")
class LayoutMatrixTest {
    @get:Rule
    val compose = createComposeRule()

    @Before
    fun onlyOnRequest() = assumeTrue("сетка вёрстки — по запросу (TELETAU_MATRIX=1)", System.getenv("TELETAU_MATRIX") == "1")

    private val widths = listOf(320, 360, 390, 412)

    private fun renderOnce(tag: String, font: Float, height: Dp, mode: UiMode, content: @Composable () -> Unit) {
        compose.setContent {
            val d = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(d.density, font)) {
                TeleTauTheme(darkTheme = false, uiMode = mode, reduceMotion = true) {
                    CompositionLocalProvider(ru.teletau.feature.student.common.LocalWebBase provides "http://192.168.1.10:3000") {
                        Row(Modifier.background(TeleTauTheme.colors.bgSunken).padding(TeleTauSpace.s400), horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s500)) {
                            widths.forEach { w ->
                                Box(Modifier.width(w.dp).height(height).clipToBounds().background(TeleTauTheme.colors.bg)) { content() }
                            }
                        }
                    }
                }
            }
        }
        compose.onRoot().captureRoboImage(File("build/matrix/$tag.png"))
    }

    private fun both(name: String, font: Float, height: Dp, mode: UiMode = UiMode.Bortnik, content: @Composable () -> Unit) =
        renderOnce("${name}_font${(font * 100).toInt()}", font, height, mode, content)

    @Composable
    private fun Signs() {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(TeleTauSpace.s400), verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s400)) {
            Demo.courseAll.units.forEach { PlaceSign(it) }
        }
    }

    @Composable
    private fun TrailTop() {
        TabScaffold(StudentTab.Path, {}) {
            Column {
                LearnTopBar(Demo.progress, onLeague = {})
                Trail(Demo.courseAll, onStart = {})
            }
        }
    }

    @Composable
    private fun TrailVillage() {
        TabScaffold(StudentTab.Path, {}) {
            Column {
                LearnTopBar(Demo.progress, onLeague = {})
                Trail(Demo.courseAll, onStart = {}, sealed = "05-village-0")
            }
        }
    }

    @Composable
    private fun Profile() {
        TabScaffold(StudentTab.Me, {}) {
            TabScroll { ProfileView(Demo.me, Demo.progress, Demo.cells, Demo.course, FreshHoney(1, 3), leaving = false, words = Demo.words, achievements = Demo.achievements, onLeave = {}, onStay = {}, onLogout = {}) }
        }
    }

    @Test fun signs130() = both("signs", 1.3f, 1850.dp) { Signs() }
    @Test fun signs200() = both("signs", 2f, 1850.dp) { Signs() }
    @Test fun trailTop130() = both("trail_top", 1.3f, 844.dp) { TrailTop() }
    @Test fun trailTop200() = both("trail_top", 2f, 844.dp) { TrailTop() }
    @Test fun trailVillage130() = both("trail_village", 1.3f, 844.dp) { TrailVillage() }
    @Test fun trailVillage200() = both("trail_village", 2f, 844.dp) { TrailVillage() }
    @Test fun welcome100() = both("welcome", 1f, 844.dp) { WelcomeScreen("ТелеТау", null, null, {}, {}, {}, {}, {}, {}) }
    @Test fun welcome130() = both("welcome", 1.3f, 844.dp) { WelcomeScreen("ТелеТау", null, null, {}, {}, {}, {}, {}, {}) }
    @Test fun welcome200() = both("welcome", 2f, 844.dp) { WelcomeScreen("ТелеТау", null, null, {}, {}, {}, {}, {}, {}) }
    @Test fun result130() = both("result", 1.3f, 844.dp) { ResultScreen(Demo.run, Demo.summary, LessonPlace("Знакомство", 3), {}) }
    @Test fun result200() = both("result", 2f, 1100.dp) { ResultScreen(Demo.run, Demo.summary, LessonPlace("Знакомство", 3), {}) }
    @Test fun league130() = both("league", 1.3f, 1400.dp) { TabScaffold(StudentTab.League, {}) { TabScroll { LeagueView(Demo.league, {}, {}, nowMillis = 1_793_923_200_000) } } }
    @Test fun league200() = both("league", 2f, 1850.dp) { TabScaffold(StudentTab.League, {}) { TabScroll { LeagueView(Demo.league, {}, {}, nowMillis = 1_793_923_200_000) } } }
    @Test fun profile130() = both("profile", 1.3f, 2300.dp) { Profile() }
    @Test fun profile200() = both("profile", 2f, 3000.dp) { Profile() }
}
