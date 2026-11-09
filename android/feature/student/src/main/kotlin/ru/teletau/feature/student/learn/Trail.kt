package ru.teletau.feature.student.learn

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.layout
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import ru.teletau.core.designsystem.FitText
import ru.teletau.core.designsystem.scaledBy
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.zIndex
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.filterNotNull
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.layout
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.constrainWidth
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import ru.teletau.core.designsystem.EmptyState
import ru.teletau.core.designsystem.HexNode
import ru.teletau.core.designsystem.HexNodeState
import ru.teletau.core.designsystem.HexNodeTone
import ru.teletau.core.designsystem.Illustration
import ru.teletau.core.designsystem.IllustrationFill
import ru.teletau.core.designsystem.KText
import ru.teletau.core.designsystem.TeleTauButton
import ru.teletau.core.designsystem.TeleTauDuration
import ru.teletau.core.designsystem.TeleTauEasing
import ru.teletau.core.designsystem.TeleTauFontSize
import ru.teletau.core.designsystem.TeleTauFontWeight
import ru.teletau.core.designsystem.TeleTauProgressBar
import ru.teletau.core.designsystem.TeleTauRadius
import ru.teletau.core.designsystem.TeleTauSize
import ru.teletau.core.designsystem.TeleTauSpace
import ru.teletau.core.designsystem.TeleTauText
import ru.teletau.core.designsystem.TeleTauTheme
import ru.teletau.core.designsystem.PhosphorIcons
import ru.teletau.core.designsystem.R
import ru.teletau.core.designsystem.UiMode
import ru.teletau.core.network.models.Course
import ru.teletau.core.network.models.CourseUnit
import ru.teletau.core.network.models.LeagueTier
import ru.teletau.core.network.models.MyProgress
import ru.teletau.core.network.models.NodeIcon
import ru.teletau.core.network.models.NodeKind
import ru.teletau.core.network.models.NodeState
import ru.teletau.core.network.models.Place
import ru.teletau.core.network.models.TrailNode
import ru.teletau.core.network.models.UnitState
import ru.teletau.feature.student.common.TIER_NAMES
import ru.teletau.feature.student.common.plural

/** Текущее место экспедиции: юнит с текущим узлом, иначе первый незаконченный открытый, иначе последний открытый. */
fun currentUnit(course: Course): CourseUnit? =
    course.units.firstOrNull { u -> u.nodes.any { it.state == NodeState.current } }
        ?: course.units.firstOrNull { u -> u.state == UnitState.open && u.nodes.any { it.state != NodeState.done } }
        ?: course.units.lastOrNull { it.state == UnitState.open }

fun nextNode(course: Course): TrailNode? {
    val all = course.units.flatMap { it.nodes }
    return all.firstOrNull { it.state == NodeState.current } ?: all.firstOrNull { it.state == NodeState.open }
}

/** Значок медовой подложки юнита. */
@Composable
private fun zoneColor(tone: PlaceTone) = when (tone) {
    PlaceTone.Honey -> TeleTauTheme.colors.zoneHoney
    PlaceTone.Green -> TeleTauTheme.colors.zoneGreen
    PlaceTone.Water -> TeleTauTheme.colors.zoneWater
}

/** Верхняя панель тропы (prototype `.topbar`): серия, мёд и значок лиги. */
@Composable
fun LearnTopBar(progress: MyProgress?, onLeague: () -> Unit, modifier: Modifier = Modifier) {
    val c = TeleTauTheme.colors
    val streak = progress?.streak?.current ?: 0
    val honey = progress?.honey?.total ?: 0
    Row(
        modifier.fillMaxWidth().defaultMinSize(minHeight = 60.dp).padding(horizontal = TeleTauSpace.s400),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        progress?.dailyGoal?.let { ru.teletau.core.designsystem.GoalMeter(it.done, it.target) }
        Row(
            Modifier.defaultMinSize(minWidth = TeleTauSize.touchMin, minHeight = TeleTauSize.touchMin)
                .semantics(mergeDescendants = true) { contentDescription = "Серия: $streak ${plural(streak, "день", "дня", "дней")} подряд" },
            horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s150),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Image(PhosphorIcons.FireFill, null, Modifier.size(TeleTauSize.icon), colorFilter = ColorFilter.tint(if (streak > 0) c.streakFill else c.lockedText))
            KText(if (progress != null) "$streak" else "–", TeleTauText.button.copy(fontWeight = TeleTauFontWeight.black), Modifier.clearAndSetSemantics {}, color = c.streakText)
        }
        Row(
            Modifier.defaultMinSize(minWidth = TeleTauSize.touchMin, minHeight = TeleTauSize.touchMin)
                .semantics(mergeDescendants = true) { contentDescription = "Мёд: $honey" },
            horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s150),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Image(PhosphorIcons.DropFill, null, Modifier.size(TeleTauSize.icon), colorFilter = ColorFilter.tint(c.accentFill))
            KText(if (progress != null) "$honey" else "–", TeleTauText.button.copy(fontWeight = TeleTauFontWeight.black), Modifier.clearAndSetSemantics {}, color = c.accentText)
        }
        val tier = progress?.league?.tier
        Box(
            Modifier.size(TeleTauSize.touchMin)
                .then(if (tier != null) Modifier.clickable(onClick = onLeague).semantics { contentDescription = "Лига ${TIER_NAMES[tier]?.gen}" } else Modifier),
            contentAlignment = Alignment.Center,
        ) { if (tier != null) Illustration(leagueBadge(tier), 30.dp) }
    }
}

fun leagueBadge(tier: LeagueTier): Int = when (tier) {
    LeagueTier.clover -> R.drawable.badge_clover
    LeagueTier.buckwheat -> R.drawable.badge_buckwheat
    LeagueTier.sweetclover -> R.drawable.badge_sweetclover
    LeagueTier.fireweed -> R.drawable.badge_fireweed
    LeagueTier.linden -> R.drawable.badge_linden
}

/** Название места: башкирское (из контента с флагом проверки), иначе русское. */
@Composable
private fun PlaceTitle(place: Place, style: androidx.compose.ui.text.TextStyle, color: androidx.compose.ui.graphics.Color, modifier: Modifier = Modifier) {
    // Длинное название («Башкирская деревня») не рвётся посередине слова: переносится между словами или мельчает.
    FitText(placeName(place), placeTitleStyle(place, style), modifier, color = color, maxLines = 2)
}

