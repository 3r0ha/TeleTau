package ru.teletau.feature.student

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.size
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import ru.teletau.core.designsystem.KText
import ru.teletau.core.designsystem.TeleTauDuration
import ru.teletau.core.designsystem.TeleTauRadius
import ru.teletau.core.designsystem.TeleTauSize
import ru.teletau.core.designsystem.TeleTauSpace
import ru.teletau.core.designsystem.TeleTauText
import ru.teletau.core.designsystem.TeleTauTheme
import ru.teletau.core.designsystem.LoadingBlock
import ru.teletau.core.designsystem.R
import ru.teletau.core.designsystem.StudentTab
import ru.teletau.core.designsystem.StudentTabBar
import ru.teletau.core.designsystem.UiMode
import ru.teletau.core.network.models.UiMode as ApiUiMode
import ru.teletau.feature.student.common.LoadError
import ru.teletau.feature.student.common.Resource
import ru.teletau.feature.student.common.Splash
import ru.teletau.feature.student.learn.FlowState
import ru.teletau.feature.student.learn.LearnTopBar
import ru.teletau.feature.student.learn.LeagueUpScreen
import ru.teletau.feature.student.learn.LessonLoading
import ru.teletau.feature.student.learn.LessonPlayer
import ru.teletau.feature.student.learn.LessonSaving
import ru.teletau.feature.student.learn.NothingToDo
import ru.teletau.feature.student.learn.ResultScreen
import ru.teletau.feature.student.learn.StreakScreen
import ru.teletau.feature.student.learn.Trail
import ru.teletau.feature.student.login.ClassCodeScreen
import ru.teletau.feature.student.login.JoinedScreen
import ru.teletau.feature.student.login.NicknamePicker
import ru.teletau.feature.student.login.NicknameScreen
import ru.teletau.feature.student.login.ScanScreen
import ru.teletau.feature.student.login.SettingsScreen
import ru.teletau.feature.student.login.WaitScreen
import ru.teletau.feature.student.login.WelcomeScreen
import ru.teletau.feature.student.tabs.HiveView
import ru.teletau.feature.student.tabs.LeagueView
import ru.teletau.feature.student.tabs.BoardView
import ru.teletau.feature.student.tabs.ProfileView
import ru.teletau.feature.student.tabs.studentClass
import ru.teletau.feature.student.tabs.WordsView
import ru.teletau.feature.student.tabs.LoginCardView
import ru.teletau.feature.student.tabs.JoinClassView
import ru.teletau.feature.student.login.SelfStartScreen

/** Возрастной режим по `Me.uiMode`; до входа — «Пчёлка» (возраст неизвестен, крупные цели подходят всем). */
fun uiModeOf(mode: ApiUiMode?, signedIn: Boolean): UiMode = when {
    !signedIn -> UiMode.Bee
    mode == ApiUiMode.bee -> UiMode.Bee
    mode == ApiUiMode.keeper -> UiMode.Keeper
    else -> UiMode.Bortnik
}

/**
 * Приложение ученика: тема и возрастной режим, стек экранов, системный «Назад» (Material 3: назад — к предыдущему
 * экрану, с вкладки — на «Путь», с корня — из приложения; во время урока — «Уже уходишь?»).
 */
