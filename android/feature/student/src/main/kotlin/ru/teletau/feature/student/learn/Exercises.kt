package ru.teletau.feature.student.learn

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import ru.teletau.core.designsystem.AnswerOption
import ru.teletau.core.designsystem.AnswerVerdict
import ru.teletau.core.network.models.AttemptResult
import ru.teletau.core.network.models.Verdict
import ru.teletau.core.designsystem.AnswerPill
import ru.teletau.core.designsystem.BashkirLetters
import ru.teletau.core.designsystem.BashkirLocale
import ru.teletau.core.designsystem.ChipTone
import ru.teletau.core.designsystem.Illustration
import ru.teletau.core.designsystem.KHeading
import ru.teletau.core.designsystem.KText
import ru.teletau.core.designsystem.TeleTauChip
import ru.teletau.core.designsystem.TeleTauFontSize
import ru.teletau.core.designsystem.TeleTauFontWeight
import ru.teletau.core.designsystem.TeleTauRadius
import ru.teletau.core.designsystem.TeleTauSpace
import ru.teletau.core.designsystem.TeleTauText
import ru.teletau.core.designsystem.TeleTauTheme
import ru.teletau.core.designsystem.LetterPanel
import ru.teletau.core.designsystem.OptionTone
import ru.teletau.core.designsystem.PhosphorIcons
import ru.teletau.core.designsystem.R
import ru.teletau.core.designsystem.TileFlow
import ru.teletau.core.designsystem.UiMode
import ru.teletau.core.designsystem.WordTile
import ru.teletau.core.network.models.AttemptAnswer
import ru.teletau.core.network.models.ChoiceAnswer
import ru.teletau.core.network.models.ChoiceAnswerType
import ru.teletau.core.network.models.ChoiceExercise
import ru.teletau.core.network.models.DuelAnswer
import ru.teletau.core.network.models.DuelChoice
import ru.teletau.core.network.models.DuelExercise
import ru.teletau.core.network.models.DuelExerciseType
import ru.teletau.core.network.models.FreeInputExercise
import ru.teletau.core.network.models.TextAnswer
import ru.teletau.core.network.models.TextAnswerType
import ru.teletau.core.network.models.TilesAnswer
import ru.teletau.core.network.models.TilesAnswerType
import ru.teletau.core.network.models.TilesExercise

/** Метка над заголовком (кроме «Пчёлки») — только «Ещё раз» (упражнение вернулось после ошибки) и «Повторение»: тип задания уже в заголовке. */
@Composable
private fun Kind(retry: Boolean, review: Boolean) {
    // В «Пчёлке» (1–4 класс) меток нет: меньше текста.
    if (TeleTauTheme.uiMode == UiMode.Bee) return
    when {
        retry -> TeleTauChip("Ещё раз", icon = PhosphorIcons.ArrowsClockwiseBold)
        review -> TeleTauChip("Повторение", icon = PhosphorIcons.ArrowsClockwiseBold)
    }
}

/** Оценка ответа для окраски плиток и поля: верно — зелень, «почти» — мёд, неверно — коралл; голос не окрашивается. */
fun verdictOf(result: AttemptResult?): AnswerVerdict? = when (result?.verdict) {
    null, Verdict.recorded -> null
    Verdict.wrong -> AnswerVerdict.Bad
    Verdict.almost -> AnswerVerdict.Almost
    else -> AnswerVerdict.Ok
}

@Composable
private fun TaskTitle(text: String) {
    KHeading(text, TeleTauText.title2, Modifier.padding(top = TeleTauSpace.s250, bottom = TeleTauSpace.s450))
}

/** Подсказка в условии: где она стоит (символы `promptRu`) и перевод. */
data class HintSpan(val start: Int, val end: Int, val hint: ru.teletau.core.network.models.PromptHint)

/**
 * Где в условии стоят подсказки: `text` — подстрока `promptRu` ровно как написана; подсказки идут по порядку и не
 * пересекаются, поэтому каждая ищется с конца предыдущей. Не нашлась — пропускаем (не выдумываем место).
 */
