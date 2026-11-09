package ru.teletau.core.designsystem

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.foundation.Image
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp

/**
 * Поверхность с «губой» (плитка, вариант, буква): граница и губа одного цвета, при нажатии лицо опускается на губу.
 * Как у кнопки — движение только у лица, цель нажатия неподвижна.
 */
@Composable
internal fun LippedSurface(
    onClick: (() -> Unit)?,
    face: Color,
    edge: Color,
    shape: Shape,
    modifier: Modifier = Modifier,
    lip: Dp = TeleTauSize.lipSmall,
    padding: PaddingValues = PaddingValues(0.dp),
    minHeight: Dp = TeleTauTheme.touchTarget,
    role: Role = Role.Button,
    contentAlignment: Alignment = Alignment.Center,
    content: @Composable BoxScope.() -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val sink by animateDpAsState(
        if (pressed && onClick != null) lip else 0.dp,
        tween(if (TeleTauTheme.reduceMotion) 0 else TeleTauDuration.PRESS),
        label = "LipSink",
    )
    Box(
        modifier
            .then(if (onClick != null) Modifier.clickable(interaction, indication = null, role = role, onClick = onClick) else Modifier)
            .padding(bottom = lip),
        propagateMinConstraints = true,
    ) {
        Box(Modifier.matchParentSize().offset(y = lip).background(edge, shape))
        Box(
            Modifier
                .defaultMinSize(minHeight = minHeight - lip)
                .offset { IntOffset(0, sink.roundToPx()) }
                .background(face, shape)
                .border(TeleTauSpace.s050, edge, shape)
                .padding(padding),
            contentAlignment = contentAlignment,
            content = content,
        )
    }
}

/** Оценка ответа после «Проверить»: верно — зелень, «почти» — мёд, неверно — коралл (всегда со значком или текстом). */
public enum class AnswerVerdict { Ok, Almost, Bad }

/** Лицо и граница поверхности по оценке; null — обычный вид. */
@Composable
internal fun verdictColors(verdict: AnswerVerdict?): Pair<Color, Color>? {
    val c = TeleTauTheme.colors
    return when (verdict) {
        AnswerVerdict.Ok -> c.successSoft to c.successFill
        AnswerVerdict.Almost -> c.accentSoft to c.accentFill
        AnswerVerdict.Bad -> c.dangerSoft to c.dangerFill
        null -> null
    }
}

/**
 * Плитка башкирского слова (prototype `.tile`). [used] — плитка уже в ответе: в банке остаётся след той же ширины
 * (воск без текста), чтобы банк не прыгал; след не нажимается и скрыт от TalkBack.
 */
@Composable
public fun WordTile(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, used: Boolean = false, enabled: Boolean = true, verdict: AnswerVerdict? = null) {
    val c = TeleTauTheme.colors
    val shape = RoundedCornerShape(TeleTauRadius.tile)
    val tileHeight = if (TeleTauTheme.uiMode == UiMode.Bee) 57.dp else 49.dp
    if (used) {
        Box(
            modifier
                .padding(bottom = TeleTauSize.lipSmall)
                .defaultMinSize(minHeight = tileHeight - TeleTauSize.lipSmall)
                .background(c.lockedFill, shape)
                .padding(horizontal = TeleTauSpace.s400, vertical = 9.dp)
                .clearAndSetSemantics {},
            contentAlignment = Alignment.Center,
        ) { KText(text, TeleTauText.bashkir(TeleTauFontSize.headline, TeleTauFontWeight.semibold), color = Color.Transparent) }
        return
    }
    val v = verdictColors(verdict)
    LippedSurface(
        onClick = if (enabled) onClick else null,
        face = v?.first ?: c.surface,
        edge = v?.second ?: c.borderDefault,
        shape = shape,
        modifier = modifier,
        padding = PaddingValues(horizontal = TeleTauSpace.s400, vertical = 9.dp),
        minHeight = tileHeight,
    ) { KText(text, TeleTauText.bashkir(TeleTauFontSize.headline, TeleTauFontWeight.semibold), color = if (verdict == AnswerVerdict.Ok) c.successText else if (verdict == AnswerVerdict.Bad) c.dangerText else c.textPrimary) }
}

/** Тон вариантов ответа: мёд — урок, фиолетовый — дуэль «Помоги языку». */
public enum class OptionTone { Honey, Violet }

