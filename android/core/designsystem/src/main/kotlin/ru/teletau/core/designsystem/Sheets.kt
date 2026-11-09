package ru.teletau.core.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/** Тон листа обратной связи: верно, неверно, «почти» (не та буква), голос в дуэли учтён. */
public enum class FeedbackTone { Ok, Bad, Almost, Voted }

/**
 * Лист обратной связи под упражнением (prototype `.sheet`): поднимается на место кнопки «Проверить». Цвет — вместе
 * со значком и заголовком (статус не передаётся одним цветом). TalkBack объявляет вердикт (live region).
 */
@Composable
public fun FeedbackSheet(
    tone: FeedbackTone,
    title: String,
    actionLabel: String,
    onAction: () -> Unit,
    modifier: Modifier = Modifier,
    @DrawableRes art: Int? = null,
    titleExtra: (@Composable () -> Unit)? = null,
    body: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val c = TeleTauTheme.colors
    val (bg, ink) = when (tone) {
        FeedbackTone.Ok -> c.successSoft to c.successText
        FeedbackTone.Bad -> c.dangerSoft to c.dangerText
        FeedbackTone.Almost -> c.accentSoft to c.accentText
        FeedbackTone.Voted -> c.violetSoft to c.violetText
    }
    val variant = when (tone) {
        FeedbackTone.Ok -> ButtonVariant.Success
        FeedbackTone.Bad -> ButtonVariant.Danger
        FeedbackTone.Almost -> ButtonVariant.Primary
        FeedbackTone.Voted -> ButtonVariant.Violet
    }
    val icon = when (tone) {
        FeedbackTone.Ok -> PhosphorIcons.CheckBold
        FeedbackTone.Bad -> PhosphorIcons.XBold
        FeedbackTone.Almost -> PhosphorIcons.LightbulbBold
        FeedbackTone.Voted -> null
    }
    Column(
        modifier
            .fillMaxWidth()
            .background(bg)
            .windowInsetsPadding(WindowInsets.navigationBars)
            .padding(start = TeleTauSpace.s400, end = TeleTauSpace.s400, top = TeleTauSpace.s450, bottom = TeleTauSpace.s450),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.widthIn(max = TeleTauSize.columnNarrow).fillMaxWidth()) {
            val text: @Composable ColumnScope.() -> Unit = {
                Row(
                    Modifier.fillMaxWidth().padding(bottom = TeleTauSpace.s200).semantics { liveRegion = LiveRegionMode.Polite },
                    horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s250),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (art == null && icon != null) {
                        Box(Modifier.size(34.dp).background(c.surface, CircleShape), contentAlignment = Alignment.Center) {
                            Image(icon, null, Modifier.size(TeleTauSize.iconSmall), colorFilter = ColorFilter.tint(ink))
                        }
                    }
                    KHeading(title, TeleTauText.title3, Modifier.weight(1f, fill = false), color = ink)
                    if (titleExtra != null) { androidx.compose.foundation.layout.Spacer(Modifier.weight(1f)); titleExtra() }
                }
                if (body != null) Column(Modifier.padding(bottom = TeleTauSpace.s400), content = body)
            }
            if (art != null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300)) {
                    Illustration(art, 78.dp)
                    Column(Modifier.weight(1f), content = text)
                }
            } else {
                text()
            }
            TeleTauButton(actionLabel, onAction, Modifier.fillMaxWidth(), variant = variant)
        }
    }
}

/**
 * Диалог-лист с пчелой (prototype 12-lesson-quit): «Уже уходишь?». Главное действие — первым; «Назад» и касание
 * вне листа закрывают его ([onDismiss]).
 */
@Composable
public fun TeleTauDialog(
    title: String,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    description: String? = null,
    @DrawableRes art: Int? = null,
    actions: @Composable ColumnScope.() -> Unit,
) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            modifier
                .padding(TeleTauSpace.s400)
                .widthIn(max = TeleTauSize.columnNarrow)
                .fillMaxWidth()
                .background(TeleTauTheme.colors.surface, RoundedCornerShape(TeleTauRadius.sheet))
                .padding(TeleTauSpace.s600)
                .semantics { paneTitle = title },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s200),
        ) {
            if (art != null) Illustration(art, 132.dp, Modifier.padding(bottom = TeleTauSpace.s200))
            KHeading(title, TeleTauText.title2, align = TextAlign.Center)
            if (description != null) {
                KText(description, TeleTauText.body, Modifier.padding(bottom = TeleTauSpace.s300), color = TeleTauTheme.colors.textSecondary, align = TextAlign.Center)
            }
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s100), horizontalAlignment = Alignment.CenterHorizontally, content = actions)
        }
    }
}