/** Название места: башкирское, если есть, иначе русское. */
internal fun placeName(place: Place): String = place.titleBa?.text ?: place.titleRu

/** Башкирское название — шрифтом с башкирскими формами букв (locl BSH), русское — как есть. */
internal fun placeTitleStyle(place: Place, style: androidx.compose.ui.text.TextStyle): androidx.compose.ui.text.TextStyle =
    if (place.titleBa != null) TeleTauText.bashkir(style.fontSize, TeleTauFontWeight.black).copy(lineHeight = style.lineHeight, letterSpacing = (-0.01).em) else style

/**
 * Тропа (prototype 01–04): места с узлами и декорациями. У текущего места вместо вывески — компактная шапка
 * (картинка-полоса, название, прогресс), над ним — плашки «на сегодня» (задание учителя, повторение). Узел «Начать»
 * виден с первого экрана; текущее место не первое — тропа открывается сразу на нём. Липкий баннер показывает место,
 * мимо которого прокручиваем. Всё открытое пройдено — сначала «На сегодня всё», тропа — по кнопке.
 */
@Composable
fun Trail(
    course: Course,
    onStart: (TrailNode) -> Unit,
    modifier: Modifier = Modifier,
    sealed: String? = null,
    busy: String? = null,
    listState: LazyListState = rememberLazyListState(),
    onReview: (() -> Unit)? = null,
    today: String = ru.teletau.feature.student.common.ufaToday(),
    /** «Пройти испытание» у закрытого места с `jump`; без обработчика предложения нет. */
    onJump: ((CourseUnit) -> Unit)? = null,
) {
    // Нажали закрытый узел — пузырь «Сначала пройди…» над ним, сам исчезает.
    var hint by remember { mutableStateOf<Pair<String, String>?>(null) }
    LaunchedEffect(hint) {
        if (hint != null) {
            kotlinx.coroutines.delay(HINT_MS)
            hint = null
        }
    }
    val onLocked: (TrailNode) -> Unit = { node -> hint = node.id to lockedHint(course, node.id) }
    val due = course.review?.due ?: 0
    val review = if (due > 0) onReview else null
    val hasPills = course.assignments.orEmpty().isNotEmpty() || review != null
    val pills: @Composable () -> Unit = { TodayPills(course, today, busy, onStart, onReview, due) }
    val unit = currentUnit(course)
    val next = nextNode(course)
    var showTrail by remember { mutableStateOf(false) }
    if (next == null && !showTrail) {
        Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = TeleTauSpace.s400), verticalArrangement = Arrangement.Center) {
            if (hasPills) Box(Modifier.padding(top = TeleTauSpace.s300)) { pills() }
            EmptyState(R.drawable.empty_all_done, "На сегодня всё", text = "Все уроки пройдены. Новые скоро появятся.", compact = hasPills) {
                TeleTauButton("На тропу", { showTrail = true }, Modifier.fillMaxWidth(), variant = if (hasPills) ru.teletau.core.designsystem.ButtonVariant.Secondary else ru.teletau.core.designsystem.ButtonVariant.Primary)
            }
        }
        return
    }
    val placeIndex = unit?.let { u -> course.units.indexOfFirst { it.id == u.id } } ?: -1
    val ahead = if (placeIndex >= 0) course.units.size - placeIndex - 1 else course.units.count { it.state == UnitState.locked }
    // Пункты списка: места (плашки — в пункте текущего места, над шапкой; текущего места нет — отдельным пунктом
    // в начале) и «Впереди ещё».
    val pillsFirst = hasPills && placeIndex < 0
    fun unitItem(ui: Int): Int = ui + if (pillsFirst) 1 else 0
    val density = androidx.compose.ui.platform.LocalDensity.current
    // Низ шапки текущего места от верха списка: пока шапка видна, баннер не нужен.
    var headBottom by remember { mutableStateOf(Float.MAX_VALUE) }
    var listBox by remember { mutableStateOf<androidx.compose.ui.layout.LayoutCoordinates?>(null) }
    // Липкий баннер места: место, мимо которого прокручиваем; не нужен, пока у верхнего края плашки, шапка места или
    // вывеска другого места.
    val bar by remember(course, pillsFirst, placeIndex, density) {
        derivedStateOf {
            val first = listState.firstVisibleItemIndex
            val ui = course.units.indices.lastOrNull { unitItem(it) <= first }
            when {
                ui == null -> null
                unitItem(ui) < first -> course.units[ui]
                ui == placeIndex -> if (headBottom < 0f) course.units[ui] else null
                listState.firstVisibleItemScrollOffset > with(density) { 180.dp.toPx() } -> course.units[ui]
                else -> null
            }
        }
    }
    // Вернулись с урока — тропа показывает только что запечатанный узел и следующий за ним, а не верх.
    // Высота вывески зависит от ширины и шрифта (надпись может уйти под картинку), поэтому место узла не угадываем:
    // открываем его место, ждём раскладки и докручиваем так, чтобы узел стоял под липким баннером.
    var sealedNode by remember { mutableStateOf<androidx.compose.ui.layout.LayoutCoordinates?>(null) }
    LaunchedEffect(sealed) {
        val id = sealed ?: return@LaunchedEffect
        val ui = course.units.indexOfFirst { u -> u.nodes.any { it.id == id } }
        if (ui < 0) return@LaunchedEffect
        listState.scrollToItem(unitItem(ui))
        val node = androidx.compose.runtime.snapshotFlow { sealedNode }.filterNotNull().first()
        androidx.compose.runtime.withFrameNanos { }
        val list = listBox ?: return@LaunchedEffect
        if (!node.isAttached || !list.isAttached) return@LaunchedEffect
        val dy = node.positionInRoot().y - list.positionInRoot().y - with(density) { 110.dp.toPx() }
        listState.scrollBy(dy)
    }
    // Текущее место не первое — тропа сразу открывается на нём: плашки и шапка места под верхней панелью (8 dp ниже
    // её края: отступ списка 12 + отступ пункта 20 − 24). Список уже прокручен (вернулись на вкладку) — не трогаем.
    LaunchedEffect(Unit) {
        if (sealed == null && placeIndex > 0 && listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset == 0) {
            listState.scrollToItem(unitItem(placeIndex), with(density) { TeleTauSpace.s600.roundToPx() })
        }
    }
    Box(modifier.fillMaxSize()) {
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize().onGloballyPositioned { listBox = it },
            contentPadding = PaddingValues(start = TeleTauSpace.s300, end = TeleTauSpace.s300, top = TeleTauSpace.s300, bottom = TeleTauSpace.s600),
        ) {
            if (pillsFirst) item(key = "today") { pills() }
            itemsIndexed(course.units, key = { _, u -> u.id }) { ui, u ->
                Column {
                  val here = ui == placeIndex
                  val tone = placeArt(u.place.slug).tone
                  if (here && hasPills) {
                      Box(Modifier.padding(top = if (ui == 0) 0.dp else TeleTauSpace.s500)) { pills() }
                  }
                  Box(
                      Modifier
                          .padding(top = if (here && hasPills || pillsFirst && ui == 0) TeleTauSpace.s200 else if (ui == 0) 0.dp else TeleTauSpace.s500)
                          .fillMaxWidth()
                          .clip(RoundedCornerShape(TeleTauRadius.sheet))
                          .background(zoneColor(tone))
                          .semantics(mergeDescendants = false) { contentDescription = "Место ${u.order} · ${u.place.titleRu} · ${u.topicRu}" }
                          .padding(start = TeleTauSpace.s250, end = TeleTauSpace.s250, top = TeleTauSpace.s250, bottom = TeleTauSpace.s200),
                  ) {
                      Column {
                          if (here) {
                              UnitHead(u, Modifier.onGloballyPositioned { head ->
                                  val list = listBox
                                  if (list != null && list.isAttached && head.isAttached) headBottom = head.positionInRoot().y + head.size.height - list.positionInRoot().y
                              })
                          } else {
                              PlaceSign(u)
                          }
                          if (u.jump != null && onJump != null) JumpOffer(loading = busy == u.id, enabled = busy == null) { onJump(u) }
                          // Под шапкой тропинка начинается сразу; у первого текущего узла — запас под пузырь «Начать».
                          val top = if (!here) 34.dp else if (u.nodes.firstOrNull()?.state == NodeState.current) 56.dp else TeleTauSpace.s200
                          UnitTrack(u, withBee = here, sealed = sealed, busy = busy, onStart = onStart, hint = hint, onLocked = onLocked, top = top, onSealedPlaced = { sealedNode = it })
                      }
                  }
                }
            }
            if (ahead > 0) {
                item(key = "end") {
                    Column(
                        Modifier.fillMaxWidth().padding(top = TeleTauSpace.s1000, bottom = TeleTauSpace.s300),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s250),
                    ) {
                        Floating { Illustration(R.drawable.bee_fly, 120.dp) }
                        KText("Впереди ещё $ahead ${plural(ahead, "место", "места", "мест")}", TeleTauText.headline, align = TextAlign.Center)
                    }
                }
            }
        }
        val shown = bar
        AnimatedVisibility(
            visible = shown != null,
            enter = fadeIn(tween(TeleTauDuration.FAST)) + slideInVertically(tween(TeleTauDuration.BASE)) { -it / 3 },
            exit = fadeOut(tween(TeleTauDuration.FAST)) + slideOutVertically(tween(TeleTauDuration.BASE)) { -it / 3 },
            modifier = Modifier.padding(horizontal = TeleTauSpace.s400, vertical = TeleTauSpace.s100),
        ) {
            // Пока баннер уезжает, показывает последнее место.
            var last by remember { mutableStateOf(shown) }
            if (shown != null) last = shown
            last?.let { UnitBar(it) }
        }
    }
}

