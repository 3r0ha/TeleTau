package ru.teletau.core.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Текст с цветом из темы — короткая запись для экранов. */
@Composable
public fun KText(
    text: String,
    style: TextStyle,
    modifier: Modifier = Modifier,
    color: Color = TeleTauTheme.colors.textPrimary,
    align: TextAlign? = null,
    maxLines: Int = Int.MAX_VALUE,
) {
    BasicText(text = text, modifier = modifier, style = style.copy(color = color, textAlign = align ?: style.textAlign), maxLines = maxLines)
}

/**
 * Заголовок экрана или раздела — для TalkBack помечен как заголовок. Слова не рвутся посередине: длинное слово, которое
 * не помещается в ширину (узкий экран, крупный шрифт), уменьшает шрифт ([FitText]).
 */
@Composable
public fun KHeading(text: String, style: TextStyle = TeleTauText.title2, modifier: Modifier = Modifier, color: Color = TeleTauTheme.colors.textPrimary, align: TextAlign? = null) {
    FitText(text, style, modifier.semantics(mergeDescendants = true) { heading() }, color, align, maxLines = Int.MAX_VALUE)
}

/** Карточка (prototype `.card`): поверхность, граница 2 dp `borderSubtle`, радиус карточки. */
@Composable
public fun TeleTauCard(
    modifier: Modifier = Modifier,
    padding: PaddingValues = PaddingValues(TeleTauSpace.s400),
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(TeleTauRadius.card)
    Column(
        modifier = modifier
            .background(TeleTauTheme.colors.surface, shape)
            .border(TeleTauSpace.s050, TeleTauTheme.colors.borderSubtle, shape)
            .padding(padding),
        content = content,
    )
}

/** Тон чипа (prototype `.chip`). */
public enum class ChipTone { Honey, Green, Water, Coral, Violet, Neutral, Solid }

/** Чип-метка: «Новое слово», «Помоги языку», «Квест выполнен». */
@Composable
public fun TeleTauChip(text: String, modifier: Modifier = Modifier, tone: ChipTone = ChipTone.Honey, icon: ImageVector? = null) {
    val c = TeleTauTheme.colors
    val (bg, ink) = when (tone) {
        ChipTone.Honey -> c.accentSoft to c.accentText
        ChipTone.Green -> c.successSoft to c.successText
        ChipTone.Water -> c.infoSoft to c.infoText
        ChipTone.Coral -> c.dangerSoft to c.dangerText
        ChipTone.Violet -> c.violetSoft to c.violetText
        ChipTone.Neutral -> c.bgSunken to c.textSecondary
        ChipTone.Solid -> c.accentFill to c.accentOn
    }
    val shape = RoundedCornerShape(TeleTauRadius.chip)
    Row(
        modifier = modifier
            .background(bg, shape)
            .then(if (tone == ChipTone.Neutral) Modifier.border(TeleTauSpace.s050, c.borderSubtle, shape) else Modifier)
            .padding(horizontal = TeleTauSpace.s300, vertical = TeleTauSpace.s150),
        horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s150),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) Image(icon, null, Modifier.size(TeleTauSpace.s400), colorFilter = ColorFilter.tint(ink))
        KText(text, TeleTauText.label, color = ink)
    }
}

/**
 * Прогресс (prototype `.progress`): дорожка из воска, медовая заливка с «губой» и бликом. [valueText] — подпись справа
 * и для TalkBack («4 из 8»).
 */
@Composable
public fun TeleTauProgressBar(
    value: Int,
    max: Int,
    modifier: Modifier = Modifier,
    label: String,
    valueText: String,
    showValue: Boolean = false,
) {
    val c = TeleTauTheme.colors
    val fraction = if (max > 0) (value.toFloat() / max).coerceIn(0f, 1f) else 0f
    Row(
        modifier = modifier.semantics(mergeDescendants = true) {
            contentDescription = label
            stateDescription = valueText
            progressBarRangeInfo = ProgressBarRangeInfo(value.toFloat(), 0f..max.coerceAtLeast(1).toFloat())
        },
        horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s250),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Canvas(Modifier.weight(1f).height(TeleTauSize.progress)) {
            val r = CornerRadius(size.height / 2, size.height / 2)
            drawRoundRect(c.lockedFill, cornerRadius = r)
            if (fraction > 0f) {
                val w = (size.width * fraction).coerceAtLeast(size.height)
                drawRoundRect(c.accentLip, size = Size(w, size.height), cornerRadius = r)
                drawRoundRect(c.accentFill, size = Size(w, size.height - 3.dp.toPx()), cornerRadius = r)
                val inset = TeleTauSpace.s200.toPx()
                if (w > inset * 2) {
                    drawRoundRect(
                        c.highlight.copy(alpha = 0.45f),
                        topLeft = Offset(inset, 3.dp.toPx()),
                        size = Size(w - inset * 2, 3.dp.toPx()),
                        cornerRadius = CornerRadius(2.dp.toPx(), 2.dp.toPx()),
                    )
                }
            }
        }
        if (showValue) KText(valueText, TeleTauText.label.copy(fontSize = TeleTauFontSize.footnote), color = c.textSecondary)
    }
}