fun hintSpans(prompt: String, hints: List<ru.teletau.core.network.models.PromptHint>?): List<HintSpan> {
    var from = 0
    return hints.orEmpty().mapNotNull { h ->
        if (h.text.isEmpty()) return@mapNotNull null
        val at = prompt.indexOf(h.text, from)
        if (at < 0) null else HintSpan(at, at + h.text.length, h).also { from = at + h.text.length }
    }
}

/**
 * Условие с подсказками: слово со словарным переводом подчёркнуто пунктиром; нажатие — пузырь с
 * переводом над словом (башкирский — шрифтом с башкирскими формами букв), повторное нажатие или касание рядом —
 * закрыть. В «Пчёлке» пузырь крупнее. TalkBack: действие «Перевод: …» у условия.
 */
@Composable
private fun HintedText(text: String, hints: List<ru.teletau.core.network.models.PromptHint>?, style: androidx.compose.ui.text.TextStyle, onOpen: (Int) -> Unit) {
    val c = TeleTauTheme.colors
    val opened by androidx.compose.runtime.rememberUpdatedState(onOpen)
    val spans = remember(text, hints) { hintSpans(text, hints) }
    var layout by remember { mutableStateOf<androidx.compose.ui.text.TextLayoutResult?>(null) }
    var open by remember(text) { mutableStateOf<Int?>(null) }
    val density = androidx.compose.ui.platform.LocalDensity.current
    Box {
        BasicText(
            text,
            Modifier
                .drawBehind {
                    val l = layout ?: return@drawBehind
                    val dash = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(2.dp.toPx(), 3.dp.toPx()))
                    spans.forEachIndexed { i, s ->
                        val first = l.getLineForOffset(s.start)
                        val last = l.getLineForOffset((s.end - 1).coerceAtLeast(s.start))
                        for (line in first..last) {
                            val x0 = if (line == first) l.getHorizontalPosition(s.start, true) else l.getLineLeft(line)
                            val x1 = if (line == last) l.getHorizontalPosition(s.end, true) else l.getLineRight(line)
                            val y = l.getLineBaseline(line) + 4.dp.toPx()
                            drawLine(if (open == i) c.accentText else c.textTertiary, Offset(x0, y), Offset(x1, y), 2.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round, pathEffect = dash)
                        }
                    }
                }
                .then(
                    if (spans.isEmpty()) Modifier else Modifier.pointerInput(spans) {
                        detectTapGestures { p ->
                            val l = layout ?: return@detectTapGestures
                            val at = l.getOffsetForPosition(p)
                            val i = spans.indexOfFirst { at >= it.start && at <= it.end }
                            open = if (i < 0 || open == i) null else i
                            open?.let(opened)
                        }
                    },
                )
                .semantics {
                    if (spans.isNotEmpty()) customActions = spans.mapIndexed { i, s ->
                        androidx.compose.ui.semantics.CustomAccessibilityAction("Перевод: ${s.hint.text}") { open = i; opened(i); true }
                    }
                },
            style = style.copy(color = c.textPrimary),
            onTextLayout = { layout = it },
        )
        val i = open
        val l = layout
        if (i != null && l != null) {
            val s = spans[i]
            val box = l.getBoundingBox(s.start)
            val end = l.getBoundingBox((s.end - 1).coerceAtLeast(s.start))
            val centerX = ((box.left + if (l.getLineForOffset(s.start) == l.getLineForOffset(s.end - 1)) end.right else l.getLineRight(l.getLineForOffset(s.start))) / 2f)
            HintBubble(s.hint.translation, anchor = androidx.compose.ui.unit.IntOffset(centerX.toInt(), box.top.toInt()), onDismiss = { open = null })
        }
    }
}