@Composable
fun StudentApp(vm: StudentViewModel, darkTheme: Boolean, reduceMotion: Boolean) {
    val routes by vm.routes.collectAsStateWithLifecycle()
    val account by vm.account.collectAsStateWithLifecycle()
    val route = routes.last()
    val flow by vm.flow.collectAsStateWithLifecycle()
    val codeStep by vm.codeStep.collectAsStateWithLifecycle()
    val signedIn = account != null && route !is Route.Welcome && route != Route.Scan && route != Route.ClassCode && route != Route.Wait && route != Route.Settings
    val activity = LocalActivity.current
    val webBase by vm.webBase.collectAsStateWithLifecycle()
    TeleTauTheme(darkTheme = darkTheme, uiMode = uiModeOf(account?.uiMode, signedIn), reduceMotion = reduceMotion) {
      androidx.compose.runtime.CompositionLocalProvider(
        ru.teletau.feature.student.common.LocalSpeaker provides vm.speaker,
        ru.teletau.feature.student.common.LocalWebBase provides webBase,
        ru.teletau.feature.student.common.LocalUiSounds provides vm.sounds,
      ) {
        // На корне стека «Назад» не перехватывается: система сама закрывает приложение с предиктивной анимацией.
        val handlesBack = routes.size > 1 ||
            (route is Route.Main && (route.tab != StudentTab.Path || flow !is FlowState.Trail)) ||
            (route == Route.ClassCode && codeStep == ru.teletau.feature.student.login.CodeStep.Nick)
        BackHandler(enabled = handlesBack) { if (!vm.onBack()) activity?.finish() }
        Box(Modifier.fillMaxSize().background(TeleTauTheme.colors.bg)) {
            AnimatedContent(
                targetState = route,
                contentKey = { it::class },
                transitionSpec = {
                    if (reduceMotion) fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                    else (fadeIn(tween(TeleTauDuration.BASE)) + slideInHorizontally(tween(TeleTauDuration.BASE)) { it / 12 }) togetherWith fadeOut(tween(TeleTauDuration.FAST))
                },
                label = "Routes",
            ) { r -> RouteContent(vm, r) }
            ToastHost(vm)
        }
      }
    }
}

