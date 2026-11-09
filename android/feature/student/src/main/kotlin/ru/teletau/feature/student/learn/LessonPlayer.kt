package ru.teletau.feature.student.learn

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.foundation.layout.size
import ru.teletau.feature.student.common.LocalUiSounds
import ru.teletau.feature.student.common.UiSound
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.BasicText
import ru.teletau.core.designsystem.BashkirLocale
import ru.teletau.core.designsystem.ButtonVariant
import ru.teletau.core.designsystem.EmptyState
import ru.teletau.core.designsystem.FeedbackSheet
import ru.teletau.core.designsystem.FeedbackTone
import ru.teletau.core.designsystem.TeleTauButton
import ru.teletau.core.designsystem.TeleTauDialog
import ru.teletau.core.designsystem.TeleTauDuration
import ru.teletau.core.designsystem.TeleTauEasing
import ru.teletau.core.designsystem.TeleTauFonts
import ru.teletau.core.designsystem.TeleTauFontWeight
import ru.teletau.core.designsystem.TeleTauIconButton
import ru.teletau.core.designsystem.TeleTauProgressBar
import ru.teletau.core.designsystem.TeleTauRadius
import ru.teletau.core.designsystem.TeleTauSize
import ru.teletau.core.designsystem.TeleTauSpace
import ru.teletau.core.designsystem.TeleTauText
import ru.teletau.core.designsystem.TeleTauTheme
import ru.teletau.core.designsystem.LinkButton
import ru.teletau.core.designsystem.LinkTone
import ru.teletau.core.designsystem.PhosphorIcons
import ru.teletau.core.designsystem.R
import ru.teletau.core.designsystem.SkeletonBlock
import ru.teletau.core.network.models.AttemptAnswer
import ru.teletau.core.network.models.AttemptResult
import ru.teletau.core.network.models.RunExercise
import ru.teletau.core.network.models.RunKind
import ru.teletau.core.network.models.Verdict

private val OK_TITLES = listOf("Верно!", "Точно!")

private val VERDICT_SOUND = mapOf(
    Verdict.correct to UiSound.Correct, Verdict.typo to UiSound.Correct, Verdict.almost to UiSound.Almost,
    Verdict.wrong to UiSound.Wrong, Verdict.recorded to UiSound.Voted,
)

/** Каркас урока: крестик и прогресс сверху, задание по центру, кнопка или лист снизу; над клавиатурой — всё видно. */
@Composable
private fun LessonFrame(done: Int, total: Int, onClose: () -> Unit, body: @Composable () -> Unit, foot: @Composable () -> Unit) {
    val c = TeleTauTheme.colors
    Column(Modifier.fillMaxSize().background(c.bg).imePadding()) {
        Row(
            Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.statusBars)
                .padding(start = TeleTauSpace.s250, end = TeleTauSpace.s400, top = TeleTauSpace.s300, bottom = TeleTauSpace.s150),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300),
        ) {
            TeleTauIconButton(PhosphorIcons.XBold, "Выйти из урока", onClose)
            TeleTauProgressBar(done, total, Modifier.weight(1f), label = "Прогресс урока", valueText = "Пройдено $done из $total")
        }
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier.widthIn(max = TeleTauSize.columnNarrow).fillMaxWidth().verticalScroll(rememberScrollState())
                    .padding(start = TeleTauSpace.s400, end = TeleTauSpace.s400, top = TeleTauSpace.s350, bottom = TeleTauSpace.s450),
            ) { body() }
        }
        foot()
    }
}

/**
 * Плеер урока (prototype 05–12): задание, «Проверить» в зоне большого пальца, после ответа — лист
 * «Верно / Почти / Пока не так / Голос учтён». «Назад» во время урока открывает «Уже уходишь?» (обрабатывает экран-хозяин).
 * Открытые подсказки к словам условия ([onHint], номер в `hints`) ответ уносит в `hintsUsed`.
 */
