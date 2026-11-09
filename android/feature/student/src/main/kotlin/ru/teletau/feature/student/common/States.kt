package ru.teletau.feature.student.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ru.teletau.core.designsystem.BashkirLocale
import ru.teletau.core.designsystem.ButtonVariant
import ru.teletau.core.designsystem.EmptyState
import ru.teletau.core.designsystem.Illustration
import ru.teletau.core.designsystem.KText
import ru.teletau.core.designsystem.TeleTauButton
import ru.teletau.core.designsystem.TeleTauFontWeight
import ru.teletau.core.designsystem.TeleTauSpace
import ru.teletau.core.designsystem.TeleTauText
import ru.teletau.core.designsystem.TeleTauTheme
import ru.teletau.core.designsystem.R
import ru.teletau.feature.student.learn.Floating

/** Ошибка загрузки (prototype 19/21): «Нет связи» с повтором или «Что-то сломалось» с текстом для ребёнка. */
@Composable
fun LoadError(error: Throwable, onRetry: () -> Unit, modifier: Modifier = Modifier, secondary: (Pair<String, () -> Unit>)? = null) {
    if (error.isNetwork()) {
        EmptyState(R.drawable.empty_offline, "Нет связи", modifier, text = "Проверь интернет.") {
            TeleTauButton("Попробовать снова", onRetry, Modifier.fillMaxWidth())
            secondary?.let { (label, action) -> TeleTauButton(label, action, Modifier.fillMaxWidth(), variant = ButtonVariant.Secondary) }
        }
    } else {
        EmptyState(R.drawable.empty_error, "Что-то сломалось", modifier, text = describeForChild(error), alert = true) {
            TeleTauButton("Попробовать снова", onRetry, Modifier.fillMaxWidth())
            secondary?.let { (label, action) -> TeleTauButton(label, action, Modifier.fillMaxWidth(), variant = ButtonVariant.Secondary) }
        }
    }
}

/**
 * Заставка (prototype 22-splash): медовый экран с летящей пчелой — пока восстанавливается вход и открывается тропа.
 * «ТелеТау» — имя бренда, needs_native_review (docs/native-review-queue.md, №1; ресурс teletau_start_brand).
 */
@Composable
fun Splash(brand: String) {
    val c = TeleTauTheme.colors
    Box(Modifier.fillMaxSize().background(c.accentFill).semantics { contentDescription = "Открываем тропу" }, contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s150)) {
            Floating { Illustration(R.drawable.bee_fly, 200.dp) }
            KText(brand, TeleTauText.display.copy(localeList = BashkirLocale), color = c.accentOn, align = TextAlign.Center)
            KText("башкирский язык каждый день", TeleTauText.body.copy(fontFamily = ru.teletau.core.designsystem.TeleTauFonts.display, fontWeight = TeleTauFontWeight.bold), color = c.accentOn.copy(alpha = 0.8f), align = TextAlign.Center)
        }
    }
}

/** Кнопка «Попробовать снова» на всю ширину — для мест без картинки. */
@Composable
fun RetryLine(text: String, onRetry: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(TeleTauSpace.s400), verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s200)) {
        KText(text, TeleTauText.callout, color = TeleTauTheme.colors.textSecondary)
        TeleTauButton("Попробовать снова", onRetry, Modifier.fillMaxWidth(), variant = ButtonVariant.Secondary)
    }
}
