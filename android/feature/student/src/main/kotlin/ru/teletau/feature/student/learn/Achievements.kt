package ru.teletau.feature.student.learn

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import ru.teletau.core.designsystem.FitText
import ru.teletau.core.designsystem.KHeading
import ru.teletau.core.designsystem.KText
import ru.teletau.core.designsystem.PhosphorIcons
import ru.teletau.core.designsystem.TeleTauCard
import ru.teletau.core.designsystem.TeleTauDuration
import ru.teletau.core.designsystem.TeleTauEasing
import ru.teletau.core.designsystem.TeleTauFontSize
import ru.teletau.core.designsystem.TeleTauFontWeight
import ru.teletau.core.designsystem.TeleTauIconButton
import ru.teletau.core.designsystem.TeleTauLineHeight
import ru.teletau.core.designsystem.TeleTauProgressBar
import ru.teletau.core.designsystem.TeleTauRadius
import ru.teletau.core.designsystem.TeleTauSize
import ru.teletau.core.designsystem.TeleTauSpace
import ru.teletau.core.designsystem.TeleTauText
import ru.teletau.core.designsystem.TeleTauTheme
import ru.teletau.core.designsystem.roundedHexPath
import ru.teletau.core.network.models.Achievement
import ru.teletau.core.network.models.MyAchievements
import ru.teletau.feature.student.common.dayLong
import kotlin.math.PI
import kotlin.math.sin

/** Значок награды (`AchievementIcon` контракта) — иконка Phosphor; набор расширяется, незнакомый значок — звезда. */
private val ICONS: Map<String, () -> ImageVector> = mapOf(
    "footprints" to { PhosphorIcons.FootprintsFill },
    "seal-check" to { PhosphorIcons.SealCheckFill },
    "fire" to { PhosphorIcons.FireFill },
    "target" to { PhosphorIcons.TargetFill },
    "book-open" to { PhosphorIcons.BookOpenFill },
    "books" to { PhosphorIcons.BooksFill },
    "scales" to { PhosphorIcons.ScalesFill },
    "map-pin" to { PhosphorIcons.MapPinFill },
    "flag-banner" to { PhosphorIcons.FlagBannerFill },
    "star" to { PhosphorIcons.StarFill },
)

fun achievementIcon(icon: String): ImageVector = (ICONS[icon] ?: ICONS.getValue("star"))()

/** Тон соты: полученная — заливка по значку (как соты тропы, счётчики профиля и серия), ещё нет — воск. */
enum class BadgeTone { Honey, Streak, Green, Water, Violet, Locked }

private val TONES: Map<String, BadgeTone> = mapOf(
    "footprints" to BadgeTone.Honey,
    "seal-check" to BadgeTone.Green,
    "fire" to BadgeTone.Streak,
    "target" to BadgeTone.Honey,
    "book-open" to BadgeTone.Water,
    "books" to BadgeTone.Water,
    "scales" to BadgeTone.Violet,
    "map-pin" to BadgeTone.Green,
    "flag-banner" to BadgeTone.Green,
    "star" to BadgeTone.Honey,
)

val Achievement.earned: Boolean get() = earnedOn != null

fun badgeTone(a: Achievement): BadgeTone = if (!a.earned) BadgeTone.Locked else TONES[a.icon] ?: BadgeTone.Honey

/**
 * Что прочитает TalkBack о награде: «7 дней подряд, получена 5 ноября», «7 дней подряд, 5 из 7» или
 * «Место пройдено, ещё не получена».
 */
fun achievementLabel(a: Achievement): String {
    val earnedOn = a.earnedOn
    return when {
        earnedOn != null -> "${a.titleRu}, получена ${dayLong(earnedOn)}"
        a.target > 1 -> "${a.titleRu}, ${a.progress} из ${a.target}"
        else -> "${a.titleRu}, ещё не получена"
    }
}

private class ToneColors(val face: Color, val lip: Color, val ink: Color, val soft: Color)

@Composable
private fun toneColors(tone: BadgeTone): ToneColors {
    val c = TeleTauTheme.colors
    return when (tone) {
        BadgeTone.Honey -> ToneColors(c.accentFill, c.accentLip, c.accentOn, c.accentSoft)
        BadgeTone.Streak -> ToneColors(c.streakFill, c.streakLip, c.textOnFill, c.streakSoft)
        BadgeTone.Green -> ToneColors(c.successFill, c.successLip, c.textOnFill, c.successSoft)
        BadgeTone.Water -> ToneColors(c.infoFill, c.infoLip, c.textOnFill, c.infoSoft)
        BadgeTone.Violet -> ToneColors(c.violetBright, c.violetLip, c.violetOn, c.violetSoft)
        BadgeTone.Locked -> ToneColors(c.lockedFill, c.lockedLip, c.lockedText, c.accentSoft)
    }
}