@Composable
fun LessonPlayer(
    lesson: LessonState, onCheck: (AttemptAnswer) -> Unit, onNext: () -> Unit, onQuit: () -> Unit, onStay: () -> Unit, onLeave: () -> Unit,
    onHint: (Int) -> Unit = {},
) {
    val exercise = currentExercise(lesson) ?: return
    val retry = isRetry(lesson)
    val stepKey = "${exercise.id}:${lesson.shownBefore[exercise.id] ?: 0}"
    var answer by remember(stepKey) { mutableStateOf<AttemptAnswer?>(null) }
    val feedback = lesson.feedback
    val locked = feedback != null || lesson.checking
    val isDuel = exercise is RunExercise.DuelWrapper
    val intro = exercise is RunExercise.WordIntroWrapper
    val review = lesson.run.kind == RunKind.review
    val check = { answer?.let { if (!locked) onCheck(it) } }
    val shake = remember(stepKey) { Animatable(0f) }
    val reduce = TeleTauTheme.reduceMotion
    val sounds = LocalUiSounds.current
    val haptic = LocalHapticFeedback.current
    // Вердикт пришёл: звук и отклик под пальцем — по одному разу на ответ (attemptId), и после поворота экрана не повторяются.
    var answered by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(feedback?.attemptId) {
        val fb = feedback ?: return@LaunchedEffect
        if (answered == fb.attemptId) return@LaunchedEffect
        answered = fb.attemptId
        sounds.play(VERDICT_SOUND.getValue(fb.verdict))
        when (fb.verdict) {
            Verdict.wrong -> haptic.performHapticFeedback(HapticFeedbackType.Reject)
            Verdict.recorded -> haptic.performHapticFeedback(HapticFeedbackType.ContextClick)
            else -> haptic.performHapticFeedback(HapticFeedbackType.Confirm)
        }
        if (fb.verdict == Verdict.wrong && !reduce) {
            for (x in listOf(-8f, 8f, -6f, 6f, -3f, 0f)) shake.animateTo(x, tween(TeleTauDuration.SHAKE / 6, easing = TeleTauEasing.inOut))
        }
    }
    // Новое упражнение въезжает справа — урок «листается».
    val enter = remember(stepKey) { Animatable(if (reduce) 0f else 1f) }
    LaunchedEffect(stepKey) { enter.animateTo(0f, tween(TeleTauDuration.SLOW, easing = TeleTauEasing.out)) }
    LessonFrame(
        done = lessonDone(lesson), total = lesson.run.exercises.size, onClose = onQuit,
        body = {
            Box(Modifier.graphicsLayer { translationX = (shake.value + enter.value * 36f) * density; alpha = 1f - enter.value }) {
                when (exercise) {
                    is RunExercise.TilesRuBaWrapper -> androidx.compose.runtime.key(stepKey) { TilesTask(exercise.value, retry, review, !locked, feedback, onHint) { answer = it } }
                    is RunExercise.ChoiceBaRuWrapper -> androidx.compose.runtime.key(stepKey) { ChoiceTask(exercise.value, retry, review, !locked, feedback) { answer = it } }
                    is RunExercise.FreeRuBaWrapper -> androidx.compose.runtime.key(stepKey) { FreeTask(exercise.value, retry, review, !locked, { answer = it }, { check() }, feedback, onHint) }
                    is RunExercise.DuelWrapper -> androidx.compose.runtime.key(stepKey) { DuelTask(exercise.value, !locked) { answer = it } }
                    is RunExercise.MatchPairsWrapper -> androidx.compose.runtime.key(stepKey) { PairsTask(exercise.value, retry, review, !locked, feedback) { answer = it } }
                    is RunExercise.WordIntroWrapper -> androidx.compose.runtime.key(stepKey) { WordIntroCard(exercise.value) }
                }
            }
        },
        foot = {
            AnimatedContent(
                targetState = feedback,
                transitionSpec = {
                    (slideInVertically(tween(if (reduce) 0 else TeleTauDuration.BASE, easing = TeleTauEasing.out)) { it } + fadeIn(tween(TeleTauDuration.FAST))) togetherWith fadeOut(tween(TeleTauDuration.FAST))
                },
                label = "LessonFoot",
            ) { fb ->
                if (fb != null) {
                    Feedback(exercise, fb, answer, willRetry(lesson), lesson.finished.size, lesson.combo, onNext)
                } else {
                    val c = TeleTauTheme.colors
                    Box(
                        Modifier.fillMaxWidth().background(c.bg)
                            .drawBehind { drawLine(c.borderSubtle, Offset(0f, 0f), Offset(size.width, 0f), TeleTauSpace.s050.toPx()) }
                            .windowInsetsPadding(WindowInsets.navigationBars)
                            .padding(start = TeleTauSpace.s400, end = TeleTauSpace.s400, top = TeleTauSpace.s350, bottom = TeleTauSpace.s450),
                        contentAlignment = Alignment.Center,
                    ) {
                        // Карточка «Новое слово» ответа не ждёт: сразу «Дальше», без проверки и без попытки.
                        if (intro) TeleTauButton("Дальше", onNext, Modifier.widthIn(max = TeleTauSize.columnNarrow).fillMaxWidth())
                        else TeleTauButton(
                            if (isDuel) "Отдать голос" else "Проверить", { check() },
                            Modifier.widthIn(max = TeleTauSize.columnNarrow).fillMaxWidth(),
                            variant = if (isDuel) ButtonVariant.Violet else ButtonVariant.Primary,
                            enabled = answer != null, loading = lesson.checking,
                        )
                    }
                }
            }
        },
    )
    if (lesson.quit) QuitDialog(onStay, onLeave)
}

