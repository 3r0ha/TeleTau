package ru.teletau.feature.student.tabs

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import ru.teletau.core.designsystem.BashkirLocale
import ru.teletau.core.designsystem.HexAvatar
import ru.teletau.core.designsystem.HexTone
import ru.teletau.core.designsystem.HoneyComb
import ru.teletau.core.designsystem.Illustration
import ru.teletau.core.designsystem.KHeading
import ru.teletau.core.designsystem.FitText
import ru.teletau.core.designsystem.KText
import ru.teletau.core.designsystem.TeleTauButton
import ru.teletau.core.designsystem.TeleTauCard
import ru.teletau.core.designsystem.TeleTauDialog
import ru.teletau.core.designsystem.TeleTauRadius
import ru.teletau.core.designsystem.TeleTauSize
import ru.teletau.core.designsystem.TeleTauSpace
import ru.teletau.core.designsystem.TeleTauText
import ru.teletau.core.designsystem.TeleTauTheme
import ru.teletau.core.designsystem.LinkButton
import ru.teletau.core.designsystem.LinkTone
import ru.teletau.core.designsystem.PhosphorIcons
import ru.teletau.core.designsystem.R
import ru.teletau.core.designsystem.avatarFor
import ru.teletau.core.designsystem.toneFor
import ru.teletau.core.network.models.Course
import ru.teletau.core.network.models.Me
import ru.teletau.core.network.models.MembershipRole
import ru.teletau.core.network.models.MyCellsPage
import ru.teletau.core.network.models.MyProgress
import ru.teletau.core.network.models.NodeState
import ru.teletau.core.network.models.UnitState
import ru.teletau.feature.student.common.plural
import ru.teletau.feature.student.learn.currentUnit

/** Класс ученика (первый, где он ученик). */
fun studentClass(me: Me?) = me?.classes?.firstOrNull { it.role == MembershipRole.student } ?: me?.classes?.firstOrNull()

/** Созрело с прошлого захода в профиль на этом устройстве: число пар и мёд за голоса. */
data class FreshHoney(val count: Int, val honey: Int)