/** «Повторить 1 слово», «Повторить 2 слова», «Повторить 5 слов». */
fun reviewTitle(due: Int): String = "Повторить $due ${plural(due, "слово", "слова", "слов")}"

/**
 * Плашки «на сегодня» над текущим местом: задания учителя (ADR 0021) и повторение слов — по строке, нажатие начинает
 * урок. Выполненное задание — зелёная строка с галочкой. Просроченных нет (сервер их не отдаёт) — ребёнка не торопим
 * и не стыдим.
 */
@Composable
fun TodayPills(course: Course, today: String, busy: String?, onStart: (TrailNode) -> Unit, onReview: (() -> Unit)?, due: Int) {
    val list = course.assignments.orEmpty().sortedBy { it.done }
    val review = if (due > 0) onReview else null
    if (list.isEmpty() && review == null) return
    val nodes = course.units.flatMap { it.nodes }
    Column(verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s200)) {
        list.forEach { a ->
            val title = ru.teletau.feature.student.common.assignmentTitle(a)
            if (a.done) {
                TodayPill(PillTone.Done, PhosphorIcons.CheckCircleFill, title, kicker = "Задание учителя выполнено")
            } else {
                val node = a.lessonId?.let { id -> nodes.firstOrNull { it.id == id } }
                // Заданный урок ещё закрыт — плашка без действия (учитель откроет его сам).
                val start: (() -> Unit)? = when {
                    a.kind == ru.teletau.core.network.models.AssignmentKind.review -> onReview
                    node != null && node.state != NodeState.locked -> ({ onStart(node) })
                    else -> null
                }
                TodayPill(
                    PillTone.Task, PhosphorIcons.ChalkboardTeacherFill, title,
                    kicker = "Задание учителя · ${ru.teletau.feature.student.common.dueForStudent(a.dueOn, today)}",
                    onClick = start, busy = node != null && busy == node.id, enabled = busy == null,
                )
            }
        }
        if (review != null) TodayPill(PillTone.Review, PhosphorIcons.ArrowsClockwiseBold, reviewTitle(due), onClick = review, enabled = busy == null)
    }
}

private enum class PillTone { Task, Review, Done }

