package ru.teletau.feature.student.login

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import ru.teletau.core.designsystem.AlertTone
import ru.teletau.core.designsystem.HoneyComb
import ru.teletau.core.designsystem.Illustration
import ru.teletau.core.designsystem.InlineAlert
import ru.teletau.core.designsystem.KHeading
import ru.teletau.core.designsystem.KText
import ru.teletau.core.designsystem.TeleTauButton
import ru.teletau.core.designsystem.TeleTauFontSize
import ru.teletau.core.designsystem.TeleTauProgressBar
import ru.teletau.core.designsystem.TeleTauRadius
import ru.teletau.core.designsystem.TeleTauSize
import ru.teletau.core.designsystem.TeleTauSpace
import ru.teletau.core.designsystem.TeleTauText
import ru.teletau.core.designsystem.TeleTauTheme
import ru.teletau.core.designsystem.LinkButton
import ru.teletau.core.designsystem.LinkTone
import ru.teletau.core.designsystem.PhosphorIcons
import ru.teletau.core.designsystem.R
import ru.teletau.core.designsystem.SimpleTopBar
import ru.teletau.core.network.models.AgeBand

/** Шаги «Учусь сам»: возраст → ник (цель дня — 2 соты по умолчанию, меняется в профиле). */
enum class SelfStep { Age, Nick }

/** Возрастные диапазоны (ADR 0022): возраст по годам не спрашивается и не хранится. */
val AGES: List<Pair<AgeBand, String>> = listOf(
    AgeBand.age710 to "7–10 лет",
    AgeBand.age1114 to "11–14 лет",
    AgeBand.age1517 to "15–17 лет",
    AgeBand.adult to "18 и старше",
)

/** Цель дня — 1, 2 или 3 урока (по умолчанию 2), как GoalPicker веба. */
val GOALS: List<Triple<Int, String, String>> = listOf(
    Triple(1, "1 урок в день", "5 минут"),
    Triple(2, "2 урока в день", "10 минут"),
    Triple(3, "3 урока в день", "15 минут"),
)
const val DEFAULT_GOAL: Int = 2

fun goalTitle(goal: Int?): String = GOALS.firstOrNull { it.first == goal }?.second ?: GOALS.first { it.first == DEFAULT_GOAL }.second

/** Строка выбора (веб ChoiceGroup): выбрано — медовая подложка, тёмная рамка и галочка (не только цветом). */
@Composable
fun ChoiceRow(title: String, selected: Boolean, onClick: () -> Unit, description: String? = null, mark: (@Composable () -> Unit)? = null) {
    val c = TeleTauTheme.colors
    val shape = RoundedCornerShape(TeleTauRadius.button)
    ru.teletau.core.designsystem.LippedSurfacePublic(
        onClick = onClick,
        face = if (selected) c.accentSoft else c.surface,
        edge = if (selected) c.accentText else c.borderDefault,
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) { this.selected = selected; contentDescription = listOfNotNull(title, description).joinToString(". ") },
        minHeight = if (description != null) 72.dp else TeleTauTheme.touchTarget + TeleTauSpace.s200,
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = TeleTauSpace.s400, vertical = TeleTauSpace.s250),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300),
        ) {
            if (mark != null) mark()
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s050)) {
                KText(title, TeleTauText.bodyLarge)
                if (description != null) KText(description, TeleTauText.footnote, color = c.textSecondary)
            }
            if (selected) {
                Box(Modifier.size(28.dp).background(c.accentFill, RoundedCornerShape(TeleTauRadius.chip)).border(TeleTauSpace.s050, c.accentLip, RoundedCornerShape(TeleTauRadius.chip)), contentAlignment = Alignment.Center) {
                    Image(PhosphorIcons.CheckBold, null, Modifier.size(16.dp), colorFilter = ColorFilter.tint(c.accentOn))
                }
            }
        }
    }
}

/** Выбор цели дня плитками; слева — соты: сколько уроков, столько ячеек мёда. */
@Composable
fun GoalPicker(value: Int, onChange: (Int) -> Unit) {
    Column(Modifier.semantics { contentDescription = "Цель на день" }, verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s250)) {
        GOALS.forEach { (g, title, minutes) ->
            ChoiceRow(title, value == g, { onChange(g) }, minutes) { Box(Modifier.width(62.dp)) { HoneyComb(3, g) } }
        }
    }
}

/**
 * «Учусь сам» (веб `/self`, ADR 0022): возраст диапазоном → ник из словаря → «Начать» → сразу тропа. Ничего личного:
 * ни имени, ни почты, ни телефона. Системный «Назад» — на предыдущий шаг.
 */
@Composable
fun SelfStartScreen(
    step: SelfStep,
    age: AgeBand?,
    onAge: (AgeBand) -> Unit,
    onNext: () -> Unit,
    onBack: () -> Unit,
    picker: @Composable () -> Unit,
) {
    val title = if (step == SelfStep.Age) "Сколько тебе лет?" else "Выбери ник"
    val index = step.ordinal + 1
    Screen(top = { SimpleTopBar("Учусь сам", onBack = onBack) }) {
        TeleTauProgressBar(index, SelfStep.entries.size, label = "Шаг", valueText = "Шаг $index из ${SelfStep.entries.size}")
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300)) {
            KHeading(title, TeleTauText.title2, Modifier.weight(1f))
            Illustration(if (step == SelfStep.Nick) R.drawable.bee_think else R.drawable.bee_read, 84.dp)
        }
        when (step) {
            SelfStep.Age -> Column(verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s600)) {
                Column(Modifier.semantics { contentDescription = "Сколько тебе лет?" }, verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s250)) {
                    AGES.forEach { (band, label) -> ChoiceRow(label, age == band, { onAge(band) }) }
                }
                TeleTauButton("Дальше", onNext, Modifier.fillMaxWidth(), enabled = age != null)
            }
            SelfStep.Nick -> picker()
        }
    }
}
