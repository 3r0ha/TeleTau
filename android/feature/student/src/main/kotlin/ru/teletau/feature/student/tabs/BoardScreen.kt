package ru.teletau.feature.student.tabs

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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import ru.teletau.core.designsystem.EmptyState
import ru.teletau.core.designsystem.FitText
import ru.teletau.core.designsystem.KHeading
import ru.teletau.core.designsystem.KText
import ru.teletau.core.designsystem.LeagueBoard
import ru.teletau.core.designsystem.PhosphorIcons
import ru.teletau.core.designsystem.R
import ru.teletau.core.designsystem.TeleTauFontSize
import ru.teletau.core.designsystem.TeleTauFontWeight
import ru.teletau.core.designsystem.TeleTauRadius
import ru.teletau.core.designsystem.TeleTauSize
import ru.teletau.core.designsystem.TeleTauSpace
import ru.teletau.core.designsystem.TeleTauText
import ru.teletau.core.designsystem.TeleTauTheme
import ru.teletau.core.network.models.PublicLeaderboard
import ru.teletau.core.network.models.PublicLeaderboardClass
import ru.teletau.core.network.models.PublicLeaderboardPeriod
import ru.teletau.core.network.models.PublicLeaderboardSchool
import ru.teletau.feature.student.common.plural

/** Периоды доски (ТЗ §4.5): учебные сутки, неделя (по умолчанию), месяц, год — по Уфе. */
private val BOARD_PERIODS = listOf(
    PublicLeaderboardPeriod.day to "День",
    PublicLeaderboardPeriod.week to "Неделя",
    PublicLeaderboardPeriod.month to "Месяц",
    PublicLeaderboardPeriod.year to "Год",
)

/** Месяцы в родительном падеже — «с 9 ноября» (как MONTHS веба). */
private val MONTHS_GEN = listOf("января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря")

/** «с 9 ноября» — начало периода (periodStart, дата по Уфе); у года — «с 1 января 2026». */
private fun boardSince(board: PublicLeaderboard): String {
    val parts = board.periodStart.split("-")
    val day = parts.getOrNull(2)?.toIntOrNull() ?: return board.periodStart
    val month = MONTHS_GEN.getOrNull((parts.getOrNull(1)?.toIntOrNull() ?: 0) - 1) ?: return board.periodStart
    return if (board.period == PublicLeaderboardPeriod.year) "с $day $month ${parts.first()}" else "с $day $month"
}

/**
 * «Доска почёта» (веб /board, ТЗ §4.5): публичный топ-10 школ и классов за период — место, группа, уроки.
 * Только агрегаты школ и классов — ни ников, ни имён (правило 13); малые группы сервер в доску не пускает.
 * Вход — с вкладки «Лига», системный «Назад» возвращает туда же.
 */
@Composable
fun BoardView(board: PublicLeaderboard, period: PublicLeaderboardPeriod, onPeriod: (PublicLeaderboardPeriod) -> Unit, onBack: () -> Unit) {
    val c = TeleTauTheme.colors
    Column {
        Column(Modifier.padding(top = TeleTauSpace.s300, bottom = TeleTauSpace.s200)) {
            Row(
                Modifier.defaultMinSize(minHeight = TeleTauSize.touchMin).clip(RoundedCornerShape(TeleTauRadius.small))
                    .clickable(role = Role.Button, onClick = onBack).padding(horizontal = TeleTauSpace.s100),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s100),
            ) {
                Image(PhosphorIcons.CaretLeftBold, null, Modifier.size(TeleTauSize.iconSmall), colorFilter = ColorFilter.tint(c.accentText))
                KText("Лига", TeleTauText.label.copy(fontSize = TeleTauFontSize.footnote), color = c.accentText)
            }
            KHeading("Доска почёта", TeleTauText.title2)
            KText(boardSince(board), TeleTauText.callout, Modifier.padding(top = TeleTauSpace.s100), color = c.textSecondary)
        }
        BoardPeriods(period, onPeriod)
        if (board.schools.isEmpty() && board.classes.isEmpty()) {
            EmptyState(R.drawable.bee_idle, "Данных ещё нет", text = "Как только школы и классы начнут заниматься, они появятся здесь.", compact = true)
        } else {
            if (board.schools.isNotEmpty()) BoardGroup("Школы", board.schools.map(::schoolEntry))
            if (board.classes.isNotEmpty()) BoardGroup("Классы", board.classes.map(::classEntry))
        }
    }
}