/** Плашка «на сегодня»: значок, что сделать и «Начать» справа; вся строка — кнопка с «губой». */
@Composable
private fun TodayPill(
    tone: PillTone, icon: ImageVector, title: String, kicker: String? = null,
    onClick: (() -> Unit)? = null, busy: Boolean = false, enabled: Boolean = true,
) {
    val c = TeleTauTheme.colors
    val (edge, fill) = when (tone) {
        PillTone.Task -> c.infoFill to c.infoSoft
        PillTone.Review -> c.accentSoftBorder to c.accentSoft
        PillTone.Done -> c.successFill to c.successSoft
    }
    val shape = RoundedCornerShape(TeleTauRadius.button)
    val interaction = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val active = onClick != null && enabled && !busy
    val sink by androidx.compose.animation.core.animateDpAsState(
        if (pressed && active) TeleTauSize.lipSmall else 0.dp,
        tween(if (TeleTauTheme.reduceMotion) 0 else TeleTauDuration.PRESS), label = "PillSink",
    )
    val row: @Composable (Modifier) -> Unit = { m ->
        Row(
            m.fillMaxWidth().defaultMinSize(minHeight = 48.dp).background(fill, shape).border(TeleTauSpace.s050, edge, shape)
                .padding(start = TeleTauSpace.s150, end = TeleTauSpace.s200, top = TeleTauSpace.s100, bottom = TeleTauSpace.s100),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300),
        ) {
            if (tone == PillTone.Done) {
                Image(icon, null, Modifier.size(32.dp), colorFilter = ColorFilter.tint(c.successFill))
            } else {
                Box(
                    Modifier.size(32.dp).background(if (tone == PillTone.Task) c.infoFill else c.accentFill, RoundedCornerShape(TeleTauRadius.small)),
                    contentAlignment = Alignment.Center,
                ) { Image(icon, null, Modifier.size(TeleTauSize.iconSmall), colorFilter = ColorFilter.tint(if (tone == PillTone.Task) c.textOnFill else c.accentOn)) }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s050)) {
                if (kicker != null) KText(kicker, TeleTauText.label, color = if (tone == PillTone.Done) c.successText else c.infoText)
                KText(title, TeleTauText.headline.copy(fontSize = TeleTauFontSize.body, lineHeight = 1.15.em))
            }
            if (onClick != null) {
                val go = RoundedCornerShape(TeleTauRadius.tile)
                Box(
                    Modifier.padding(vertical = TeleTauSize.lipSmall / 2).defaultMinSize(minWidth = 72.dp, minHeight = 32.dp)
                        .drawBehind { drawRoundRect(c.accentLip, topLeft = androidx.compose.ui.geometry.Offset(0f, TeleTauSize.lipSmall.toPx()), cornerRadius = androidx.compose.ui.geometry.CornerRadius(TeleTauRadius.tile.toPx())) }
                        .background(c.accentFill, go).padding(horizontal = TeleTauSpace.s300),
                    contentAlignment = Alignment.Center,
                ) {
                    if (busy) PillSpinner(c.accentOn) else KText("Начать", TeleTauText.headline.copy(fontSize = TeleTauFontSize.callout, lineHeight = 1.em), color = c.accentOn)
                }
            }
        }
    }
    if (onClick == null) {
        row(Modifier.semantics(mergeDescendants = true) {})
        return
    }
    Box(
        Modifier.fillMaxWidth()
            .semantics(mergeDescendants = true) { if (busy) stateDescription = "Подождите" }
            .clickable(interactionSource = interaction, indication = null, enabled = active, role = androidx.compose.ui.semantics.Role.Button, onClick = onClick)
            .padding(bottom = TeleTauSize.lipSmall),
        propagateMinConstraints = true,
    ) {
        Box(Modifier.matchParentSize().offset(y = TeleTauSize.lipSmall).background(edge, shape))
        row(Modifier.offset { androidx.compose.ui.unit.IntOffset(0, sink.roundToPx()) })
    }
}

@Composable
private fun PillSpinner(color: androidx.compose.ui.graphics.Color) {
    val angle = if (TeleTauTheme.reduceMotion) {
        0f
    } else {
        val t = rememberInfiniteTransition(label = "PillSpinner")
        val a by t.animateFloat(0f, 360f, infiniteRepeatable(tween(TeleTauDuration.SPIN, easing = androidx.compose.animation.core.LinearEasing), RepeatMode.Restart), label = "PillSpinnerAngle")
        a
    }
    Canvas(Modifier.size(TeleTauSize.iconSmall).graphicsLayer { rotationZ = angle }) {
        drawArc(color, startAngle = 0f, sweepAngle = 270f, useCenter = false, style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round))
    }
}

/**
 * «Повторить N слов» в словаре: слова из пройденных уроков, срок которых наступил. Кнопка начинает короткий урок
 * повторения. Без технических объяснений — только сколько слов.
 */
@Composable
fun ReviewCard(due: Int, onReview: () -> Unit, highlighted: Boolean = false) {
    val c = TeleTauTheme.colors
    val shape = RoundedCornerShape(TeleTauRadius.card)
    // В словаре карточка медовая (prototype 55-words).
    Column(
        Modifier.fillMaxWidth().padding(bottom = TeleTauSpace.s300)
            .background(if (highlighted) c.accentSoft else c.surface, shape)
            .border(TeleTauSpace.s050, if (highlighted) c.accentSoftBorder else c.borderSubtle, shape).padding(TeleTauSpace.s400),
        verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s300),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s300)) {
            Illustration(R.drawable.bee_read, 60.dp)
            KText(reviewTitle(due), TeleTauText.headline, Modifier.weight(1f).semantics { heading() })
        }
        TeleTauButton("Начать", onReview, Modifier.fillMaxWidth(), icon = PhosphorIcons.ArrowsClockwiseBold)
    }
}

@Composable
private fun UnitBar(u: CourseUnit) {
    val c = TeleTauTheme.colors
    val (fill, lip) = when (placeArt(u.place.slug).tone) {
        PlaceTone.Honey -> c.accentFill to c.accentLip
        PlaceTone.Green -> c.successFill to c.successLip
        PlaceTone.Water -> c.infoFill to c.infoLip
    }
    val shape = RoundedCornerShape(TeleTauRadius.button)
    Box(Modifier.fillMaxWidth().clearAndSetSemantics {}) {
        Box(Modifier.matchParentSize().offset(y = TeleTauSize.lip).background(lip, shape))
        Column(Modifier.fillMaxWidth().background(fill, shape).padding(horizontal = TeleTauSpace.s400, vertical = TeleTauSpace.s250)) {
            val name = u.place.titleBa?.text ?: u.place.titleRu
            FitText(name.uppercase(), TeleTauText.caption.copy(letterSpacing = 0.06.em, localeList = ru.teletau.core.designsystem.BashkirLocale), color = c.textOnFill.copy(alpha = 0.85f), maxLines = 1)
            FitText(u.topicRu, TeleTauText.bodyLarge.copy(fontFamily = ru.teletau.core.designsystem.TeleTauFonts.display, fontWeight = TeleTauFontWeight.black), Modifier.padding(top = TeleTauSpace.s100), color = c.textOnFill)
        }
    }
}

/**
 * Шапка текущего места (вместо вывески): картинка-полоса справа растворяется в карточке, слева — название, тема и
 * сколько пройдено, по нижнему краю — тонкая медовая полоса прогресса. Компактная: тропа под ней видна с первого
 * экрана; тропинка выходит из-под шапки.
 */
