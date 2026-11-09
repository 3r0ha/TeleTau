package ru.teletau.feature.student.learn

import ru.teletau.core.network.models.AttemptResult
import ru.teletau.core.network.models.LeagueOutcome
import ru.teletau.core.network.models.LessonRun
import ru.teletau.core.network.models.LessonRunSummary
import ru.teletau.core.network.models.NodeKind
import ru.teletau.core.network.models.RunKind
import ru.teletau.core.network.models.RunExercise
import ru.teletau.core.network.models.Verdict

/*
 * Один автомат состояний тропы, урока и потока после урока — порт apps/web/app/_components/learn/machine.ts
 * (тот же порядок шагов, те же правила повтора):
 *
 *   trail ─start→ starting ─runReady→ lesson ⟲ (check → verdict → next) ─последнее упражнение→ completing
 *     ↑              └─runFailed→ trail                                                         │ completed
 *     └─ leagueUp ←continue─ achievement ←continue─ streak ←continue─ result ←────────────────────┘
 *
 * После итога — только нужные шаги по порядку: серия (урок продлил её), новые награды (newAchievements), новая лига.
 * Неверный ответ возвращается в конец урока («Повторим в конце урока»), когда сервер ответил retry: true, — не
 * больше MAX_RETRIES раз. Дуэль не повторяется: в ней нет неверного ответа. Испытание для перехода ([jumpNode]) идёт
 * тем же путём, но повторов в нём нет, а ответ с runEnded: true (ошибок больше, чем можно) по «Дальше» сразу ведёт
 * к завершению — оставшиеся упражнения не показываются. Запросы выполняет ViewModel по состоянию;
 * сам автомат — чистая функция (LearnMachineTest).
 */

const val MAX_RETRIES = 3

/** Что начинаем: узел тропы, повторение слов ([REVIEW_NODE]) или испытание для перехода к месту ([jumpNode]). */
data class NodeRef(val id: String, val kind: RunKind)

/** Повторение слов, срок которых наступил (POST /reviews/runs) — не узел тропы, запечатывать нечего. */
val REVIEW_NODE: NodeRef = NodeRef("review", RunKind.review)

/** Испытание для перехода к закрытому месту (POST /units/{unitId}/jump-runs): id — место (`CourseUnit.id`), не узел. */
fun jumpNode(unitId: String): NodeRef = NodeRef(unitId, RunKind.jump)

fun NodeKind.toRunKind(): RunKind = RunKind.entries.first { it.value == value }

/** Какой узел тропы запечатать по возвращении: у повторения и испытания для перехода — никакой. */
private fun NodeRef.sealedId(): String? = if (kind == RunKind.review || kind == RunKind.jump) null else id

data class LessonState(
    val run: LessonRun,
    val node: NodeRef,
    /** Очередь показа: id упражнений; текущее — первое. */
    val queue: List<String>,
    /** Упражнения, которые больше не покажем (решены или исчерпали повторы). */
    val finished: List<String> = emptyList(),
    /** Сколько раз упражнение уже вернулось в конец. */
    val retries: Map<String, Int> = emptyMap(),
    /** Сколько показов упражнения было до этого (0 — первый показ). */
    val shownBefore: Map<String, Int> = emptyMap(),
    val feedback: AttemptResult? = null,
    val checking: Boolean = false,
    val quit: Boolean = false,
    /** attemptId текущего ответа: повтор после сбоя сети уходит с тем же id (сервер не засчитает дважды). */
    val attemptId: String? = null,
    val startedAt: Long = 0,
    /** Верные ответы подряд в этом уроке (огонёк «3 подряд» на листе): ошибка обнуляет счёт, голос не считается. */
    val combo: Int = 0,
)

/** С какого числа верных ответов подряд лист «Верно» показывает огонёк «N подряд». */
const val COMBO_FROM = 3

private fun comboAfter(combo: Int, verdict: Verdict): Int = when (verdict) {
    Verdict.recorded -> combo
    Verdict.wrong -> 0
    else -> combo + 1
}

