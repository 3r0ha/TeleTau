package ru.teletau.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.intl.LocaleList
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview

/** Башкирский: шрифты с `locl BSH` выбирают башкирские начертания Ҫ и Ҙ. */
private val Bashkir = LocaleList("ba")

/**
 * Стартовый экран-проверка: токены «Борть», обе темы и башкирские глифы.
 *
 * В приложении не показывается: старт ученика — WelcomeScreen в :feature:student.
 * Текст здесь системный, кнопка — Nunito (TeleTauText.button). Все цвета и размеры —
 * из `TeleTauTokens.generated.kt`. Размеры текста в `sp` следуют системному масштабу шрифта,
 * а содержимое прокручивается, поэтому крупный шрифт (до 200 %) не обрезает вёрстку.
 * Фон уходит под системные панели (edge-to-edge), содержимое — внутри безопасной зоны.
 */
@Composable
public fun StartScreen(
    modifier: Modifier = Modifier,
    onStart: () -> Unit = {},
) {
    val colors = TeleTauTheme.colors
    BoxWithConstraints(
        modifier = modifier
            .fillMaxSize()
            .background(colors.bg)
            .windowInsetsPadding(WindowInsets.safeDrawing),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .heightIn(min = maxHeight)
                .padding(horizontal = TeleTauSpace.s600, vertical = TeleTauSpace.s800),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s600),
        ) {
            Header()
            Spacer(Modifier.weight(1f))
            HoneyCell()
            GlyphCard()
            Spacer(Modifier.weight(1f))
            PrimaryButton(
                text = stringResource(R.string.teletau_start_action),
                onClick = onStart,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun Header() {
    val colors = TeleTauTheme.colors
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s200),
    ) {
        BasicText(
            text = stringResource(R.string.teletau_start_brand),
            modifier = Modifier.semantics { heading() },
            style = TextStyle(
                color = colors.textPrimary,
                fontSize = TeleTauFontSize.title1,
                fontWeight = TeleTauFontWeight.black,
                textAlign = TextAlign.Center,
                localeList = Bashkir,
            ),
        )
        BasicText(
            text = stringResource(R.string.teletau_start_subtitle),
            style = TextStyle(
                color = colors.textSecondary,
                fontSize = TeleTauFontSize.bodyLarge,
                textAlign = TextAlign.Center,
            ),
        )
    }
}

/** Медовая ячейка с «губой», как у кнопки: тот же шестиугольник глубоким мёдом, сдвинутый вниз. */
@Composable
private fun HoneyCell() {
    Box {
        Box(
            Modifier
                .matchParentSize()
                .offset(y = TeleTauSize.lip)
                .background(TeleTauTheme.colors.accentLip, HexagonShape),
        )
        HexCell(
            contentDescription = stringResource(R.string.teletau_start_hex_label),
            modifier = Modifier.height(TeleTauSpace.s1600 * 2),
        )
    }
}

@Composable
private fun GlyphCard() {
    val colors = TeleTauTheme.colors
    val shape = RoundedCornerShape(TeleTauRadius.card)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.surface, shape)
            // Толщина границы карточки — 2 dp (прототип v2); отдельного токена толщины нет, берём шаг s050.
            .border(TeleTauSpace.s050, colors.borderSubtle, shape)
            .padding(TeleTauSpace.s400)
            // TalkBack читает подпись и буквы одним элементом.
            .semantics(mergeDescendants = true) {},
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s200),
    ) {
        BasicText(
            text = stringResource(R.string.teletau_start_glyph_caption),
            style = TextStyle(
                color = colors.textSecondary,
                fontSize = TeleTauFontSize.footnote,
                fontWeight = TeleTauFontWeight.semibold,
                textAlign = TextAlign.Center,
            ),
        )
        BasicText(
            text = stringResource(R.string.teletau_start_glyph_line),
            style = TextStyle(
                color = colors.textPrimary,
                fontSize = TeleTauFontSize.title3,
                textAlign = TextAlign.Center,
                localeList = Bashkir,
            ),
        )
    }
}

@Preview(name = "Светлая", showBackground = true)
@Composable
private fun StartScreenLightPreview() {
    TeleTauTheme(darkTheme = false) { StartScreen() }
}

@Preview(name = "Тёмная", showBackground = true)
@Composable
private fun StartScreenDarkPreview() {
    TeleTauTheme(darkTheme = true) { StartScreen() }
}

@Preview(name = "Шрифт 200 %", fontScale = 2f, showBackground = true)
@Composable
private fun StartScreenLargeFontPreview() {
    TeleTauTheme(darkTheme = false) { StartScreen() }
}