private val baBold = SpanStyle(fontFamily = TeleTauFonts.display, fontWeight = TeleTauFontWeight.bold, localeList = BashkirLocale)

@Composable
private fun SheetText(text: AnnotatedString, modifier: Modifier = Modifier) {
    BasicText(text, modifier, style = TeleTauText.body.copy(color = TeleTauTheme.colors.textPrimary))
}

/** Строка листа с записью носителя: текст и «Послушать» рядом (только если запись есть). */
@Composable
private fun WithListen(audio: ru.teletau.core.network.models.AudioClip?, word: String, text: AnnotatedString) {
    if (audio == null) return SheetText(text)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300)) {
        SheetText(text, Modifier.weight(1f))
        ru.teletau.feature.student.common.Listen(audio, size = ru.teletau.core.designsystem.SpeakSize.Small, label = "Послушать: $word")
    }
}

/** Огонёк «N подряд» справа от «Верно!» — когда верных ответов подряд от трёх. */
@Composable
private fun ComboPill(combo: Int) {
    val c = TeleTauTheme.colors
    val reduce = TeleTauTheme.reduceMotion
    val pop = remember { Animatable(if (reduce) 1f else 0.6f) }
    LaunchedEffect(Unit) { pop.animateTo(1f, androidx.compose.animation.core.spring(dampingRatio = 0.45f, stiffness = 500f)) }
    Row(
        Modifier.graphicsLayer { scaleX = pop.value; scaleY = pop.value }
            .background(c.surface, androidx.compose.foundation.shape.RoundedCornerShape(TeleTauRadius.chip))
            .padding(horizontal = TeleTauSpace.s300, vertical = TeleTauSpace.s100),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s100),
    ) {
        androidx.compose.foundation.Image(PhosphorIcons.FireFill, null, Modifier.size(18.dp), colorFilter = androidx.compose.ui.graphics.ColorFilter.tint(c.streakFill))
        ru.teletau.core.designsystem.KText("$combo подряд", TeleTauText.footnote.copy(fontWeight = TeleTauFontWeight.black), color = c.streakText)
    }
}

/** Слово из ответа крупно, нужная буква подсвечена мёдом (веб `HintedAnswer`). */
private fun hintedAnswer(text: String, hint: ru.teletau.core.network.models.LetterHint?, mark: SpanStyle): AnnotatedString = buildAnnotatedString {
    if (hint == null) return@buildAnnotatedString append(text)
    var word = -1
    Regex("\\s+|\\S+").findAll(text).forEach { m ->
        val w = m.value
        if (w.isBlank()) return@forEach append(w)
        word++
        if (word != hint.token) return@forEach append(w)
        var letter = -1
        val at = w.indices.firstOrNull { i -> w[i].isLetter() && ++letter == hint.index }
        if (at == null || w[at].lowercase(java.util.Locale.forLanguageTag("ba")) != hint.expected) return@forEach append(w)
        append(w.substring(0, at))
        withStyle(mark) { append(w[at]) }
        append(w.substring(at + 1))
    }
}

