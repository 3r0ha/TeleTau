package ru.teletau.feature.student.learn

import ru.teletau.feature.student.common.ScreenSound
import ru.teletau.feature.student.common.UiSound
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateIntAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import ru.teletau.core.designsystem.ButtonVariant
import ru.teletau.core.designsystem.EmptyState
import ru.teletau.core.designsystem.Illustration
import ru.teletau.core.designsystem.KHeading
import ru.teletau.core.designsystem.KText
import ru.teletau.core.designsystem.TeleTauButton
import ru.teletau.core.designsystem.TeleTauDuration
import ru.teletau.core.designsystem.TeleTauEasing
import ru.teletau.core.designsystem.TeleTauFontSize
import ru.teletau.core.designsystem.TeleTauFontWeight
import ru.teletau.core.designsystem.TeleTauRadius
import ru.teletau.core.designsystem.TeleTauSize
import ru.teletau.core.designsystem.TeleTauSpace
import ru.teletau.core.designsystem.TeleTauText
import ru.teletau.core.designsystem.TeleTauTheme
import ru.teletau.core.designsystem.PhosphorIcons
import ru.teletau.core.designsystem.R
import ru.teletau.core.designsystem.StatTile
import ru.teletau.core.designsystem.roundedHexPath
import ru.teletau.core.network.models.JumpResult
import ru.teletau.core.network.models.LessonRun
import ru.teletau.core.network.models.LessonRunSummary
import ru.teletau.core.network.models.NodeKind
import ru.teletau.core.network.models.Place
import ru.teletau.core.network.models.RunKind
import ru.teletau.core.network.models.StreakDay
import ru.teletau.core.network.models.StreakDayStatus
import ru.teletau.feature.student.common.TIER_NAMES
import ru.teletau.feature.student.common.duration
import ru.teletau.feature.student.common.plural
import ru.teletau.feature.student.common.weekdayShort
import kotlin.math.roundToInt
import kotlin.random.Random

/** Где урок на тропе — для подписи «Знакомство · урок 4»; у испытания для перехода — место, которое открывали. */
data class LessonPlace(val topicRu: String? = null, val lessonNumber: Int? = null, val place: Place? = null)

/** Полноэкранный шаг после урока (prototype `.full`): картинка, заголовок, текст, одна кнопка внизу. [hero] — вместо картинки [art]. */
@Composable
private fun AfterScreen(
    art: Int,
    artWidth: Int = 236,
    violet: Boolean = false,
    confetti: Boolean = false,
    hop: Boolean = false,
    action: String,
    variant: ButtonVariant = ButtonVariant.Primary,
    busy: Boolean = false,
    onAction: () -> Unit,
    hero: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = TeleTauTheme.colors
    Box(Modifier.fillMaxSize().background(if (violet) c.violetSoft else c.bg)) {
        Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars)) {
            Column(
                Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = TeleTauSpace.s400).padding(top = TeleTauSpace.s800),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Column(Modifier.widthIn(max = TeleTauSize.columnNarrow), horizontalAlignment = Alignment.CenterHorizontally) {
                    if (hero != null) hero() else Hop(hop) { Illustration(art, artWidth.dp, Modifier.padding(top = TeleTauSpace.s450, bottom = TeleTauSpace.s150)) }
                    content()
                }
            }
            Box(
                Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.navigationBars).padding(start = TeleTauSpace.s400, end = TeleTauSpace.s400, top = TeleTauSpace.s400, bottom = 22.dp),
                contentAlignment = Alignment.Center,
            ) { TeleTauButton(action, onAction, Modifier.widthIn(max = TeleTauSize.columnNarrow).fillMaxWidth(), variant = variant, loading = busy) }
        }
        if (confetti) HoneyConfetti()
    }
}

