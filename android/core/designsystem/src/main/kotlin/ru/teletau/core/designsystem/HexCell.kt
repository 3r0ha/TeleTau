package ru.teletau.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.shape.GenericShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/** Отношение ширины шестиугольника с вершиной сверху к его высоте: √3 / 2. */
public val HexCellAspectRatio: Float = sqrt(3f) / 2f

/**
 * Шестиугольник «Борть» — модуль сетки и формы (docs/05-design-system.md §2).
 * Правильный, с вершиной сверху, вписан в отведённый прямоугольник с сохранением пропорций.
 */
public val HexagonShape: Shape = GenericShape { size, _ ->
    val radius = min(size.height, size.width / HexCellAspectRatio) / 2f
    val cx = size.width / 2f
    val cy = size.height / 2f
    for (index in 0 until 6) {
        // От верхней вершины по часовой стрелке через каждые 60°.
        val angle = index * PI / 3 - PI / 2
        val x = cx + radius * cos(angle).toFloat()
        val y = cy + radius * sin(angle).toFloat()
        if (index == 0) moveTo(x, y) else lineTo(x, y)
    }
    close()
}

/**
 * Ячейка сот. Пока только состояние «мёд» (заливка); остальные состояния из §5
 * (пустая, нектар, созревает, запечатана, отклонена) появятся вместе с экранами миссий.
 *
 * Размер задаёт [modifier] (обычно высота): ширина вычисляется по пропорции шестиугольника.
 *
 * @param contentDescription описание для TalkBack — ячейка несёт смысл, а не декорация.
 * @param fill заливка; по умолчанию медовая `accentFill`.
 */
@Composable
public fun HexCell(
    contentDescription: String,
    modifier: Modifier = Modifier,
    fill: Color = TeleTauTheme.colors.accentFill,
) {
    Box(
        modifier = modifier
            .aspectRatio(HexCellAspectRatio, matchHeightConstraintsFirst = true)
            .clip(HexagonShape)
            .background(fill)
            .semantics {
                this.contentDescription = contentDescription
                role = Role.Image
            },
    )
}
