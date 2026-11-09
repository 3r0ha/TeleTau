package ru.teletau.core.designsystem

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import kotlin.math.hypot

/**
 * Скруглённый шестиугольник с плоским верхом, вписанный в прямоугольник w×h, — узлы тропы, аватары, соты
 * (порт `hexPath` из packages/ui/src/hex.ts: те же вершины и скругления квадратичными кривыми).
 */
public fun roundedHexPath(w: Float, h: Float, r: Float, ox: Float = 0f, oy: Float = 0f): Path {
    val points = listOf(
        Offset(w * 0.25f, 0f), Offset(w * 0.75f, 0f), Offset(w, h / 2f),
        Offset(w * 0.75f, h), Offset(w * 0.25f, h), Offset(0f, h / 2f),
    ).map { Offset(it.x + ox, it.y + oy) }
    fun toward(a: Offset, b: Offset): Offset {
        val dx = b.x - a.x
        val dy = b.y - a.y
        val len = hypot(dx, dy)
        return Offset(a.x + dx / len * r, a.y + dy / len * r)
    }
    return Path().apply {
        points.forEachIndexed { i, v ->
            val a = toward(v, points[(i + 5) % 6])
            val b = toward(v, points[(i + 1) % 6])
            if (i == 0) moveTo(a.x, a.y) else lineTo(a.x, a.y)
            quadraticTo(v.x, v.y, b.x, b.y)
        }
        close()
    }
}

/** Форма-шестиугольник с плоским верхом и скруглением [radius] (обрезка картинок аватара, подложки). */
public class RoundedHexShape(private val radius: Dp) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline =
        Outline.Generic(roundedHexPath(size.width, size.height, with(density) { radius.toPx() }))
}