/** Пчела на сотах прыгает со сжатием (токен hop); без анимации — неподвижна. */
@Composable
private fun Hop(enabled: Boolean, content: @Composable () -> Unit) {
    if (!enabled || TeleTauTheme.reduceMotion) return content()
    val y = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        y.animateTo(-18f, tween(TeleTauDuration.HOP / 3, easing = TeleTauEasing.out))
        y.animateTo(0f, tween(TeleTauDuration.HOP / 3, easing = TeleTauEasing.fall))
        y.animateTo(4f, tween(TeleTauDuration.HOP / 6))
        y.animateTo(0f, tween(TeleTauDuration.HOP / 6, easing = TeleTauEasing.spring))
    }
    Box(Modifier.graphicsLayer { translationY = y.value * density; scaleY = 1f - (y.value.coerceAtLeast(0f) / 40f); transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0.5f, 1f) }) { content() }
}

/** Конфетти из маленьких сот — праздник; при «Убрать анимацию» его нет. */
@Composable
private fun HoneyConfetti() {
    if (TeleTauTheme.reduceMotion) return
    val c = TeleTauTheme.colors
    val palette = listOf(c.accentFill, c.accentLip, c.successFill, c.infoFill, c.violetBright, c.dangerFill)
    val pieces = remember { List(26) { Triple(Random.nextFloat(), Random.nextFloat() * 0.35f, Random.nextFloat() * 360f) } }
    val t = remember { Animatable(0f) }
    LaunchedEffect(Unit) { t.animateTo(1.35f, tween(TeleTauDuration.CONFETTI, easing = LinearEasing)) }
    Canvas(Modifier.fillMaxSize().clearAndSetSemantics {}) {
        val cell = 12.dp.toPx()
        pieces.forEachIndexed { i, (x, delay, rot) ->
            val p = ((t.value - delay) / 1f).coerceIn(0f, 1f)
            if (p <= 0f || p >= 1f) return@forEachIndexed
            val fall = TeleTauEasing.fall.transform(p)
            translate(x * size.width, -cell + fall * (size.height + cell * 2)) {
                rotate(rot + p * 240f, pivot = androidx.compose.ui.geometry.Offset(cell / 2, cell / 2)) {
                    drawPath(roundedHexPath(cell, cell * 0.875f, 2.dp.toPx()), palette[i % palette.size])
                }
            }
        }
    }
}

/** Цель дня на итоге: выполнена этим уроком — празднуем; ещё нет — сколько сот осталось; выполнена раньше — ничего. */
@Composable
private fun GoalNote(summary: LessonRunSummary) {
    val goal = summary.dailyGoal ?: return
    val c = TeleTauTheme.colors
    val reached = summary.dailyGoalReached == true
    if (!reached && goal.met) return
    val left = goal.target - goal.done
    val shape = RoundedCornerShape(TeleTauRadius.panel)
    Row(
        Modifier.fillMaxWidth().padding(top = TeleTauSpace.s400).background(if (reached) c.accentSoft else c.surface, shape)
            .border(TeleTauSpace.s050, if (reached) c.accentSoftBorder else c.borderSubtle, shape).padding(horizontal = TeleTauSpace.s400, vertical = TeleTauSpace.s200),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300),
    ) {
        ru.teletau.core.designsystem.GoalMeter(goal.done, goal.target)
        ru.teletau.core.designsystem.FitText(
            if (reached) "Цель дня выполнена" else "Ещё $left ${plural(left, "сота", "соты", "сот")} до цели дня",
            if (reached) TeleTauText.callout.copy(fontWeight = TeleTauFontWeight.bold) else TeleTauText.callout, Modifier.weight(1f), maxLines = 3,
        )
    }
}

/** Упражнений нет (prototype 20-empty-done): у «Помоги языку» закончились дуэли, за которые ученик ещё не голосовал. */
@Composable
fun NothingToDo(kind: RunKind, onContinue: () -> Unit) {
    val (title, lead) = when (kind) {
        RunKind.helpLanguage -> "Все пары уже оценены" to "Новые появятся позже."
        RunKind.review -> "Пока нечего повторять" to "Новые слова появятся после уроков."
        else -> "Здесь пока пусто" to "В этом уроке пока нет заданий."
    }
    AfterScreen(R.drawable.empty_all_done, action = "На тропу", onAction = onContinue) {
        Title(title)
        Lead(lead)
    }
}

