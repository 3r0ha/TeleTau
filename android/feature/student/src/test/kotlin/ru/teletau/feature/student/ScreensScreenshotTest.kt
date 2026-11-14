package ru.teletau.feature.student

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import ru.teletau.core.designsystem.TeleTauSpace
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.click
import com.github.takahirom.roborazzi.captureRoboImage
import com.github.takahirom.roborazzi.captureScreenRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import ru.teletau.core.designsystem.TeleTauTheme
import ru.teletau.core.designsystem.R
import ru.teletau.core.designsystem.StudentTab
import ru.teletau.core.designsystem.UiMode
import ru.teletau.core.network.models.AttemptResult
import ru.teletau.core.network.models.PairMatch
import ru.teletau.core.network.models.RunKind
import ru.teletau.core.network.models.Verdict
import ru.teletau.core.session.NetworkFailure
import ru.teletau.feature.student.common.LoadError
import ru.teletau.feature.student.common.Resource
import ru.teletau.feature.student.common.Splash
import ru.teletau.feature.student.learn.LeagueUpScreen
import ru.teletau.feature.student.learn.LearnTopBar
import ru.teletau.feature.student.learn.LessonPlace
import ru.teletau.feature.student.learn.LessonPlayer
import ru.teletau.feature.student.learn.LessonState
import ru.teletau.feature.student.learn.NodeRef
import ru.teletau.feature.student.learn.id
import ru.teletau.feature.student.learn.ResultScreen
import ru.teletau.feature.student.learn.StreakScreen
import ru.teletau.feature.student.learn.Trail
import ru.teletau.feature.student.login.ClassCodeScreen
import ru.teletau.feature.student.login.CodeStep
import ru.teletau.feature.student.login.NicknamePicker
import ru.teletau.feature.student.login.ScanScreen
import ru.teletau.feature.student.login.ScanState
import ru.teletau.feature.student.login.WaitScreen
import ru.teletau.feature.student.login.WaitState
import ru.teletau.feature.student.login.WelcomeScreen
import ru.teletau.feature.student.preview.Demo
import ru.teletau.feature.student.tabs.BoardView
import ru.teletau.feature.student.tabs.HiveView
import ru.teletau.feature.student.tabs.LeagueView
import ru.teletau.feature.student.tabs.ProfileView
import ru.teletau.feature.student.tabs.FreshHoney
import ru.teletau.core.network.models.NicknameSuggestion