/** Вкладка «Профиль» (prototype 18-profile): серия, мёд, слова, голоса, «Награды», «Мой словарь», «Мой вклад в словарь», настройки. */
@Composable
fun ProfileView(
    me: Me,
    progress: MyProgress,
    cells: MyCellsPage,
    course: Course,
    fresh: FreshHoney?,
    leaving: Boolean,
    words: ru.teletau.core.network.models.MyWords? = null,
    onWords: () -> Unit = {},
    onCard: () -> Unit = {},
    onGoal: () -> Unit = {},
    sounds: Boolean = true,
    onSounds: (Boolean) -> Unit = {},
    onDarkTheme: (Boolean) -> Unit = {},
    onTeacher: () -> Unit = {},
    /** Награды; нет (не загрузились) — блока нет. */
    achievements: ru.teletau.core.network.models.MyAchievements? = null,
    onLeave: () -> Unit,
    onStay: () -> Unit,
    onLogout: () -> Unit,
) {
    val c = TeleTauTheme.colors
    val klass = studentClass(me)
    val (matured, pending, _, honeyPending) = cells.summary
    val cellsTotal = minOf(24, matured + pending)
    Column {
        Row(Modifier.fillMaxWidth().padding(top = 22.dp, bottom = TeleTauSpace.s400), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s400)) {
            val art = avatarFor(me.nickname)
            if (art != null) HexAvatar(88.dp, tone = toneFor(me.nickname.orEmpty()), art = art, lip = true)
            else HexAvatar(88.dp, tone = HexTone.Honey, art = R.drawable.app_icon_alt, lip = true)
            Column(Modifier.weight(1f)) {
                KHeading(me.nickname.orEmpty(), TeleTauText.title2)
                if (klass != null) ru.teletau.core.designsystem.FitText("${klass.title} · ${klass.schoolName}", TeleTauText.callout, maxLines = 3, modifier = Modifier.padding(top = TeleTauSpace.s100), color = c.textSecondary)
            }
        }
        Column(Modifier.semantics { contentDescription = "Мои итоги" }, verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s250)) {
            Row(horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s250)) {
                Stat(PhosphorIcons.FireFill, c.streakFill, "${progress.streak.current}", plural(progress.streak.current, "день подряд", "дня подряд", "дней подряд"), Modifier.weight(1f))
                Stat(PhosphorIcons.DropFill, c.accentFill, "${progress.honey.total}", "мёда", Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s250)) {
                val count = words?.summary?.total ?: progress.wordsLearned
                Stat(PhosphorIcons.BookOpenFill, c.infoFill, "$count", plural(count, "слово", "слова", "слов"), Modifier.weight(1f))
                Stat(PhosphorIcons.ScalesFill, c.violetBright, "${progress.votes.total}", plural(progress.votes.total, "голос", "голоса", "голосов"), Modifier.weight(1f))
            }
        }
        Column(Modifier.padding(top = TeleTauSpace.s350)) {
            if (achievements != null) ru.teletau.feature.student.learn.AchievementsCard(achievements)
            DictionaryLink(words, onWords)
            // «Учусь сам» (ADR 0022): вход с другого устройства — личная карточка.
            me.loginCard?.let { status ->
                LinkCard(
                    PhosphorIcons.IdentificationCardFill, c.accentSoft, c.accentFill, "Моя карточка входа",
                    if (status == ru.teletau.core.network.models.LoginCardStatus.issued) "Вход с другого устройства" else "Чтобы не потерять мёд и серию",
                    onCard,
                )
            }
            if (fresh != null) Matured(fresh)
            TabCard(
                "Мой вклад в словарь",
                if (cellsTotal > 0) listOfNotNull(
                    "$matured в словаре",
                    if (pending > 0) "$pending ${plural(pending, "ждёт", "ждут", "ждут")} итога" else null,
                    if (honeyPending > 0) "+$honeyPending мёда созревает" else null,
                ).joinToString(" · ") else "Голосуй в «Помоги языку» на тропе.",
            ) {
                if (cellsTotal > 0) HoneyComb(cellsTotal, minOf(matured, cellsTotal), Modifier.padding(top = TeleTauSpace.s100, bottom = TeleTauSpace.s250), nectar = maxOf(0, cellsTotal - matured))
            }
            TeleTauCard(Modifier.fillMaxWidth(), padding = androidx.compose.foundation.layout.PaddingValues(horizontal = TeleTauSpace.s400, vertical = TeleTauSpace.s100)) {
                Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 56.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300)) {
                    Image(PhosphorIcons.TargetFill, null, Modifier.size(22.dp), colorFilter = ColorFilter.tint(c.textTertiary))
                    Column(Modifier.weight(1f)) {
                        FitText("Цель дня", TeleTauText.body.copy(fontWeight = ru.teletau.core.designsystem.TeleTauFontWeight.semibold), minScale = 0.5f)
                        FitText(ru.teletau.feature.student.login.goalTitle(me.dailyGoal), TeleTauText.footnote, color = c.textSecondary, maxLines = 3, minScale = 0.5f)
                    }
                    LinkButton("Изменить", onGoal)
                }
                SettingsDivider()
                // «Звуки»: звуки урока на этом устройстве (запись носителя «Послушать» играет всегда).
                Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 56.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300)) {
                    Image(if (sounds) PhosphorIcons.SpeakerHighFill else PhosphorIcons.SpeakerSlashFill, null, Modifier.size(22.dp), colorFilter = ColorFilter.tint(c.textTertiary))
                    FitText("Звуки", TeleTauText.body.copy(fontWeight = ru.teletau.core.designsystem.TeleTauFontWeight.semibold), Modifier.weight(1f).clearAndSetSemantics {}, minScale = 0.5f)
                    ru.teletau.core.designsystem.TeleTauSwitch(sounds, onSounds, "Звуки")
                }
                SettingsDivider()
                // «Тёмная тема»: положение — тема на экране (выбор на устройстве, без выбора — светлая), переключение меняет тему сразу.
                Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 56.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300)) {
                    Image(PhosphorIcons.MoonFill, null, Modifier.size(22.dp), colorFilter = ColorFilter.tint(c.textTertiary))
                    FitText("Тёмная тема", TeleTauText.body.copy(fontWeight = ru.teletau.core.designsystem.TeleTauFontWeight.semibold), Modifier.weight(1f).clearAndSetSemantics {}, minScale = 0.5f)
                    ru.teletau.core.designsystem.TeleTauSwitch(TeleTauTheme.isDark, onDarkTheme, "Тёмная тема")
                }
                // Заявка учителя — на сайте, по почте.
                if (me.kind == ru.teletau.core.network.models.AccountKind.adult && me.teacherStatus == ru.teletau.core.network.models.TeacherStatus.none && me.profile != null) {
                    SettingsDivider()
                    Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 56.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300)) {
                        Image(PhosphorIcons.ChalkboardTeacherFill, null, Modifier.size(22.dp), colorFilter = ColorFilter.tint(c.textTertiary))
                        LinkButton("Я учитель", onTeacher)
                    }
                }
                SettingsDivider()
                Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 56.dp), verticalAlignment = Alignment.CenterVertically) {
                    LinkButton("Выйти", onLeave, tone = LinkTone.Danger, icon = PhosphorIcons.SignOutBold)
                }
            }
        }
    }
    if (leaving) {
        // Без карточки, почты и класса вернуться к своему мёду нельзя — сначала карточка (ADR 0022).
        val noWayBack = me.loginCard == ru.teletau.core.network.models.LoginCardStatus.none && me.profile == null && klass == null
        TeleTauDialog(
            if (noWayBack) "Сначала сделай карточку" else "Уже уходишь?", onDismiss = onStay,
            description = leaveText(me), art = if (noWayBack) R.drawable.bee_think else R.drawable.bee_sympathy,
        ) {
            if (noWayBack) TeleTauButton("Сделать карточку", { onStay(); onCard() }, Modifier.fillMaxWidth())
            else TeleTauButton("Остаться", onStay, Modifier.fillMaxWidth())
            LinkButton("Выйти", onLogout, tone = LinkTone.Danger)
        }
    }
}