@Composable
private fun Title(text: String, tight: Boolean = false) {
    KHeading(text, TeleTauText.title1, Modifier.padding(top = if (tight) 0.dp else TeleTauSpace.s250, bottom = TeleTauSpace.s150), align = TextAlign.Center)
}

@Composable
private fun Lead(text: String) {
    KText(text, TeleTauText.body, Modifier.widthIn(max = 330.dp).padding(bottom = 22.dp), color = TeleTauTheme.colors.textSecondary, align = TextAlign.Center)
}

/** «Урок пройден!» (prototype 13-result): мёд, точность, время, новые слова. Счётчик мёда «набегает». */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ResultScreen(run: LessonRun, summary: LessonRunSummary, place: LessonPlace, onContinue: () -> Unit) {
    summary.jump?.let { return JumpResultScreen(it, summary, place.place, onContinue) }
    val c = TeleTauTheme.colors
    val helping = run.kind == RunKind.helpLanguage
    val title = when {
        helping -> "Спасибо за помощь!"
        run.kind == RunKind.placeTest -> "Испытание пройдено!"
        run.kind == RunKind.review -> "Повторение пройдено!"
        else -> "Урок пройден!"
    }
    val pending = summary.honey.pendingFromVotes
    val where = if (run.kind == RunKind.review) "" else listOfNotNull(place.topicRu, if (helping) "Помоги языку" else place.lessonNumber?.let { "урок $it" } ?: run.titleRu).joinToString(" · ")
    val reduce = TeleTauTheme.reduceMotion
    var target by remember { mutableStateOf(if (reduce) summary.honey.total else 0) }
    LaunchedEffect(Unit) { target = summary.honey.total }
    val honey by animateIntAsState(target, tween(if (reduce) 0 else TeleTauDuration.COUNT, easing = TeleTauEasing.out), label = "HoneyCount")
    ScreenSound(UiSound.Complete)
    AfterScreen(R.drawable.scene_lesson_complete, confetti = true, hop = true, action = "Дальше", onAction = onContinue) {
        Title(title)
        if (where.isNotEmpty()) Lead(where + if (helping && pending > 0) " · ещё +$pending мёда созреет позже" else "")
        Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = "Итог урока: мёд +${summary.honey.total}, точность ${(summary.accuracy * 100).roundToInt()}%, время ${duration(summary.durationSeconds)}" },
            horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s250)) {
            StatTile("Мёд", "+$honey", Modifier.weight(1f), icon = PhosphorIcons.DropFill)
            StatTile("Точность", "${(summary.accuracy * 100).roundToInt()}%", Modifier.weight(1f))
            StatTile("Время", duration(summary.durationSeconds), Modifier.weight(1f))
        }
        GoalNote(summary)
        if (summary.newWords.isNotEmpty()) {
            val shape = RoundedCornerShape(TeleTauRadius.panel)
            Row(
                Modifier.fillMaxWidth().padding(top = TeleTauSpace.s400).background(c.surface, shape).border(TeleTauSpace.s050, c.borderSubtle, shape)
                    .padding(start = TeleTauSpace.s300, end = TeleTauSpace.s400, top = TeleTauSpace.s300, bottom = TeleTauSpace.s300),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300),
            ) {
                Illustration(R.drawable.bee_read, 60.dp)
                Column {
                    KText("НОВЫЕ СЛОВА", TeleTauText.caption.copy(letterSpacing = 0.06.em), color = c.textTertiary)
                    FlowRow(Modifier.padding(top = TeleTauSpace.s200), horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s150), verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s150)) {
                        summary.newWords.forEach { w ->
                            Box(Modifier.background(c.accentSoft, RoundedCornerShape(TeleTauRadius.chip)).padding(horizontal = TeleTauSpace.s250, vertical = TeleTauSpace.s100)) {
                                KText(w.text, TeleTauText.bashkir(TeleTauFontSize.body, TeleTauFontWeight.extrabold))
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun dayText(s: StreakDayStatus) = when (s) {
    StreakDayStatus.done -> "цель выполнена"
    StreakDayStatus.frozen -> "заморозка"
    StreakDayStatus.missed -> "пропуск"
    StreakDayStatus.today -> "сегодня"
    StreakDayStatus.future -> "впереди"
}

/**
 * Серия (prototype 14-streak): дни подряд, неделя сотами, заморозки — одной строкой. Сегодняшняя сота сразу
 * запечатывается мёдом (короткий «прыжок»), прошлые дни уже закрыты — они не ждут своей очереди.
 */
@Composable
fun StreakScreen(summary: LessonRunSummary, onContinue: () -> Unit) {
    val c = TeleTauTheme.colors
    val s = summary.streak
    ScreenSound(UiSound.Streak)
    AfterScreen(R.drawable.scene_streak, artWidth = 260, action = "Дальше", onAction = onContinue) {
        KText("${s.current}", TeleTauText.display.copy(fontSize = TeleTauFontSize.board, lineHeight = 1.em), Modifier.clearAndSetSemantics {}, color = c.streakFill)
        Title("${plural(s.current, "день подряд", "дня подряд", "дней подряд")}", tight = true)
        // Цель дня уже на итоге урока — здесь только о серии.
        Lead(if (s.current <= 1) "Серия началась. Приходи завтра." else "Приходи завтра, чтобы не прервать серию.")
        val shape = RoundedCornerShape(TeleTauRadius.panel)
        Column(
            Modifier.fillMaxWidth().background(c.surface, shape).border(TeleTauSpace.s050, c.borderSubtle, shape)
                .padding(start = TeleTauSpace.s250, end = TeleTauSpace.s250, top = TeleTauSpace.s350, bottom = TeleTauSpace.s300),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = "Эта неделя: " + s.week.joinToString { "${weekdayShort(it.date)}: ${dayText(it.status)}" } }) {
                s.week.forEach { d -> WeekDay(d, d.date == s.today, Modifier.weight(1f)) }
            }
            if (s.freezes > 0) {
                Row(Modifier.padding(top = TeleTauSpace.s300), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s150)) {
                    Illustration(R.drawable.item_streak_freeze, 26.dp)
                    KText(
                        "${s.freezes} ${plural(s.freezes, "заморозка", "заморозки", "заморозок")} в запасе",
                        TeleTauText.label.copy(fontSize = TeleTauFontSize.footnote), color = c.textSecondary,
                    )
                }
            }
        }
    }
}