data class AfterLesson(
    val node: NodeRef,
    val run: LessonRun,
    val summary: LessonRunSummary,
    /** Этот урок выполнил цель дня (первый урок суток) — показать экран серии. */
    val showStreak: Boolean,
)

sealed interface FlowState {
    data class Trail(val sealed: String? = null) : FlowState
    data class Starting(val node: NodeRef, val runId: String) : FlowState
    /** Забег без упражнений: у «Помоги языку» закончились дуэли для этого аккаунта. */
    data class Empty(val node: NodeRef) : FlowState
    data class Lesson(val lesson: LessonState) : FlowState
    data class Completing(val lesson: LessonState, val failed: Boolean = false) : FlowState
    data class Result(val after: AfterLesson) : FlowState
    data class Streak(val after: AfterLesson) : FlowState
    /** «Новая награда!»: в итоге есть newAchievements — все новые награды одним экраном. */
    data class Achievement(val after: AfterLesson) : FlowState
    data class LeagueUp(val after: AfterLesson) : FlowState
}

sealed interface FlowEvent {
    data class Start(val node: NodeRef, val runId: String) : FlowEvent
    data class RunReady(val run: LessonRun, val now: Long) : FlowEvent
    data object RunFailed : FlowEvent
    data class Check(val attemptId: String) : FlowEvent
    data class VerdictReady(val result: AttemptResult) : FlowEvent
    data object AttemptFailed : FlowEvent
    data object Next : FlowEvent
    data object Quit : FlowEvent
    data object Stay : FlowEvent
    data object Leave : FlowEvent
    data class Completed(val summary: LessonRunSummary, val showStreak: Boolean) : FlowEvent
    data object CompleteFailed : FlowEvent
    data object RetryComplete : FlowEvent
    data object Continue : FlowEvent
}

val initialFlow: FlowState = FlowState.Trail()

/** Идентификатор упражнения любого вида. */
val RunExercise.id: String
    get() = when (this) {
        is RunExercise.TilesRuBaWrapper -> value.id
        is RunExercise.ChoiceBaRuWrapper -> value.id
        is RunExercise.FreeRuBaWrapper -> value.id
        is RunExercise.DuelWrapper -> value.id
        is RunExercise.MatchPairsWrapper -> value.id
        is RunExercise.WordIntroWrapper -> value.id
    }

fun currentExercise(l: LessonState): RunExercise? = l.queue.firstOrNull()?.let { id -> l.run.exercises.firstOrNull { it.id == id } }

/** Сейчас — карточка «Новое слово»: ответа нет, «Дальше» ведёт к следующему упражнению без попытки. */
fun isIntro(l: LessonState): Boolean = currentExercise(l) is RunExercise.WordIntroWrapper

/** Текущее упражнение показывается повторно (после ошибки). */
fun isRetry(l: LessonState): Boolean = l.queue.firstOrNull()?.let { (l.shownBefore[it] ?: 0) > 0 } ?: false

/** Прогресс урока: решённые упражнения, включая текущее, если его вердикт засчитан. */
fun lessonDone(l: LessonState): Int {
    val counted = if (l.feedback != null && l.feedback.verdict != Verdict.wrong) 1 else 0
    return minOf(l.run.exercises.size, l.finished.size + counted)
}

/** Неверный ответ вернётся в конец урока (повторы не исчерпаны). */
fun willRetry(l: LessonState): Boolean {
    val id = l.queue.firstOrNull() ?: return false
    val f = l.feedback ?: return false
    return f.verdict == Verdict.wrong && f.retry && (l.retries[id] ?: 0) < MAX_RETRIES
}

/** Шаги после итога по порядку. */
private enum class AfterStep { Result, Streak, Achievement, LeagueUp }

/** Нужен ли шаг после итога этому уроку. */
private fun wants(step: AfterStep, after: AfterLesson): Boolean = when (step) {
    AfterStep.Result -> false
    AfterStep.Streak -> after.showStreak
    AfterStep.Achievement -> !after.summary.newAchievements.isNullOrEmpty()
    AfterStep.LeagueUp -> after.summary.leagueResult?.outcome == LeagueOutcome.promoted
}

