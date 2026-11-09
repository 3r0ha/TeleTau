package ru.teletau.feature.student

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.teletau.core.network.models.Achievement
import ru.teletau.core.network.models.AttemptResult
import ru.teletau.core.network.models.DuelExercise
import ru.teletau.core.network.models.DuelExerciseType
import ru.teletau.core.network.models.FreeInputExercise
import ru.teletau.core.network.models.FreeInputExerciseType
import ru.teletau.core.network.models.HoneyBreakdown
import ru.teletau.core.network.models.LeagueOutcome
import ru.teletau.core.network.models.LeagueResult
import ru.teletau.core.network.models.LeagueTier
import ru.teletau.core.network.models.LessonRun
import ru.teletau.core.network.models.LessonRunSummary
import ru.teletau.core.network.models.ReviewStatus
import ru.teletau.core.network.models.RunExercise
import ru.teletau.core.network.models.RunKind
import ru.teletau.core.network.models.RunStatus
import ru.teletau.core.network.models.StreakState
import ru.teletau.core.network.models.Verdict
import ru.teletau.feature.student.learn.FlowEvent
import ru.teletau.feature.student.learn.FlowState
import ru.teletau.feature.student.learn.MAX_RETRIES
import ru.teletau.feature.student.learn.NodeRef
import ru.teletau.feature.student.learn.REVIEW_NODE
import ru.teletau.feature.student.learn.initialFlow
import ru.teletau.feature.student.learn.isRetry
import ru.teletau.feature.student.learn.lessonDone
import ru.teletau.feature.student.learn.reduce

/** Автомат «тропа → урок → итог → серия → награда → лига → тропа» — те же сценарии, что apps/web/test/learn-machine.test.ts. */
class LearnMachineTest {
    private val node = NodeRef("u01-moya-shkola", RunKind.lesson)
    private val review = ReviewStatus.needsNativeReview
    private val run = LessonRun(
        runId = "r1", lessonId = node.id, kind = RunKind.lesson, titleRu = "Моя школа", status = RunStatus.active, startedAt = "2026-11-14T06:00:00Z",
        exercises = listOf(
            RunExercise.FreeRuBaWrapper(FreeInputExercise("e1", FreeInputExerciseType.freeRuBa, review, "Спасибо!", emptyList())),
            RunExercise.DuelWrapper(DuelExercise("e2", DuelExerciseType.duel, review, "item", "Добрый день", "A", "B")),
        ),
    )

    private fun verdict(v: Verdict, retry: Boolean = false) = AttemptResult(attemptId = "a", exerciseId = "e", verdict = v, firstAttempt = true, retry = retry)

    private fun summary(extended: Boolean, promoted: Boolean) = LessonRunSummary(
        runId = run.runId, lessonId = node.id, honey = HoneyBreakdown(12, 10, 2, 1.0, 3), accuracy = 1.0, durationSeconds = 90, newWords = emptyList(), votes = 1,
        streak = StreakState(6, 6, 2, extended, "2026-11-14", emptyList()),
        leagueResult = if (promoted) LeagueResult("2026-11-02", LeagueTier.sweetclover, LeagueTier.fireweed, LeagueOutcome.promoted, 5, 318) else null,
    )

    private fun play(events: List<FlowEvent>, from: FlowState = initialFlow) = events.fold(from, ::reduce)
    private fun started(r: LessonRun = run, n: NodeRef = node) = play(listOf(FlowEvent.Start(n, r.runId), FlowEvent.RunReady(r, 0)))
    private fun answer(result: AttemptResult) = listOf(FlowEvent.Check("att"), FlowEvent.VerdictReady(result), FlowEvent.Next)

