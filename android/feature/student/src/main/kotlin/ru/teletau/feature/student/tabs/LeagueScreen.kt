package ru.teletau.feature.student.tabs

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.LocalDensity
import ru.teletau.core.designsystem.Illustrations
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ru.teletau.core.designsystem.EmptyState
import ru.teletau.core.designsystem.Illustration
import ru.teletau.core.designsystem.KHeading
import ru.teletau.core.designsystem.KText
import ru.teletau.core.designsystem.TeleTauButton
import ru.teletau.core.designsystem.TeleTauRadius
import ru.teletau.core.designsystem.TeleTauSpace
import ru.teletau.core.designsystem.TeleTauText
import ru.teletau.core.designsystem.TeleTauTheme
import ru.teletau.core.designsystem.LeagueBoard
import ru.teletau.core.designsystem.LeagueRow
import ru.teletau.core.designsystem.LeagueZoneRow
import ru.teletau.core.designsystem.R
import ru.teletau.core.network.models.LeagueStanding
import ru.teletau.core.network.models.LeagueZone
import ru.teletau.feature.student.common.LEAGUE_TIERS
import ru.teletau.feature.student.common.TIER_NAMES
import ru.teletau.feature.student.common.weekEndsIn
import ru.teletau.feature.student.learn.leagueBadge

/** Вкладка «Лига» (prototype 16-league): лиги медоносов, таблица недели с зонами повышения и понижения. */
@Composable
fun LeagueView(league: LeagueStanding, onTrail: () -> Unit, nowMillis: Long = System.currentTimeMillis()) {
    val c = TeleTauTheme.colors
    val tierIndex = LEAGUE_TIERS.indexOf(league.tier)
    val next = LEAGUE_TIERS.getOrNull(tierIndex + 1)
    val name = TIER_NAMES.getValue(league.tier)
    val members = league.members
    val lastUp = members.indexOfLast { it.zone == LeagueZone.promote }
    val firstDown = members.indexOfFirst { it.zone == LeagueZone.demote }
    val climbing = next != null && members.any { it.me && it.zone == LeagueZone.promote }
    Column {
        Row(
            Modifier.fillMaxWidth().padding(top = TeleTauSpace.s350, bottom = TeleTauSpace.s100).clearAndSetSemantics {},
            horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s100, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.Bottom,
        ) {
            LEAGUE_TIERS.forEachIndexed { i, t ->
                when {
                    i == tierIndex -> Illustration(leagueBadge(t), 104.dp)
                    i < tierIndex -> Illustration(leagueBadge(t), 54.dp)
                    else -> Box(Modifier.alpha(0.55f)) { GrayIllustration(leagueBadge(t), 54) }
                }
            }
        }
        Column(Modifier.fillMaxWidth().padding(top = TeleTauSpace.s150, bottom = TeleTauSpace.s200), horizontalAlignment = Alignment.CenterHorizontally) {
            KHeading("Лига ${name.gen}", TeleTauText.title2, align = TextAlign.Center)
            val first = if (next != null && league.zones.promote > 0) "Первые ${league.zones.promote} перейдут в Лигу ${TIER_NAMES.getValue(next).gen}." else "Это высшая лига."
            KText("$first\nИтоги ${weekEndsIn(league.endsAt, nowMillis)}.", TeleTauText.callout, Modifier.padding(top = TeleTauSpace.s100), color = c.textSecondary, align = TextAlign.Center)
        }
        if (climbing && next != null) {
            val shape = RoundedCornerShape(TeleTauRadius.panel)
            Row(
                Modifier.fillMaxWidth().padding(top = TeleTauSpace.s200).background(c.successSoft, shape).padding(TeleTauSpace.s300),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300),
            ) {
                Illustration(R.drawable.bee_proud, 58.dp)
                Column {
                    KHeading("Ты в зоне повышения", TeleTauText.headline, color = c.successText)
                    KText("Удержи место до конца недели.", TeleTauText.footnote, color = c.textPrimary)
                }
            }
        }
        if (members.isNotEmpty()) {
            LeagueBoard(Modifier.padding(top = TeleTauSpace.s200, bottom = TeleTauSpace.s400)) {
                members.forEachIndexed { i, m ->
                    if (i == firstDown && firstDown > 0) LeagueZoneRow(up = false)
                    LeagueRow(m.rank, m.nickname ?: "Участник", m.points, m.me, up = m.zone == LeagueZone.promote, first = i == 0)
                    if (i == lastUp && lastUp < members.size - 1) LeagueZoneRow(up = true)
                }
            }
        } else {
            EmptyState(R.drawable.bee_idle, "Лига ждёт тебя", text = "Пройди урок, чтобы попасть в таблицу.", compact = true) {
                TeleTauButton("На тропу", onTrail, Modifier.fillMaxWidth())
            }
        }
    }
}

/** Значок будущей лиги — бесцветный (как `filter: grayscale` в вебе). */
@Composable
private fun GrayIllustration(id: Int, width: Int) {
    val resources = LocalResources.current
    val px = with(LocalDensity.current) { width.dp.roundToPx() }
    val bitmap = remember(id, px) { Illustrations.bitmap(resources, id, px) }
    Image(
        bitmap, null,
        Modifier.size(width.dp, (width * bitmap.height / bitmap.width).dp),
        colorFilter = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0f) }),
    )
}
