package ru.teletau.core.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.max
import kotlin.math.roundToInt

/** Состояние узла тропы (контракт `NodeState`). */
public enum class HexNodeState { Done, Current, Open, Locked }

/** Мёд — урок и испытание, фиолетовый — «Помоги языку» (закрытые — воск при любом тоне). */
public enum class HexNodeTone { Honey, Violet }

// Геометрия узла прототипа v2 (packages/ui HexNode): ячейка 78×68, губа 7, кольцо текущего узла на 13/12 шире.
private val NODE_W = 78.dp
private val NODE_H = 68.dp
private val NODE_LIP = 7.dp

/**
 * Узел тропы — шестиугольная ячейка с «губой» (docs/05 §0, решение 1): пройденный — мёд с галочкой, текущий — с
 * «дышащим» кольцом, «Помоги языку» — фиолетовый, закрытый — воск. Нажатие утапливает ячейку на высоту губы.
 */
@Composable
public fun HexNode(
    state: HexNodeState,
    icon: ImageVector,
    label: String,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    tone: HexNodeTone = HexNodeTone.Honey,
) {
    val c = TeleTauTheme.colors
    val locked = state == HexNodeState.Locked
    val (face, lip, ink) = when {
        locked -> Triple(c.lockedFill, c.lockedLip, c.lockedText)
        tone == HexNodeTone.Violet -> Triple(c.violetBright, c.violetLip, c.violetOn)
        else -> Triple(c.accentFill, c.accentLip, c.accentOn)
    }
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    // Закрытый узел тоже нажимается (подсказка «Сначала пройди…»), но не утапливается.
    val clickable = onClick != null
    val sink by animateDpAsState(if (pressed && clickable && !locked) NODE_LIP else 0.dp, tween(if (TeleTauTheme.reduceMotion) 0 else TeleTauDuration.PRESS), label = "NodeSink")
    val breath = if (state == HexNodeState.Current && !TeleTauTheme.reduceMotion) {
        val t = rememberInfiniteTransition(label = "NodeBreath")
        val v by t.animateFloat(1f, 1.06f, infiniteRepeatable(tween(TeleTauDuration.BREATH / 2, easing = TeleTauEasing.inOut), RepeatMode.Reverse), label = "NodeBreathScale")
        v
    } else {
        1f
    }
    Box(
        modifier
            .size(NODE_W, NODE_H + NODE_LIP)
            .semantics(mergeDescendants = true) {
                contentDescription = label
                if (!clickable) role = Role.Image
            }
            .then(if (clickable) Modifier.clickable(interaction, indication = null, role = Role.Button, onClick = onClick) else Modifier),
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val w = NODE_W.toPx()
            val h = NODE_H.toPx()
            if (state == HexNodeState.Current) {
                val ring = roundedHexPath(w + 20.dp.toPx(), h + 18.dp.toPx(), 14.dp.toPx(), -10.dp.toPx(), -9.dp.toPx())
                val cx = w / 2
                val cy = h / 2
                scale(breath, pivot = Offset(cx, cy)) { drawPath(ring, c.lockedFill, style = Stroke(width = 6.dp.toPx())) }
            }
            drawPath(roundedHexPath(w, h, 13.dp.toPx(), 0f, NODE_LIP.toPx()), lip)
            val dy = sink.toPx()
            drawPath(roundedHexPath(w, h, 13.dp.toPx(), 0f, dy), face)
            if (!locked) {
                drawPath(
                    roundedHexPath(w - 26.dp.toPx(), h - 26.dp.toPx(), 8.dp.toPx(), 13.dp.toPx(), 9.dp.toPx() + dy),
                    c.highlight.copy(alpha = 0.35f),
                    style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round, pathEffect = PathEffect.dashPathEffect(floatArrayOf(18.dp.toPx(), 200.dp.toPx()))),
                )
            }
        }
        Image(
            icon, null,
            Modifier.size(32.dp).offset { IntOffset((23.dp + 0.dp).roundToPx(), (18.dp + sink).roundToPx()) },
            colorFilter = ColorFilter.tint(ink),
        )
    }
}

/** Тон шестиугольного аватара (prototype AVA). */
public enum class HexTone { Honey, Green, Water, Coral, Violet, Locked, Empty }

/** Цвета аватаров по кругу: соседние места различаются. */
public val HexTones: List<HexTone> = listOf(HexTone.Honey, HexTone.Green, HexTone.Water, HexTone.Violet, HexTone.Coral)

/** Стабильный цвет по строке (ник, номер места) — тот же хеш, что `toneFor` в packages/ui. */
public fun toneFor(key: String): HexTone {
    // UInt переполняется по модулю 2^32 — как `>>> 0` в TS.
    var h = 0u
    for (ch in key) h = h * 31u + ch.code.toUInt()
    return HexTones[(h % HexTones.size.toUInt()).toInt()]
}