    @Test
    fun wrongWithRetry_returnsToEndAndIsMarkedAsRetry() {
        val s = play(answer(verdict(Verdict.wrong, true)), started()) as FlowState.Lesson
        assertEquals(listOf("e2", "e1"), s.lesson.queue)
        assertEquals(0, lessonDone(s.lesson))
        val atRetry = play(answer(verdict(Verdict.recorded)), s) as FlowState.Lesson
        assertTrue(isRetry(atRetry.lesson))
        assertEquals(1, lessonDone(atRetry.lesson))
    }

    @Test
    fun almostDoesNotReturn_wrongReturnsAtMostMaxRetries() {
        assertTrue(play(answer(verdict(Verdict.almost)) + answer(verdict(Verdict.recorded)), started()) is FlowState.Completing)
        var s = started(run.copy(exercises = run.exercises.take(1)))
        repeat(MAX_RETRIES) {
            s = play(answer(verdict(Verdict.wrong, true)), s)
            assertTrue(s is FlowState.Lesson)
        }
        assertTrue(play(answer(verdict(Verdict.wrong, true)), s) is FlowState.Completing)
    }

    @Test
    fun combo_countsCorrectInARow_wrongResets_voteDoesNotCount() {
        val three = run.copy(exercises = List(5) { i -> RunExercise.FreeRuBaWrapper(FreeInputExercise("e$i", FreeInputExerciseType.freeRuBa, review, "Спасибо!", emptyList())) })
        var s: FlowState = started(three)
        val combos = mutableListOf<Int>()
        for (v in listOf(Verdict.correct, Verdict.almost, Verdict.recorded, Verdict.typo, Verdict.wrong)) {
            s = play(listOf(FlowEvent.Check("att"), FlowEvent.VerdictReady(verdict(v))), s)
            combos += (s as FlowState.Lesson).lesson.combo
            s = play(listOf(FlowEvent.Next), s)
        }
        assertEquals(listOf(1, 2, 2, 3, 0), combos)
        assertEquals(3, ru.teletau.feature.student.learn.COMBO_FROM)
    }

    @Test
    fun wordIntro_nextWithoutAttempt_countsAsStep_neverRepeats() {
        val intro = RunExercise.WordIntroWrapper(ru.teletau.core.network.models.WordIntroExercise("w1", ru.teletau.core.network.models.WordIntroExerciseType.wordIntro, review, ru.teletau.core.network.models.BaString("мәктәп", review), "школа"))
        val s0 = started(run.copy(exercises = listOf(intro) + run.exercises)) as FlowState.Lesson
        assertTrue(ru.teletau.feature.student.learn.isIntro(s0.lesson))
        assertEquals("«Проверить» на карточке ничего не делает", s0, reduce(s0, FlowEvent.Check("att")))
        val s1 = reduce(s0, FlowEvent.Next) as FlowState.Lesson
        assertEquals(listOf("e1", "e2"), s1.lesson.queue)
        assertEquals("карточка — шаг полосы прогресса", 1, lessonDone(s1.lesson))
        assertEquals(0, s1.lesson.combo)
        assertTrue("одни карточки — урока нет", play(listOf(FlowEvent.Start(node, "r"), FlowEvent.RunReady(run.copy(exercises = listOf(intro)), 0))) is FlowState.Empty)
    }

    @Test
    fun afterNetworkFailure_recheckKeepsAttemptId() {
        val s = play(listOf(FlowEvent.Check("first"), FlowEvent.AttemptFailed, FlowEvent.Check("second")), started()) as FlowState.Lesson
        assertEquals("first", s.lesson.attemptId)
        assertTrue(s.lesson.checking)
    }

    @Test
    fun runWithoutExercises_showsEmptyThenTrail() {
        val help = NodeRef("u01-help-1", RunKind.helpLanguage)
        val s = play(listOf(FlowEvent.Start(help, "r"), FlowEvent.RunReady(run.copy(exercises = emptyList()), 0)))
        assertEquals(FlowState.Empty(help), s)
        assertEquals(FlowState.Trail(), play(listOf(FlowEvent.Continue), s))
    }