@Composable
private fun Feedback(exercise: RunExercise, result: AttemptResult, answer: AttemptAnswer?, retryLater: Boolean, index: Int, combo: Int, onNext: () -> Unit) {
    val c = TeleTauTheme.colors
    // В «Пчёлке» (1–4 класс) — меньше текста: без второй строки листа.
    val extra = retryLater && TeleTauTheme.uiMode != ru.teletau.core.designsystem.UiMode.Bee
    val okTitle = OK_TITLES[index % OK_TITLES.size]
    val pill: (@Composable () -> Unit)? = if (combo >= COMBO_FROM) ({ ComboPill(combo) }) else null
    if (exercise is RunExercise.MatchPairsWrapper) {
        val ex = exercise.value
        val links = (answer as? AttemptAnswer.PairsWrapper)?.value?.pairs.orEmpty().associate { it.left to it.right }
        if (result.verdict == Verdict.wrong) {
            FeedbackSheet(FeedbackTone.Bad, "Пока не так", "Дальше", onNext) {
                val wrong = result.correctPairs.orEmpty().filter { links[it.left] != it.right }
                SheetText(buildAnnotatedString {
                    append("Правильно так:")
                    wrong.forEach { p ->
                        append("\n")
                        withStyle(baBold) { append(ex.left.firstOrNull { it.id == p.left }?.text.orEmpty()) }
                        append(" — «${ex.right.firstOrNull { it.id == p.right }?.textRu.orEmpty()}»")
                    }
                    if (extra) append("\nПовторим в конце урока.")
                })
            }
        } else {
            FeedbackSheet(FeedbackTone.Ok, okTitle, "Дальше", onNext, titleExtra = pill)
        }
        return
    }
    val mark = SpanStyle(fontFamily = TeleTauFonts.display, fontWeight = TeleTauFontWeight.black, localeList = BashkirLocale, background = c.accentFill, color = c.accentOn)
    val correct = result.correctAnswer?.text.orEmpty()
    val audio = result.correctAnswer?.audio
    val choice = (exercise as? RunExercise.ChoiceBaRuWrapper)?.value
    val option = choice?.let { ch -> ch.options.firstOrNull { it.id == result.correctOptionId }?.textRu ?: result.meaningRu }
    // У выбора правильный ответ — русский вариант, у плиток и ввода — башкирская фраза.
    val answerText: AnnotatedString? = when {
        choice != null -> option?.let { buildAnnotatedString { withStyle(SpanStyle(fontWeight = TeleTauFontWeight.semibold)) { append(it) } } }
        correct.isNotEmpty() -> buildAnnotatedString { withStyle(baBold) { append(correct) } }
        else -> null
    }
    val promptRu = when (exercise) {
        is RunExercise.TilesRuBaWrapper -> exercise.value.promptRu
        is RunExercise.FreeRuBaWrapper -> exercise.value.promptRu
        else -> null
    }
    val meaning: AnnotatedString? = when {
        choice != null && option != null -> buildAnnotatedString {
            withStyle(baBold) { append(choice.prompt) }
            append(" — «$option»")
        }
        exercise is RunExercise.DuelWrapper || correct.isEmpty() -> null
        else -> buildAnnotatedString {
            withStyle(baBold) { append(correct) }
            append(" — «${(result.meaningRu ?: promptRu.orEmpty()).trimEnd('.', '!', '?')}»")
        }
    }
    when (result.verdict) {
        Verdict.correct -> FeedbackSheet(FeedbackTone.Ok, okTitle, "Дальше", onNext, titleExtra = pill) {
            meaning?.let { WithListen(if (choice == null) audio else choice.promptAudio, if (choice == null) correct else choice.prompt, it) }
        }
        Verdict.typo -> FeedbackSheet(FeedbackTone.Ok, "Верно, но с опечаткой", "Дальше", onNext, titleExtra = pill) {
            answerText?.let { WithListen(audio, correct, buildAnnotatedString { append("Правильно: "); append(it) }) }
        }
        // Засчитано, но одна башкирская буква заменена похожей русской: слово крупно, эта буква подсвечена.
        Verdict.almost -> FeedbackSheet(FeedbackTone.Almost, "Почти!", "Дальше", onNext, art = R.drawable.bee_surprise) {
            val hint = result.hint
            if (correct.isNotEmpty()) {
                BasicText(
                    hintedAnswer(correct, hint, mark),
                    Modifier.padding(bottom = TeleTauSpace.s100),
                    style = TeleTauText.bashkir(ru.teletau.core.designsystem.TeleTauFontSize.title3, TeleTauFontWeight.bold).copy(color = c.textPrimary),
                )
            }
            SheetText(
                buildAnnotatedString {
                    if (hint != null) {
                        append("Засчитано. Здесь пишется «")
                        withStyle(SpanStyle(localeList = BashkirLocale)) { append(hint.expected) }
                        append("»")
                        if (hint.got.isNotEmpty() && hint.got != hint.expected) {
                            append(", а не «")
                            withStyle(SpanStyle(localeList = BashkirLocale)) { append(hint.got) }
                            append("»")
                        }
                        append(".")
                    } else {
                        append("Засчитано. Сравни со своим ответом.")
                    }
                },
            )
        }
        Verdict.wrong -> FeedbackSheet(FeedbackTone.Bad, "Пока не так", "Дальше", onNext) {
            if (answerText != null) WithListen(audio.takeIf { choice == null }, correct, buildAnnotatedString { append("Правильно: "); append(answerText) })
            if (extra) SheetText(AnnotatedString("Повторим в конце урока."))
        }
        Verdict.recorded -> FeedbackSheet(FeedbackTone.Voted, "Голос учтён", "Дальше", onNext, art = R.drawable.bee_cheer) {
            SheetText(AnnotatedString("Итог появится в профиле."))
        }
    }
}