/**
 * Аватары ников (design/assets/approved/avatar-*.webp): ник — «прилагательное + существительное» (ADR 0009), аватар
 * по существительному. Порядок и слова — как AVATAR_NOUNS в packages/ui/src/avatars.ts.
 */
private val AVATAR_NOUNS: Map<String, Int> = mapOf(
    "пчела" to R.drawable.avatar_bee, "шмель" to R.drawable.avatar_bumblebee, "сова" to R.drawable.avatar_owl,
    "еж" to R.drawable.avatar_hedgehog, "лиса" to R.drawable.avatar_fox, "барсук" to R.drawable.avatar_badger,
    "белка" to R.drawable.avatar_squirrel, "медведь" to R.drawable.avatar_bear, "рысь" to R.drawable.avatar_lynx,
    "сокол" to R.drawable.avatar_falcon, "ласточка" to R.drawable.avatar_swallow, "журавль" to R.drawable.avatar_crane,
    "синица" to R.drawable.avatar_tit, "бобер" to R.drawable.avatar_beaver, "стрекоза" to R.drawable.avatar_dragonfly,
    "заяц" to R.drawable.avatar_hare, "куница" to R.drawable.avatar_marten, "филин" to R.drawable.avatar_eagle_owl,
    "цапля" to R.drawable.avatar_heron, "дельфин" to R.drawable.avatar_dolphin, "комета" to R.drawable.avatar_comet,
    "кедр" to R.drawable.avatar_cedar, "звезда" to R.drawable.avatar_star, "клен" to R.drawable.avatar_maple,
    "ромашка" to R.drawable.avatar_chamomile, "ветер" to R.drawable.avatar_wind, "береза" to R.drawable.avatar_birch,
    "маяк" to R.drawable.avatar_lighthouse, "рябина" to R.drawable.avatar_rowan, "компас" to R.drawable.avatar_compass,
    "волна" to R.drawable.avatar_wave, "родник" to R.drawable.avatar_spring, "солнце" to R.drawable.avatar_sun,
    "облако" to R.drawable.avatar_cloud, "озеро" to R.drawable.avatar_lake, "перо" to R.drawable.avatar_feather,
)

/** Аватар по нику: последнее слово — существительное из словаря (без регистра и различия ё/е). Нет — null. */
@DrawableRes
public fun avatarFor(nickname: String?): Int? {
    val noun = nickname?.trim()?.split(Regex("\\s+"))?.lastOrNull() ?: return null
    return AVATAR_NOUNS[noun.lowercase().replace('ё', 'е')]
}

private class ToneColors(val fill: Color, val lip: Color, val soft: Color, val ink: Color)

@Composable
private fun toneColors(tone: HexTone): ToneColors {
    val c = TeleTauTheme.colors
    return when (tone) {
        HexTone.Honey -> ToneColors(c.accentFill, c.accentLip, c.accentSoft, c.textOnFill)
        HexTone.Green -> ToneColors(c.successFill, c.successLip, c.successSoft, c.textOnFill)
        HexTone.Water -> ToneColors(c.infoFill, c.infoLip, c.infoSoft, c.textOnFill)
        HexTone.Coral -> ToneColors(c.dangerFill, c.dangerLip, c.dangerSoft, c.textOnFill)
        HexTone.Violet -> ToneColors(c.violetBright, c.violetLip, c.violetSoft, c.violetOn)
        HexTone.Locked -> ToneColors(c.lockedFill, c.lockedLip, c.bgSunken, c.textSecondary)
        HexTone.Empty -> ToneColors(c.surface, c.borderDefault, c.surface, c.textTertiary)
    }
}

/**
 * Шестиугольный аватар (prototype avaHex): персонаж ника в рамке тона на мягкой подложке ([art]) или заливка тона
 * с текстом ([text] — номер места). Высота — 7/8 ширины, [lip] — «губа» снизу, [deep] — глубокий оттенок тона.
 */