    @Test
    fun afterLesson_resultStreakLeagueUpTrailWithSealedNode() {
        val done = play(answer(verdict(Verdict.correct)) + answer(verdict(Verdict.recorded)) + FlowEvent.Completed(summary(true, true), showStreak = true), started())
        assertTrue(done is FlowState.Result)
        val steps = (1..3).map { n -> play(List(n) { FlowEvent.Continue }, done)::class.simpleName }
        assertEquals(listOf("Streak", "LeagueUp", "Trail"), steps)
        assertEquals(FlowState.Trail(sealed = node.id), play(List(3) { FlowEvent.Continue }, done))
    }

    private val award = Achievement(id = "words-10", titleRu = "10 слов", descriptionRu = "Выучи 10 слов", icon = "book-open", progress = 10, target = 10, earnedOn = "2026-11-14")

    @Test
    fun newAchievements_shownAfterStreakBeforeLeagueUp() {
        val withAward = summary(true, true).copy(newAchievements = listOf(award, award.copy(id = "first-place", icon = "map-pin")))
        val done = play(answer(verdict(Verdict.correct)) + answer(verdict(Verdict.recorded)) + FlowEvent.Completed(withAward, showStreak = true), started())
        val steps = (1..4).map { n -> play(List(n) { FlowEvent.Continue }, done)::class.simpleName }
        assertEquals(listOf("Streak", "Achievement", "LeagueUp", "Trail"), steps)
        // Все новые награды — на одном экране, этот шаг не повторяется для каждой.
        assertEquals(2, (play(List(2) { FlowEvent.Continue }, done) as FlowState.Achievement).after.summary.newAchievements?.size)
        assertEquals(FlowState.Trail(sealed = node.id), play(List(4) { FlowEvent.Continue }, done))
    }

    @Test
    fun newAchievementWithoutStreakOrPromotion_resultThenAchievementThenTrail() {
        val withAward = summary(false, false).copy(newAchievements = listOf(award))
        val done = play(answer(verdict(Verdict.correct)) + answer(verdict(Verdict.recorded)) + FlowEvent.Completed(withAward, showStreak = false), started())
        assertTrue(play(listOf(FlowEvent.Continue), done) is FlowState.Achievement)
        assertEquals(FlowState.Trail(sealed = node.id), play(List(2) { FlowEvent.Continue }, done))
        // Пустой список — экрана награды нет.
        val none = play(answer(verdict(Verdict.correct)) + answer(verdict(Verdict.recorded)) + FlowEvent.Completed(withAward.copy(newAchievements = emptyList()), showStreak = false), started())
        assertEquals(FlowState.Trail(sealed = node.id), play(listOf(FlowEvent.Continue), none))
    }

    @Test
    fun secondLessonOfDayWithoutPromotion_goesStraightToTrail() {
        val done = play(answer(verdict(Verdict.correct)) + answer(verdict(Verdict.recorded)) + FlowEvent.Completed(summary(true, false), showStreak = false), started())
        assertEquals(FlowState.Trail(sealed = node.id), play(listOf(FlowEvent.Continue), done))
    }

    @Test
    fun quitDialog_stayOrLeave() {
        val quit = play(listOf(FlowEvent.Quit), started()) as FlowState.Lesson
        assertTrue(quit.lesson.quit)
        assertTrue(play(listOf(FlowEvent.Stay), quit) is FlowState.Lesson)
        assertEquals(FlowState.Trail(), play(listOf(FlowEvent.Leave), quit))
    }

    @Test
    fun reviewRun_returnsToTrailWithoutSealing() {
        val done = play(answer(verdict(Verdict.correct)) + answer(verdict(Verdict.recorded)) + FlowEvent.Completed(summary(true, false), showStreak = false), started(run.copy(kind = RunKind.review), REVIEW_NODE))
        assertEquals(FlowState.Trail(sealed = null), play(listOf(FlowEvent.Continue), done))
    }