/** Пузырь с переводом над словом условия: тёмный, со стрелкой вниз (как подсказка закрытого узла). */
@Composable
private fun HintBubble(translation: ru.teletau.core.network.models.BaString, anchor: androidx.compose.ui.unit.IntOffset, onDismiss: () -> Unit) {
    val c = TeleTauTheme.colors
    val big = TeleTauTheme.uiMode == UiMode.Bee
    val gap = with(androidx.compose.ui.platform.LocalDensity.current) { 6.dp.roundToPx() }
    androidx.compose.ui.window.Popup(
        popupPositionProvider = object : androidx.compose.ui.window.PopupPositionProvider {
            override fun calculatePosition(
                anchorBounds: androidx.compose.ui.unit.IntRect, windowSize: androidx.compose.ui.unit.IntSize,
                layoutDirection: androidx.compose.ui.unit.LayoutDirection, popupContentSize: androidx.compose.ui.unit.IntSize,
            ): androidx.compose.ui.unit.IntOffset {
                val x = (anchorBounds.left + anchor.x - popupContentSize.width / 2).coerceIn(0, maxOf(0, windowSize.width - popupContentSize.width))
                val y = (anchorBounds.top + anchor.y - popupContentSize.height - gap).coerceAtLeast(0)
                return androidx.compose.ui.unit.IntOffset(x, y)
            }
        },
        onDismissRequest = onDismiss,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier.widthIn(max = 260.dp).background(c.textPrimary, RoundedCornerShape(TeleTauRadius.tile))
                    .padding(horizontal = TeleTauSpace.s400, vertical = if (big) TeleTauSpace.s300 else TeleTauSpace.s250)
                    .semantics { liveRegion = androidx.compose.ui.semantics.LiveRegionMode.Polite },
            ) {
                KText(
                    translation.text,
                    TeleTauText.bashkir(if (big) TeleTauFontSize.title2 else TeleTauFontSize.headline, TeleTauFontWeight.extrabold),
                    color = c.bg,
                )
            }
            Canvas(Modifier.size(16.dp, 8.dp)) {
                drawPath(Path().apply { moveTo(0f, 0f); lineTo(size.width / 2, size.height); lineTo(size.width, 0f); close() }, c.textPrimary)
            }
        }
    }
}

/** Пчела с репликой-пузырём (prototype `.prompt`): русская фраза, которую переводим. В «Хранителе» — без пчелы. */
@Composable
private fun Prompt(bee: Int, text: String, hints: List<ru.teletau.core.network.models.PromptHint>? = null, onHint: (Int) -> Unit = {}) {
    val c = TeleTauTheme.colors
    val keeper = TeleTauTheme.uiMode == UiMode.Keeper
    Row(Modifier.fillMaxWidth().padding(bottom = TeleTauSpace.s450), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s250)) {
        if (!keeper) Floating { Illustration(bee, if (TeleTauTheme.uiMode == UiMode.Bee) 116.dp else 104.dp) }
        val shape = RoundedCornerShape(TeleTauRadius.panel)
        Box(Modifier.weight(1f).padding(bottom = if (keeper) 0.dp else 26.dp)) {
            Box(
                Modifier.fillMaxWidth().background(c.surface, shape).border(TeleTauSpace.s050, c.borderDefault, shape)
                    .padding(horizontal = TeleTauSpace.s400, vertical = TeleTauSpace.s350),
            ) { HintedText(text, hints, TeleTauText.body.copy(fontSize = TeleTauFontSize.headline, lineHeight = 1.25.em), onHint) }
            if (!keeper) {
                Canvas(Modifier.size(10.dp, 16.dp).offset(x = (-8).dp, y = 0.dp).align(Alignment.BottomStart).offset(y = (-14).dp)) {
                    val p = Path().apply { moveTo(size.width, 0f); lineTo(0f, size.height / 2); lineTo(size.width, size.height) }
                    drawPath(Path().apply { addPath(p); close() }, c.surface)
                    drawPath(p, c.borderDefault, style = Stroke(2.dp.toPx()))
                }
            }
        }
    }
}