/**
 * Вариант ответа (prototype `.option`, `.variant`): плитка с меткой-номером или буквой. Выбор — не только цветом:
 * темнее граница и губа, метка залита. Для TalkBack — радиокнопка с состоянием «выбрано».
 */
@Composable
public fun AnswerOption(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    mark: String? = null,
    tone: OptionTone = OptionTone.Honey,
    bashkir: Boolean = false,
    enabled: Boolean = true,
    verdict: AnswerVerdict? = null,
) {
    val c = TeleTauTheme.colors
    val violet = tone == OptionTone.Violet
    val v = verdictColors(verdict)
    val edge = when {
        selected && violet -> c.violetText
        selected -> c.accentText
        else -> c.borderDefault
    }
    val face = when {
        selected && violet -> c.violetSoft
        selected -> c.accentSoft
        else -> c.surface
    }
    LippedSurface(
        onClick = if (enabled) onClick else null,
        face = v?.first ?: face,
        edge = v?.second ?: edge,
        shape = RoundedCornerShape(if (violet) TeleTauRadius.panel else TeleTauRadius.button),
        modifier = modifier.fillMaxWidth().semantics {
            this.selected = selected
            if (verdict == AnswerVerdict.Ok) stateDescription = "верно" else if (verdict == AnswerVerdict.Bad) stateDescription = "неверно"
        },
        padding = PaddingValues(horizontal = TeleTauSpace.s400, vertical = if (violet) TeleTauSpace.s400 else TeleTauSpace.s350),
        role = Role.RadioButton,
        contentAlignment = Alignment.CenterStart,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s350), verticalAlignment = Alignment.CenterVertically) {
            if (verdict == AnswerVerdict.Ok || verdict == AnswerVerdict.Bad) {
                val ok = verdict == AnswerVerdict.Ok
                Box(
                    Modifier.size(30.dp).background(if (ok) c.successFill else c.dangerFill, RoundedCornerShape(TeleTauRadius.mark)),
                    contentAlignment = Alignment.Center,
                ) { Image(if (ok) PhosphorIcons.CheckBold else PhosphorIcons.XBold, null, Modifier.size(TeleTauSize.iconSmall), colorFilter = ColorFilter.tint(c.textOnFill)) }
            } else if (mark != null) {
                val markShape = RoundedCornerShape(TeleTauRadius.mark)
                val markBg = when {
                    violet && selected -> c.violetFill
                    violet -> c.violetSoft
                    selected -> c.accentFill
                    else -> Color.Transparent
                }
                val markInk = when {
                    violet && selected -> c.violetOn
                    violet -> c.violetText
                    selected -> c.accentOn
                    else -> c.textTertiary
                }
                Box(
                    Modifier
                        .size(if (violet) 34.dp else 30.dp)
                        .background(markBg, markShape)
                        .then(if (!violet) Modifier.border(TeleTauSpace.s050, if (selected) c.accentLip else c.borderDefault, markShape) else Modifier),
                    contentAlignment = Alignment.Center,
                ) { KText(mark, if (violet) TeleTauText.headline.copy(fontSize = TeleTauFontSize.body) else TeleTauText.label.copy(fontSize = TeleTauFontSize.footnote), color = markInk) }
            }
            val style = when {
                violet -> TeleTauText.bashkir(TeleTauFontSize.title3, TeleTauFontWeight.semibold)
                bashkir -> TeleTauText.bashkir(TeleTauFontSize.bodyLarge, TeleTauFontWeight.semibold)
                verdict == AnswerVerdict.Ok -> TeleTauText.bodyLarge.copy(fontWeight = TeleTauFontWeight.bold)
                else -> TeleTauText.bodyLarge
            }
            KText(text, style, color = when (verdict) { AnswerVerdict.Ok -> c.successText; AnswerVerdict.Bad -> c.dangerText; else -> c.textPrimary })
        }
    }
}