/**
 * Снимки ключевых экранов ученика (Roborazzi + Robolectric, без эмулятора) на демо-данных показа (preview/Demo.kt) —
 * телефон 390×844 dp, как снимки утверждённого прототипа (prototypes/trail-expedition/shots). Движение выключено
 * («Убрать анимацию»): снимок — итоговый кадр. Эталоны — src/test/snapshots: запись `recordRoborazziDebug`,
 * сверка `verifyRoborazziDebug`.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "w390dp-h844dp-xhdpi")
class ScreensScreenshotTest {

    @get:Rule
    val compose = createComposeRule()

    private fun show(dark: Boolean = false, mode: UiMode = UiMode.Bortnik, content: @Composable () -> Unit) {
        compose.setContent {
            TeleTauTheme(darkTheme = dark, uiMode = mode, reduceMotion = true) {
                // Адрес сайта — для относительных записей «/audio/…» (кнопка «Послушать»).
                androidx.compose.runtime.CompositionLocalProvider(ru.teletau.feature.student.common.LocalWebBase provides "http://192.168.1.10:3000") {
                    Box(Modifier.fillMaxSize().background(TeleTauTheme.colors.bg)) { content() }
                }
            }
        }
    }

    private fun snap(name: String) = compose.onRoot().captureRoboImage("$name.png")

    private fun lessonAt(id: String, feedback: AttemptResult? = null): LessonState {
        val ids = Demo.run.exercises.map { it.let(::exerciseId) }
        val i = ids.indexOf(id)
        return LessonState(
            run = Demo.run, node = NodeRef("u01-moya-shkola", RunKind.lesson),
            queue = ids.drop(i) + ids.take(i), finished = ids.take(i), feedback = feedback,
        )
    }

    private fun exerciseId(e: ru.teletau.core.network.models.RunExercise): String = e.id

    @Composable
    private fun TrailTab(dark: Boolean = false) {
        TabScaffold(StudentTab.Path, {}) {
            Column {
                LearnTopBar(Demo.progress, onLeague = {})
                Trail(Demo.course, onStart = {}, onReview = {})
            }
        }
    }

    @Test fun trail() { show { TrailTab() }; snap("trail") }

    /** Знакомство с пчелой: лист снизу над затемнённой тропой и навигацией (веб 24-intro, 24b-intro-goal). */
    @Test fun intro() { show { Box { TrailTab(); ru.teletau.feature.student.learn.TrailIntro(2, {}, {}) } }; snap("intro") }

    @Test fun intro_goal() { show { Box { TrailTab(); ru.teletau.feature.student.learn.TrailIntro(2, {}, {}, startAt = 1) } }; snap("intro_goal") }

    /** Нажали закрытый узел — пузырь «Сначала пройди «Моя школа»» (веб 25-home-locked-hint). */
    @Test
    fun trail_locked_hint() {
        show { TrailTab() }
        compose.onNode(hasContentDescription("Урок «Вежливые слова»", substring = true)).performScrollTo().performClick()
        snap("trail_locked_hint")
    }

    /** Самый узкий экран и самое длинное название: «Башкирская деревня» на 320 dp при шрифте 130 %. */
    @Test
    @Config(qualifiers = "w320dp-h844dp-xhdpi", fontScale = 1.3f)
    fun village_320_font130() {
        show { TabScaffold(StudentTab.Path, {}) { Column { LearnTopBar(Demo.progress, onLeague = {}); Trail(Demo.courseAll, onStart = {}) } } }
        snap("village_320_font130")
    }

    /** Тропа у «Башкирской деревни» (вернулись с урока): вывеска, баннер места и подписи узлов — на 320 dp, шрифт 130 %. */
    @Test
    @Config(qualifiers = "w320dp-h844dp-xhdpi", fontScale = 1.3f)
    fun village_trail_320_font130() {
        show { TabScaffold(StudentTab.Path, {}) { Column { LearnTopBar(Demo.progress, onLeague = {}); Trail(Demo.courseAll, onStart = {}, sealed = "05-village-0") } } }
        snap("village_trail_320_font130")
    }

    /** Все 6 вывесок мест на 320 dp при шрифте 130 %: надпись — на ровном фоне слева или под картинкой, не на рисунке. */
    @Test
    @Config(qualifiers = "w320dp-h1500dp-xhdpi", fontScale = 1.3f)
    fun signs_320_font130() {
        show {
            Column(Modifier.padding(TeleTauSpace.s400), verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s400)) {
                Demo.courseAll.units.forEach { ru.teletau.feature.student.learn.PlaceSign(it) }
            }
        }
        snap("signs_320_font130")
    }

    /** Плашки «Задание учителя» и «Повторить» над шапкой места; узел «Начать» — над вкладками (веб 62-home-today). */
    @Test
    fun trail_today() {
        val course = Demo.course.copy(assignments = listOf(Demo.assignment))
        show { TabScaffold(StudentTab.Path, {}) { Column { LearnTopBar(Demo.progress, {}); Trail(course, onStart = {}, onReview = {}, today = "2026-11-06") } } }
        snap("trail_today")
    }

    /** Текущее место второе — тропа сразу открывается на нём: плашка и шапка Шульган-Таша под панелью (веб 63-home-second-place). */
    @Test
    fun trail_second_place() {
        val u = Demo.course.units
        val course = Demo.course.copy(
            units = listOf(
                u[0].copy(nodes = u[0].nodes.map { it.copy(state = ru.teletau.core.network.models.NodeState.done) }),
                u[1].copy(
                    state = ru.teletau.core.network.models.UnitState.open,
                    nodes = u[1].nodes.mapIndexed { i, n ->
                        n.copy(state = if (i < 2) ru.teletau.core.network.models.NodeState.done else if (i == 2) ru.teletau.core.network.models.NodeState.current else ru.teletau.core.network.models.NodeState.locked)
                    },
                ),
                u[2],
            ),
        )
        show { TabScaffold(StudentTab.Path, {}) { Column { LearnTopBar(Demo.progress, {}); Trail(course, onStart = {}, onReview = {}) } } }
        snap("trail_second_place")
    }

    @Test fun trail_dark() { show(dark = true) { TrailTab(dark = true) }; snap("trail_dark") }

    @Test
    @Config(qualifiers = "w390dp-h2900dp-xhdpi")
    fun trail_places() { show { TrailTab() }; snap("trail_places") }

    @Test
    fun lesson_tiles() {
        show { LessonPlayer(lessonAt("e1"), {}, {}, {}, {}, {}) }
        compose.onNodeWithText("Урта").performClick()
        compose.onNodeWithText("мәктәп").performClick()
        snap("lesson_tiles")
    }

    @Test
    fun lesson_tiles_ok() {
        var lesson by mutableStateOf(lessonAt("e1"))
        show { LessonPlayer(lesson, {}, {}, {}, {}, {}) }
        compose.onNodeWithText("Урта").performClick()
        compose.onNodeWithText("мәктәп").performClick()
        lesson = lesson.copy(feedback = Demo.correct)
        snap("lesson_tiles_ok")
    }

    private fun introLesson(): LessonState {
        val run = Demo.run.copy(exercises = listOf(ru.teletau.core.network.models.RunExercise.WordIntroWrapper(Demo.wordIntro)) + Demo.run.exercises)
        return LessonState(run = run, node = NodeRef("u01-moya-shkola", RunKind.lesson), queue = run.exercises.map { it.id })
    }

    /** «Новое слово» перед заданиями: слово крупно, «Послушать», перевод, пчела и «Дальше». */
    @Test fun lesson_word_intro() { show { LessonPlayer(introLesson(), {}, {}, {}, {}, {}) }; snap("lesson_word_intro") }

    @Test fun lesson_word_intro_bee() { show(mode = UiMode.Bee) { LessonPlayer(introLesson(), {}, {}, {}, {}, {}) }; snap("lesson_word_intro_bee") }

    /** Подсказка к слову условия: пунктир под «школа», нажатие — пузырь «мәктәп». */
    @Test
    fun lesson_hint() {
        show { LessonPlayer(lessonAt("e1"), {}, {}, {}, {}, {}) }
        compose.onNodeWithText("Средняя школа").performTouchInput { click(androidx.compose.ui.geometry.Offset(width * 0.8f, height / 2f)) }
        compose.waitForIdle()
        captureScreenRoboImage("lesson_hint.png")
    }

    @Test
    fun lesson_hint_bee() {
        show(mode = UiMode.Bee) { LessonPlayer(lessonAt("e1"), {}, {}, {}, {}, {}) }
        compose.onNodeWithText("Средняя школа").performTouchInput { click(androidx.compose.ui.geometry.Offset(width * 0.8f, height / 2f)) }
        compose.waitForIdle()
        captureScreenRoboImage("lesson_hint_bee.png")
    }

    /** Третий верный ответ подряд: поле зелёное, огонёк «3 подряд» справа от «Верно!» (веб 26-lesson-combo). */
    @Test
    fun lesson_combo() {
        var lesson by mutableStateOf(lessonAt("e3"))
        show { LessonPlayer(lesson, {}, {}, {}, {}, {}) }
        compose.onNode(hasContentDescription("Перевод на башкирский: тетрадь")).performTextInput("дәфтәр")
        lesson = lesson.copy(feedback = Demo.almost.copy(verdict = Verdict.correct, hint = null), combo = 3)
        snap("lesson_combo")
    }

    @Test
    fun lesson_choice_wrong() {
        var lesson by mutableStateOf(lessonAt("e2"))
        show { LessonPlayer(lesson, {}, {}, {}, {}, {}) }
        compose.onNodeWithText("книга").performClick()
        lesson = lesson.copy(feedback = Demo.wrongChoice)
        snap("lesson_choice_wrong")
    }

    @Test
    fun lesson_input_almost() {
        var lesson by mutableStateOf(lessonAt("e3"))
        show { LessonPlayer(lesson, {}, {}, {}, {}, {}) }
        compose.onNode(hasContentDescription("Перевод на башкирский: тетрадь")).performTextInput("дафтәр")
        lesson = lesson.copy(feedback = Demo.almost)
        snap("lesson_input_almost")
    }

    @Test
    fun lesson_duel() {
        show { LessonPlayer(lessonAt("e4"), {}, {}, {}, {}, {}) }
        compose.onNodeWithText("Һаумыһығыҙ!").performClick()
        snap("lesson_duel")
    }

    @Test
    fun lesson_duel_voted() {
        var lesson by mutableStateOf(lessonAt("e4"))
        show { LessonPlayer(lesson, {}, {}, {}, {}, {}) }
        compose.onNodeWithText("Һаумыһығыҙ!").performClick()
        lesson = lesson.copy(feedback = Demo.recorded)
        snap("lesson_duel_voted")
    }

    @Test
    fun lesson_pairs_wrong() {
        var lesson by mutableStateOf(lessonAt("e5"))
        show { LessonPlayer(lesson, {}, {}, {}, {}, {}) }
        listOf("китап" to "книга", "мәктәп" to "школа", "дәфтәр" to "учитель", "уҡытыусы" to "тетрадь").forEach { (l, r) ->
            compose.onNodeWithText(l).performClick()
            compose.onNodeWithText(r).performClick()
        }
        lesson = lesson.copy(
            feedback = AttemptResult(
                attemptId = "a5", exerciseId = "e5", verdict = Verdict.wrong, firstAttempt = true, retry = true,
                correctPairs = listOf(PairMatch("l1", "r2"), PairMatch("l2", "r4"), PairMatch("l3", "r3"), PairMatch("l4", "r1")),
            ),
        )
        snap("lesson_pairs_wrong")
    }

    @Test
    fun lesson_quit() {
        show { LessonPlayer(lessonAt("e1").copy(quit = true), {}, {}, {}, {}, {}) }
        compose.waitForIdle()
        captureScreenRoboImage("lesson_quit.png")
    }

    @Test
    @Config(fontScale = 2f)
    fun lesson_tiles_font200() { show { LessonPlayer(lessonAt("e1"), {}, {}, {}, {}, {}) }; snap("lesson_tiles_font200") }

    @Test
    fun lesson_free_bee() { show(mode = UiMode.Bee) { LessonPlayer(lessonAt("e3"), {}, {}, {}, {}, {}) }; snap("lesson_free_bee") }

    @Test fun result() { show { ResultScreen(Demo.run, Demo.summary, LessonPlace("Знакомство", 3), {}) }; snap("result") }

    /** Тропа прокручена к закрытому Шульган-Ташу (второй пункт списка): под вывеской — «Уже знаешь?» и «Пройти испытание». */
    @Test
    fun trail_jump() {
        show {
            TabScaffold(StudentTab.Path, {}) {
                Column {
                    LearnTopBar(Demo.progress, onLeague = {})
                    Trail(Demo.courseJump, onStart = {}, onJump = {}, listState = androidx.compose.foundation.lazy.rememberLazyListState(1, JUMP_SCROLL))
                }
            }
        }
        snap("trail_jump")
    }

    private val jumpPlace = LessonPlace("Семья", place = Demo.courseJump.units[1].place)

    /** Испытание сдано: картинка места, «Место открыто», название, мёд и цель дня. */
    @Test fun jump_passed() { show { ResultScreen(Demo.jumpRun, Demo.jumpPassed, jumpPlace, {}) }; snap("jump_passed") }

    /** Испытание не сдано: «Пока рано» и «К урокам». */
    @Test fun jump_failed() { show { ResultScreen(Demo.jumpRun, Demo.jumpFailed, jumpPlace, {}) }; snap("jump_failed") }

    @Test fun streak() { show { StreakScreen(Demo.summary.copy(dailyGoal = null), {}) }; snap("streak") }

    @Test fun league_up() { show { LeagueUpScreen(Demo.summary, busy = false, onContinue = {}) }; snap("league_up") }

    @Test
    @Config(qualifiers = "w390dp-h1300dp-xhdpi")
    fun league() { show { TabScaffold(StudentTab.League, {}) { TabScroll { LeagueView(Demo.league, {}, {}, nowMillis = 1_793_923_200_000) } } }; snap("league") }

    /** Доска почёта с лиги: периоды, топ школ и классов недели. */
    @Test
    @Config(qualifiers = "w390dp-h1300dp-xhdpi")
    fun board() { show { TabScaffold(StudentTab.League, {}) { TabScroll { BoardView(Demo.board, Demo.board.period, {}, onBack = {}) } } }; snap("board") }

    @Test fun hive() { show { TabScaffold(StudentTab.Hive, {}) { TabScroll { HiveView(Demo.hive, "5 «Б»", "Демо-школа № 1") } } }; snap("hive") }

    @Test
    @Config(qualifiers = "w390dp-h1200dp-xhdpi")
    fun profile() {
        show {
            TabScaffold(StudentTab.Me, {}) {
                TabScroll { ProfileView(Demo.me, Demo.progress, Demo.cells, Demo.course, FreshHoney(1, 3), leaving = false, words = Demo.words, onLeave = {}, onStay = {}, onLogout = {}) }
            }
        }
        snap("profile")
    }

    @Test fun profile_dark() {
        show(dark = true) {
            TabScaffold(StudentTab.Me, {}) {
                TabScroll { ProfileView(Demo.me, Demo.progress, Demo.cells, Demo.course, null, leaving = false, onLeave = {}, onStay = {}, onLogout = {}) }
            }
        }
        snap("profile_dark")
    }

    /** Настройки профиля на самом узком экране при шрифте 130 %: «Звуки» и «Тёмная тема» с выключателями, тема тёмная. */
    @Test
    @Config(qualifiers = "w320dp-h1500dp-xhdpi", fontScale = 1.3f)
    fun profile_settings_320_font130() {
        show(dark = true) {
            TabScaffold(StudentTab.Me, {}) {
                TabScroll { ProfileView(Demo.me, Demo.progress, Demo.cells, Demo.course, null, leaving = false, words = Demo.words, onLeave = {}, onStay = {}, onLogout = {}) }
            }
        }
        snap("profile_settings_320_font130")
    }

    /** «Цель дня» из профиля — как на вебе: число уроков (сот) в день, под ним минуты. */
    @Test
    fun goal_dialog() {
        show { TabScaffold(StudentTab.Me, {}) {}; GoalDialogView(2, {}, false, null, {}, {}) }
        compose.waitForIdle()
        captureScreenRoboImage("goal_dialog.png")
    }

    @Test fun welcome() { show(mode = UiMode.Bee) { WelcomeScreen("ТелеТау", null, null, {}, {}, {}, {}, {}, {}) }; snap("welcome") }

    @Test fun splash() { show { Splash("ТелеТау") }; snap("splash") }

    @Test fun scan() { show(mode = UiMode.Bee) { ScanScreen(ScanState.Idle, null, {}, {}, {}, {}) }; snap("scan") }

    @Test
    fun class_code() {
        show(mode = UiMode.Bee) { ClassCodeScreen(CodeStep.Code, "K7Q4", null, {}, {}, {}) {} }
        snap("class_code")
    }

    @Test
    fun class_code_nick() {
        val nicks = Resource.Ready(listOf(NicknameSuggestion("n1", "Смелая пчела"), NicknameSuggestion("n2", "Рыжая лиса"), NicknameSuggestion("n3", "Мудрая сова")))
        show(mode = UiMode.Bee) {
            ClassCodeScreen(CodeStep.Nick, "K7Q4MZ", null, {}, {}, {}) { NicknamePicker(nicks, "n1", {}, {}, "Отправить заявку", false, null, {}) }
        }
        snap("class_code_nick")
    }

    @Test fun wait_pending() { show(mode = UiMode.Bee) { WaitScreen(WaitState.Pending("5 «Б»", "Смелая пчела"), {}, {}) }; snap("wait") }

    @Test
    fun offline() {
        show { TabScaffold(StudentTab.Path, {}) { Column { LearnTopBar(null, {}); LoadError(NetworkFailure(java.io.IOException("нет сети")), {}) } } }
        snap("offline")
    }

    @Test
    fun all_done() {
        val done = Demo.course.copy(units = Demo.course.units.map { u -> u.copy(nodes = u.nodes.map { it.copy(state = if (u.order == 1) ru.teletau.core.network.models.NodeState.done else it.state) }) }, review = null)
        show { TabScaffold(StudentTab.Path, {}) { Column { LearnTopBar(Demo.progress, {}); Trail(done, onStart = {}) } } }
        snap("all_done")
    }

    @Test
    @Config(qualifiers = "w390dp-h1250dp-xhdpi")
    fun words() {
        show { TabScaffold(StudentTab.Me, {}) { TabScroll { ru.teletau.feature.student.tabs.WordsView(Demo.words, {}, {}, {}) } } }
        snap("words")
    }

    @Test
    fun words_empty() {
        val empty = ru.teletau.core.network.models.MyWords(ru.teletau.core.network.models.MyWordsSummary(0, 0, 0), emptyList())
        show { TabScaffold(StudentTab.Me, {}) { TabScroll { ru.teletau.feature.student.tabs.WordsView(empty, {}, {}, {}) } } }
        snap("words_empty")
    }

    @Test
    @Config(qualifiers = "w390dp-h1150dp-xhdpi")
    fun trail_assignment() {
        val course = Demo.course.copy(assignments = listOf(Demo.assignment), review = null)
        show { TabScaffold(StudentTab.Path, {}) { Column { LearnTopBar(Demo.progress, {}); Trail(course, onStart = {}, onReview = {}, today = "2026-11-05") } } }
        snap("trail_assignment")
    }

    @Test
    @Config(qualifiers = "w390dp-h1150dp-xhdpi")
    fun trail_assignment_done() {
        val review = ru.teletau.core.network.models.StudentAssignment(
            id = "0190a8c0-0000-7000-8000-00000000a002", kind = ru.teletau.core.network.models.AssignmentKind.review, titleRu = "Повторить слова", dueOn = "2026-11-19", done = false,
        )
        val course = Demo.course.copy(assignments = listOf(Demo.assignment.copy(done = true), review))
        show(dark = true) { TabScaffold(StudentTab.Path, {}) { Column { LearnTopBar(Demo.progress, {}); Trail(course, onStart = {}, onReview = {}, today = "2026-11-05") } } }
        snap("trail_assignment_done_dark")
    }

    @Test
    fun lesson_choice_listen() {
        show { LessonPlayer(lessonAt("e2"), {}, {}, {}, {}, {}) }
        snap("lesson_choice_listen")
    }

    @Test fun welcome_dark() { show(dark = true, mode = UiMode.Bee) { WelcomeScreen("ТелеТау", null, null, {}, {}, {}, {}, {}, {}) }; snap("welcome_dark") }

    private val selfNicks = Resource.Ready(listOf(NicknameSuggestion("n1", "Смелая пчела"), NicknameSuggestion("n2", "Ловкий шмель"), NicknameSuggestion("n3", "Тихая липа")))

    @Test
    fun self_age() {
        show(mode = UiMode.Bee) { ru.teletau.feature.student.login.SelfStartScreen(ru.teletau.feature.student.login.SelfStep.Age, null, {}, {}, {}) {} }
        snap("self_age")
    }

    @Test
    fun self_nick() {
        show(mode = UiMode.Bee) {
            ru.teletau.feature.student.login.SelfStartScreen(ru.teletau.feature.student.login.SelfStep.Nick, ru.teletau.core.network.models.AgeBand.age1114, {}, {}, {}) {
                NicknamePicker(selfNicks, null, {}, {}, "Начать", false, null, {})
            }
        }
        snap("self_nick")
    }


    @Composable
    private fun CardScreen(card: Resource<ru.teletau.core.network.models.LoginCard?>, confirm: Boolean = false) {
        TabScaffold(StudentTab.Me, {}) {
            TabScroll {
                ru.teletau.feature.student.tabs.LoginCardView(Demo.selfMe, card, false, null, confirm, "ТелеТау", "192.168.1.10:3000", {}, {}, {}, {}, {}, {})
            }
        }
    }

    @Test fun card_none() { show { CardScreen(Resource.Ready(null)) }; snap("card_none") }

    @Test
    @Config(qualifiers = "w390dp-h1000dp-xhdpi")
    fun card() { show { CardScreen(Resource.Ready(Demo.loginCard)) }; snap("card") }

    @Test
    @Config(qualifiers = "w390dp-h1000dp-xhdpi")
    fun card_dark() { show(dark = true) { CardScreen(Resource.Ready(Demo.loginCard)) }; snap("card_dark") }

    @Test
    fun card_new_confirm() {
        show { CardScreen(Resource.Ready(Demo.loginCard), confirm = true) }
        compose.waitForIdle()
        captureScreenRoboImage("card_new_confirm.png")
    }

    @Test
    @Config(qualifiers = "w390dp-h1300dp-xhdpi")
    fun profile_solo() {
        show {
            TabScaffold(StudentTab.Me, {}) {
                TabScroll { ProfileView(Demo.selfMe, Demo.progress, Demo.cells, Demo.course, null, leaving = false, words = Demo.words, onLeave = {}, onStay = {}, onLogout = {}) }
            }
        }
        snap("profile_solo")
    }

    @Test fun hive_no_class() { show { TabScaffold(StudentTab.Hive, {}) { TabScroll { ru.teletau.feature.student.tabs.NoClassView(Demo.selfMe, {}, {}) } } }; snap("hive_no_class") }

    @Test
    fun join_class() {
        show { TabScaffold(StudentTab.Hive, {}) { TabScroll { ru.teletau.feature.student.tabs.JoinClassView(Demo.selfMe, ru.teletau.feature.student.tabs.JoinState.Code, "K7Q", null, false, {}, {}, {}) } } }
        snap("join_class")
    }

    @Test
    fun join_class_wait() {
        show { TabScaffold(StudentTab.Hive, {}) { TabScroll { ru.teletau.feature.student.tabs.JoinClassView(Demo.selfMe, ru.teletau.feature.student.tabs.JoinState.Waiting("5 «Б»"), "", null, false, {}, {}, {}) } } }
        snap("join_class_wait")
    }

    // ── награды: блок в профиле, лист подробностей, «Новая награда!» (как снимки веба awards-*) ──

    @Composable
    private fun AwardsProfile() {
        TabScaffold(StudentTab.Me, {}) {
            TabScroll { ProfileView(Demo.me, Demo.progress, Demo.cells, Demo.course, null, leaving = false, words = Demo.words, achievements = Demo.achievements, onLeave = {}, onStay = {}, onLogout = {}) }
        }
    }

    /** Профиль целиком: «Награды» — 5 из 12, сетка сот по три, полученные с днём, остальные с прогрессом. */
    @Test
    @Config(qualifiers = "w390dp-h1520dp-xhdpi")
    fun awards_profile() { show { AwardsProfile() }; snap("awards_profile") }

    @Test
    @Config(qualifiers = "w390dp-h1520dp-xhdpi")
    fun awards_profile_dark() { show(dark = true) { AwardsProfile() }; snap("awards_profile_dark") }

    /** Самый узкий экран и шрифт 130 %: сетка по три не ломается, названия не обрезаются. */
    @Test
    @Config(qualifiers = "w320dp-h1800dp-xhdpi", fontScale = 1.3f)
    fun awards_profile_320_font130() { show { AwardsProfile() }; snap("awards_profile_320_font130") }

    private fun awardSheet(name: String, label: String, dark: Boolean) {
        show(dark = dark) { AwardsProfile() }
        compose.onNode(hasContentDescription(label)).performScrollTo().performClick()
        compose.waitForIdle()
        captureScreenRoboImage("$name.png")
    }

    /** Лист награды в процессе: крупная сота воском, что сделать, полоса «5 из 7». */
    @Test fun awards_sheet_progress() = awardSheet("awards_sheet_progress", "7 дней подряд, 5 из 7", dark = false)

    @Test fun awards_sheet_progress_dark() = awardSheet("awards_sheet_progress_dark", "7 дней подряд, 5 из 7", dark = true)

    /** Лист полученной награды: цветная сота с бликом, что сделать, «Получена 5 ноября». */
    @Test fun awards_sheet_earned() = awardSheet("awards_sheet_earned", "3 дня подряд, получена 5 ноября", dark = false)

    @Test fun awards_sheet_earned_dark() = awardSheet("awards_sheet_earned_dark", "3 дня подряд, получена 5 ноября", dark = true)

    /** «Новая награда!» после урока: крупная сота в ореоле из сот, название, «Дальше». */
    @Test fun awards_new() { show { ru.teletau.feature.student.learn.NewAchievementScreen(Demo.summaryWithAward, {}) }; snap("awards_new") }

    @Test fun awards_new_dark() { show(dark = true) { ru.teletau.feature.student.learn.NewAchievementScreen(Demo.summaryWithAward, {}) }; snap("awards_new_dark") }

    /** Несколько наград за урок — все на одном экране «Новые награды!». */
    @Test
    fun awards_new_many() {
        val many = Demo.summary.copy(newAchievements = listOf(Demo.award("words-10", "2026-11-14"), Demo.award("first-place", "2026-11-14"), Demo.award("goal-7", "2026-11-14")))
        show { ru.teletau.feature.student.learn.NewAchievementScreen(many, {}) }
        snap("awards_new_many")
    }

    @Suppress("unused") private val keep = R.drawable.bee_idle
}

/** Сдвиг тропы в снимке trail_jump внутри дорожки Уфы, px: внизу экрана — вывеска Шульган-Таша и предложение испытания. */
private const val JUMP_SCROLL = 0