@Composable
private fun UnitHead(unit: CourseUnit, modifier: Modifier = Modifier) {
    val c = TeleTauTheme.colors
    val art = placeArt(unit.place.slug)
    val done = unit.nodes.count { it.state == NodeState.done }
    val total = unit.nodes.size
    val shape = RoundedCornerShape(TeleTauRadius.panel)
    val place = unit.place.titleBa?.let { "${it.text}, ${unit.place.titleRu}" } ?: unit.place.titleRu
    BoxWithConstraints(
        modifier.zIndex(1f).fillMaxWidth().defaultMinSize(minHeight = 72.dp).clip(shape).background(c.surface)
            .clearAndSetSemantics { heading(); contentDescription = "$place, ${unit.topicRu}. Пройдено $done из $total" },
    ) {
        val w = maxWidth
        if (art.hero != null) {
            Box(
                Modifier.matchParentSize().padding(start = w * 0.44f)
                    .graphicsLayer { compositingStrategy = androidx.compose.ui.graphics.CompositingStrategy.Offscreen }
                    .drawWithContent {
                        drawContent()
                        drawRect(androidx.compose.ui.graphics.Brush.horizontalGradient(0f to androidx.compose.ui.graphics.Color.Transparent, 0.46f to c.surface), blendMode = androidx.compose.ui.graphics.BlendMode.DstIn)
                    },
            ) { IllustrationFill(art.hero, w * 0.56f, Modifier.fillMaxSize(), alignment = BiasAlignment(0.24f, 0.16f)) }
        }
        Column(
            Modifier.width(w * 0.64f).align(Alignment.CenterStart)
                .padding(start = TeleTauSpace.s400, end = TeleTauSpace.s400, top = TeleTauSpace.s250, bottom = TeleTauSpace.s350),
            verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s050),
        ) {
            // Башкирское название и русское рядом; не помещаются в строку — русское уходит вниз.
            androidx.compose.foundation.layout.FlowRow(itemVerticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s150)) {
                PlaceTitle(unit.place, TeleTauText.title3, c.textPrimary)
                if (unit.place.titleBa != null) {
                    FitText(unit.place.titleRu, TeleTauText.label.copy(fontSize = TeleTauFontSize.callout, fontWeight = TeleTauFontWeight.bold), Modifier.padding(bottom = 2.dp), color = c.textTertiary, maxLines = 1)
                }
            }
            Row(verticalAlignment = Alignment.Bottom) {
                KText("${unit.topicRu} · ", TeleTauText.footnote, Modifier.weight(1f, fill = false), color = c.textSecondary)
                KText("$done из $total", TeleTauText.footnote.copy(fontWeight = TeleTauFontWeight.bold), color = c.accentText, maxLines = 1)
            }
        }
        // Сколько пройдено — тонкой медовой полосой по нижнему краю.
        Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(6.dp).background(c.lockedFill)) {
            if (done > 0 && total > 0) {
                Box(Modifier.fillMaxWidth(done.toFloat() / total).fillMaxHeight().background(c.accentFill, RoundedCornerShape(topEnd = 3.dp, bottomEnd = 3.dp)))
            }
        }
        Box(Modifier.matchParentSize().border(TeleTauSpace.s050, c.borderSubtle, shape))
    }
}

/**
 * Вывеска места: картинка 1584×672, слева — ровный фон без рисунка ([PlaceArt.signCalm]), над орнаментом. Плашка
 * «Место N», название и тема стоят только там и не заходят на рисунок; не помещаются даже мельче (узкий экран,
 * крупный шрифт, длинное название) — надпись уходит под картинку.
 */
@Composable
internal fun PlaceSign(unit: CourseUnit) {
    val c = TeleTauTheme.colors
    val art = placeArt(unit.place.slug)
    val locked = unit.state == UnitState.locked
    val allDone = unit.nodes.isNotEmpty() && unit.nodes.all { it.state == NodeState.done }
    val ink = if (art.signOnDark) c.highlight else c.textOnFill
    val shape = RoundedCornerShape(TeleTauRadius.panel)
    val title = placeName(unit.place)
    val titleStyle = placeTitleStyle(unit.place, TeleTauText.title3)
    val topicStyle = TeleTauText.headline.copy(fontWeight = TeleTauFontWeight.extrabold, lineHeight = 1.1.em)
    val chip: @Composable () -> Unit = {
        Row(
            Modifier.background(c.highlight, RoundedCornerShape(TeleTauRadius.chip)).padding(horizontal = 11.dp, vertical = 5.dp),
            horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s150),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val icon: ImageVector? = if (locked) PhosphorIcons.LockSimpleFill else if (allDone) PhosphorIcons.CheckBold else null
            if (icon != null) Image(icon, null, Modifier.size(15.dp), colorFilter = ColorFilter.tint(c.textOnFill))
            androidx.compose.foundation.text.BasicText("Место ${unit.order}", style = TeleTauText.label.copy(letterSpacing = 0.02.em, color = c.textOnFill), softWrap = false, maxLines = 1)
        }
    }
    val measurer = androidx.compose.ui.text.rememberTextMeasurer()
    val density = androidx.compose.ui.platform.LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val signW = maxWidth
        val signH = signW * (672f / 1584f)
        // Ровный фон: слева от рисунка и над полосой орнамента (нижние ~16 % картинки).
        val calmW = signW * art.signCalm - TeleTauSpace.s350 - TeleTauSpace.s200
        val calmH = signH * 0.84f - TeleTauSpace.s250
        val scale = if (art.sign == null) null else remember(title, unit.topicRu, unit.order, locked, allDone, calmW, calmH, density) {
            with(density) {
                val chipText = measurer.measure("Место ${unit.order}", TeleTauText.label.copy(letterSpacing = 0.02.em), softWrap = false, maxLines = 1).size
                val chipH = chipText.height + 10.dp.roundToPx()
                // Плашка «Место N» не переносится: не влезает в ровный фон — надпись уходит под картинку.
                val chipW = chipText.width + 22.dp.roundToPx() + if (locked || allDone) (15.dp + TeleTauSpace.s150).roundToPx() else 0
                if (chipW > calmW.roundToPx()) null else ru.teletau.core.designsystem.fitBlock(
                    measurer, listOf(title to titleStyle, unit.topicRu to topicStyle),
                    maxWidth = calmW.roundToPx(), maxHeight = calmH.roundToPx(), extraHeight = chipH + (TeleTauSpace.s150 * 2).roundToPx(),
                )
            }
        }
        if (art.sign != null && scale != null) {
            Box(Modifier.fillMaxWidth().height(signH).clip(shape).background(c.accentSoft)) {
                IllustrationFill(art.sign, signW, Modifier.fillMaxSize())
                Column(
                    Modifier.padding(start = TeleTauSpace.s350, top = TeleTauSpace.s250).width(calmW).height(calmH),
                    verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s150, Alignment.CenterVertically),
                ) {
                    chip()
                    KText(title, titleStyle.scaledBy(scale), Modifier.semantics { heading() }, color = ink, maxLines = 2)
                    KText(unit.topicRu, topicStyle.scaledBy(scale), color = ink, maxLines = 2)
                }
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s150)) {
                if (art.sign != null) {
                    Box(Modifier.fillMaxWidth().height(signH).clip(shape).background(c.accentSoft)) { IllustrationFill(art.sign, signW, Modifier.fillMaxSize()) }
                }
                Column(Modifier.padding(horizontal = TeleTauSpace.s150, vertical = TeleTauSpace.s100), verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s150)) {
                    chip()
                    FitText(title, titleStyle, Modifier.semantics { heading() }, color = c.textPrimary)
                    FitText(unit.topicRu, topicStyle, color = c.textPrimary)
                }
            }
        }
    }
}
private fun rowTop(i: Int, gapAt: Int): Float = i * NODE_ROW + if (gapAt >= 0 && i >= gapAt) BUBBLE_GAP else 0f

