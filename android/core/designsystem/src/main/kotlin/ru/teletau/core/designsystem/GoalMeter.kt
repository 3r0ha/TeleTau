package ru.teletau.core.designsystem

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em

/**
 * Цель дня (prototype `.goal`, packages/ui GoalMeter): сота наполняется мёдом по доле сделанного, рядом — «1 из 2 сот».
 * Выполнено — сота полная с галочкой. Для TalkBack — одна фраза «Цель дня: 1 из 2».
 */
@Composable
public fun GoalMeter(done: Int, target: Int, modifier: Modifier = Modifier, unit: String = "сот") {
    val c = TeleTauTheme.colors
    val shown = minOf(done, target)
    val share = if (target > 0) shown.toFloat() / target else 0f
    val met = target > 0 && done >= target
    Row(
        modifier.defaultMinSize(minHeight = TeleTauSize.touchMin)
            .semantics(mergeDescendants = true) { contentDescription = "Цель дня: $shown из $target" + if (met) ", выполнена" else "" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s150),
    ) {
        Canvas(Modifier.size(30.dp, 26.dp)) {
            val w = size.width
            val h = size.height
            val hex = roundedHexPath(w, h, 5.dp.toPx())
            drawPath(hex, c.lockedFill)
            if (share > 0f) clipPath(hex) { drawRect(c.accentFill, topLeft = Offset(0f, h * (1 - share)), size = Size(w, h * share)) }
            drawPath(roundedHexPath(w - 4.dp.toPx(), h - 4.dp.toPx(), 4.dp.toPx(), 2.dp.toPx(), 2.dp.toPx()), c.accentLip.copy(alpha = 0.5f), style = Stroke(2.dp.toPx()))
            if (met) {
                val k = w / 30f
                val check = Path().apply { moveTo(9.5f * k, 13.5f * k); lineTo(13.5f * k, 17.5f * k); lineTo(20.5f * k, 9.5f * k) }
                drawPath(check, c.accentOn, style = Stroke(2.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
        }
        Column(Modifier.clearAndSetSemantics {}) {
            val ink = if (met) c.accentText else c.textSecondary
            KText("$shown из $target", TeleTauText.label.copy(lineHeight = 1.1.em), color = ink)
            KText(unit, TeleTauText.label.copy(lineHeight = 1.1.em), color = ink)
        }
    }
}