@Composable
private fun RouteContent(vm: StudentViewModel, r: Route) {
    val context = LocalContext.current
    val brand = stringResource(R.string.teletau_start_brand)
    when (r) {
        Route.Splash -> {
            val error by vm.startupError.collectAsStateWithLifecycle()
            val e = error
            if (e == null) Splash(brand) else Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars), contentAlignment = Alignment.Center) {
                LoadError(e, vm::retryStartup, secondary = "Войти заново" to vm::startOver)
            }
        }
        Route.Welcome -> {
            val ended by vm.ended.collectAsStateWithLifecycle()
            // Фраза дня: тихо, раз на адрес сервера; пары нет или API молчит — карточки нет.
            LaunchedEffect(Unit) { vm.loadPhraseOfDay() }
            val phrase by vm.phrase.collectAsStateWithLifecycle()
            // Кабинет учителя и вход взрослого по почте — на сайте.
            val site = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(vm.teacherUrl))) }; Unit }
            WelcomeScreen(brand, ended, phrase, onStudent = vm::openScan, onSelf = vm::openSelf, onTeacher = site, onCard = vm::openScan, onEmail = site, onSettings = vm::openSettings)
        }
        Route.Settings -> {
            val url by vm.apiBaseUrl.collectAsStateWithLifecycle()
            val web by vm.webBaseOverride.collectAsStateWithLifecycle()
            val health by vm.health.collectAsStateWithLifecycle()
            SettingsScreen(url, web, ::webBaseFor, health, vm.appVersion, vm::checkServer, vm::saveServer, onBack = { vm.onBack() })
        }
        Route.SelfStart -> {
            val step by vm.selfStep.collectAsStateWithLifecycle()
            val age by vm.age.collectAsStateWithLifecycle()
            SelfStartScreen(step, age, vm::pickAge, vm::selfNext, onBack = { vm.onBack() }) {
                Picker(vm, "Начать", vm::selfNext)
            }
        }
        Route.LoginCard -> TabScaffold(StudentTab.Me, vm::selectTab) {
            val me by vm.account.collectAsStateWithLifecycle()
            val card by vm.card.collectAsStateWithLifecycle()
            val busy by vm.cardBusy.collectAsStateWithLifecycle()
            val error by vm.cardError.collectAsStateWithLifecycle()
            val confirm by vm.cardConfirm.collectAsStateWithLifecycle()
            val webBase by vm.webBase.collectAsStateWithLifecycle()
            TabScroll {
                SubTop("Профиль") { vm.onBack() }
                me?.let {
                    LoginCardView(
                        it, card, busy, error, confirm, brand, Uri.parse(webBase).authority ?: webBase,
                        onIssue = vm::issueCard, onAskNew = vm::askNewCard, onCancelNew = vm::cancelNewCard,
                        onReload = vm::loadCard, onBack = { vm.onBack() }, onSaved = vm::cardSaved,
                    )
                }
            }
        }
        Route.JoinClass -> TabScaffold(StudentTab.Hive, vm::selectTab) {
            val me by vm.account.collectAsStateWithLifecycle()
            val state by vm.join.collectAsStateWithLifecycle()
            val code by vm.code.collectAsStateWithLifecycle()
            val error by vm.codeError.collectAsStateWithLifecycle()
            val busy by vm.submitting.collectAsStateWithLifecycle()
            TabScroll {
                SubTop("Класс") { vm.onBack() }
                me?.let { JoinClassView(it, state, code, error, busy, vm::onCode, vm::submitJoinClass, vm::joinAgain) }
            }
        }
        Route.Words -> TabScaffold(StudentTab.Me, vm::selectTab) {
            val words by vm.words.collectAsStateWithLifecycle()
            TabScroll {
                when (val w = words) {
                    is Resource.Ready -> WordsView(w.data, onBack = { vm.onBack() }, onReview = vm::reviewFromWords, onTrail = { vm.selectTab(StudentTab.Path) })
                    is Resource.Failed -> LoadError(w.error, vm::loadWords)
                    Resource.Loading -> LoadingBlock("Открываем словарь", rows = 5)
                }
            }
        }
        Route.Board -> TabScaffold(StudentTab.League, vm::selectTab) {
            val board by vm.board.collectAsStateWithLifecycle()
            val period by vm.boardPeriod.collectAsStateWithLifecycle()
            TabScroll {
                when (val b = board) {
                    is Resource.Ready -> BoardView(b.data, period, vm::pickBoardPeriod, onBack = { vm.onBack() })
                    is Resource.Failed -> LoadError(b.error, vm::loadBoard)
                    Resource.Loading -> LoadingBlock("Открываем доску", rows = 5)
                }
            }
        }
        Route.Scan -> {
            val scan by vm.scan.collectAsStateWithLifecycle()
            val ended by vm.ended.collectAsStateWithLifecycle()
            ScanScreen(scan, ended, vm::onScanned, vm::openClassCode, onBack = { vm.onBack() }, onReset = vm::resetScan)
        }
        Route.ClassCode -> {
            val step by vm.codeStep.collectAsStateWithLifecycle()
            val code by vm.code.collectAsStateWithLifecycle()
            val error by vm.codeError.collectAsStateWithLifecycle()
            ClassCodeScreen(step, code, error, vm::onCode, vm::codeNext, onBack = { vm.onBack() }) { Picker(vm, "Отправить заявку", vm::submitJoin) }
        }
        Route.Wait -> {
            val state by vm.wait.collectAsStateWithLifecycle()
            WaitScreen(state, vm::waitAgain, vm::waitLeave)
        }
        Route.Nickname -> NicknameScreen(leaving = false, onLeave = vm::notMyCard) { Picker(vm, "Выбрать", vm::submitNick) }
        Route.Joined -> {
            val me by vm.account.collectAsStateWithLifecycle()
            val leaving by vm.leaving.collectAsStateWithLifecycle()
            me?.let { JoinedScreen(it, leaving, vm::goTrail, vm::askLeave, vm::stay, vm::logout) }
        }
        is Route.Main -> MainShell(vm, r.tab)
    }
}

@Composable
private fun Picker(vm: StudentViewModel, label: String, onSubmit: () -> Unit) {
    val nicks by vm.nicks.collectAsStateWithLifecycle()
    val picked by vm.picked.collectAsStateWithLifecycle()
    val submitting by vm.submitting.collectAsStateWithLifecycle()
    val error by vm.submitError.collectAsStateWithLifecycle()
    NicknamePicker(nicks, picked, vm::pickNick, vm::loadNicks, label, submitting, error, onSubmit)
}

