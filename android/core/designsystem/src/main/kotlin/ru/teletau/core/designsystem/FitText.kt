package ru.teletau.core.designsystem

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.Hyphens
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.isSpecified

/** Подобранный размер: во сколько раз уменьшить шрифт и нужен ли перенос по слогам. */
internal data class TextFit(val scale: Float, val hyphens: Boolean)

/** Шаг уменьшения шрифта. */
private const val FIT_STEP = 0.05f

/**
 * Слова, которые нельзя разорвать: части между пробелами и после дефиса («Шульган-» и «Таш» переносятся отдельно,
 * как делает сам перенос строк Android).
 */
internal fun unbreakableWords(text: String): List<String> =
    text.split(Regex("\\s+")).flatMap { w -> Regex("[^-]+-?|-").findAll(w).map { it.value }.toList() }.filter { it.isNotBlank() }

/**
 * Самый крупный шрифт (от 100 % вниз шагами по 5 %, не мельче [minScale]), при котором текст помещается в ширину
 * [maxWidth] и высоту [maxHeight] не больше чем в [maxLines] строк, а каждое слово — целиком на своей строке.
 * Не помещается и на [minScale] — переносим по слогам с дефисом.
 */
internal fun fitText(
    measurer: TextMeasurer,
    text: String,
    style: TextStyle,
    maxWidth: Int,
    maxHeight: Int,
    maxLines: Int,
    minScale: Float,
): TextFit {
    if (maxWidth == Constraints.Infinity || text.isBlank()) return TextFit(1f, false)
    val words = unbreakableWords(text)
    var scale = 1f
    while (true) {
        val s = scaled(style, scale)
        val wordsFit = words.all { w -> measurer.measure(AnnotatedString(w), s, softWrap = false, maxLines = 1).size.width <= maxWidth }
        if (wordsFit) {
            val layout = measure(measurer, text, s, maxWidth, Int.MAX_VALUE)
            if (layout.lineCount <= maxLines && (maxHeight == Constraints.Infinity || layout.size.height <= maxHeight)) return TextFit(scale, false)
        }
        if (scale - FIT_STEP < minScale - 0.001f) return TextFit(minScale, !wordsFit)
        scale -= FIT_STEP
    }
}

private fun measure(measurer: TextMeasurer, text: String, style: TextStyle, maxWidth: Int, maxLines: Int): TextLayoutResult =
    measurer.measure(AnnotatedString(text), style, constraints = Constraints(maxWidth = maxWidth), maxLines = maxLines)

private fun scaled(style: TextStyle, scale: Float): TextStyle {
    if (scale == 1f) return style.copy(lineBreak = LineBreak.Heading)
    val size: TextUnit = style.fontSize
    val line: TextUnit = style.lineHeight
    return style.copy(
        fontSize = if (size.isSpecified) size * scale else size,
        // Межстрочный в em масштабируется сам; в sp — вместе со шрифтом.
        lineHeight = if (line.isSpecified && line.isSp) line * scale else line,
        lineBreak = LineBreak.Heading,
    )
}

/**
 * Заголовок, который не рвёт слова посередине («башкирска / я»): переносится только между словами, ровными строками
 * (`LineBreak.Heading`); не помещается — шрифт ступенчато уменьшается до [minScale]; и только если слово не влезает
 * даже так — перенос по слогам с дефисом (`Hyphens.Auto`). Ширина и высота — из ограничений родителя
 * (и [maxHeight], если задана).
 */
@Composable
public fun FitText(
    text: String,
    style: TextStyle,
    modifier: Modifier = Modifier,
    color: Color = TeleTauTheme.colors.textPrimary,
    align: TextAlign? = null,
    maxLines: Int = 2,
    minScale: Float = 0.6f,
    maxHeight: Dp = Dp.Unspecified,
) {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val heightCap = maxHeight
    BoxWithConstraints(modifier) {
        val w = constraints.maxWidth
        val limit = if (heightCap.isSpecified) with(density) { heightCap.roundToPx() } else Constraints.Infinity
        val h = minOf(constraints.maxHeight, limit)
        val fit = remember(text, style, w, h, maxLines, minScale, density.density, density.fontScale) {
            fitText(measurer, text, style, w, h, maxLines, minScale)
        }
        val base = scaled(style, fit.scale)
        BasicText(
            text = text,
            style = base.copy(
                color = color,
                textAlign = align ?: style.textAlign,
                hyphens = if (fit.hyphens) Hyphens.Auto else Hyphens.None,
            ),
            maxLines = maxLines,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Стиль, уменьшенный в [scale] раз (шрифт и межстрочный в sp), с переносом строк для заголовков. */
public fun TextStyle.scaledBy(scale: Float): TextStyle = scaled(this, scale)

/**
 * Общий масштаб шрифта (от 100 % вниз шагами по 5 %, не мельче [minScale]) для нескольких строк, стоящих друг под
 * другом в рамке [maxWidth]×[maxHeight] (вывеска места): каждое слово целиком, не больше [maxLines] строк у каждой
 * надписи, вместе с [extraHeight] (плашки и отступы) — не выше рамки. null — не помещается даже так.
 */
public fun fitBlock(
    measurer: TextMeasurer,
    items: List<Pair<String, TextStyle>>,
    maxWidth: Int,
    maxHeight: Int,
    extraHeight: Int = 0,
    maxLines: Int = 2,
    minScale: Float = 0.7f,
): Float? {
    var scale = 1f
    while (scale >= minScale - 0.001f) {
        var height = extraHeight
        val ok = items.all { (text, style) ->
            val s = scaled(style, scale)
            val wordsFit = unbreakableWords(text).all { w -> measurer.measure(AnnotatedString(w), s, softWrap = false, maxLines = 1).size.width <= maxWidth }
            if (!wordsFit) return@all false
            val layout = measure(measurer, text, s, maxWidth, Int.MAX_VALUE)
            height += layout.size.height
            layout.lineCount <= maxLines
        }
        if (ok && height <= maxHeight) return scale
        scale -= FIT_STEP
    }
    return null
}
