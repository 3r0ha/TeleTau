package ru.teletau.core.designsystem

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp

/** Крупная — в карточке слова; малая — в строке словаря и в листе ответа. */
public enum class SpeakSize { Large, Small }

/**
 * «Послушать» (prototype `.speak`): медовая кнопка со значком динамика — запись носителя. Пока звучит, значок
 * «пульсирует» (без движения при «Убрать анимацию»). Ошибки воспроизведения ребёнку не показываются.
 */
@Composable
public fun SpeakButton(
    playing: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: SpeakSize = SpeakSize.Large,
    label: String = "Послушать",
) {
    val c = TeleTauTheme.colors
    val pulse = if (playing && !TeleTauTheme.reduceMotion) {
        val t = rememberInfiniteTransition(label = "Speak")
        val v by t.animateFloat(1f, 1.18f, infiniteRepeatable(tween(TeleTauDuration.BREATH / 2, easing = TeleTauEasing.inOut), RepeatMode.Reverse), label = "SpeakPulse")
        v
    } else {
        1f
    }
    val semantics = Modifier.semantics {
        contentDescription = label
        if (playing) stateDescription = "Звучит"
    }
    if (size == SpeakSize.Large) {
        LippedSurface(
            onClick = onClick,
            face = c.accentFill,
            edge = c.accentLip,
            shape = RoundedCornerShape(TeleTauRadius.iconButton),
            modifier = modifier.size(48.dp, 48.dp + TeleTauSize.lipSmall).then(semantics),
            minHeight = 48.dp + TeleTauSize.lipSmall,
        ) {
            Image(PhosphorIcons.SpeakerHighFill, null, Modifier.size(TeleTauSize.iconLarge).graphicsLayer { scaleX = pulse; scaleY = pulse }, colorFilter = ColorFilter.tint(c.accentOn))
        }
    } else {
        Box(
            modifier
                .size(TeleTauTheme.touchTarget)
                .background(c.accentSoft, RoundedCornerShape(TeleTauRadius.iconButton))
                .clickable(role = Role.Button, onClick = onClick)
                .then(semantics),
            contentAlignment = Alignment.Center,
        ) {
            Image(PhosphorIcons.SpeakerHighFill, null, Modifier.size(TeleTauSize.icon).graphicsLayer { scaleX = pulse; scaleY = pulse }, colorFilter = ColorFilter.tint(c.accentText))
        }
    }
}