/** Следующий нужный шаг после [from]; шагов больше нет — тропа (с запечатанным узлом урока). */
private fun afterStep(from: AfterStep, after: AfterLesson): FlowState =
    when (AfterStep.entries.drop(from.ordinal + 1).firstOrNull { wants(it, after) }) {
        AfterStep.Streak -> FlowState.Streak(after)
        AfterStep.Achievement -> FlowState.Achievement(after)
        AfterStep.LeagueUp -> FlowState.LeagueUp(after)
        AfterStep.Result, null -> FlowState.Trail(sealed = after.node.sealedId())
    }

fun reduce(state: FlowState, event: FlowEvent): FlowState {
    when (event) {
        is FlowEvent.Start -> return if (state is FlowState.Trail) FlowState.Starting(event.node, event.runId) else state
        is FlowEvent.RunReady -> {
            if (state !is FlowState.Starting) return state
            val ids = event.run.exercises.map { it.id }
            // Одни карточки «Новое слово» без заданий — урока нет.
            if (event.run.exercises.none { it !is RunExercise.WordIntroWrapper }) return FlowState.Empty(state.node)
            return FlowState.Lesson(LessonState(run = event.run, node = state.node, queue = ids, startedAt = event.now))
        }
        FlowEvent.RunFailed -> return if (state is FlowState.Starting) FlowState.Trail() else state
        else -> Unit
    }

    if (state is FlowState.Lesson) {
        val l = state.lesson
        return when (event) {
            is FlowEvent.Check ->
                if (l.feedback != null || l.checking || isIntro(l)) state else FlowState.Lesson(l.copy(checking = true, attemptId = l.attemptId ?: event.attemptId))
            is FlowEvent.VerdictReady -> if (!l.checking) state else FlowState.Lesson(l.copy(checking = false, feedback = event.result, combo = comboAfter(l.combo, event.result.verdict)))
            FlowEvent.AttemptFailed -> FlowState.Lesson(l.copy(checking = false))
            FlowEvent.Next -> {
                if (l.feedback == null && !isIntro(l)) return state
                val id = l.queue.firstOrNull() ?: return state
                // Испытание для перехода окончено досрочно: ответ показан, остальное не показываем — сразу итог.
                if (l.feedback?.runEnded == true) {
                    return FlowState.Completing(l.copy(queue = emptyList(), finished = l.finished + id, feedback = null, attemptId = null))
                }
                val rest = l.queue.drop(1)
                val retry = willRetry(l)
                val next = l.copy(
                    queue = if (retry) rest + id else rest,
                    finished = if (retry) l.finished else l.finished + id,
                    retries = if (retry) l.retries + (id to (l.retries[id] ?: 0) + 1) else l.retries,
                    shownBefore = l.shownBefore + (id to (l.shownBefore[id] ?: 0) + 1),
                    feedback = null,
                    attemptId = null,
                )
                if (next.queue.isNotEmpty()) FlowState.Lesson(next) else FlowState.Completing(next)
            }
            FlowEvent.Quit -> FlowState.Lesson(l.copy(quit = true))
            FlowEvent.Stay -> FlowState.Lesson(l.copy(quit = false))
            FlowEvent.Leave -> FlowState.Trail()
            else -> state
        }
    }

    if (state is FlowState.Completing) {
        return when (event) {
            is FlowEvent.Completed -> FlowState.Result(AfterLesson(state.lesson.node, state.lesson.run, event.summary, event.showStreak))
            FlowEvent.CompleteFailed -> state.copy(failed = true)
            FlowEvent.RetryComplete -> FlowState.Completing(state.lesson)
            FlowEvent.Leave -> FlowState.Trail()
            else -> state
        }
    }

    if (event == FlowEvent.Continue) {
        return when (state) {
            is FlowState.Empty -> FlowState.Trail()
            is FlowState.Result -> afterStep(AfterStep.Result, state.after)
            is FlowState.Streak -> afterStep(AfterStep.Streak, state.after)
            is FlowState.Achievement -> afterStep(AfterStep.Achievement, state.after)
            is FlowState.LeagueUp -> afterStep(AfterStep.LeagueUp, state.after)
            else -> state
        }
    }
    return state
}