/** Строка доски: место, название группы, уроки за период. Подпись — район (школа) или «школа · район» (класс). */
private data class BoardEntry(val rank: Int, val name: String, val sub: String, val lessons: Int)

private fun schoolEntry(s: PublicLeaderboardSchool) = BoardEntry(s.rank, s.school, s.district, s.lessons)

private fun classEntry(k: PublicLeaderboardClass) = BoardEntry(k.rank, k.classLabel, "${k.school} · ${k.district}", k.lessons)

/** Сегмент периодов — как вкладки нижней навигации: выбранный подсвечен, роль Tab, состояние selected. */
@Composable
private fun BoardPeriods(period: PublicLeaderboardPeriod, onPeriod: (PublicLeaderboardPeriod) -> Unit) {
    val c = TeleTauTheme.colors
    val shape = RoundedCornerShape(TeleTauRadius.tile)
    Row(Modifier.fillMaxWidth().padding(top = TeleTauSpace.s200), horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s150)) {
        BOARD_PERIODS.forEach { (value, label) ->
            val on = value == period
            Box(
                Modifier.weight(1f).clip(shape)
                    .background(if (on) c.accentSoft else c.surface)
                    .border(TeleTauSpace.s050, if (on) c.accentText else c.borderSubtle, shape)
                    .clickable(role = Role.Tab) { onPeriod(value) }
                    .semantics { selected = on }
                    .defaultMinSize(minHeight = TeleTauSize.touchMin)
                    .padding(vertical = TeleTauSpace.s150),
                contentAlignment = Alignment.Center,
            ) { FitText(label, TeleTauText.callout, color = if (on) c.accentText else c.textSecondary, align = TextAlign.Center, maxLines = 1, minScale = 0.5f) }
        }
    }
}

/** Раздел доски («Школы» или «Классы»): заголовок и таблица-лига — место, группа, уроки. */
@Composable
private fun BoardGroup(title: String, entries: List<BoardEntry>) {
    val c = TeleTauTheme.colors
    Column(Modifier.padding(top = TeleTauSpace.s500)) {
        KText(title.uppercase(), TeleTauText.label.copy(letterSpacing = 0.04.em), Modifier.padding(bottom = TeleTauSpace.s200).semantics { heading() }, color = c.textTertiary)
        LeagueBoard {
            entries.forEachIndexed { i, e ->
                BoardRow(e, first = i == 0)
            }
        }
    }
}

/** Строка доски — как строка лиги: место, группа (район подписью), уроки за период. */
@Composable
private fun BoardRow(entry: BoardEntry, first: Boolean) {
    val c = TeleTauTheme.colors
    if (!first) Box(Modifier.fillMaxWidth().height(TeleTauSpace.s050).background(c.borderSubtle))
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 58.dp)
            .padding(horizontal = TeleTauSpace.s350, vertical = TeleTauSpace.s250)
            .semantics(mergeDescendants = true) {
                contentDescription = "Место ${entry.rank}, ${entry.name}, ${entry.lessons} ${plural(entry.lessons, "урок", "урока", "уроков")}"
            },
        horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FitText(entry.rank.toString(), TeleTauText.headline.copy(fontSize = TeleTauFontSize.body), Modifier.width(TeleTauSpace.s600), color = c.textTertiary, align = TextAlign.Center, maxLines = 1, minScale = 0.5f)
        Column(
            Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s050),
        ) {
            FitText(entry.name, TeleTauText.body.copy(fontWeight = TeleTauFontWeight.semibold), minScale = 0.5f)
            FitText(entry.sub, TeleTauText.footnote, color = c.textSecondary, maxLines = 2, minScale = 0.5f)
        }
        KText(entry.lessons.toString(), TeleTauText.label.copy(fontSize = TeleTauFontSize.callout), color = c.textSecondary)
    }
}