@Composable
private fun WeekDay(day: StreakDay, today: Boolean, modifier: Modifier) {
    val c = TeleTauTheme.colors
    val state = when (day.status) {
        StreakDayStatus.frozen -> 2
        StreakDayStatus.done -> 1
        else -> 0
    }
    val reduce = TeleTauTheme.reduceMotion
    // Сегодняшняя сота — сразу в цвете и «прыгает» на место; остальные дни — как есть, без анимации.
    val pop = today && state != 0 && !reduce
    val scale = remember { Animatable(if (pop) 0.6f else 1f) }
    LaunchedEffect(Unit) { if (pop) scale.animateTo(1f, tween(TeleTauDuration.RISE, easing = TeleTauEasing.spring)) }
    Column(modifier.clearAndSetSemantics {}, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s150)) {
        KText(weekdayShort(day.date), TeleTauText.caption, color = if (today) c.textPrimary else c.textTertiary)
        Canvas(Modifier.size(32.dp, 31.dp).graphicsLayer { scaleX = scale.value; scaleY = scale.value; transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0.5f, 0.6f) }) {
            val w = 32.dp.toPx()
            val h = 28.dp.toPx()
            val r = 3.5f.dp.toPx()
            when (state) {
                0 -> {
                    val p = roundedHexPath(w - 2.dp.toPx(), h - 2.dp.toPx(), r, 1.dp.toPx(), 1.dp.toPx())
                    drawPath(p, c.surface)
                    drawPath(p, c.borderDefault, style = Stroke(2.dp.toPx()))
                }
                else -> {
                    val (face, lip) = if (state == 2) c.infoFill to c.infoLip else c.accentFill to c.accentLip
                    drawPath(roundedHexPath(w, h, r, 0f, 3.dp.toPx()), lip)
                    drawPath(roundedHexPath(w, h, r), face)
                }
            }
        }
    }
}