@Composable
private fun Stat(icon: ImageVector, tint: Color, value: String, label: String, modifier: Modifier) {
    val c = TeleTauTheme.colors
    val shape = RoundedCornerShape(TeleTauRadius.button)
    Row(
        modifier.background(c.surface, shape).border(TeleTauSpace.s050, c.borderSubtle, shape).padding(horizontal = TeleTauSpace.s350, vertical = TeleTauSpace.s300)
            .semantics(mergeDescendants = true) { contentDescription = "$value $label" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s250),
    ) {
        Image(icon, null, Modifier.size(26.dp), colorFilter = ColorFilter.tint(tint))
        Column(Modifier.clearAndSetSemantics {}) {
            FitText(value, TeleTauText.headline, maxLines = 1, minScale = 0.5f)
            FitText(label, TeleTauText.labelText, color = c.textSecondary, minScale = 0.5f)
        }
    }
}

/** Чем войти снова — по тому, как ученик сюда попал (как leaveText веба). */
fun leaveText(me: Me): String = when {
    me.loginCard == ru.teletau.core.network.models.LoginCardStatus.none && me.profile == null && studentClass(me) == null -> "Без неё мёд и серию не вернуть."
    me.loginCard == ru.teletau.core.network.models.LoginCardStatus.issued -> "Войти снова можно по твоей карточке."
    me.kind == ru.teletau.core.network.models.AccountKind.adult -> "Войти снова можно по почте."
    else -> "Войти снова можно по карточке или коду класса."
}

@Composable
private fun SettingsDivider() {
    androidx.compose.foundation.layout.Box(Modifier.fillMaxWidth().height(TeleTauSpace.s050).background(TeleTauTheme.colors.borderSubtle))
}

/** Строка-ссылка профиля: значок в плашке, название, подпись и «›». */
@Composable
private fun LinkCard(icon: androidx.compose.ui.graphics.vector.ImageVector, tileBg: Color, tint: Color, title: String, sub: String?, onClick: () -> Unit) {
    val c = TeleTauTheme.colors
    ru.teletau.core.designsystem.LippedSurfacePublic(
        onClick = onClick, face = c.surface, edge = c.borderSubtle,
        modifier = Modifier.fillMaxWidth().padding(bottom = TeleTauSpace.s350).semantics(mergeDescendants = true) {},
        minHeight = 80.dp, radius = TeleTauRadius.card,
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = TeleTauSpace.s400, vertical = TeleTauSpace.s300), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300)) {
            androidx.compose.foundation.layout.Box(Modifier.size(52.dp).background(tileBg, RoundedCornerShape(TeleTauRadius.button)), contentAlignment = Alignment.Center) {
                Image(icon, null, Modifier.size(TeleTauSize.iconLarge), colorFilter = ColorFilter.tint(tint))
            }
            Column(Modifier.weight(1f)) {
                ru.teletau.core.designsystem.FitText(title, TeleTauText.headline)
                if (sub != null) ru.teletau.core.designsystem.FitText(sub, TeleTauText.footnote, color = c.textSecondary, maxLines = 3)
            }
            Image(PhosphorIcons.CaretRightBold, null, Modifier.size(TeleTauSize.icon), colorFilter = ColorFilter.tint(c.textSecondary))
        }
    }
}

/** «Мой словарь» — вход в словарь из профиля: сколько слов и сколько пора повторить. */
@Composable
private fun DictionaryLink(words: ru.teletau.core.network.models.MyWords?, onClick: () -> Unit) {
    LinkCard(PhosphorIcons.BookOpenFill, TeleTauTheme.colors.infoSoft, TeleTauTheme.colors.infoFill, "Мой словарь", dictionaryStatus(words), onClick)
}

/** «Мёд созрел!»: с прошлого захода созрели варианты, за которые голосовал ученик. */
@Composable
private fun Matured(fresh: FreshHoney) {
    val c = TeleTauTheme.colors
    val shape = RoundedCornerShape(TeleTauRadius.panel)
    val plus = if (fresh.honey > 0) " · +${fresh.honey} мёда" else ""
    Row(
        Modifier.fillMaxWidth().padding(bottom = TeleTauSpace.s350).background(c.accentSoft, shape).border(TeleTauSpace.s050, c.accentSoftBorder, shape).padding(TeleTauSpace.s300),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300),
    ) {
        Illustration(R.drawable.scene_honey_matured, 92.dp)
        Column(Modifier.weight(1f)) {
            KText("Мёд созрел!", TeleTauText.headline, Modifier.semantics { heading() }, color = c.accentText)
            KText(
                "${fresh.count} ${plural(fresh.count, "перевод", "перевода", "переводов")} с твоим голосом ${plural(fresh.count, "вошёл", "вошли", "вошли")} в словарь$plus",
                TeleTauText.footnote,
            )
        }
    }
}