/** «Переведи на башкирский» — собери ответ из плиток (tiles_ru_ba, prototype 05–06). */
@Composable
fun TilesTask(
    exercise: TilesExercise, retry: Boolean, review: Boolean, enabled: Boolean, result: AttemptResult? = null, onHint: (Int) -> Unit = {},
    onAnswer: (AttemptAnswer?) -> Unit,
) {
    var picked by remember(exercise.id, retry) { mutableStateOf(listOf<String>()) }
    val sounds = ru.teletau.feature.student.common.LocalUiSounds.current
    val verdict = verdictOf(result)
    fun update(next: List<String>) {
        sounds.play(ru.teletau.feature.student.common.UiSound.Tap)
        picked = next
        onAnswer(if (next.isEmpty()) null else AttemptAnswer.TilesWrapper(TilesAnswer(TilesAnswerType.tiles, next)))
    }
    val text = { id: String -> exercise.tiles.firstOrNull { it.id == id }?.text.orEmpty() }
    val c = TeleTauTheme.colors
    val tileH = if (TeleTauTheme.uiMode == UiMode.Bee) 57 else 49
    val row = tileH + 13
    Column {
        Kind(retry, review)
        TaskTitle("Переведи на башкирский")
        Prompt(R.drawable.bee_explain, exercise.promptRu, exercise.hints, onHint)
        Box(
            Modifier.fillMaxWidth().defaultMinSize(minHeight = (row * 2).dp).padding(top = TeleTauSpace.s150)
                .semantics { contentDescription = "Твой ответ — нажми на слово, чтобы убрать" }
                .drawBehind {
                    val step = row.dp.toPx()
                    var y = step - 3.dp.toPx() + TeleTauSpace.s150.toPx()
                    while (y < size.height) {
                        drawLine(c.borderDefault, Offset(0f, y), Offset(size.width, y), 2.dp.toPx())
                        y += step
                    }
                },
        ) {
            TileFlow(Modifier.fillMaxWidth()) {
                picked.forEach { id -> WordTile(text(id), { update(picked - id) }, enabled = enabled, verdict = verdict) }
            }
        }
        TileFlow(Modifier.fillMaxWidth().padding(top = 26.dp), center = true) {
            exercise.tiles.forEach { t -> WordTile(t.text, { update(picked + t.id) }, used = t.id in picked, enabled = enabled) }
        }
    }
}

/** «Что значит это слово?» — узнавание (choice_ba_ru, prototype 07). */
@Composable
fun ChoiceTask(exercise: ChoiceExercise, retry: Boolean, review: Boolean, enabled: Boolean, result: AttemptResult? = null, onAnswer: (AttemptAnswer?) -> Unit) {
    var choice by remember(exercise.id, retry) { mutableStateOf<String?>(null) }
    val c = TeleTauTheme.colors
    // После проверки: верный вариант — зелёный с галочкой, выбранный неверный — коралловый с крестиком.
    val verdicts = buildMap {
        if (result != null) {
            result.correctOptionId?.let { put(it, AnswerVerdict.Ok) }
            val ch = choice
            if (ch != null && ch != result.correctOptionId && result.verdict == Verdict.wrong) put(ch, AnswerVerdict.Bad)
        }
    }
    Column {
        Kind(retry, review)
        TaskTitle("Что значит это слово?")
        Row(
            Modifier.fillMaxWidth().defaultMinSize(minHeight = 84.dp).padding(bottom = TeleTauSpace.s450)
                .background(c.accentSoft, RoundedCornerShape(TeleTauRadius.panel)).padding(TeleTauSpace.s450),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300),
        ) {
            KText(exercise.prompt, TeleTauText.bashkir(TeleTauFontSize.title1, TeleTauFontWeight.black).copy(lineHeight = 1.1.em), Modifier.weight(1f))
            ru.teletau.feature.student.common.Listen(exercise.promptAudio, label = "Послушать: ${exercise.prompt}")
        }
        Column(Modifier.semantics { contentDescription = "Варианты перевода" }, verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s250)) {
            exercise.options.forEachIndexed { i, o ->
                AnswerOption(o.textRu, choice == o.id, {
                    choice = o.id
                    onAnswer(AttemptAnswer.ChoiceWrapper(ChoiceAnswer(ChoiceAnswerType.choice, o.id)))
                }, mark = "${i + 1}", enabled = enabled, verdict = verdicts[o.id])
            }
        }
    }
}

