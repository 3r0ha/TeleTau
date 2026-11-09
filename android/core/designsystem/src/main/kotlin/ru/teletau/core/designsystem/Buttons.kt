package ru.teletau.core.designsystem

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp

/** Вид кнопки (prototype v2 `.btn`): мёд — главное действие, остальные — по смыслу. */
public enum class ButtonVariant { Primary, Secondary, Success, Danger, Violet }

private class ButtonLook(val face: Color, val lip: Color, val ink: Color, val edge: Color?)

@Composable
private fun lookOf(variant: ButtonVariant, enabled: Boolean): ButtonLook {
    val c = TeleTauTheme.colors
    if (!enabled) return ButtonLook(c.lockedFill, c.lockedLip, c.lockedText, null)
    return when (variant) {
        ButtonVariant.Primary -> ButtonLook(c.accentFill, c.accentLip, c.accentOn, null)
        ButtonVariant.Secondary -> ButtonLook(c.surface, c.borderDefault, c.accentText, c.borderDefault)
        ButtonVariant.Success -> ButtonLook(c.successFill, c.successLip, c.textOnFill, null)
        ButtonVariant.Danger -> ButtonLook(c.dangerFill, c.dangerLip, c.textOnFill, null)
        ButtonVariant.Violet -> ButtonLook(c.violetFill, c.violetLip, c.violetOn, null)
    }
}

/**
 * Кнопка «Борть»: лицевая часть, под ней «губа» глубоким цветом. Высота — не меньше [TeleTauTheme.buttonHeight]
 * (56 dp в «Пчёлке»), губа входит в цель нажатия. При нажатии лицевая часть опускается на губу за
 * [TeleTauDuration.PRESS]. Неактивная — воск. [loading] — крутится индикатор, повторное нажатие не уходит.
 */
@Composable
public fun TeleTauButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.Primary,
    enabled: Boolean = true,
    loading: Boolean = false,
    icon: ImageVector? = null,
) {
    val look = lookOf(variant, enabled)
    val shape = RoundedCornerShape(TeleTauRadius.button)
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val active = enabled && !loading
    val sink by animateDpAsState(
        targetValue = if (pressed && active) TeleTauSize.lip else 0.dp,
        animationSpec = tween(durationMillis = if (TeleTauTheme.reduceMotion) 0 else TeleTauDuration.PRESS),
        label = "ButtonSink",
    )
    Box(
        modifier = modifier
            .defaultMinSize(minWidth = TeleTauTheme.touchTarget)
            .semantics(mergeDescendants = true) { if (loading) stateDescription = "Подождите" }
            .clickable(interactionSource = interaction, indication = null, enabled = active, role = Role.Button, onClick = onClick)
            .padding(bottom = TeleTauSize.lip),
        propagateMinConstraints = true,
    ) {
        Box(
            Modifier
                .matchParentSize()
                .offset(y = TeleTauSize.lip)
                .background(look.lip, shape),
        )
        Box(
            modifier = Modifier
                .defaultMinSize(minHeight = TeleTauTheme.buttonHeight)
                .offset { IntOffset(0, sink.roundToPx()) }
                .background(look.face, shape)
                .then(if (look.edge != null) Modifier.border(TeleTauSpace.s050, look.edge, shape) else Modifier)
                .padding(horizontal = TeleTauSpace.s500, vertical = TeleTauSpace.s250),
            contentAlignment = Alignment.Center,
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s200), verticalAlignment = Alignment.CenterVertically) {
                if (loading) {
                    Spinner(look.ink)
                } else if (icon != null) {
                    Image(icon, contentDescription = null, modifier = Modifier.size(TeleTauSize.iconSmall), colorFilter = ColorFilter.tint(look.ink))
                }
                BasicText(text = text, style = TeleTauText.button.copy(color = look.ink, textAlign = TextAlign.Center))
            }
        }
    }
}

/** Главная кнопка экрана — [TeleTauButton] вида [ButtonVariant.Primary]. */
@Composable
public fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    TeleTauButton(text = text, onClick = onClick, modifier = modifier, enabled = enabled)
}