/**
 * Геометрия соты по размеру — как ячейки тропы, пропорционально (ширина, высота, «губа», скругление, значок) — и лента
 * с числом: насколько свисает под сотой, наименьшая ширина, поля и кегль.
 */
enum class BadgeSize(
    internal val w: Dp,
    internal val h: Dp,
    internal val lip: Dp,
    internal val r: Dp,
    internal val icon: Dp,
    internal val hang: Dp,
    internal val levelMin: Dp,
    internal val levelPadH: Dp,
    internal val levelPadV: Dp,
    internal val levelFont: TextUnit,
) {
    Tile(64.dp, 56.dp, 6.dp, 11.dp, 28.dp, TeleTauSpace.s100, 26.dp, TeleTauSpace.s150, TeleTauSpace.s050, TeleTauFontSize.caption),
    Medium(96.dp, 84.dp, 8.dp, 15.dp, 42.dp, TeleTauSpace.s100, 32.dp, TeleTauSpace.s200, TeleTauSpace.s050, TeleTauFontSize.footnote),
    Hero(140.dp, 122.dp, 10.dp, 22.dp, 62.dp, TeleTauSpace.s150, 40.dp, TeleTauSpace.s250, TeleTauSpace.s100, TeleTauFontSize.body),
}

/** Ореол крупного значка: две соты мягкого тона за ним. */
private val HALO_W = 260.dp
private val HALO_H = 226.dp

/** Блик на соте (как у узлов тропы): штрих 16 и пробел 200 вдоль контура. */
private const val SHINE_DASH = 16f
private const val SHINE_GAP = 200f

/**
 * Сота-значок награды: полученная — цветная, с бликом, ещё нет — воск. У наград с числом — число на ленте под сотой.
 * Декоративная: смысл передают подпись и текст рядом. [rise] — сота поднимается с пружиной и по ней проходит блик
 * (экран «Новая награда!»); [delay] — задержка подъёма, мс. У крупной полученной соты — ореол из сот.
 */