/** Каркас вкладок: урок и экраны после урока — во весь экран, иначе — содержимое вкладки и нижняя навигация. */
@Composable
private fun MainShell(vm: StudentViewModel, tab: StudentTab) {
    val flow by vm.flow.collectAsStateWithLifecycle()
    if (tab == StudentTab.Path) {
        when (val f = flow) {
            is FlowState.Starting -> return LessonLoading(onLeave = { vm.onBack() })
            is FlowState.Lesson -> return LessonPlayer(f.lesson, vm::check, vm::next, vm::quit, vm::stayInLesson, vm::leaveLesson, vm::hintOpened)
            is FlowState.Empty -> return NothingToDo(f.node.kind, vm::continueFlow)
            is FlowState.Completing -> return LessonSaving(f.failed, vm::retryComplete, vm::leaveLesson)
            is FlowState.Result -> return ResultScreen(f.after.run, f.after.summary, vm.placeOf(f.after.node), vm::continueFlow)
            is FlowState.Streak -> return StreakScreen(f.after.summary, vm::continueFlow)
            is FlowState.Achievement -> return ru.teletau.feature.student.learn.NewAchievementScreen(f.after.summary, vm::continueFlow)
            is FlowState.LeagueUp -> {
                val busy by vm.leagueBusy.collectAsStateWithLifecycle()
                return LeagueUpScreen(f.after.summary, busy, vm::continueFlow)
            }
            is FlowState.Trail -> Unit
        }
    }
    LaunchedEffect(tab) {
        when (tab) {
            StudentTab.League -> vm.loadLeague()
            StudentTab.Hive -> vm.loadHive()
            StudentTab.Me -> vm.loadProfile()
            StudentTab.Path -> vm.refreshTrail()
        }
    }
    Box(Modifier.fillMaxSize()) {
        TabScaffold(tab, vm::selectTab) {
            when (tab) {
                StudentTab.Path -> PathTab(vm, (flow as? FlowState.Trail)?.sealed)
                StudentTab.League -> TabScroll { LeagueTab(vm) }
                StudentTab.Hive -> TabScroll { HiveTab(vm) }
                StudentTab.Me -> TabScroll { ProfileTab(vm) }
            }
        }
        if (tab == StudentTab.Path) IntroOverlay(vm)
    }
}

/** Каркас вкладки: содержимое в колонке под строкой состояния и нижняя навигация ученика. */
@Composable
fun TabScaffold(tab: StudentTab, onSelect: (StudentTab) -> Unit, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize().background(TeleTauTheme.colors.bg)) {
        Box(Modifier.windowInsetsPadding(WindowInsets.statusBars).weight(1f).fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
            Box(Modifier.widthIn(max = TeleTauSize.columnNarrow).fillMaxSize()) { content() }
        }
        StudentTabBar(tab, onSelect)
    }
}

/** Прокручиваемое содержимое вкладки с полями колонки. */
@Composable
fun TabScroll(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = TeleTauSpace.s400, end = TeleTauSpace.s400, bottom = TeleTauSpace.s600)) { content() }
}

@Composable
private fun PathTab(vm: StudentViewModel, sealed: String?) {
    val course by vm.course.collectAsStateWithLifecycle()
    val progress by vm.progress.collectAsStateWithLifecycle()
    val flow by vm.flow.collectAsStateWithLifecycle()
    val list = rememberLazyListState()
    Column(Modifier.fillMaxSize()) {
        LearnTopBar((progress as? Resource.Ready)?.data, onLeague = { vm.selectTab(StudentTab.League) })
        when (val c = course) {
            is Resource.Ready -> Trail(c.data, vm::start, sealed = sealed, busy = (flow as? FlowState.Starting)?.node?.id, listState = list, onReview = vm::startReview, onJump = vm::startJump)
            is Resource.Failed -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadError(c.error, vm::loadTrail) }
            Resource.Loading -> Box(Modifier.padding(horizontal = TeleTauSpace.s400)) { LoadingBlock("Открываем тропу", rows = 4) }
        }
    }
}