private val ICON_CYCLE = listOf(NodeIcon.star, NodeIcon.chatCircleText, NodeIcon.bookOpen, NodeIcon.barbell)

private fun nodeIcon(node: TrailNode, i: Int): ImageVector = when {
    node.kind == NodeKind.helpLanguage -> PhosphorIcons.ScalesFill
    node.kind == NodeKind.placeTest -> if (node.state == NodeState.done) PhosphorIcons.CheckBold else PhosphorIcons.TrophyFill
    node.state == NodeState.done -> PhosphorIcons.CheckBold
    else -> when (node.icon ?: ICON_CYCLE[i % ICON_CYCLE.size]) {
        NodeIcon.star -> PhosphorIcons.StarFill
        NodeIcon.chatCircleText -> PhosphorIcons.ChatCircleTextFill
        NodeIcon.bookOpen -> PhosphorIcons.BookOpenFill
        NodeIcon.barbell -> PhosphorIcons.BarbellFill
    }
}

private fun stateName(node: TrailNode) = when (node.state) {
    // Засчитан сданным испытанием для перехода — выглядит как пройденный, TalkBack говорит, как именно.
    NodeState.done -> if (node.passedByTest == true) "пройден испытанием" else "пройден"
    NodeState.current -> "следующий"
    NodeState.open -> "доступен"
    NodeState.locked -> "закрыт"
}

fun nodeLabel(node: TrailNode): String {
    val what = if (node.kind == NodeKind.lesson) "Урок «${node.titleRu}»" else node.titleRu
    return if (node.state == NodeState.current) "$what — начать" else "$what, ${stateName(node)}"
}

/**
 * «Уже знаешь?» под вывеской закрытого места (`CourseUnit.jump`): испытание открывает место, не проходя уроки перед
 * ним. Пока открывается другой урок — кнопка неактивна; своё испытание открывается — на кнопке индикатор.
 */
@Composable
private fun JumpOffer(loading: Boolean, enabled: Boolean, onJump: () -> Unit) {
    val c = TeleTauTheme.colors
    val shape = RoundedCornerShape(TeleTauRadius.panel)
    // Над дорожкой: тропинка места выходит из-под блока, а не рисуется поверх его края.
    Column(
        Modifier.zIndex(1f).padding(top = TeleTauSpace.s250).fillMaxWidth()
            .background(c.surface, shape).border(TeleTauSpace.s050, c.borderSubtle, shape)
            .padding(start = TeleTauSpace.s400, end = TeleTauSpace.s400, top = TeleTauSpace.s300, bottom = TeleTauSpace.s400),
        verticalArrangement = Arrangement.spacedBy(TeleTauSpace.s250),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s250)) {
            Illustration(R.drawable.bee_think, 44.dp)
            KText("Уже знаешь?", TeleTauText.headline, Modifier.weight(1f).semantics { heading() })
        }
        TeleTauButton(
            "Пройти испытание", onJump, Modifier.fillMaxWidth(),
            variant = ru.teletau.core.designsystem.ButtonVariant.Secondary, enabled = enabled || loading, loading = loading, icon = PhosphorIcons.TrophyFill,
        )
    }
}

private fun hexState(s: NodeState) = when (s) {
    NodeState.done -> HexNodeState.Done
    NodeState.current -> HexNodeState.Current
    NodeState.open -> HexNodeState.Open
    NodeState.locked -> HexNodeState.Locked
}

/**
 * Дорожка юнита: нарисованная тропинка (медовая — пройдено, песочная — впереди), декорации места, пчела у текущего
 * узла, узлы «змейкой» с подписями и пузырём «Начать». Координаты — как в прототипе, от оси дорожки.
 */