/** «Напиши по-башкирски» — ввод с панелью башкирских букв (free_ru_ba, prototype 08–09). */
@Composable
fun FreeTask(
    exercise: FreeInputExercise, retry: Boolean, review: Boolean, enabled: Boolean, onAnswer: (AttemptAnswer?) -> Unit, onSubmit: () -> Unit,
    result: AttemptResult? = null, onHint: (Int) -> Unit = {},
) {
    var value by remember(exercise.id, retry) { mutableStateOf(TextFieldValue("")) }
    var focused by remember { mutableStateOf(false) }
    val c = TeleTauTheme.colors
    val verdict = verdictOf(result)
    val (fieldFace, fieldEdge) = when (verdict) {
        AnswerVerdict.Ok -> c.successSoft to c.successFill
        AnswerVerdict.Almost -> c.accentSoft to c.accentFill
        AnswerVerdict.Bad -> c.dangerSoft to c.dangerFill
        null -> c.surface to (if (focused) c.focus else c.borderDefault)
    }
    fun update(next: TextFieldValue) {
        value = next
        onAnswer(if (next.text.isBlank()) null else AttemptAnswer.TextWrapper(TextAnswer(TextAnswerType.text, next.text)))
    }
    Column {
        Kind(retry, review)
        TaskTitle("Напиши по-башкирски")
        Prompt(R.drawable.bee_think, exercise.promptRu, exercise.hints, onHint)
        val shape = RoundedCornerShape(TeleTauRadius.panel)
        val style = TeleTauText.bashkir(TeleTauFontSize.title3, TeleTauFontWeight.medium).copy(color = c.textPrimary)
        BasicTextField(
            value = value,
            onValueChange = { if (enabled) update(it) },
            readOnly = !enabled,
            textStyle = style,
            cursorBrush = SolidColor(c.focus),
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.None,
                autoCorrectEnabled = false,
                keyboardType = KeyboardType.Text,
                imeAction = ImeAction.Done,
                hintLocales = BashkirLocale,
            ),
            keyboardActions = KeyboardActions(onDone = { if (enabled) onSubmit() }),
            modifier = Modifier
                .fillMaxWidth()
                .semantics { contentDescription = "Перевод на башкирский: ${exercise.promptRu}" }
                .onFocusChanged { focused = it.isFocused },
            decorationBox = { inner ->
                Box(
                    Modifier.fillMaxWidth().defaultMinSize(minHeight = 118.dp).background(fieldFace, shape)
                        .border(TeleTauSpace.s050, fieldEdge, shape)
                        .padding(TeleTauSpace.s400),
                ) {
                    if (value.text.isEmpty()) KText("Твой ответ", TeleTauText.body.copy(fontSize = TeleTauFontSize.title3), color = c.textTertiary)
                    inner()
                }
            },
        )
        LetterPanel(
            onInsert = { letter ->
                val start = value.selection.min
                val end = value.selection.max
                val text = value.text.substring(0, start) + letter + value.text.substring(end)
                update(TextFieldValue(text, TextRange(start + letter.length)))
            },
            letters = exercise.letters.ifEmpty { BashkirLetters },
            enabled = enabled,
        )
    }
}

/**
 * Дуэль «Помоги языку» (prototype 10-lesson-duel; docs/05 §0): исходная фраза, два варианта и «Оба подходят / Не знаю» —
 * без плашки-объяснения и без чужих голосов (защита от конформизма, docs/03 §4a).
 */
@Composable
fun DuelTask(exercise: DuelExercise, enabled: Boolean, onAnswer: (AttemptAnswer?) -> Unit) {
    var choice by remember(exercise.id) { mutableStateOf<DuelChoice?>(null) }
    val c = TeleTauTheme.colors
    fun pick(v: DuelChoice) {
        choice = v
        onAnswer(AttemptAnswer.DuelWrapper(DuelAnswer(DuelExerciseType.duel, v)))
    }
    Column {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                TeleTauChip("Помоги языку", tone = ChipTone.Violet, icon = PhosphorIcons.ScalesFill)
                TaskTitle("Какой перевод звучит естественнее?")
            }
            Illustration(R.drawable.scene_duel, 104.dp, Modifier.offset(x = TeleTauSpace.s100, y = (-TeleTauSpace.s200)))
        }
        Column(
            Modifier.fillMaxWidth().padding(bottom = TeleTauSpace.s400).background(c.violetSoft, RoundedCornerShape(TeleTauRadius.panel))
                .padding(horizontal = TeleTauSpace.s400, vertical = TeleTauSpace.s350),
        ) {
            KText("ПО-РУССКИ", TeleTauText.caption.copy(fontWeight = TeleTauFontWeight.bold, letterSpacing = 0.06.em), Modifier.padding(bottom = TeleTauSpace.s100), color = c.violetText)
            KText(exercise.sourceRu, TeleTauText.headline.copy(fontWeight = TeleTauFontWeight.extrabold))
        }
        Column(Modifier.semantics { contentDescription = "Варианты перевода" }, verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s300)) {
            AnswerOption(exercise.a, choice == DuelChoice.a, { pick(DuelChoice.a) }, mark = "A", tone = OptionTone.Violet, enabled = enabled)
            AnswerOption(exercise.b, choice == DuelChoice.b, { pick(DuelChoice.b) }, mark = "B", tone = OptionTone.Violet, enabled = enabled)
            Row(Modifier.fillMaxWidth().padding(top = TeleTauSpace.s100), horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s200, Alignment.CenterHorizontally)) {
                AnswerPill("Оба подходят", choice == DuelChoice.both, { pick(DuelChoice.both) }, enabled = enabled)
                AnswerPill("Не знаю", choice == DuelChoice.skip, { pick(DuelChoice.skip) }, enabled = enabled)
            }
        }
    }
}