@Composable
public fun HexAvatar(
    size: Dp,
    modifier: Modifier = Modifier,
    tone: HexTone = HexTone.Honey,
    @DrawableRes art: Int? = null,
    lip: Boolean = false,
    deep: Boolean = false,
    text: String? = null,
) {
    val t = toneColors(tone)
    val shine = TeleTauTheme.colors.highlight.copy(alpha = 0.35f)
    val h = (size.value * 0.875f).roundToInt().dp
    val lipH = if (lip) max(3f, (size.value * 0.08f)).roundToInt().dp else 0.dp
    val resources = LocalResources.current
    val px = with(LocalDensity.current) { size.roundToPx() }
    val bitmap = art?.let { remember(it, px) { Illustrations.bitmap(resources, it, px) } }
    Box(modifier.size(size, h + lipH).clearAndSetSemantics {}, contentAlignment = Alignment.TopCenter) {
        Canvas(Modifier.fillMaxSize()) {
            val w = this.size.width
            val hh = h.toPx()
            val r = max(3.dp.toPx(), w * 0.12f)
            if (lipH > 0.dp) drawPath(roundedHexPath(w, hh, r, 0f, lipH.toPx()), t.lip)
            val face = roundedHexPath(w, hh, r)
            if (bitmap != null) {
                drawPath(face, t.soft)
                clipPath(face) {
                    // Персонаж стоит «плечами» на нижней грани: вписан по высоте, по центру, снизу.
                    val boxW = w * 0.88f
                    val boxH = hh
                    val scale = minOf(boxW / bitmap.width, boxH / bitmap.height)
                    val dw = bitmap.width * scale
                    val dh = bitmap.height * scale
                    drawImage(
                        bitmap,
                        dstOffset = IntOffset((w * 0.06f + (boxW - dw) / 2).roundToInt(), (hh * 0.06f + boxH - dh).roundToInt()),
                        dstSize = IntSize(dw.roundToInt(), dh.roundToInt()),
                    )
                }
                val frame = max(2.dp.toPx(), w * 0.05f)
                drawPath(roundedHexPath(w - frame, hh - frame, r, frame / 2, frame / 2), t.fill, style = Stroke(width = frame))
            } else {
                drawPath(face, if (deep) t.lip else t.fill)
                if (tone != HexTone.Empty && tone != HexTone.Locked && size >= 56.dp) {
                    drawPath(
                        roundedHexPath(w * 0.66f, hh * 0.62f, r * 0.6f, w * 0.17f, hh * 0.13f),
                        shine,
                        style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round, pathEffect = PathEffect.dashPathEffect(floatArrayOf(w * 0.24f, 400f))),
                    )
                }
            }
        }
        if (text != null && bitmap == null) {
            Box(Modifier.size(size, h), contentAlignment = Alignment.Center) {
                KText(text, TeleTauText.headline.copy(fontSize = (size.value * 0.36f).sp), color = t.ink, align = TextAlign.Center)
            }
        }
    }
}

/** Ячейка сот: мёд (сделано), нектар (созревает), пустая. */
public enum class CombCell { Honey, Nectar, Empty }

/**
 * Соты (prototype comb): ряд ячеек зигзагом — квест класса, «Мой вклад в словарь», пройденные места. Если ряд шире
 * места — соты уменьшаются целиком. Декоративные: смысл передаёт текст рядом.
 */
@Composable
public fun HoneyComb(total: Int, filled: Int, modifier: Modifier = Modifier, nectar: Int = 0, perRow: Int = 12) {
    val n = total.coerceAtLeast(0)
    if (n == 0) return
    val colors = TeleTauTheme.colors
    val cols = minOf(perRow, n).coerceAtLeast(1)
    val rows = (n + cols - 1) / cols
    val cw = 30f
    val ch = 26f
    val step = cw - 6f
    val drop = ch / 2
    val rowH = ch + drop + 4f
    val width = cw + (cols - 1) * step
    val height = rows * rowH - 4f
    BoxWithConstraints(modifier.fillMaxWidth().clearAndSetSemantics {}) {
        val scale = minOf(1f, maxWidth.value / width)
        Canvas(Modifier.width((width * scale).dp).height((height * scale).dp)) {
            val k = 1.dp.toPx() * scale
            val stroke = 2f
            for (i in 0 until n) {
                val col = i % cols
                val row = i / cols
                val x = col * step
                val y = row * rowH + if (col % 2 == 1) drop else 0f
                val kind = when {
                    i < filled -> CombCell.Honey
                    i < filled + nectar -> CombCell.Nectar
                    else -> CombCell.Empty
                }
                val inset = if (kind == CombCell.Honey) 0f else stroke / 2
                val p = roundedHexPath((cw - inset * 2) * k, (ch - inset * 2) * k, 4f * k, (x + inset) * k, (y + inset) * k)
                when (kind) {
                    CombCell.Honey -> drawPath(p, colors.accentFill)
                    CombCell.Nectar -> {
                        drawPath(p, colors.accentFill.copy(alpha = 0.32f))
                        drawPath(p, colors.accentLip.copy(alpha = 0.55f), style = Stroke(stroke * k))
                    }
                    CombCell.Empty -> {
                        drawPath(p, colors.surface)
                        drawPath(p, colors.borderDefault, style = Stroke(stroke * k))
                    }
                }
            }
        }
    }
}
