package ru.teletau.feature.student.learn

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ru.teletau.core.designsystem.Illustration
import ru.teletau.core.designsystem.KHeading
import ru.teletau.core.designsystem.KText
import ru.teletau.core.designsystem.TeleTauButton
import ru.teletau.core.designsystem.TeleTauDuration
import ru.teletau.core.designsystem.TeleTauEasing
import ru.teletau.core.designsystem.TeleTauRadius
import ru.teletau.core.designsystem.TeleTauSize
import ru.teletau.core.designsystem.TeleTauSpace
import ru.teletau.core.designsystem.TeleTauText
import ru.teletau.core.designsystem.TeleTauTheme
import ru.teletau.core.designsystem.LinkButton
import ru.teletau.core.designsystem.LinkTone
import ru.teletau.core.designsystem.R
import ru.teletau.feature.student.common.plural

private data class IntroStep(val art: Int, val title: String, val text: String)

private fun introSteps(goal: Int) = listOf(
    IntroStep(R.drawable.hero_landing, "Привет! Я пчела", "Пойдём по тропе через весь Башкортостан."),
    IntroStep(
        R.drawable.scene_lesson_complete, "Урок — сота мёда",
        "Цель дня — $goal ${plural(goal, "сота", "соты", "сот")}. Заходи каждый день, чтобы не прервать серию.",
    ),
)

/**
 * Знакомство с пчелой при первом заходе на тропу (ещё ни одного урока; веб `TrailIntro`): лист снизу над затемнённой
 * тропой, два шага — тропа, затем урок-сота, цель дня и серия. Первый можно пропустить, последний сразу начинает
 * первый урок. «Назад» и касание затемнения закрывают знакомство.
 */
@Composable
fun TrailIntro(goal: Int, onClose: () -> Unit, onStart: () -> Unit, startAt: Int = 0) {
    val c = TeleTauTheme.colors
    val reduce = TeleTauTheme.reduceMotion
    val steps = introSteps(goal)
    var i by rememberSaveable { mutableStateOf(startAt.coerceIn(0, steps.lastIndex)) }
    val last = i == steps.lastIndex
    BackHandler(onBack = onClose)
    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier.fillMaxSize().background(c.scrim.copy(alpha = 0.45f))
                .clickable(remember { MutableInteractionSource() }, indication = null, onClick = onClose)
                .clearAndSetSemantics {},
        )
        var shown by remember { mutableStateOf(reduce) }
        LaunchedEffect(Unit) { shown = true }
        val rise by animateDpAsState(if (shown) 0.dp else 420.dp, tween(if (reduce) 0 else TeleTauDuration.SLOW, easing = TeleTauEasing.out), label = "IntroRise")
        Column(
            Modifier.align(Alignment.BottomCenter).widthIn(max = TeleTauSize.columnNarrow).fillMaxWidth()
                .graphicsLayer { translationY = rise.toPx() }
                .background(c.bg, RoundedCornerShape(topStart = TeleTauRadius.sheet, topEnd = TeleTauRadius.sheet))
                .clickable(remember { MutableInteractionSource() }, indication = null) {}
                .windowInsetsPadding(WindowInsets.navigationBars)
                .padding(start = TeleTauSpace.s400, end = TeleTauSpace.s400, top = TeleTauSpace.s400, bottom = TeleTauSpace.s400)
                .semantics { paneTitle = steps[i].title },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            AnimatedContent(
                targetState = i,
                transitionSpec = {
                    if (reduce) fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                    else (fadeIn(tween(TeleTauDuration.BASE)) + slideInHorizontally(tween(TeleTauDuration.BASE, easing = TeleTauEasing.out)) { it / 8 }) togetherWith fadeOut(tween(TeleTauDuration.FAST))
                },
                label = "IntroStep",
            ) { k ->
                val step = steps[k]
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    if (k == 0) {
                        // Пейзаж с пчелой — в рамке-«окошке», как на сайте.
                        androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxWidth().height(170.dp).clip(RoundedCornerShape(TeleTauRadius.card)).background(c.accentSoft)) {
                            ru.teletau.core.designsystem.IllustrationFill(step.art, maxWidth, Modifier.fillMaxSize(), alignment = androidx.compose.ui.BiasAlignment(0.6f, 0f))
                        }
                    } else {
                        Illustration(step.art, 150.dp)
                    }
                    Row(
                        Modifier.padding(top = TeleTauSpace.s350, bottom = TeleTauSpace.s300)
                            .semantics { contentDescription = "Шаг ${k + 1} из ${steps.size}" },
                        horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s150),
                    ) {
                        steps.indices.forEach { d ->
                            Box(Modifier.width(if (d == k) 22.dp else 8.dp).height(8.dp).background(if (d == k) c.accentFill else c.borderDefault, RoundedCornerShape(TeleTauRadius.chip)))
                        }
                    }
                    KHeading(step.title, TeleTauText.title2, align = TextAlign.Center)
                    KText(step.text, TeleTauText.body, Modifier.padding(top = TeleTauSpace.s200, bottom = TeleTauSpace.s500), color = c.textSecondary, align = TextAlign.Center)
                }
            }
            if (last) {
                TeleTauButton("Начать урок", { onClose(); onStart() }, Modifier.fillMaxWidth())
                LinkButton("Посмотреть тропу", onClose, Modifier.padding(top = TeleTauSpace.s200), tone = LinkTone.Neutral)
            } else {
                TeleTauButton("Дальше", { i += 1 }, Modifier.fillMaxWidth())
                LinkButton("Пропустить", onClose, Modifier.padding(top = TeleTauSpace.s200), tone = LinkTone.Neutral)
            }
        }
    }
}