private data class PairPick(val left: Boolean, val id: String)

/**
 * «Соедини пары» (match_pairs): слева башкирские слова, справа переводы. Нажми слово, затем перевод (или наоборот);
 * нажатие на соединённое — разъединить. Пара отмечается номером и цветом (не только цветом); после проверки —
 * верные зелёные, неверные коралловые.
 */
@Composable
fun PairsTask(
    exercise: ru.teletau.core.network.models.MatchPairsExercise,
    retry: Boolean,
    review: Boolean,
    enabled: Boolean,
    result: ru.teletau.core.network.models.AttemptResult?,
    onAnswer: (AttemptAnswer?) -> Unit,
) {
    var links by remember(exercise.id, retry) { mutableStateOf(listOf<ru.teletau.core.network.models.PairLink>()) }
    var picked by remember(exercise.id, retry) { mutableStateOf<PairPick?>(null) }
    val sounds = ru.teletau.feature.student.common.LocalUiSounds.current
    fun update(next: List<ru.teletau.core.network.models.PairLink>) {
        links = next
        onAnswer(
            if (next.size == exercise.left.size) AttemptAnswer.PairsWrapper(ru.teletau.core.network.models.PairsAnswer(ru.teletau.core.network.models.PairsAnswerType.pairs, next)) else null,
        )
    }
    fun tap(left: Boolean, id: String) {
        sounds.play(ru.teletau.feature.student.common.UiSound.Tap)
        val linked = links.firstOrNull { (if (left) it.left else it.right) == id }
        val p = picked
        when {
            linked != null -> { update(links - linked); picked = PairPick(left, id) }
            p != null && p.left != left -> {
                update(links + if (left) ru.teletau.core.network.models.PairLink(left = id, right = p.id) else ru.teletau.core.network.models.PairLink(left = p.id, right = id))
                picked = null
            }
            else -> picked = if (p == PairPick(left, id)) null else PairPick(left, id)
        }
    }
    val correct = result?.correctPairs.orEmpty().associate { it.left to it.right }
    val c = TeleTauTheme.colors
    val tones = listOf(c.accentFill to c.accentSoft, c.infoFill to c.infoSoft, c.violetFill to c.violetSoft, c.successFill to c.successSoft, c.streakFill to c.streakSoft)
    val inks = listOf(c.accentText, c.infoText, c.violetText, c.successText, c.streakText)
    @Composable
    fun Item(left: Boolean, id: String, text: String) {
        val index = links.indexOfFirst { (if (left) it.left else it.right) == id }
        val link = links.getOrNull(index)
        val verdict = if (result == null || link == null) null else correct[link.left] == link.right
        val selected = picked == PairPick(left, id)
        val (fill, soft) = when {
            verdict == true -> c.successFill to c.successSoft
            verdict == false -> c.dangerFill to c.dangerSoft
            index >= 0 -> tones[index % tones.size]
            selected -> c.accentFill to c.accentSoft
            else -> c.borderDefault to c.surface
        }
        val ink = when {
            verdict == true -> c.successText
            verdict == false -> c.dangerText
            index >= 0 -> inks[index % inks.size]
            else -> c.textPrimary
        }
        val status = listOfNotNull(if (index >= 0) "пара ${index + 1}" else null, if (verdict == true) "верно" else if (verdict == false) "не так" else null).joinToString(", ")
        ru.teletau.core.designsystem.LippedSurfacePublic(
            onClick = if (enabled) ({ tap(left, id) }) else null,
            face = soft, edge = fill,
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = if (status.isEmpty()) text else "$text, $status" },
            minHeight = 60.dp,
        ) {
            Row(Modifier.fillMaxWidth().padding(horizontal = TeleTauSpace.s300, vertical = TeleTauSpace.s200), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s200)) {
                if (index >= 0) {
                    Box(Modifier.size(26.dp).background(c.surface, RoundedCornerShape(TeleTauRadius.chip)).border(TeleTauSpace.s050, fill, RoundedCornerShape(TeleTauRadius.chip)), contentAlignment = Alignment.Center) {
                        KText("${index + 1}", TeleTauText.label, color = ink)
                    }
                }
                KText(text, if (left) TeleTauText.bashkir(TeleTauFontSize.bodyLarge, TeleTauFontWeight.extrabold) else TeleTauText.bodyLarge.copy(fontWeight = TeleTauFontWeight.semibold))
            }
        }
    }
    Column {
        Kind(retry, review)
        TaskTitle("Соедини пары")
        if (TeleTauTheme.uiMode != UiMode.Bee) KText("Нажми слово и его перевод", TeleTauText.callout, Modifier.padding(bottom = TeleTauSpace.s400).offset(y = (-TeleTauSpace.s200)), color = c.textSecondary)
        Row(horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s250)) {
            Column(Modifier.weight(1f).semantics { contentDescription = "Слова" }, verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s250)) {
                exercise.left.forEach { Item(true, it.id, it.text) }
            }
            Column(Modifier.weight(1f).semantics { contentDescription = "Переводы" }, verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s250)) {
                exercise.right.forEach { Item(false, it.id, it.textRu) }
            }
        }
    }
}