@Composable
private fun UnitTrack(
    unit: CourseUnit, withBee: Boolean, sealed: String?, busy: String?, onStart: (TrailNode) -> Unit, hint: Pair<String, String>?, onLocked: (TrailNode) -> Unit,
    top: Dp = 34.dp,
    onSealedPlaced: (androidx.compose.ui.layout.LayoutCoordinates) -> Unit = {},
) {
    val c = TeleTauTheme.colors
    val nodes = unit.nodes
    val cur = nodes.indexOfFirst { it.state == NodeState.current }
    val gapAt = if (cur > 0) cur else -1
    val height = rowTop(nodes.size, gapAt)
    val pts = buildList {
        add(Offset(0f, -48f))
        nodes.indices.forEach { add(Offset(offsetOf(it), rowTop(it, gapAt) + NODE_MID)) }
        add(Offset(0f, height - 20f))
    }
    val lastDone = nodes.indexOfLast { it.state == NodeState.done }
    val allDone = nodes.isNotEmpty() && lastDone == nodes.size - 1
    val walked = when {
        allDone -> pts.size - 1
        cur >= 0 -> cur + 1
        lastDone >= 0 -> lastDone + 1
        else -> 0
    }
    val art = placeArt(unit.place.slug)
    val keeper = TeleTauTheme.uiMode == UiMode.Keeper
    BoxWithConstraints(Modifier.padding(top = top).fillMaxWidth().height(height.dp)) {
        val trackW = maxWidth
        val cx = trackW / 2
        Canvas(Modifier.fillMaxSize().clearAndSetSemantics {}) {
            val k = 1.dp.toPx()
            val center = size.width / 2
            fun path(from: Int, to: Int): Path = Path().apply {
                moveTo(center + pts[from].x * k, pts[from].y * k)
                for (i in from until to) {
                    val a = pts[i]
                    val b = pts[i + 1]
                    val mid = (b.y - a.y) / 2
                    cubicTo(center + a.x * k, (a.y + mid) * k, center + b.x * k, (b.y - mid) * k, center + b.x * k, b.y * k)
                }
            }
            val dash = PathEffect.dashPathEffect(floatArrayOf(1 * k, 13 * k))
            if (walked < pts.size - 1) {
                val p = path(walked, pts.size - 1)
                drawPath(p, c.textTertiary.copy(alpha = 0.12f), style = Stroke(30 * k, cap = StrokeCap.Round))
                drawPath(p, c.textTertiary.copy(alpha = 0.3f), style = Stroke(4 * k, cap = StrokeCap.Round, pathEffect = dash))
            }
            if (walked > 0) {
                val p = path(0, walked)
                drawPath(p, c.accentFill.copy(alpha = 0.38f), style = Stroke(30 * k, cap = StrokeCap.Round))
                drawPath(p, c.accentLip.copy(alpha = 0.85f), style = Stroke(4 * k, cap = StrokeCap.Round, pathEffect = dash))
            }
        }
        art.decos.filter { it.y < height + 40 }.forEachIndexed { i, d -> DecoImage(d, cx, i) }
        if (withBee && cur >= 0 && !keeper) {
            val beeW = 92f
            val beeH = beeW * 845f / 664f
            val x = offsetOf(cur) + (if (offsetOf(cur) <= 0) 92f else -92f) - beeW / 2
            val y = rowTop(cur, gapAt) + NODE_MID - beeH * 0.58f
            Box(Modifier.offset(x = cx + x.dp, y = y.dp).clearAndSetSemantics {}) { Floating { Illustration(R.drawable.bee_idle, beeW.dp) } }
        }
        nodes.forEachIndexed { i, node ->
            val top = rowTop(i, gapAt)
            val left = cx + offsetOf(i).dp - 39.dp
            Box(Modifier.offset(x = left, y = top.dp).then(if (sealed == node.id) Modifier.onGloballyPositioned(onSealedPlaced) else Modifier)) {
                TrailNodeView(node, i, sealed == node.id, busy, onStart, hint?.takeIf { it.first == node.id }?.second, onLocked, left, trackW)
            }
        }
    }
}

@Composable
private fun TrailNodeView(
    node: TrailNode, index: Int, sealed: Boolean, busy: String?, onStart: (TrailNode) -> Unit, hint: String?, onLocked: (TrailNode) -> Unit,
    left: androidx.compose.ui.unit.Dp, trackWidth: androidx.compose.ui.unit.Dp,
) {
    val c = TeleTauTheme.colors
    val reduce = TeleTauTheme.reduceMotion
    val nope = remember { Animatable(0f) }
    LaunchedEffect(hint) {
        if (hint != null && !reduce) for (x in listOf(-6f, 6f, -4f, 4f, -2f, 0f)) nope.animateTo(x, tween(TeleTauDuration.SHAKE / 6, easing = TeleTauEasing.inOut))
    }
    val seal = remember { Animatable(1f) }
    LaunchedEffect(sealed) {
        if (sealed && !reduce) {
            seal.snapTo(0.7f)
            seal.animateTo(1f, keyframes { durationMillis = TeleTauDuration.SLOW; 1.12f at (TeleTauDuration.SLOW * 0.6f).toInt() using TeleTauEasing.out })
        }
    }
    Box(Modifier.width(78.dp)) {
        HexNode(
            state = hexState(node.state),
            tone = if (node.kind == NodeKind.helpLanguage) HexNodeTone.Violet else HexNodeTone.Honey,
            icon = nodeIcon(node, index),
            label = nodeLabel(node),
            onClick = when {
                busy != null -> null
                node.state == NodeState.locked -> ({ onLocked(node) })
                else -> ({ onStart(node) })
            },
            modifier = Modifier.graphicsLayer { scaleX = seal.value; scaleY = seal.value; translationX = nope.value * density },
        )
        val current = node.state == NodeState.current
        if (node.titleRu.isNotEmpty()) {
            // Подпись под узлом: шире соты (до 150 dp), по центру под ней, но не за краем тропы; длинная —
            // в две строки между словами или мельче, чтобы не залезть на следующий узел.
            val labelW = minOf(150.dp, trackWidth - 8.dp)
            Box(
                Modifier.offset(y = 81.dp).clearAndSetSemantics {}.layout { m, cons ->
                    val p = m.measure(androidx.compose.ui.unit.Constraints(maxWidth = labelW.roundToPx()))
                    val box = 78.dp.roundToPx()
                    val minX = (4.dp - left).roundToPx()
                    val maxX = (trackWidth - 4.dp - left).roundToPx() - p.width
                    layout(box, p.height) { p.place(((box - p.width) / 2).coerceIn(minX, maxOf(minX, maxX)), 0) }
                },
            ) {
                FitText(
                    node.titleRu,
                    if (current) TeleTauText.label.copy(fontSize = TeleTauFontSize.footnote, letterSpacing = 0.01.em) else TeleTauText.label.copy(letterSpacing = 0.01.em),
                    color = if (current) c.accentText else c.textSecondary,
                    align = TextAlign.Center,
                    maxLines = 2,
                    maxHeight = 28.dp,
                    minScale = 0.7f,
                )
            }
        }
        if (current) {
            Box(Modifier.offset(y = (-48).dp).width(78.dp).clearAndSetSemantics {}, contentAlignment = Alignment.TopCenter) {
                Bobbing { StartBubble() }
            }
        }
        if (hint != null) {
            // Пузырь стоит над узлом: низ стрелки — у верха соты, ширина — по тексту, не шире 210 dp.
            Box(
                Modifier.zIndex(3f).layout { m, cons ->
                    val p = m.measure(cons.copy(minWidth = 0, maxWidth = 210.dp.roundToPx()))
                    val w = 78.dp.roundToPx()
                    layout(w, 0) { p.place((w - p.width) / 2, -p.height + 2.dp.roundToPx()) }
                },
            ) { LockedHint(hint) }
        }
    }
}

