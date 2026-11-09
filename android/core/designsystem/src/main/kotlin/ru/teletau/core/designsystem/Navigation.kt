package ru.teletau.core.designsystem

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/** Вкладки ученика (prototype `.tabbar`): «Путь», «Лига», «Класс», «Профиль». */
public enum class StudentTab(public val label: String) { Path("Путь"), League("Лига"), Hive("Класс"), Me("Профиль") }

/** Нижняя навигация ученика: значок 28 dp и подпись; текущая вкладка — медовая подложка с рамкой. */
@Composable
public fun StudentTabBar(current: StudentTab, onSelect: (StudentTab) -> Unit, modifier: Modifier = Modifier) {
    val c = TeleTauTheme.colors
    Box(
        modifier
            .fillMaxWidth()
            .background(c.bg)
            .drawBehind { drawLine(c.borderSubtle, Offset(0f, 0f), Offset(size.width, 0f), TeleTauSpace.s050.toPx()) }
            .windowInsetsPadding(WindowInsets.navigationBars)
            .padding(start = TeleTauSpace.s250, end = TeleTauSpace.s250, top = TeleTauSpace.s200, bottom = TeleTauSpace.s250),
        contentAlignment = Alignment.Center,
    ) {
        Row(Modifier.widthIn(max = TeleTauSize.columnNarrow).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s100)) {
            StudentTab.entries.forEach { tab ->
                val on = tab == current
                val icon = when (tab) {
                    StudentTab.Path -> PhosphorIcons.PathFill
                    StudentTab.League -> PhosphorIcons.ShieldStarFill
                    StudentTab.Hive -> PhosphorIcons.UsersThreeFill
                    StudentTab.Me -> PhosphorIcons.UserCircleFill
                }
                val shape = RoundedCornerShape(TeleTauRadius.tile)
                Column(
                    Modifier
                        .weight(1f)
                        .defaultMinSize(minHeight = TeleTauTheme.touchTarget)
                        .clip(shape)
                        .background(if (on) c.accentSoft else Color.Transparent)
                        .border(TeleTauSpace.s050, if (on) c.accentText else Color.Transparent, shape)
                        .clickable(role = Role.Tab) { onSelect(tab) }
                        .semantics(mergeDescendants = true) { selected = on }
                        .padding(top = TeleTauSpace.s150, bottom = 5.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Image(icon, null, Modifier.size(TeleTauSize.iconLarge), colorFilter = ColorFilter.tint(if (on) c.accentLip else c.textTertiary))
                    FitText(tab.label, TeleTauText.caption, color = if (on) c.accentText else c.textTertiary, maxLines = 1, minScale = 0.5f)
                }
            }
        }
    }
}

/** Таблица лиги (prototype `.board`): строки участников и разделители зон. */
@Composable
public fun LeagueBoard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(TeleTauRadius.panel)
    Column(
        modifier.fillMaxWidth().clip(shape).background(TeleTauTheme.colors.surface).border(TeleTauSpace.s050, TeleTauTheme.colors.borderSubtle, shape),
        content = content,
    )
}

/** Разделитель строк таблицы. */
@Composable
private fun RowDivider() {
    Box(Modifier.fillMaxWidth().height(TeleTauSpace.s050).background(TeleTauTheme.colors.borderSubtle))
}

/**
 * Строка лиги: место, аватар по нику (цвет — по месту: пять тонов, затем их глубокие оттенки), ник из словаря,
 * мёд за неделю. В лиге только ники — никаких имён (CLAUDE.md, правило 5).
 */
@Composable
public fun LeagueRow(rank: Int, nickname: String, points: Int, me: Boolean, up: Boolean, first: Boolean, modifier: Modifier = Modifier) {
    val c = TeleTauTheme.colors
    val i = (rank - 1).coerceAtLeast(0) % (HexTones.size * 2)
    if (!first) RowDivider()
    Row(
        modifier
            .fillMaxWidth()
            .background(if (me) c.accentSoft else Color.Transparent)
            .defaultMinSize(minHeight = 58.dp)
            .padding(horizontal = TeleTauSpace.s350, vertical = TeleTauSpace.s250)
            .semantics(mergeDescendants = true) {
                contentDescription = buildString {
                    append("Место $rank, $nickname")
                    if (me) append(", это ты")
                    append(", $points мёда")
                }
            },
        horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FitText(rank.toString(), TeleTauText.headline.copy(fontSize = TeleTauFontSize.body), Modifier.width(TeleTauSpace.s600), color = if (up) c.successText else c.textTertiary, align = TextAlign.Center, maxLines = 1, minScale = 0.5f)
        HexAvatar(40.dp, tone = HexTones[i % HexTones.size], deep = i >= HexTones.size, art = avatarFor(nickname))
        // Ник и «ты»: тесно (узкий экран, крупный шрифт) — «ты» уходит под ник, ник переносится только между словами.
        androidx.compose.foundation.layout.FlowRow(
            Modifier.weight(1f).clearAndSetSemantics {},
            itemVerticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s150),
            verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s100),
        ) {
            FitText(nickname, TeleTauText.body.copy(fontWeight = TeleTauFontWeight.semibold), minScale = 0.5f)
            if (me) {
                Box(Modifier.background(c.accentFill, RoundedCornerShape(TeleTauRadius.chip)).padding(horizontal = TeleTauSpace.s200, vertical = 3.dp)) {
                    KText("ты", TeleTauText.caption, color = c.accentOn)
                }
            }
        }
        Row(Modifier.clearAndSetSemantics {}, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            Image(PhosphorIcons.DropFill, null, Modifier.size(TeleTauSpace.s400), colorFilter = ColorFilter.tint(c.accentFill))
            KText(points.toString(), TeleTauText.label.copy(fontSize = TeleTauFontSize.callout), color = c.textSecondary)
        }
    }
}

/** «↑ Зона повышения» под последним повышаемым, «↓ Зона понижения» над первым понижаемым. */
@Composable
public fun LeagueZoneRow(up: Boolean, modifier: Modifier = Modifier) {
    val c = TeleTauTheme.colors
    RowDivider()
    Row(
        modifier.fillMaxWidth().background(if (up) c.successSoft else c.dangerSoft).padding(TeleTauSpace.s200).clearAndSetSemantics {},
        horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s150, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val ink = if (up) c.successText else c.dangerText
        Image(if (up) PhosphorIcons.ArrowUpBold else PhosphorIcons.ArrowDownBold, null, Modifier.size(TeleTauSpace.s350), colorFilter = ColorFilter.tint(ink))
        KText(if (up) "ЗОНА ПОВЫШЕНИЯ" else "ЗОНА ПОНИЖЕНИЯ", TeleTauText.caption, color = ink)
    }
}
