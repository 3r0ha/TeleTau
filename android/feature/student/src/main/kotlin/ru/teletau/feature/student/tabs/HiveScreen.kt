package ru.teletau.feature.student.tabs

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import ru.teletau.core.designsystem.ChipTone
import ru.teletau.core.designsystem.HoneyComb
import ru.teletau.core.designsystem.Illustration
import ru.teletau.core.designsystem.KHeading
import ru.teletau.core.designsystem.KText
import ru.teletau.core.designsystem.TeleTauCard
import ru.teletau.core.designsystem.TeleTauChip
import ru.teletau.core.designsystem.TeleTauProgressBar
import ru.teletau.core.designsystem.TeleTauSpace
import ru.teletau.core.designsystem.TeleTauText
import ru.teletau.core.designsystem.TeleTauTheme
import ru.teletau.core.designsystem.PhosphorIcons
import ru.teletau.core.designsystem.R
import ru.teletau.core.network.models.ClassHive
import ru.teletau.core.network.models.HiveDay
import ru.teletau.feature.student.common.plural
import ru.teletau.feature.student.common.weekdayShort
import kotlin.math.max
import kotlin.math.roundToInt

private const val COMB = 12

/** Заголовок вкладки: название и подпись. */
@Composable
internal fun PageHead(title: String, lead: String?, art: Int? = null) {
    Row(Modifier.fillMaxWidth().padding(top = TeleTauSpace.s450, bottom = TeleTauSpace.s200), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            KHeading(title, TeleTauText.title2)
            if (lead != null) KText(lead, TeleTauText.callout, Modifier.padding(top = TeleTauSpace.s100), color = TeleTauTheme.colors.textSecondary)
        }
        if (art != null) Illustration(art, 104.dp)
    }
}

@Composable
internal fun TabCard(title: String, sub: String?, content: @Composable () -> Unit = {}) {
    TeleTauCard(Modifier.fillMaxWidth().padding(bottom = TeleTauSpace.s350)) {
        KHeading(title, TeleTauText.headline, Modifier.padding(bottom = TeleTauSpace.s100))
        if (sub != null) KText(sub, TeleTauText.footnote, Modifier.padding(bottom = TeleTauSpace.s300), color = TeleTauTheme.colors.textSecondary)
        content()
    }
}

/**
 * Вкладка «Класс» (prototype 17-class): улей класса — квест недели в сотах и сколько ребят занимались. Только
 * агрегаты: никаких рейтингов отдельных детей (docs/05 §8, п. 5).
 */
@Composable
fun HiveView(hive: ClassHive, title: String, schoolName: String) {
    val (titleRu, goal, progress, completed) = hive.quest
    val filled = if (goal > 0) minOf(COMB, (minOf(progress, goal).toFloat() / goal * COMB).roundToInt()) else 0
    val active = hive.participation.active
    val total = hive.participation.total
    Column {
        PageHead("Улей $title", "$schoolName · $total ${plural(total, "ученик", "ученика", "учеников")}", R.drawable.scene_class_hive)
        TabCard("Квест недели", titleRu) {
            if (completed) TeleTauChip("Квест выполнен", Modifier.padding(bottom = TeleTauSpace.s200), tone = ChipTone.Green, icon = PhosphorIcons.CheckBold)
            HoneyComb(COMB, filled, Modifier.padding(top = TeleTauSpace.s100, bottom = TeleTauSpace.s250))
            TeleTauProgressBar(minOf(progress, goal), goal, label = "Квест недели", valueText = "$progress из $goal", showValue = true)
        }
        TabCard("На этой неделе", "Занимались $active из $total") {
            HoneyComb(total, active, Modifier.padding(top = TeleTauSpace.s100, bottom = TeleTauSpace.s250).semantics { contentDescription = "Занимались $active из $total" }, perRow = COMB)
            if (hive.days.isNotEmpty()) HiveDays(hive.days)
        }
    }
}

/** Сколько ребят занимались в каждый день недели — столбики без имён. */
@Composable
private fun HiveDays(days: List<HiveDay>) {
    val c = TeleTauTheme.colors
    val maxActive = max(1, days.maxOf { it.active })
    Row(
        Modifier.fillMaxWidth().padding(top = TeleTauSpace.s200)
            .drawBehind { drawLine(c.borderSubtle, Offset(0f, 0f), Offset(size.width, 0f), TeleTauSpace.s050.toPx()) }
            .padding(top = TeleTauSpace.s300)
            .semantics(mergeDescendants = true) { contentDescription = "По дням недели: " + days.joinToString { "${weekdayShort(it.date)}: ${it.active}" } },
    ) {
        days.forEach { d ->
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s150)) {
                Canvas(Modifier.size(22.dp, 44.dp)) {
                    val barH = if (d.active > 0) max(6f, d.active.toFloat() / maxActive * 44f) else 3f
                    val h = barH.dp.toPx()
                    drawRoundRect(if (d.active > 0) c.accentFill else c.lockedFill, topLeft = Offset(0f, size.height - h), size = Size(size.width, h), cornerRadius = CornerRadius(5.dp.toPx()))
                }
                KText(weekdayShort(d.date), TeleTauText.caption, color = c.textTertiary)
            }
        }
    }
}