/** Подпись под узлом не переносится и может быть шире ячейки (как `white-space: nowrap` в прототипе). */
private fun Modifier.wrapUnbounded(): Modifier = this.then(Modifier.layout { measurable, constraints ->
    val p = measurable.measure(constraints.copy(minWidth = 0, maxWidth = androidx.compose.ui.unit.Constraints.Infinity))
    layout(constraints.constrainWidth(p.width), p.height) { p.place((constraints.constrainWidth(p.width) - p.width) / 2, 0) }
})

/** Сколько держится подсказка у закрытого узла, мс. */
private const val HINT_MS = 3200L

/** Подсказка у закрытого узла: какой урок пройти сначала. */
fun lockedHint(course: Course, nodeId: String): String {
    val all = course.units.flatMap { it.nodes }
    val i = all.indexOfFirst { it.id == nodeId }
    val before = all.getOrNull(i - 1)
    return if (before != null && (before.state == NodeState.current || before.state == NodeState.open)) "Сначала пройди «${before.titleRu}»" else "Сначала пройди предыдущие уроки"
}

/** Тёмный пузырь с замком над закрытым узлом (веб `.track__hint`); TalkBack читает его сразу. */
@Composable
private fun LockedHint(text: String) {
    val c = TeleTauTheme.colors
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Row(
            Modifier.background(c.textPrimary, RoundedCornerShape(TeleTauRadius.tile))
                .padding(horizontal = TeleTauSpace.s350, vertical = TeleTauSpace.s250)
                .semantics { liveRegion = androidx.compose.ui.semantics.LiveRegionMode.Polite; contentDescription = text },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(TeleTauSpace.s200),
        ) {
            Image(PhosphorIcons.LockSimpleFill, null, Modifier.size(TeleTauSize.iconSmall), colorFilter = ColorFilter.tint(c.bg))
            KText(text, TeleTauText.label.copy(fontSize = TeleTauFontSize.footnote), color = c.bg)
        }
        Canvas(Modifier.size(16.dp, 8.dp)) {
            drawPath(Path().apply { moveTo(0f, 0f); lineTo(size.width / 2, size.height); lineTo(size.width, 0f); close() }, c.textPrimary)
        }
    }
}

@Composable
private fun StartBubble() {
    val c = TeleTauTheme.colors
    val shape = RoundedCornerShape(TeleTauRadius.tile)
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.wrapUnbounded()) {
        Box(Modifier.background(c.surface, shape).border(TeleTauSpace.s050, c.borderDefault, shape).padding(horizontal = TeleTauSpace.s400, vertical = TeleTauSpace.s250)) {
            KText("Начать", TeleTauText.headline.copy(fontSize = TeleTauFontSize.body, letterSpacing = 0.02.em, lineHeight = 1.em), color = c.accentText)
        }
        Canvas(Modifier.size(16.dp, 9.dp).offset(y = (-2).dp)) {
            val p = Path().apply { moveTo(0f, 0f); lineTo(size.width / 2, size.height); lineTo(size.width, 0f); close() }
            drawPath(p, c.surface)
            val edge = Path().apply { moveTo(0f, 0f); lineTo(size.width / 2, size.height); lineTo(size.width, 0f) }
            drawPath(edge, c.borderDefault, style = Stroke(2.dp.toPx()))
        }
    }
}

/** Пчела плавает вверх-вниз (токен float); при «Убрать анимацию» — неподвижна. */
@Composable
fun Floating(content: @Composable () -> Unit) {
    if (TeleTauTheme.reduceMotion) return content()
    val t = rememberInfiniteTransition(label = "Float")
    val dy by t.animateFloat(0f, -7f, infiniteRepeatable(tween(TeleTauDuration.FLOAT / 2, easing = TeleTauEasing.inOut), RepeatMode.Reverse), label = "FloatY")
    Box(Modifier.graphicsLayer { translationY = dy * density }) { content() }
}

@Composable
private fun Bobbing(content: @Composable () -> Unit) {
    if (TeleTauTheme.reduceMotion) return content()
    val t = rememberInfiniteTransition(label = "Bob")
    val dy by t.animateFloat(0f, -4f, infiniteRepeatable(tween(TeleTauDuration.BOB / 2, easing = TeleTauEasing.inOut), RepeatMode.Reverse), label = "BobY")
    Box(Modifier.graphicsLayer { translationY = dy * density }) { content() }
}

@Composable
private fun DecoImage(d: Deco, cx: Dp, index: Int) {
    val aspect = ru.teletau.core.designsystem.illustrationAspect(d.art)
    val h = d.w / aspect
    val reduce = TeleTauTheme.reduceMotion
    val motion = if (reduce) null else d.motion
    val phase = (index % 4) * 0.25f
    val anim = if (motion != null) {
        val t = rememberInfiniteTransition(label = "Deco")
        val period = when (motion) {
            DecoMotion.Sway -> TeleTauDuration.SWAY
            DecoMotion.Roll -> TeleTauDuration.ROLL
            DecoMotion.Rock -> TeleTauDuration.ROCK
            DecoMotion.Leap -> TeleTauDuration.LEAP
        }
        val v by t.animateFloat(-1f, 1f, infiniteRepeatable(tween(period / 2, delayMillis = (period * phase / 2).toInt(), easing = TeleTauEasing.inOut), RepeatMode.Reverse), label = "DecoMove")
        v
    } else {
        0f
    }
    Box(
        Modifier
            .offset(x = cx + (d.x - d.w / 2).dp, y = (d.y - h / 2).dp)
            .clearAndSetSemantics {}
            .graphicsLayer {
                rotationZ = d.rot + when (motion) {
                    DecoMotion.Sway -> anim * 2f
                    DecoMotion.Rock -> anim * 3f
                    else -> 0f
                }
                translationX = if (motion == DecoMotion.Roll) anim * 4f * density else 0f
                translationY = if (motion == DecoMotion.Leap) (if (anim > 0.6f) -(anim - 0.6f) * 30f * density else 0f) else 0f
                scaleX = if (d.flip) -1f else 1f
                transformOrigin = TransformOrigin(0.5f, if (motion == DecoMotion.Sway) 1f else 0.5f)
            },
    ) { Illustration(d.art, d.w.dp) }
}