/**
 * «Новая награда!» — после итога и серии, перед новой лигой: сота поднимается с бликом в ореоле из сот, сверху падают
 * соты-конфетти. Несколько наград за урок — все на одном экране «Новые награды!».
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NewAchievementScreen(summary: LessonRunSummary, onContinue: () -> Unit) {
    val list = summary.newAchievements.orEmpty()
    val single = list.singleOrNull()
    ScreenSound(UiSound.LevelUp)
    AfterScreen(
        R.drawable.scene_lesson_complete, confetti = true, action = "Дальше", onAction = onContinue,
        hero = {
            if (single != null) AchievementBadge(single, Modifier.padding(top = TeleTauSpace.s450, bottom = TeleTauSpace.s300), size = BadgeSize.Hero, rise = true)
        },
    ) {
        Title(if (single != null) "Новая награда!" else "Новые награды!")
        if (single != null) {
            ru.teletau.core.designsystem.FitText(
                single.titleRu, TeleTauText.title3, Modifier.padding(bottom = 22.dp), align = TextAlign.Center, maxLines = 3,
            )
        } else {
            FlowRow(
                Modifier.fillMaxWidth().padding(top = TeleTauSpace.s200, bottom = TeleTauSpace.s600),
                horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s350, Alignment.CenterHorizontally),
                verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s400),
            ) {
                list.forEachIndexed { i, a ->
                    Column(Modifier.width(112.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        AchievementBadge(a, size = BadgeSize.Medium, rise = true, delay = minOf(i, 2) * TeleTauDuration.STAGGER)
                        ru.teletau.core.designsystem.FitText(
                            a.titleRu, TeleTauText.body.copy(fontWeight = TeleTauFontWeight.bold, lineHeight = ru.teletau.core.designsystem.TeleTauLineHeight.SNUG.em),
                            Modifier.padding(top = TeleTauSpace.s250), align = TextAlign.Center, maxLines = 3, minScale = 0.7f,
                        )
                    }
                }
            }
        }
    }
}

/**
 * «Новая лига — Кипрей!» (prototype 15-league-up): крылатый конь из эпоса несёт выше, значок новой лиги поднимается.
 * Башкирское имя коня в интерфейсе не пишется: башкирский текст — только из API.
 */
