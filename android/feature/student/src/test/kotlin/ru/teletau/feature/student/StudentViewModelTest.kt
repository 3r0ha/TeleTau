package ru.teletau.feature.student

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import ru.teletau.core.designsystem.StudentTab
import ru.teletau.core.network.models.AttemptAnswer
import ru.teletau.core.network.models.AttemptResult
import ru.teletau.core.network.models.AuthSession
import ru.teletau.core.network.models.AuthSessionTokenType
import ru.teletau.core.network.models.Course
import ru.teletau.core.network.models.DeviceInfo
import ru.teletau.core.network.models.DevicePlatform
import ru.teletau.core.network.models.LessonRun
import ru.teletau.core.network.models.LessonRunSummary
import ru.teletau.core.network.models.MyProgress
import ru.teletau.core.network.models.TilesAnswer
import ru.teletau.core.network.models.TilesAnswerType
import ru.teletau.core.session.InMemoryTokenStore
import ru.teletau.core.session.TeleTauClient
import ru.teletau.core.session.TeleTauJson
import ru.teletau.feature.student.learn.FlowState
import ru.teletau.feature.student.preview.Demo

/**
 * Приложение ученика на моках API (Ktor MockEngine, ответы — сгенерированные модели контракта): вход по QR → тропа →
 * урок → итог → серия → новая лига → тропа; системный «Назад» — с вкладки на «Путь», с корня — выход.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class StudentViewModelTest {
    private val requests = mutableListOf<String>()
    /** Тела отправленных ответов и вердикты на них по порядку (кончились — «Верно»). */
    private val attemptBodies = mutableListOf<String>()
    private val attemptResults = ArrayDeque<AttemptResult>()
    /** Итог забега (у испытания для перехода — с полем jump). */
    private var completeSummary: LessonRunSummary = Demo.summary
    /** GET /me/achievements отвечает 503. */
    private var achievementsDown = false

    private val engine = MockEngine { req ->
        requests += "${req.method.value} ${req.url.encodedPath}"
        fun ok(body: String) = respond(body, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        // Урок: карточка «Новое слово», затем одно задание.
        val one = Demo.run.copy(exercises = listOf(ru.teletau.core.network.models.RunExercise.WordIntroWrapper(Demo.wordIntro)) + Demo.run.exercises.take(1))
        when (req.url.encodedPath) {
            "/api/v1/auth/qr" -> {
                assertTrue(String(req.body.toByteArray()).contains("TT1.0123456789.ABCDEFGHJKMNPQRSTVWXYZ0123.6V"))
                ok(TeleTauJson.encodeToString(AuthSession.serializer(), AuthSession("A1", "2099-01-01T00:00:00Z", "ttr_refresh_token_0001", "2099-02-01T00:00:00Z", AuthSessionTokenType.bearer, Demo.me)))
            }
            "/api/v1/course" -> ok(TeleTauJson.encodeToString(Course.serializer(), Demo.course))
            "/api/v1/me/progress" -> ok(TeleTauJson.encodeToString(MyProgress.serializer(), Demo.progress))
            "/api/v1/lessons/u01-moya-shkola/runs" -> {
                val body = String(req.body.toByteArray())
                assertTrue("урок просит карточки «Новое слово»: $body", body.contains("\"accepts\":[\"word_intro\"]"))
                ok(TeleTauJson.encodeToString(LessonRun.serializer(), one))
            }
            "/api/v1/lesson-runs/${one.runId}/attempts" -> {
                attemptBodies += String(req.body.toByteArray())
                ok(TeleTauJson.encodeToString(AttemptResult.serializer(), attemptResults.removeFirstOrNull() ?: Demo.correct))
            }
            "/api/v1/units/02-shulgantash/jump-runs" -> {
                val body = String(req.body.toByteArray())
                assertTrue("испытание — без карточек «Новое слово»: $body", !body.contains("accepts"))
                ok(TeleTauJson.encodeToString(LessonRun.serializer(), one.copy(lessonId = "02-shulgantash", kind = ru.teletau.core.network.models.RunKind.jump, titleRu = "Испытание", exercises = Demo.run.exercises.take(3))))
            }
            "/api/v1/lesson-runs/${one.runId}/complete" -> ok(TeleTauJson.encodeToString(LessonRunSummary.serializer(), completeSummary))
            "/api/v1/leagues/result-seen" -> respond("", HttpStatusCode.NoContent)
            "/api/v1/me/achievements" ->
                if (achievementsDown) respond("""{"type":"about:blank","title":"Сервис недоступен","status":503}""", HttpStatusCode.ServiceUnavailable, headersOf(HttpHeaders.ContentType, "application/problem+json"))
                else ok(TeleTauJson.encodeToString(ru.teletau.core.network.models.MyAchievements.serializer(), Demo.achievements))
            "/api/v1/nicknames/suggest" -> ok("""{"items":[{"id":"n.owl","text":"Мудрая сова"},{"id":"n.fox","text":"Рыжая лиса"},{"id":"n.bee","text":"Смелая пчела"}]}""")
            "/api/v1/auth/self" -> {
                val body = String(req.body.toByteArray())
                assertTrue(body, body.contains("\"ageBand\":\"age_11_14\"") && body.contains("\"nicknameId\":\"n.owl\"") && !body.contains("dailyGoal"))
                ok(TeleTauJson.encodeToString(AuthSession.serializer(), AuthSession("S1", "2099-01-01T00:00:00Z", "ttr_self_refresh_token_01", "2099-02-01T00:00:00Z", AuthSessionTokenType.bearer, Demo.selfMe)))
            }
            "/api/v1/auth/login-card" -> {
                assertTrue(String(req.body.toByteArray()).contains("TP1.0123456789.ABCDEFGHJKMNPQRSTVWXYZ0123.4S"))
                ok(TeleTauJson.encodeToString(AuthSession.serializer(), AuthSession("S2", "2099-01-01T00:00:00Z", "ttr_card_refresh_token_1", "2099-02-01T00:00:00Z", AuthSessionTokenType.bearer, Demo.selfMe)))
            }
            "/api/v1/me/class-join" -> ok("""{"requestId":"0190a8c0-0000-7000-8000-00000000c001","status":"pending","expiresAt":"2099-01-01T00:00:00Z","pollIntervalSeconds":1,"class":{"title":"5 «Б»","grade":5,"letter":"Б"}}""")
            "/api/v1/me/class-join/0190a8c0-0000-7000-8000-00000000c001" -> ok("""{"requestId":"0190a8c0-0000-7000-8000-00000000c001","status":"approved","expiresAt":"2099-01-01T00:00:00Z","pollIntervalSeconds":1,"class":{"title":"5 «Б»","grade":5,"letter":"Б"}}""")
            "/api/v1/me" -> ok(TeleTauJson.encodeToString(ru.teletau.core.network.models.Me.serializer(), Demo.selfMe.copy(classes = Demo.me.classes)))
            else -> respond("""{"type":"about:blank","title":"нет","status":404}""", HttpStatusCode.NotFound, headersOf(HttpHeaders.ContentType, "application/problem+json"))
        }
    }

    private val env = object : StudentEnvironment {
        val device = DeviceInfo("0f8d4c3e-8a3b-4b6e-9e3f-2a1b3c4d5e6f", DevicePlatform.android, "test")
        override val client: StateFlow<TeleTauClient> = MutableStateFlow(TeleTauClient("http://api.test", engine, InMemoryTokenStore(), device))
        override val apiBaseUrl: StateFlow<String> = MutableStateFlow("http://api.test:4000")
        override val webBaseOverride: StateFlow<String?> = MutableStateFlow(null)
        override fun setServer(apiUrl: String, webUrl: String?) = Unit
        override fun probe(url: String) = client.value
        override val speaker = object : ru.teletau.feature.student.common.Speaker {
            override val playing: StateFlow<String?> = MutableStateFlow(null)
            override fun play(url: String) = Unit
            override fun stop() = Unit
        }
        override val appVersion = "test"
        override fun cellsSeen(accountId: String): Pair<Int, Int>? = null
        override fun saveCellsSeen(accountId: String, matured: Int, honey: Int) = Unit
        override fun now(): Long = 1_793_923_200_000
    }

    /** Ответы MockEngine приходят из его потока: прокручиваем очередь, пока условие не выполнится. */
    private fun kotlinx.coroutines.test.TestScope.await(what: String, cond: () -> Boolean) {
        repeat(500) {
            advanceUntilIdle()
            if (cond()) return
            Thread.sleep(10)
        }
        error("Не дождались: $what")
    }

    @Before fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After fun tearDown() = Dispatchers.resetMain()

    @Test
    fun qrLogin_lesson_afterLesson_backToTrail() = runTest {
        val vm = StudentViewModel(env)
        advanceUntilIdle()
        assertEquals(listOf(Route.Welcome), vm.routes.value)
        assertTrue("на корне «Назад» закрывает приложение", !vm.onBack())

        vm.openScan()
        vm.onScanned("https://teletau.study/q#tt1.0123456789.abcdefghjkmnpqrstvwxyz0123.6v")
        await("вход") { vm.routes.value.last() is Route.Main }
        assertEquals(listOf(Route.Main(StudentTab.Path)), vm.routes.value)
        assertEquals("Смелая пчела", vm.account.value?.nickname)

        val node = Demo.course.units.first().nodes.first { it.id == "u01-moya-shkola" }
        await("тропа") { vm.course.value is ru.teletau.feature.student.common.Resource.Ready && vm.progress.value is ru.teletau.feature.student.common.Resource.Ready }
        vm.start(node)
        await("урок") { vm.flow.value is FlowState.Lesson }
        // Карточка «Новое слово»: ответа нет — «Дальше» без попытки.
        assertTrue(ru.teletau.feature.student.learn.isIntro((vm.flow.value as FlowState.Lesson).lesson))
        vm.check(AttemptAnswer.TilesWrapper(TilesAnswer(TilesAnswerType.tiles, listOf("t1"))))
        vm.next()
        assertTrue("после карточки — задание", !ru.teletau.feature.student.learn.isIntro((vm.flow.value as FlowState.Lesson).lesson))
        assertEquals("попытка за карточку не отправляется", 0, requests.count { it.endsWith("/attempts") })
        vm.check(AttemptAnswer.TilesWrapper(TilesAnswer(TilesAnswerType.tiles, listOf("t1", "t2"))))
        await("вердикт") { (vm.flow.value as? FlowState.Lesson)?.lesson?.feedback != null }
        assertEquals(Demo.correct.verdict, (vm.flow.value as FlowState.Lesson).lesson.feedback?.verdict)
        assertTrue("«Назад» в уроке — «Уже уходишь?»", vm.onBack() && (vm.flow.value as FlowState.Lesson).lesson.quit)
        vm.stayInLesson()
        vm.next()
        await("итог") { vm.flow.value is FlowState.Result }
        assertTrue(vm.flow.value is FlowState.Result)
        vm.continueFlow()
        assertTrue(vm.flow.value is FlowState.Streak)
        vm.continueFlow()
        assertTrue(vm.flow.value is FlowState.LeagueUp)
        vm.continueFlow()
        await("тропа после урока") { vm.flow.value is FlowState.Trail }
        assertEquals(FlowState.Trail(sealed = "u01-moya-shkola"), vm.flow.value)
        assertTrue(requests.contains("POST /api/v1/leagues/result-seen"))

        vm.selectTab(StudentTab.League)
        assertTrue(vm.onBack())
        assertEquals(Route.Main(StudentTab.Path), vm.routes.value.last())
        assertTrue(!vm.onBack())
        assertEquals("кабинет учителя — на сайте того же компьютера", "http://api.test:3000/teacher/login", vm.teacherUrl)
    }

    @Test
    fun achievements_failureHidesBlockSilently_newAwardAfterStreakAndInProfile() = runTest {
        val vm = StudentViewModel(env)
        advanceUntilIdle()
        vm.openScan()
        vm.onScanned("https://teletau.study/q#tt1.0123456789.abcdefghjkmnpqrstvwxyz0123.6v")
        await("тропа") { vm.course.value is ru.teletau.feature.student.common.Resource.Ready && vm.progress.value is ru.teletau.feature.student.common.Resource.Ready }

        // Награды не загрузились — блока нет, тоста нет, остальной профиль грузится как обычно.
        achievementsDown = true
        vm.selectTab(StudentTab.Me)
        vm.loadProfile()
        await("награды не загрузились") { vm.achievements.value is ru.teletau.feature.student.common.Resource.Failed }
        assertEquals(null, vm.toast.value)
        await("профиль") { vm.cells.value !is ru.teletau.feature.student.common.Resource.Loading }

        achievementsDown = false
        vm.loadProfile()
        await("награды") { vm.achievements.value is ru.teletau.feature.student.common.Resource.Ready }
        val before = (vm.achievements.value as ru.teletau.feature.student.common.Resource.Ready).data
        assertEquals(5 to 12, before.earned to before.total)

        // Урок принёс «7 дней подряд»: итог → серия → «Новая награда!» → новая лига → тропа.
        vm.selectTab(StudentTab.Path)
        completeSummary = Demo.summaryWithAward
        vm.start(Demo.course.units.first().nodes.first { it.id == "u01-moya-shkola" })
        await("урок") { vm.flow.value is FlowState.Lesson }
        vm.next()
        vm.check(AttemptAnswer.TilesWrapper(TilesAnswer(TilesAnswerType.tiles, listOf("t1", "t2"))))
        await("вердикт") { (vm.flow.value as? FlowState.Lesson)?.lesson?.feedback != null }
        vm.next()
        await("итог") { vm.flow.value is FlowState.Result }
        val merged = (vm.achievements.value as ru.teletau.feature.student.common.Resource.Ready).data
        assertEquals("новая награда сразу в профиле", 6, merged.earned)
        assertEquals("2026-11-14", merged.achievements.first { it.id == "streak-7" }.earnedOn)
        vm.continueFlow()
        assertTrue(vm.flow.value is FlowState.Streak)
        vm.continueFlow()
        assertTrue(vm.flow.value is FlowState.Achievement)
        assertTrue("«Назад» на экране награды — дальше по потоку", vm.onBack())
        assertTrue(vm.flow.value is FlowState.LeagueUp)
        vm.continueFlow()
        await("тропа после урока") { vm.flow.value is FlowState.Trail }
    }

    @Test
    fun openedHint_goesToAttemptAsHintsUsed_newShowStartsFromZero() = runTest {
        val vm = StudentViewModel(env)
        advanceUntilIdle()
        vm.openScan()
        vm.onScanned("https://teletau.study/q#tt1.0123456789.abcdefghjkmnpqrstvwxyz0123.6v")
        await("тропа") { vm.course.value is ru.teletau.feature.student.common.Resource.Ready && vm.progress.value is ru.teletau.feature.student.common.Resource.Ready }
        vm.start(Demo.course.units.first().nodes.first { it.id == "u01-moya-shkola" })
        await("урок") { vm.flow.value is FlowState.Lesson }
        vm.next()
        // Первый ответ — «Пока не так» с повтором: задание вернётся в конец урока.
        attemptResults += Demo.correct.copy(attemptId = "a0", verdict = ru.teletau.core.network.models.Verdict.wrong, retry = true)
        val tiles = AttemptAnswer.TilesWrapper(TilesAnswer(TilesAnswerType.tiles, listOf("t1", "t2")))

        // Подсказку открыли дважды — это одна подсказка.
        vm.hintOpened(0)
        vm.hintOpened(0)
        vm.check(tiles)
        await("вердикт") { (vm.flow.value as? FlowState.Lesson)?.lesson?.feedback != null }
        assertTrue(attemptBodies[0], attemptBodies[0].contains("\"hintsUsed\":1"))
        // После проверки подсказка уже не считается; повтор задания — новый показ, без подсказок.
        vm.hintOpened(0)
        vm.next()
        assertTrue("задание вернулось", ru.teletau.feature.student.learn.isRetry((vm.flow.value as FlowState.Lesson).lesson))
        vm.check(tiles)
        await("второй вердикт") { attemptBodies.size == 2 && (vm.flow.value as? FlowState.Lesson)?.lesson?.feedback != null }
        assertTrue(attemptBodies[1], !attemptBodies[1].contains("hintsUsed"))
    }

    @Test
    fun jump_startsJumpRun_runEndedCompletesAtOnce_backToTrailUnsealed() = runTest {
        val vm = StudentViewModel(env)
        advanceUntilIdle()
        vm.openScan()
        vm.onScanned("https://teletau.study/q#tt1.0123456789.abcdefghjkmnpqrstvwxyz0123.6v")
        await("тропа") { vm.course.value is ru.teletau.feature.student.common.Resource.Ready && vm.progress.value is ru.teletau.feature.student.common.Resource.Ready }
        completeSummary = Demo.jumpFailed

        vm.startJump(Demo.course.units[1])
        assertTrue("у места без jump испытания нет", vm.flow.value is FlowState.Trail && requests.none { it.contains("/jump-runs") })

        val place = Demo.courseJump.units[1]
        vm.startJump(place)
        await("испытание") { vm.flow.value is FlowState.Lesson }
        assertTrue(requests.contains("POST /api/v1/units/02-shulgantash/jump-runs"))
        assertTrue("обычный урок не открывался", requests.none { it.startsWith("POST /api/v1/lessons/") })
        val lesson = (vm.flow.value as FlowState.Lesson).lesson
        assertEquals(ru.teletau.feature.student.learn.jumpNode("02-shulgantash"), lesson.node)

        // Ошибок больше, чем можно: ответ показан, по «Дальше» — сразу итог, остальные два задания не показываются.
        attemptResults += Demo.correct.copy(attemptId = "a0", verdict = ru.teletau.core.network.models.Verdict.wrong, retry = false, runEnded = true)
        vm.check(AttemptAnswer.TilesWrapper(TilesAnswer(TilesAnswerType.tiles, listOf("t1", "t2"))))
        await("вердикт") { (vm.flow.value as? FlowState.Lesson)?.lesson?.feedback != null }
        vm.next()
        await("итог") { vm.flow.value is FlowState.Result }
        assertEquals(1, requests.count { it.endsWith("/attempts") })
        assertTrue(requests.contains("POST /api/v1/lesson-runs/${Demo.run.runId}/complete"))
        val after = (vm.flow.value as FlowState.Result).after
        assertEquals(false, after.summary.jump?.passed)
        assertEquals("на итоге — само место", "Шульган-Таш", vm.placeOf(after.node).place?.titleRu)

        vm.continueFlow()
        await("тропа после испытания") { vm.flow.value is FlowState.Trail }
        assertEquals(FlowState.Trail(sealed = null), vm.flow.value)
    }

    @Test
    fun selfLearner_ageNick_thenJoinsClass() = runTest {
        val vm = StudentViewModel(env)
        advanceUntilIdle()
        vm.openSelf()
        vm.selfNext()
        assertEquals("без возраста дальше нельзя", ru.teletau.feature.student.login.SelfStep.Age, vm.selfStep.value)
        vm.pickAge(ru.teletau.core.network.models.AgeBand.age1114)
        vm.selfNext()
        assertEquals(ru.teletau.feature.student.login.SelfStep.Nick, vm.selfStep.value)
        await("ники") { vm.nicks.value is ru.teletau.feature.student.common.Resource.Ready }
        vm.selfNext()
        assertEquals("без ника «Начать» ничего не делает", ru.teletau.feature.student.login.SelfStep.Nick, vm.selfStep.value)
        assertTrue("«Назад» — на шаг возраста", vm.onBack() && vm.selfStep.value == ru.teletau.feature.student.login.SelfStep.Age)
        vm.selfNext()
        vm.pickNick("n.owl")
        // «Начать»: цель дня не передаётся — сервер ставит 2, меняется в профиле.
        vm.selfNext()
        await("тропа") { vm.routes.value == listOf(Route.Main(StudentTab.Path)) }
        assertEquals("Мудрая сова", vm.account.value?.nickname)

        vm.selectTab(StudentTab.Hive)
        vm.openJoin()
        vm.onCode("k7q-4mz")
        vm.submitJoinClass()
        await("класс") { vm.routes.value == listOf(Route.Main(StudentTab.Hive)) }
        assertEquals("5 «Б»", vm.account.value?.classes?.firstOrNull()?.title)
        assertTrue(requests.contains("GET /api/v1/me/class-join/0190a8c0-0000-7000-8000-00000000c001"))
    }

    @Test
    fun personalCard_goesToLoginCardEndpoint() = runTest {
        val vm = StudentViewModel(env)
        advanceUntilIdle()
        vm.openScan()
        vm.onScanned("tp1.0123456789.abcdefghjkmnpqrstvwxyz0123.4s")
        await("вход по личной карточке") { vm.routes.value.last() is Route.Main }
        assertTrue(requests.contains("POST /api/v1/auth/login-card"))
        assertTrue(requests.none { it.contains("/auth/qr") })
    }

    @Test
    fun invalidQr_showsChildMessage_withoutRequest() = runTest {
        val vm = StudentViewModel(env)
        advanceUntilIdle()
        vm.openScan()
        vm.onScanned("https://example.com/other")
        assertTrue(vm.scan.value is ru.teletau.feature.student.login.ScanState.Error)
        assertTrue(requests.none { it.contains("/auth/qr") })
    }
}