/** Пустое состояние, ошибка, офлайн (prototype `.full`): картинка серии, заголовок, короткий текст, действия. */
@Composable
public fun EmptyState(
    @DrawableRes art: Int,
    title: String,
    modifier: Modifier = Modifier,
    text: String? = null,
    compact: Boolean = false,
    alert: Boolean = false,
    richText: androidx.compose.ui.text.AnnotatedString? = null,
    actions: (@Composable ColumnScope.() -> Unit)? = null,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = TeleTauSpace.s500, vertical = TeleTauSpace.s800)
            .then(if (alert) Modifier.semantics { liveRegion = LiveRegionMode.Polite } else Modifier),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s200),
    ) {
        Illustration(art, if (compact) 160.dp else 220.dp, Modifier.padding(bottom = TeleTauSpace.s250))
        KHeading(title, if (compact) TeleTauText.title3 else TeleTauText.title1, align = TextAlign.Center)
        if (text != null || richText != null) {
            BasicText(
                richText ?: androidx.compose.ui.text.AnnotatedString(text.orEmpty()),
                Modifier.widthIn(max = 360.dp).padding(bottom = TeleTauSpace.s400),
                style = TeleTauText.body.copy(color = TeleTauTheme.colors.textSecondary, textAlign = TextAlign.Center),
            )
        }
        if (actions != null) {
            Column(Modifier.widthIn(max = 360.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s100), horizontalAlignment = Alignment.CenterHorizontally, content = actions)
        }
    }
}

/** Плитка-статистика (prototype `.stile`): медовая шапка с названием и крупное значение. */
@Composable
public fun StatTile(label: String, value: String, modifier: Modifier = Modifier, icon: ImageVector? = null) {
    val c = TeleTauTheme.colors
    val shape = RoundedCornerShape(TeleTauRadius.button)
    Column(
        modifier = modifier
            .border(TeleTauSpace.s050, c.accentFill, shape)
            .background(c.surface, shape)
            .semantics(mergeDescendants = true) {},
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.fillMaxWidth().background(c.accentFill, RoundedCornerShape(topStart = TeleTauRadius.button, topEnd = TeleTauRadius.button))
                .padding(vertical = TeleTauSpace.s150, horizontal = TeleTauSpace.s100),
            contentAlignment = Alignment.Center,
        ) { FitText(label.uppercase(), TeleTauText.caption, color = c.accentOn, align = TextAlign.Center, maxLines = 1, minScale = 0.5f) }
        Row(
            Modifier.padding(vertical = TeleTauSpace.s300, horizontal = TeleTauSpace.s100),
            horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s100),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (icon != null) Image(icon, null, Modifier.size(TeleTauSize.iconSmall), colorFilter = ColorFilter.tint(c.accentFill))
            FitText(value, TeleTauText.title3, maxLines = 1, minScale = 0.5f)
        }
    }
}

/** Скелетон загрузки: блок утопленного цвета, мягко «дышит» (без движения при «Убрать анимацию»). */
@Composable
public fun SkeletonBlock(modifier: Modifier = Modifier, width: Dp? = null, height: Dp, radius: Dp = TeleTauRadius.small) {
    val a = if (TeleTauTheme.reduceMotion) {
        1f
    } else {
        val t = rememberInfiniteTransition(label = "Skeleton")
        val v by t.animateFloat(1f, 0.55f, infiniteRepeatable(tween(TeleTauDuration.SHIMMER / 2, easing = TeleTauEasing.inOut), RepeatMode.Reverse), label = "SkeletonAlpha")
        v
    }
    Box(
        (if (width != null) modifier.width(width) else modifier.fillMaxWidth())
            .height(height)
            .alpha(a)
            .background(TeleTauTheme.colors.lockedFill, RoundedCornerShape(radius)),
    )
}

/** Загрузка блока: несколько полос-скелетонов и подпись для TalkBack («Открываем тропу»). */
@Composable
public fun LoadingBlock(label: String, modifier: Modifier = Modifier, rows: Int = 3) {
    Column(
        modifier.fillMaxWidth().padding(vertical = TeleTauSpace.s600).semantics(mergeDescendants = true) { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s300),
    ) {
        SkeletonBlock(height = 176.dp, radius = TeleTauRadius.card)
        repeat(rows) { SkeletonBlock(height = TeleTauSpace.s1200, radius = TeleTauRadius.button) }
    }
}

/** Тон встроенного сообщения. */
public enum class AlertTone { Honey, Danger }

/** Встроенное сообщение (prototype `.alert`): «Карточка найдена — входим…», ошибки форм. Объявляется TalkBack. */
@Composable
public fun InlineAlert(text: String, modifier: Modifier = Modifier, tone: AlertTone = AlertTone.Honey) {
    val c = TeleTauTheme.colors
    val (bg, edge) = if (tone == AlertTone.Danger) c.dangerSoft to c.dangerText else c.accentSoft to c.accentSoftBorder
    val shape = RoundedCornerShape(TeleTauRadius.button)
    Box(
        modifier
            .fillMaxWidth()
            .background(bg, shape)
            .border(TeleTauSpace.s050, edge.copy(alpha = if (tone == AlertTone.Danger) 0.35f else 1f), shape)
            .padding(horizontal = TeleTauSpace.s400, vertical = TeleTauSpace.s300)
            .semantics { liveRegion = LiveRegionMode.Polite },
    ) { KText(text, TeleTauText.callout, color = if (tone == AlertTone.Danger) c.dangerText else c.textPrimary) }
}

/** Верхняя панель простого экрана: «назад» и название. */
@Composable
public fun SimpleTopBar(title: String, modifier: Modifier = Modifier, onBack: (() -> Unit)? = null, end: (@Composable () -> Unit)? = null) {
    Row(
        modifier.fillMaxWidth().heightIn(min = TeleTauSize.touchChild).padding(horizontal = TeleTauSpace.s100),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) TeleTauIconButton(PhosphorIcons.ArrowLeftBold, "Назад", onBack) else Spacer(Modifier.width(TeleTauSpace.s300))
        KText(title, TeleTauText.headline, Modifier.weight(1f), maxLines = 1)
        if (end != null) end()
    }
}