@Composable
fun AchievementBadge(a: Achievement, modifier: Modifier = Modifier, size: BadgeSize = BadgeSize.Tile, rise: Boolean = false, delay: Int = 0) {
    val tone = badgeTone(a)
    val t = toneColors(tone)
    val c = TeleTauTheme.colors
    val reduce = TeleTauTheme.reduceMotion
    val moving = rise && !reduce
    val up = remember { Animatable(if (moving) 0f else 1f) }
    val glint = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        if (!moving) return@LaunchedEffect
        up.animateTo(1f, tween(TeleTauDuration.RISE, delayMillis = TeleTauDuration.SLOW + delay, easing = TeleTauEasing.spring))
        glint.animateTo(1f, tween(TeleTauDuration.GLINT, easing = TeleTauEasing.inOut))
    }
    val halo = size == BadgeSize.Hero && tone != BadgeTone.Locked
    // С ореолом сота стоит в его центре: ореол целиком в границах значка (ничего не обрезается на узком экране).
    val boxW = if (halo) HALO_W else size.w
    val boxH = if (halo) HALO_H else size.h + size.lip + size.hang
    Box(
        modifier
            .size(boxW, boxH)
            .clearAndSetSemantics {}
            .graphicsLayer {
                val v = up.value
                alpha = v.coerceIn(0f, 1f)
                val s = 0.55f + 0.45f * v
                scaleX = s
                scaleY = s
                translationY = (1f - v) * 40.dp.toPx()
                transformOrigin = TransformOrigin(0.5f, 1f)
            },
    ) {
        if (halo) {
            Canvas(Modifier.fillMaxSize()) {
                val hw = HALO_W.toPx()
                val hh = HALO_H.toPx()
                drawPath(roundedHexPath(hw, hh, 40.dp.toPx()), t.soft.copy(alpha = 0.55f))
                drawPath(roundedHexPath(hw - 56.dp.toPx(), hh - 48.dp.toPx(), 32.dp.toPx(), 28.dp.toPx(), 24.dp.toPx()), t.soft)
            }
        }
        Box(
            Modifier
                .offset((boxW - size.w) / 2, if (halo) (HALO_H - size.h) / 2 else 0.dp)
                .size(size.w, size.h + size.lip + size.hang),
        ) {
            Canvas(Modifier.fillMaxSize()) {
                val w = size.w.toPx()
                val h = size.h.toPx()
                val r = size.r.toPx()
                drawPath(roundedHexPath(w, h, r, 0f, size.lip.toPx()), t.lip)
                drawPath(roundedHexPath(w, h, r), t.face)
                if (tone != BadgeTone.Locked) {
                    val g = glint.value
                    val period = (SHINE_DASH + SHINE_GAP).dp.toPx()
                    drawPath(
                        roundedHexPath(w - r * 2, h - r * 2, r * 0.6f, r, r * 0.7f),
                        c.highlight.copy(alpha = 0.4f + 0.5f * sin(PI * g).toFloat()),
                        style = Stroke(
                            width = 3.dp.toPx(),
                            cap = StrokeCap.Round,
                            pathEffect = PathEffect.dashPathEffect(floatArrayOf(SHINE_DASH.dp.toPx(), SHINE_GAP.dp.toPx()), period * (1f - g)),
                        ),
                    )
                }
            }
            Image(
                achievementIcon(a.icon), null,
                Modifier.align(Alignment.TopCenter).offset(y = (size.h - size.icon) / 2).size(size.icon),
                colorFilter = ColorFilter.tint(t.ink),
            )
            // Число — на ленте поверх нижнего края соты.
            if (a.target > 1) {
                val shape = RoundedCornerShape(TeleTauRadius.chip)
                Box(
                    Modifier
                        .align(Alignment.BottomCenter)
                        .defaultMinSize(minWidth = size.levelMin)
                        .background(c.surface, shape)
                        .border(TeleTauSpace.s050, t.lip, shape)
                        .padding(horizontal = size.levelPadH, vertical = size.levelPadV),
                    contentAlignment = Alignment.Center,
                ) {
                    KText(
                        "${a.target}",
                        levelStyle(size.levelFont),
                        color = if (tone == BadgeTone.Locked) c.textTertiary else c.textPrimary,
                        align = TextAlign.Center,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

private fun levelStyle(size: TextUnit): TextStyle =
    TeleTauText.caption.copy(fontSize = size, fontWeight = TeleTauFontWeight.black, fontFeatureSettings = "tnum", lineHeight = TextUnit.Unspecified)

/** Тонкая полоса прогресса под плиткой награды. */
@Composable
private fun MiniBar(value: Int, max: Int, modifier: Modifier = Modifier) {
    val c = TeleTauTheme.colors
    val fraction = if (max > 0) (value.toFloat() / max).coerceIn(0f, 1f) else 0f
    Canvas(modifier.width(64.dp).height(TeleTauSpace.s150).clearAndSetSemantics {}) {
        val radius = CornerRadius(size.height / 2, size.height / 2)
        drawRoundRect(c.lockedFill, cornerRadius = radius)
        if (fraction > 0f) drawRoundRect(c.accentFill, size = Size((size.width * fraction).coerceAtLeast(size.height), size.height), cornerRadius = radius)
    }
}

private val metaStyle: TextStyle get() = TeleTauText.footnote.copy(fontSize = TeleTauFontSize.caption, fontFeatureSettings = "tnum")

/**
 * «Награды» в профиле: сетка сот по три в ряд — полученные цветные, с днём получения; остальные воском, с прогрессом.
 * Нажатие — лист с подробностями: что сделать и когда получена.
 */
@Composable
fun AchievementsCard(data: MyAchievements, modifier: Modifier = Modifier) {
    val c = TeleTauTheme.colors
    var open by remember { mutableStateOf<Achievement?>(null) }
    TeleTauCard(modifier.fillMaxWidth().padding(bottom = TeleTauSpace.s350)) {
        Row(Modifier.fillMaxWidth().padding(bottom = TeleTauSpace.s300), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s200)) {
            KHeading("Награды", TeleTauText.headline, Modifier.weight(1f))
            KText(
                "${data.earned} из ${data.total}",
                TeleTauText.footnote.copy(fontWeight = TeleTauFontWeight.bold, fontFeatureSettings = "tnum"),
                color = c.textSecondary,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s300)) {
            data.achievements.chunked(3).forEach { row ->
                // Узкий зазор и плитки без боковых полей: на 320 dp при крупном шрифте длинные слова названий
                // («пройдено») почти не уменьшаются.
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s100)) {
                    row.forEach { a -> AwardTile(a, Modifier.weight(1f)) { open = a } }
                    repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
    open?.let { AchievementSheet(it) { open = null } }
}

/** Плитка награды: сота, название и день получения — или полоса и «5 из 7». Нажатая сота утапливается. */
@Composable
private fun AwardTile(a: Achievement, modifier: Modifier, onClick: () -> Unit) {
    val c = TeleTauTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val sink by animateDpAsState(if (pressed) TeleTauSize.lipSmall else 0.dp, tween(if (TeleTauTheme.reduceMotion) 0 else TeleTauDuration.PRESS), label = "AwardSink")
    Column(
        modifier
            .clip(RoundedCornerShape(TeleTauRadius.tile))
            .clickable(interaction, indication = null, role = Role.Button, onClick = onClick)
            .semantics(mergeDescendants = true) { contentDescription = achievementLabel(a) }
            .padding(top = TeleTauSpace.s150, bottom = TeleTauSpace.s100),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        AchievementBadge(a, Modifier.offset { IntOffset(0, sink.roundToPx()) })
        Column(Modifier.padding(top = TeleTauSpace.s150).clearAndSetSemantics {}, horizontalAlignment = Alignment.CenterHorizontally) {
            FitText(
                a.titleRu,
                TeleTauText.footnote.copy(fontWeight = TeleTauFontWeight.bold, lineHeight = TeleTauLineHeight.SNUG.em),
                color = if (a.earned) c.textPrimary else c.textSecondary,
                align = TextAlign.Center,
                maxLines = 3,
                minScale = 0.5f,
            )
            val earnedOn = a.earnedOn
            when {
                earnedOn != null -> FitText(dayLong(earnedOn), metaStyle, Modifier.padding(top = TeleTauSpace.s100), color = c.textTertiary, align = TextAlign.Center, maxLines = 1)
                a.target > 1 -> {
                    MiniBar(a.progress, a.target, Modifier.padding(top = TeleTauSpace.s150))
                    FitText("${a.progress} из ${a.target}", metaStyle, Modifier.padding(top = TeleTauSpace.s100), color = c.textTertiary, align = TextAlign.Center, maxLines = 1)
                }
            }
        }
    }
}

/**
 * Лист награды снизу: крупная сота, что сделать, затем «Получена 5 ноября» или полоса «5 из 7». Закрывают крестик,
 * «Назад» и касание затемнения.
 */
@Composable
fun AchievementSheet(a: Achievement, onDismiss: () -> Unit) {
    val c = TeleTauTheme.colors
    val reduce = TeleTauTheme.reduceMotion
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxSize().clickable(remember { MutableInteractionSource() }, indication = null, onClick = onDismiss).clearAndSetSemantics {})
            var shown by remember { mutableStateOf(reduce) }
            LaunchedEffect(Unit) { shown = true }
            val lift by animateDpAsState(if (shown) 0.dp else 420.dp, tween(if (reduce) 0 else TeleTauDuration.SLOW, easing = TeleTauEasing.out), label = "AwardSheetRise")
            Column(
                Modifier
                    .align(Alignment.BottomCenter)
                    .widthIn(max = TeleTauSize.columnNarrow)
                    .fillMaxWidth()
                    .graphicsLayer { translationY = lift.toPx() }
                    .background(c.bg, RoundedCornerShape(topStart = TeleTauRadius.sheet, topEnd = TeleTauRadius.sheet))
                    .clickable(remember { MutableInteractionSource() }, indication = null) {}
                    .windowInsetsPadding(WindowInsets.navigationBars)
                    .padding(start = TeleTauSpace.s400, end = TeleTauSpace.s400, top = TeleTauSpace.s300, bottom = TeleTauSpace.s800)
                    .semantics { paneTitle = a.titleRu },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Spacer(Modifier.size(TeleTauTheme.touchTarget))
                    Box(Modifier.weight(1f), contentAlignment = Alignment.Center) { KHeading(a.titleRu, TeleTauText.title3, align = TextAlign.Center) }
                    TeleTauIconButton(PhosphorIcons.XBold, "Закрыть", onDismiss)
                }
                AchievementBadge(a, Modifier.padding(top = TeleTauSpace.s400), size = BadgeSize.Medium)
                KText(a.descriptionRu, TeleTauText.body, Modifier.padding(top = TeleTauSpace.s400), color = c.textSecondary, align = TextAlign.Center)
                val earnedOn = a.earnedOn
                when {
                    earnedOn != null -> KText(
                        "Получена ${dayLong(earnedOn)}",
                        TeleTauText.body.copy(fontWeight = TeleTauFontWeight.bold),
                        Modifier.padding(top = TeleTauSpace.s250),
                        color = c.successText,
                        align = TextAlign.Center,
                    )
                    a.target > 1 -> TeleTauProgressBar(
                        a.progress, a.target,
                        Modifier.padding(top = TeleTauSpace.s250).widthIn(max = 280.dp).fillMaxWidth(),
                        label = a.titleRu, valueText = "${a.progress} из ${a.target}", showValue = true,
                    )
                }
            }
        }
    }
}