@Composable
private fun Spinner(color: Color) {
    val angle = if (TeleTauTheme.reduceMotion) {
        0f
    } else {
        val t = rememberInfiniteTransition(label = "Spinner")
        val a by t.animateFloat(0f, 360f, infiniteRepeatable(tween(TeleTauDuration.SPIN, easing = LinearEasing), RepeatMode.Restart), label = "SpinnerAngle")
        a
    }
    Canvas(Modifier.size(TeleTauSize.iconSmall).rotate(angle)) {
        drawArc(color, startAngle = 0f, sweepAngle = 270f, useCenter = false, style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round))
    }
}

/** Тон текстовой кнопки (prototype `.link-btn`). */
public enum class LinkTone { Accent, Neutral, Danger }

/** Текстовая кнопка: второстепенное действие («Выйти из урока», «Другие варианты»). Цель нажатия — как у кнопки. */
@Composable
public fun LinkButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tone: LinkTone = LinkTone.Accent,
    icon: ImageVector? = null,
    enabled: Boolean = true,
) {
    val c = TeleTauTheme.colors
    val ink = when {
        !enabled -> c.lockedText
        tone == LinkTone.Danger -> c.dangerText
        tone == LinkTone.Neutral -> c.textSecondary
        else -> c.accentText
    }
    Row(
        modifier = modifier
            .defaultMinSize(minHeight = TeleTauTheme.touchTarget, minWidth = TeleTauTheme.touchTarget)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = TeleTauSpace.s300),
        horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s150, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) Image(icon, null, Modifier.size(TeleTauSize.iconSmall), colorFilter = ColorFilter.tint(ink))
        BasicText(text, style = TeleTauText.button.copy(color = ink, fontSize = TeleTauFontSize.callout, textAlign = TextAlign.Center))
    }
}

/** Кнопка-значок (крестик урока, «назад»): цель нажатия не меньше [TeleTauTheme.touchTarget], подпись — для TalkBack. */
@Composable
public fun TeleTauIconButton(icon: ImageVector, label: String, onClick: () -> Unit, modifier: Modifier = Modifier, tint: Color = TeleTauTheme.colors.textSecondary) {
    Box(
        modifier = modifier
            .size(TeleTauTheme.touchTarget)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Image(icon, contentDescription = null, modifier = Modifier.size(TeleTauSize.iconLarge), colorFilter = ColorFilter.tint(tint))
    }
}

/**
 * Выключатель (веб `.switch`): дорожка — серая или зелёная, ручка скользит с пружиной. Подпись — рядом, в строке;
 * TalkBack читает его как переключатель с этой подписью ([label]).
 */
@Composable
public fun TeleTauSwitch(checked: Boolean, onCheckedChange: (Boolean) -> Unit, label: String, modifier: Modifier = Modifier) {
    val c = TeleTauTheme.colors
    val knob by animateDpAsState(
        if (checked) 24.dp else 0.dp,
        if (TeleTauTheme.reduceMotion) androidx.compose.animation.core.snap() else androidx.compose.animation.core.spring(dampingRatio = 0.6f, stiffness = 700f),
        label = "SwitchKnob",
    )
    val trackShape = RoundedCornerShape(TeleTauRadius.chip)
    Box(
        modifier
            .size(60.dp, TeleTauSize.touchMin)
            .toggleable(
                value = checked,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                role = Role.Switch,
                onValueChange = onCheckedChange,
            )
            .semantics { contentDescription = label },
        contentAlignment = Alignment.CenterStart,
    ) {
        Box(
            Modifier.padding(horizontal = 2.dp).size(56.dp, 32.dp)
                .background(if (checked) c.successFill else c.lockedFill, trackShape)
                .border(TeleTauSpace.s050, if (checked) c.successLip else c.borderStrong, trackShape),
        )
        Box(
            Modifier.offset(x = 7.dp + knob, y = (-1).dp).size(22.dp)
                .background(if (checked) c.successLip else c.borderStrong, trackShape)
                .padding(bottom = 2.dp)
                .background(c.surface, trackShape),
        )
    }
}