/**
 * «Новое слово» (word_intro): знакомство со словом урока перед упражнениями с ним — слово крупно (шрифт с башкирскими
 * формами букв), «Послушать», если есть запись носителя, перевод и пчела. Ответа нет: «Дальше» внизу ведёт к следующему
 * заданию без попытки. Появилась — мягкий звук «новое слово».
 */
@Composable
fun WordIntroCard(exercise: ru.teletau.core.network.models.WordIntroExercise) {
    val c = TeleTauTheme.colors
    val sounds = ru.teletau.feature.student.common.LocalUiSounds.current
    LaunchedEffect(exercise.id) { sounds.play(ru.teletau.feature.student.common.UiSound.NewWord) }
    val keeper = TeleTauTheme.uiMode == UiMode.Keeper
    val shape = RoundedCornerShape(TeleTauRadius.card)
    Column {
        TaskTitle("Новое слово")
        Column(
            Modifier.fillMaxWidth().background(c.accentSoft, shape).border(TeleTauSpace.s050, c.accentSoftBorder, shape)
                .padding(horizontal = TeleTauSpace.s500, vertical = TeleTauSpace.s600),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s300),
        ) {
            if (!keeper) Floating { Illustration(R.drawable.bee_read, if (TeleTauTheme.uiMode == UiMode.Bee) 132.dp else 116.dp) }
            ru.teletau.core.designsystem.FitText(
                exercise.word.text,
                TeleTauText.bashkir(TeleTauFontSize.display, TeleTauFontWeight.black).copy(lineHeight = 1.1.em),
                align = androidx.compose.ui.text.style.TextAlign.Center,
                maxLines = 2,
                minScale = 0.5f,
            )
            ru.teletau.feature.student.common.Listen(exercise.word.audio, label = "Послушать: ${exercise.word.text}")
            ru.teletau.core.designsystem.FitText(
                exercise.translationRu,
                TeleTauText.title3.copy(fontWeight = TeleTauFontWeight.semibold),
                color = c.textSecondary,
                align = androidx.compose.ui.text.style.TextAlign.Center,
                maxLines = 3,
            )
        }
    }
}