/** Знакомство с пчелой поверх тропы и навигации: первый заход (ещё ни одного урока), на этом устройстве — один раз. */
@Composable
private fun IntroOverlay(vm: StudentViewModel) {
    val me by vm.account.collectAsStateWithLifecycle()
    val closed by vm.introClosed.collectAsStateWithLifecycle()
    val progress by vm.progress.collectAsStateWithLifecycle()
    val course by vm.course.collectAsStateWithLifecycle()
    val flow by vm.flow.collectAsStateWithLifecycle()
    val id = me?.id ?: return
    val p = (progress as? Resource.Ready)?.data ?: return
    val k = (course as? Resource.Ready)?.data ?: return
    val seen = androidx.compose.runtime.remember(id, closed) { vm.introSeen(id) }
    if (seen || p.lessonsCompleted > 0 || flow !is FlowState.Trail || ru.teletau.feature.student.learn.nextNode(k) == null) return
    ru.teletau.feature.student.learn.TrailIntro(p.dailyGoal?.target ?: me?.dailyGoal ?: 2, vm::closeIntro, vm::introStart)
}

@Composable
private fun LeagueTab(vm: StudentViewModel) {
    val league by vm.league.collectAsStateWithLifecycle()
    when (val l = league) {
        is Resource.Ready -> LeagueView(l.data, onTrail = { vm.selectTab(StudentTab.Path) }, onBoard = vm::openBoard)
        is Resource.Failed -> LoadError(l.error, vm::loadLeague)
        Resource.Loading -> LoadingBlock("Загружаем лигу", rows = 5)
    }
}

@Composable
private fun HiveTab(vm: StudentViewModel) {
    val me by vm.account.collectAsStateWithLifecycle()
    val hive by vm.hive.collectAsStateWithLifecycle()
    val klass = studentClass(me)
    if (me != null && klass == null) {
        ru.teletau.feature.student.tabs.NoClassView(me!!, vm::openJoin) { vm.selectTab(StudentTab.League) }
        return
    }
    when (val h = hive) {
        is Resource.Ready -> if (klass != null) HiveView(h.data, klass.title, klass.schoolName)
        is Resource.Failed -> LoadError(h.error, vm::loadHive)
        Resource.Loading -> LoadingBlock("Загружаем улей", rows = 2)
    }
}

@Composable
private fun ProfileTab(vm: StudentViewModel) {
    val me by vm.account.collectAsStateWithLifecycle()
    val progress by vm.progress.collectAsStateWithLifecycle()
    val cells by vm.cells.collectAsStateWithLifecycle()
    val course by vm.course.collectAsStateWithLifecycle()
    val fresh by vm.fresh.collectAsStateWithLifecycle()
    val leaving by vm.leaving.collectAsStateWithLifecycle()
    val words by vm.words.collectAsStateWithLifecycle()
    val achievements by vm.achievements.collectAsStateWithLifecycle()
    val soundsOn by vm.sounds.enabled.collectAsStateWithLifecycle()
    val context = LocalContext.current
    // Кабинет учителя — на сайте.
    val teacher = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(vm.teacherUrl))) }; Unit }
    val m = me
    val p = (progress as? Resource.Ready)?.data
    val c = (cells as? Resource.Ready)?.data
    val k = (course as? Resource.Ready)?.data
    val error = (progress as? Resource.Failed)?.error ?: (cells as? Resource.Failed)?.error ?: (course as? Resource.Failed)?.error
    when {
        m != null && p != null && c != null && k != null -> ProfileView(
            m, p, c, k, fresh, leaving, (words as? Resource.Ready)?.data, vm::openWords, vm::openCard, vm::openGoal,
            sounds = soundsOn, onSounds = vm::setSounds, onDarkTheme = vm::setDarkTheme, onTeacher = teacher,
            achievements = (achievements as? Resource.Ready)?.data,
            onLeave = vm::askLeave, onStay = vm::stay, onLogout = vm::logout,
        )
        error != null -> LoadError(error, vm::loadProfile)
        else -> LoadingBlock("Загружаем профиль", rows = 4)
    }
    GoalDialog(vm)
}