/** «Уже уходишь?» (prototype 12-lesson-quit): «Остаться» — основное действие. */
@Composable
fun QuitDialog(onStay: () -> Unit, onLeave: () -> Unit) {
    TeleTauDialog("Уже уходишь?", onDismiss = onStay, description = "Урок начнётся сначала.", art = R.drawable.bee_sympathy) {
        TeleTauButton("Остаться", onStay, Modifier.fillMaxWidth())
        LinkButton("Выйти", onLeave, tone = LinkTone.Danger)
    }
}

/** Урок открывается: тот же каркас, вместо задания — скелетон. */
@Composable
fun LessonLoading(onLeave: () -> Unit) {
    LessonFrame(0, 1, onLeave, body = {
        Column(verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s400)) {
            SkeletonBlock(width = 140.dp, height = 30.dp, radius = TeleTauRadius.button)
            SkeletonBlock(Modifier.fillMaxWidth(0.8f), height = 30.dp)
            SkeletonBlock(height = 120.dp, radius = TeleTauRadius.card)
            SkeletonBlock(height = 60.dp, radius = TeleTauRadius.button)
        }
    }, foot = {})
}

/** Итог сохраняется; при сбое — повтор с тем же runId (сервер не начислит мёд дважды). */
@Composable
fun LessonSaving(failed: Boolean, onRetry: () -> Unit, onLeave: () -> Unit) {
    Box(Modifier.fillMaxSize().background(TeleTauTheme.colors.bg).windowInsetsPadding(WindowInsets.statusBars), contentAlignment = Alignment.Center) {
        if (failed) {
            EmptyState(R.drawable.empty_error, "Итог не сохранился", text = "Проверь интернет. Ответы не пропадут.", alert = true) {
                TeleTauButton("Попробовать снова", onRetry, Modifier.fillMaxWidth())
                LinkButton("На тропу", onLeave, tone = LinkTone.Neutral)
            }
        } else {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s400)) {
                SkeletonBlock(width = 220.dp, height = 220.dp, radius = TeleTauRadius.card)
                SkeletonBlock(width = 200.dp, height = 30.dp)
            }
        }
    }
}