@Composable
fun LeagueUpScreen(summary: LessonRunSummary, busy: Boolean, onContinue: () -> Unit) {
    val result = summary.leagueResult ?: return
    val from = TIER_NAMES[result.tierBefore]
    val to = TIER_NAMES[result.tierAfter]
    val reduce = TeleTauTheme.reduceMotion
    val rise = remember { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(Unit) { rise.animateTo(1f, tween(TeleTauDuration.RISE, delayMillis = TeleTauDuration.SLOW, easing = TeleTauEasing.spring)) }
    ScreenSound(UiSound.LevelUp)
    AfterScreen(R.drawable.scene_league_up, violet = true, confetti = true, action = "Дальше", variant = ButtonVariant.Violet, busy = busy, onAction = onContinue) {
        Title("Новая лига — ${to?.nom}!")
        Lead("Ты среди лучших в Лиге ${from?.gen}.")
        Box(Modifier.graphicsLayer { translationY = (1 - rise.value) * 24f * density; alpha = rise.value }) {
            Illustration(leagueBadge(result.tierAfter), 96.dp, contentDescription = "Значок Лиги ${to?.gen}")
        }
    }
}

/**
 * Итог испытания для перехода (`summary.jump`). Сдано — «Место открыто»: картинка и название места, мёд, цель дня;
 * дальше — обычный поток (серия, лига, тропа). Не сдано — «Пока рано» и к урокам: на тропе ничего не изменилось.
 * Ни счёта ошибок, ни правил испытания на экране нет.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun JumpResultScreen(jump: JumpResult, summary: LessonRunSummary, place: Place?, onContinue: () -> Unit) {
    if (!jump.passed) {
        AfterScreen(R.drawable.bee_sympathy, artWidth = 200, action = "К урокам", onAction = onContinue) { Title("Пока рано") }
        return
    }
    val c = TeleTauTheme.colors
    val reduce = TeleTauTheme.reduceMotion
    var target by remember { mutableStateOf(if (reduce) summary.honey.total else 0) }
    LaunchedEffect(Unit) { target = summary.honey.total }
    val honey by animateIntAsState(target, tween(if (reduce) 0 else TeleTauDuration.COUNT, easing = TeleTauEasing.out), label = "JumpHoneyCount")
    ScreenSound(UiSound.Complete)
    val art = place?.let { placeArt(it.slug) }
    val heroArt = art?.hero
    val hero: (@Composable () -> Unit)? = if (heroArt != null) ({ PlaceHero(heroArt, art?.heroAlt) }) else null
    AfterScreen(R.drawable.scene_lesson_complete, confetti = true, hop = true, action = "Дальше", onAction = onContinue, hero = hero) {
        Title("Место открыто")
        if (place != null) {
            // Башкирское название и русское рядом (как на карточке места); не помещаются — русское уходит вниз.
            FlowRow(
                Modifier.fillMaxWidth().padding(bottom = 22.dp).semantics(mergeDescendants = true) {},
                horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s150, Alignment.CenterHorizontally),
                itemVerticalAlignment = Alignment.Bottom,
            ) {
                ru.teletau.core.designsystem.FitText(placeName(place), placeTitleStyle(place, TeleTauText.title3), color = c.accentText, maxLines = 2)
                if (place.titleBa != null) {
                    ru.teletau.core.designsystem.FitText(place.titleRu, TeleTauText.button.copy(fontWeight = TeleTauFontWeight.bold), Modifier.padding(bottom = TeleTauSpace.s050), color = c.textTertiary)
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
            StatTile(
                "Мёд", "+$honey",
                Modifier.fillMaxWidth(0.5f).semantics(mergeDescendants = true) { contentDescription = "Мёд +${summary.honey.total}" },
                icon = PhosphorIcons.DropFill,
            )
        }
        GoalNote(summary)
    }
}

/** Картинка открытого места (герой карточки места) и пчела в полёте у её края. */
@Composable
private fun PlaceHero(@androidx.annotation.DrawableRes art: Int, alt: String?) {
    val c = TeleTauTheme.colors
    val shape = RoundedCornerShape(TeleTauRadius.card)
    Box(Modifier.fillMaxWidth().padding(top = TeleTauSpace.s450, bottom = TeleTauSpace.s500)) {
        androidx.compose.foundation.layout.BoxWithConstraints(
            Modifier.fillMaxWidth().clip(shape).border(TeleTauSpace.s050, c.borderSubtle, shape),
        ) {
            Illustration(art, maxWidth, contentDescription = alt)
        }
        Box(Modifier.align(Alignment.BottomEnd).offset(x = TeleTauSpace.s200, y = TeleTauSpace.s800).clearAndSetSemantics {}) {
            Hop(true) { Illustration(R.drawable.bee_fly, 96.dp) }
        }
    }
}