/** Короткое сообщение внизу экрана (нет связи, урок не открылся) — само исчезает через 4 с. */
@Composable
private fun ToastHost(vm: StudentViewModel) {
    val toast by vm.toast.collectAsStateWithLifecycle()
    LaunchedEffect(toast) {
        if (toast != null) {
            delay(4000)
            vm.dismissToast()
        }
    }
    Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars), contentAlignment = Alignment.BottomCenter) {
        AnimatedVisibility(toast != null, enter = slideInVertically { it } + fadeIn(), exit = slideOutVertically { it } + fadeOut()) {
            val c = TeleTauTheme.colors
            Box(
                Modifier.padding(start = TeleTauSpace.s400, end = TeleTauSpace.s400, bottom = 96.dp())
                    .widthIn(max = TeleTauSize.columnNarrow).fillMaxWidth()
                    .background(c.textPrimary, RoundedCornerShape(TeleTauRadius.button))
                    .clickable { vm.dismissToast() }
                    .semantics { liveRegion = LiveRegionMode.Polite }
                    .padding(horizontal = TeleTauSpace.s400, vertical = TeleTauSpace.s300),
            ) { KText(toast.orEmpty(), TeleTauText.callout, color = c.bg) }
        }
    }
}

private fun Int.dp() = androidx.compose.ui.unit.Dp(this.toFloat())

/** Строка «‹ Профиль» над экраном поверх вкладки. */
@Composable
private fun SubTop(label: String, onBack: () -> Unit) {
    val c = TeleTauTheme.colors
    androidx.compose.foundation.layout.Row(
        Modifier.padding(top = TeleTauSpace.s300).androidxClip().clickable(onClick = onBack).padding(horizontal = TeleTauSpace.s100).androidxMinTouch(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(TeleTauSpace.s100),
    ) {
        androidx.compose.foundation.Image(ru.teletau.core.designsystem.PhosphorIcons.CaretLeftBold, null, Modifier.androidxIcon(), colorFilter = androidx.compose.ui.graphics.ColorFilter.tint(c.accentText))
        KText(label, TeleTauText.label.copy(fontSize = ru.teletau.core.designsystem.TeleTauFontSize.footnote), color = c.accentText)
    }
}

private fun Modifier.androidxClip(): Modifier = this.then(Modifier.clip(RoundedCornerShape(TeleTauRadius.small)))
private fun Modifier.androidxMinTouch(): Modifier = this.then(Modifier.defaultMinSize(minHeight = TeleTauSize.touchMin))
private fun Modifier.androidxIcon(): Modifier = this.then(Modifier.size(TeleTauSize.iconSmall))

/** «Цель дня» в профиле: 1, 2 или 3 урока (PATCH /me dailyGoal). */
@Composable
private fun GoalDialog(vm: StudentViewModel) {
    val open by vm.goalDialog.collectAsStateWithLifecycle()
    if (!open) return
    val goal by vm.goal.collectAsStateWithLifecycle()
    val busy by vm.submitting.collectAsStateWithLifecycle()
    val error by vm.submitError.collectAsStateWithLifecycle()
    GoalDialogView(goal, vm::pickGoal, busy, error, vm::saveGoal, vm::closeGoal)
}

/** Лист «Цель дня» — как на вебе: «1 урок в день · 5 минут», «2 урока в день · 10 минут», «3 урока в день · 15 минут» и «Сохранить». */
@Composable
fun GoalDialogView(goal: Int, onPick: (Int) -> Unit, busy: Boolean, error: String?, onSave: () -> Unit, onClose: () -> Unit) {
    ru.teletau.core.designsystem.TeleTauDialog("Цель дня", onDismiss = onClose) {
        ru.teletau.feature.student.login.GoalPicker(goal, onPick)
        if (error != null) ru.teletau.core.designsystem.InlineAlert(error, tone = ru.teletau.core.designsystem.AlertTone.Danger)
        ru.teletau.core.designsystem.TeleTauButton("Сохранить", onSave, Modifier.fillMaxWidth().padding(top = TeleTauSpace.s300), loading = busy)
        ru.teletau.core.designsystem.LinkButton("Отмена", onClose, tone = ru.teletau.core.designsystem.LinkTone.Neutral)
    }
}