/** Короткая кнопка-чип под вариантами («Оба подходят», «Не знаю»). */
@Composable
public fun AnswerPill(text: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, tone: OptionTone = OptionTone.Violet, enabled: Boolean = true) {
    val c = TeleTauTheme.colors
    val shape = RoundedCornerShape(TeleTauRadius.chip)
    val edge = when {
        selected && tone == OptionTone.Violet -> c.violetText
        selected -> c.accentText
        else -> c.borderDefault
    }
    val bg = when {
        selected && tone == OptionTone.Violet -> c.violetSoft
        selected -> c.accentSoft
        else -> c.surface
    }
    val ink = when {
        selected && tone == OptionTone.Violet -> c.violetText
        selected -> c.accentText
        else -> c.textSecondary
    }
    Box(
        modifier
            .defaultMinSize(minHeight = TeleTauTheme.touchTarget)
            .background(bg, shape)
            .border(TeleTauSpace.s050, edge, shape)
            .clickable(enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .semantics { this.selected = selected }
            .padding(horizontal = TeleTauSpace.s400),
        contentAlignment = Alignment.Center,
    ) { KText(text, TeleTauText.label.copy(fontSize = TeleTauFontSize.footnote), color = ink) }
}

/**
 * Особые буквы башкирского алфавита в порядке прототипа — только правильные кодовые точки (CLAUDE.md, правило 7):
 * ә U+04D9, ө U+04E9, ү U+04AF, ғ U+0493, ҡ U+04A1, ң U+04A3, ҙ U+0499, ҫ U+04AB, һ U+04BB.
 */
public val BashkirLetters: List<String> = listOf("ә", "ө", "ү", "ғ", "ҡ", "ң", "ҙ", "ҫ", "һ")

/**
 * Панель башкирских букв (docs/05 §8, п. 2): без неё на телефоне без башкирской раскладки ребёнок не введёт ҡ, ғ, ҙ.
 * Девять кнопок в ряд, в «Пчёлке» — по пять в ряду (цели 56 dp).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
public fun LetterPanel(
    onInsert: (String) -> Unit,
    modifier: Modifier = Modifier,
    letters: List<String> = BashkirLetters,
    enabled: Boolean = true,
    hint: String? = null,
) {
    val c = TeleTauTheme.colors
    val bee = TeleTauTheme.uiMode == UiMode.Bee
    val perRow = if (bee) 5 else letters.size.coerceAtLeast(1)
    Column(modifier.fillMaxWidth().padding(top = TeleTauSpace.s300), horizontalAlignment = Alignment.CenterHorizontally) {
        letters.chunked(perRow).forEach { row ->
            Row(Modifier.fillMaxWidth().padding(bottom = TeleTauSpace.s150), horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s150)) {
                row.forEach { l ->
                    LippedSurface(
                        onClick = if (enabled) ({ onInsert(l) }) else null,
                        face = c.surface,
                        edge = c.borderDefault,
                        shape = RoundedCornerShape(TeleTauRadius.iconButton),
                        modifier = Modifier.weight(1f).semantics { contentDescription = "Буква $l" },
                        minHeight = if (bee) TeleTauSize.touchChild else 46.dp,
                    ) { KText(l, TeleTauText.bashkir(TeleTauFontSize.title3, TeleTauFontWeight.semibold), align = TextAlign.Center) }
                }
                repeat(perRow - row.size) { Box(Modifier.weight(1f)) }
            }
        }
        if (hint != null) KText(hint, TeleTauText.labelText, Modifier.padding(top = TeleTauSpace.s100), color = c.textTertiary, align = TextAlign.Center)
    }
}

/** Ряд плиток с переносом — банк и ответ упражнения «собери из плиток». */
@OptIn(ExperimentalLayoutApi::class)
@Composable
public fun TileFlow(modifier: Modifier = Modifier, center: Boolean = false, content: @Composable () -> Unit) {
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s200, if (center) Alignment.CenterHorizontally else Alignment.Start),
        verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s250),
    ) { content() }
}

/** Поверхность с «губой» для экранов (пары, своё содержимое): граница и губа — [edge], лицо — [face]. */
@Composable
public fun LippedSurfacePublic(
    onClick: (() -> Unit)?,
    face: Color,
    edge: Color,
    modifier: Modifier = Modifier,
    minHeight: Dp = TeleTauTheme.touchTarget,
    radius: Dp = TeleTauRadius.tile,
    lip: Dp = TeleTauSize.lipSmall,
    content: @Composable BoxScope.() -> Unit,
) {
    LippedSurface(onClick, face, edge, RoundedCornerShape(radius), modifier, lip = lip, minHeight = minHeight, contentAlignment = Alignment.CenterStart, content = content)
}