    private val jump = ru.teletau.feature.student.learn.jumpNode("02-shulgantash")
    private val jumpRun = run.copy(
        runId = "j1", lessonId = jump.id, kind = RunKind.jump, titleRu = "Испытание",
        exercises = List(4) { i -> RunExercise.FreeRuBaWrapper(FreeInputExercise("e$i", FreeInputExerciseType.freeRuBa, review, "Спасибо!", emptyList())) },
    )

    @Test
    fun jump_runEnded_nextGoesStraightToCompleting_restNotShown() {
        // Ошибка без досрочного конца — дальше следующее упражнение, повтора нет (retry: false).
        val afterWrong = play(answer(verdict(Verdict.wrong)), started(jumpRun, jump)) as FlowState.Lesson
        assertEquals(listOf("e1", "e2", "e3"), afterWrong.lesson.queue)
        // Ошибок больше, чем можно: лист с ответом показан, по «Дальше» — сразу завершение.
        val ended = play(listOf(FlowEvent.Check("att"), FlowEvent.VerdictReady(verdict(Verdict.wrong).copy(runEnded = true))), afterWrong) as FlowState.Lesson
        assertTrue("лист с ответом показывается как обычно", ended.lesson.feedback?.runEnded == true)
        val completing = play(listOf(FlowEvent.Next), ended)
        assertTrue(completing is FlowState.Completing)
        assertEquals(emptyList<String>(), (completing as FlowState.Completing).lesson.queue)
        assertEquals(listOf("e0", "e1"), completing.lesson.finished)
    }

    @Test
    fun jump_afterResult_trailSealsNothing() {
        val jumpSummary = summary(extended = true, promoted = false).copy(
            lessonId = jump.id, jump = ru.teletau.core.network.models.JumpResult(unitId = jump.id, passed = true, mistakes = 0, mistakesAllowed = 2),
        )
        val all = jumpRun.exercises.flatMap { answer(verdict(Verdict.correct)) }
        val done = play(all + FlowEvent.Completed(jumpSummary, showStreak = true), started(jumpRun, jump))
        assertTrue(done is FlowState.Result)
        assertEquals("сначала серия — обычный поток", "Streak", play(listOf(FlowEvent.Continue), done)::class.simpleName)
        assertEquals(FlowState.Trail(sealed = null), play(List(2) { FlowEvent.Continue }, done))
        // Не сдано — сразу на тропу, тоже ничего не запечатывая.
        val failed = play(answer(verdict(Verdict.wrong).copy(runEnded = true)) + FlowEvent.Completed(jumpSummary.copy(jump = jumpSummary.jump?.copy(passed = false)), showStreak = false), started(jumpRun, jump))
        assertEquals(FlowState.Trail(sealed = null), play(listOf(FlowEvent.Continue), failed))
    }

    @Test
    fun passedByTest_nodeReadsAsPassedByTest() {
        val node = ru.teletau.core.network.models.TrailNode(id = "u02-mama-i-papa", kind = ru.teletau.core.network.models.NodeKind.lesson, state = ru.teletau.core.network.models.NodeState.done, titleRu = "Мама и папа", completions = 0, passedByTest = true)
        assertEquals("Урок «Мама и папа», пройден испытанием", ru.teletau.feature.student.learn.nodeLabel(node))
        assertEquals("Урок «Мама и папа», пройден", ru.teletau.feature.student.learn.nodeLabel(node.copy(passedByTest = null, completions = 1)))
    }

    @Test
    fun completeFailure_canBeRetried() {
        val completing = play(answer(verdict(Verdict.correct)) + answer(verdict(Verdict.recorded)) + FlowEvent.CompleteFailed, started()) as FlowState.Completing
        assertTrue(completing.failed)
        assertEquals(false, (play(listOf(FlowEvent.RetryComplete), completing) as FlowState.Completing).failed)
    }
}
