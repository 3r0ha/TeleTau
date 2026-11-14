package ru.teletau.feature.student

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ru.teletau.core.authcodes.ClassCodeCodec
import ru.teletau.core.authcodes.ClassCodeParseError
import ru.teletau.core.authcodes.ClassCodeParseResult
import ru.teletau.core.authcodes.LoginCardCodec
import ru.teletau.core.authcodes.LoginCardKind
import ru.teletau.core.authcodes.LoginCardParseResult
import ru.teletau.core.designsystem.StudentTab
import ru.teletau.core.network.models.AttemptAnswer
import ru.teletau.core.network.models.AttemptRequest
import ru.teletau.core.network.models.ClassHive
import ru.teletau.core.network.models.Course
import ru.teletau.core.network.models.CourseUnit
import ru.teletau.core.network.models.JoinRequestStatus
import ru.teletau.core.network.models.LeagueOutcome
import ru.teletau.core.network.models.LeagueResultSeenRequest
import ru.teletau.core.network.models.LeagueStanding
import ru.teletau.core.network.models.Me
import ru.teletau.core.network.models.MyAchievements
import ru.teletau.core.network.models.MyCellsPage
import ru.teletau.core.network.models.MyProgress
import ru.teletau.core.network.models.MyWords
import ru.teletau.core.network.models.NicknameSuggestion
import ru.teletau.core.network.models.NodeKind
import ru.teletau.core.network.models.NodeState
import ru.teletau.core.network.models.PhraseOfDayPair
import ru.teletau.core.network.models.PublicLeaderboard
import ru.teletau.core.network.models.PublicLeaderboardPeriod
import ru.teletau.core.network.models.StartLessonRunRequest
import ru.teletau.core.network.models.TrailNode
import ru.teletau.core.network.models.UpdateMeRequest
import ru.teletau.core.session.ApiProblem
import ru.teletau.core.session.TeleTauClient
import ru.teletau.core.session.NetworkFailure
import ru.teletau.core.session.SessionState
import ru.teletau.core.session.Uuid7
import ru.teletau.core.session.apiCall
import ru.teletau.core.session.apiCallUnit
import ru.teletau.core.session.isShortRateLimit
import ru.teletau.feature.student.common.Resource
import ru.teletau.feature.student.common.data
import ru.teletau.feature.student.common.describeForChild
import ru.teletau.feature.student.common.sessionEndedText
import ru.teletau.feature.student.learn.FlowEvent
import ru.teletau.feature.student.learn.FlowState
import ru.teletau.feature.student.learn.LessonPlace
import ru.teletau.feature.student.learn.NodeRef
import ru.teletau.feature.student.learn.REVIEW_NODE
import ru.teletau.feature.student.learn.jumpNode
import ru.teletau.feature.student.learn.toRunKind
import ru.teletau.core.network.models.RunKind
import ru.teletau.feature.student.learn.currentExercise
import ru.teletau.feature.student.learn.id
import ru.teletau.feature.student.learn.initialFlow
import ru.teletau.feature.student.learn.reduce
import ru.teletau.feature.student.login.CodeStep
import ru.teletau.feature.student.login.HealthState
import ru.teletau.feature.student.login.ScanState
import ru.teletau.feature.student.login.WaitState
import ru.teletau.feature.student.tabs.FreshHoney
import ru.teletau.feature.student.tabs.studentClass

/** Экран приложения (стек — системный «Назад» снимает верхний). */
sealed interface Route {
    data object Splash : Route
    data object Welcome : Route
    data object Settings : Route
    data object Scan : Route
    data object ClassCode : Route
    data object Wait : Route
    data object Nickname : Route
    data object Joined : Route
    data class Main(val tab: StudentTab = StudentTab.Path) : Route
    /** «Мой словарь» — поверх вкладки «Профиль». */
    data object Words : Route
    /** «Учусь сам»: возраст → ник → цель дня. */
    data object SelfStart : Route
    /** «Моя карточка входа» — поверх вкладки «Профиль». */
    data object LoginCard : Route
    /** «Вступить в класс» — поверх вкладки «Класс». */
    data object JoinClass : Route
    /** «Доска почёта» — поверх вкладки «Лига» (публичный топ школ и классов, вход с лиги). */
    data object Board : Route
}

/** Заявка по коду класса — только в памяти, не дольше срока (контракт: pollToken не хранить дольше заявки). */
private data class JoinTicket(val requestId: String, val pollToken: String, val classTitle: String, val nickname: String, val pollIntervalSeconds: Int)

/** Отказы входа по личной карточке — свои тексты (как PERSONAL_CARD_ERRORS веба). */
private val PERSONAL_CARD_ERRORS = mapOf(
    "card_invalid" to "Карточка не найдена. Сделай новую в профиле на устройстве, где ты уже вошёл.",
    "card_revoked" to "Эта карточка больше не действует: ты сделал новую. Покажи её.",
)

private val CODE_ERRORS = mapOf(
    ClassCodeParseError.EMPTY to "Введи код с доски.",
    ClassCodeParseError.INVALID_CHARACTER to "Только латинские буквы и цифры.",
    ClassCodeParseError.INVALID_LENGTH to "В коде 6 символов.",
)

/**
 * Состояние приложения ученика: стек экранов, сессия, вход (QR, код класса, ник), автомат урока и данные вкладок.
 * Побочные эффекты автомата — как LearnFlow.tsx веба: runId и attemptId — UUIDv7 клиента, повтор после сбоя сети
 * уходит с тем же идентификатором (сервер не засчитает дважды).
 */
class StudentViewModel(private val env: StudentEnvironment) : ViewModel() {
    private val client: TeleTauClient get() = env.client.value

    private val _routes = MutableStateFlow<List<Route>>(listOf(Route.Splash))
    val routes: StateFlow<List<Route>> = _routes.asStateFlow()

    private val _account = MutableStateFlow<Me?>(null)
    val account: StateFlow<Me?> = _account.asStateFlow()

    private val _startupError = MutableStateFlow<Throwable?>(null)
    val startupError: StateFlow<Throwable?> = _startupError.asStateFlow()

    /** Сервер завершил сессию — текст для экрана входа. */
    private val _ended = MutableStateFlow<String?>(null)
    val ended: StateFlow<String?> = _ended.asStateFlow()

    // ── фраза дня (старт, публичная витрина без регистрации) ──
    private val _phrase = MutableStateFlow<PhraseOfDayPair?>(null)

    /** Пара дня для карточки на старте; null — карточки нет (пары нет или API молчит). */
    val phrase: StateFlow<PhraseOfDayPair?> = _phrase.asStateFlow()

    /** Адрес сервера, для которого фраза уже запрошена; смена адреса — новый запрос. */
    private var phraseForUrl: String? = null

    private val _toast = MutableStateFlow<String?>(null)
    val toast: StateFlow<String?> = _toast.asStateFlow()

    // ── вход ──
    private val _scan = MutableStateFlow<ScanState>(ScanState.Idle)
    val scan: StateFlow<ScanState> = _scan.asStateFlow()
    private val _codeStep = MutableStateFlow(CodeStep.Code)
    val codeStep: StateFlow<CodeStep> = _codeStep.asStateFlow()
    private val _code = MutableStateFlow("")
    val code: StateFlow<String> = _code.asStateFlow()
    private val _codeError = MutableStateFlow<String?>(null)
    val codeError: StateFlow<String?> = _codeError.asStateFlow()
    private val _nicks = MutableStateFlow<Resource<List<NicknameSuggestion>>>(Resource.Loading)
    val nicks: StateFlow<Resource<List<NicknameSuggestion>>> = _nicks.asStateFlow()
    private val _picked = MutableStateFlow<String?>(null)
    val picked: StateFlow<String?> = _picked.asStateFlow()
    private val _submitting = MutableStateFlow(false)
    val submitting: StateFlow<Boolean> = _submitting.asStateFlow()
    private val _submitError = MutableStateFlow<String?>(null)
    val submitError: StateFlow<String?> = _submitError.asStateFlow()
    private val _wait = MutableStateFlow<WaitState>(WaitState.Missing)
    val wait: StateFlow<WaitState> = _wait.asStateFlow()
    private val _health = MutableStateFlow<HealthState>(HealthState.Idle)
    val health: StateFlow<HealthState> = _health.asStateFlow()
    private val _leaving = MutableStateFlow(false)
    val leaving: StateFlow<Boolean> = _leaving.asStateFlow()

    // ── обучение ──
    private val _flow = MutableStateFlow(initialFlow)
    val flow: StateFlow<FlowState> = _flow.asStateFlow()
    private val _course = MutableStateFlow<Resource<Course>>(Resource.Loading)
    val course: StateFlow<Resource<Course>> = _course.asStateFlow()
    private val _progress = MutableStateFlow<Resource<MyProgress>>(Resource.Loading)
    val progress: StateFlow<Resource<MyProgress>> = _progress.asStateFlow()
    private val _league = MutableStateFlow<Resource<LeagueStanding>>(Resource.Loading)
    val league: StateFlow<Resource<LeagueStanding>> = _league.asStateFlow()
    private val _hive = MutableStateFlow<Resource<ClassHive>>(Resource.Loading)
    val hive: StateFlow<Resource<ClassHive>> = _hive.asStateFlow()
    // ── доска почёта (публичная, без токена) ──
    private val _board = MutableStateFlow<Resource<PublicLeaderboard>>(Resource.Loading)
    val board: StateFlow<Resource<PublicLeaderboard>> = _board.asStateFlow()
    /** Период доски — состояние экрана; по умолчанию неделя (как в контракте). */
    private val _boardPeriod = MutableStateFlow(PublicLeaderboardPeriod.week)
    val boardPeriod: StateFlow<PublicLeaderboardPeriod> = _boardPeriod.asStateFlow()
    private val _cells = MutableStateFlow<Resource<MyCellsPage>>(Resource.Loading)
    val cells: StateFlow<Resource<MyCellsPage>> = _cells.asStateFlow()
    private val _fresh = MutableStateFlow<FreshHoney?>(null)
    val fresh: StateFlow<FreshHoney?> = _fresh.asStateFlow()
    private val _words = MutableStateFlow<Resource<MyWords>>(Resource.Loading)
    val words: StateFlow<Resource<MyWords>> = _words.asStateFlow()
    /** Награды профиля; не загрузились — блока «Награды» нет, остальной профиль на месте. */
    private val _achievements = MutableStateFlow<Resource<MyAchievements>>(Resource.Loading)
    val achievements: StateFlow<Resource<MyAchievements>> = _achievements.asStateFlow()
    // ── «Учусь сам», карточка входа, класс ──
    private val _selfStep = MutableStateFlow(ru.teletau.feature.student.login.SelfStep.Age)
    val selfStep: StateFlow<ru.teletau.feature.student.login.SelfStep> = _selfStep.asStateFlow()
    private val _age = MutableStateFlow<ru.teletau.core.network.models.AgeBand?>(null)
    val age: StateFlow<ru.teletau.core.network.models.AgeBand?> = _age.asStateFlow()
    private val _goal = MutableStateFlow(ru.teletau.feature.student.login.DEFAULT_GOAL)
    val goal: StateFlow<Int> = _goal.asStateFlow()
    private val _card = MutableStateFlow<Resource<ru.teletau.core.network.models.LoginCard?>>(Resource.Loading)
    val card: StateFlow<Resource<ru.teletau.core.network.models.LoginCard?>> = _card.asStateFlow()
    private val _cardBusy = MutableStateFlow(false)
    val cardBusy: StateFlow<Boolean> = _cardBusy.asStateFlow()
    private val _cardError = MutableStateFlow<String?>(null)
    val cardError: StateFlow<String?> = _cardError.asStateFlow()
    private val _cardConfirm = MutableStateFlow(false)
    val cardConfirm: StateFlow<Boolean> = _cardConfirm.asStateFlow()
    private val _join = MutableStateFlow<ru.teletau.feature.student.tabs.JoinState>(ru.teletau.feature.student.tabs.JoinState.Code)
    val join: StateFlow<ru.teletau.feature.student.tabs.JoinState> = _join.asStateFlow()
    private val _goalDialog = MutableStateFlow(false)
    val goalDialog: StateFlow<Boolean> = _goalDialog.asStateFlow()
    private var joinJob: Job? = null
    private val _leagueBusy = MutableStateFlow(false)
    val leagueBusy: StateFlow<Boolean> = _leagueBusy.asStateFlow()

    private var ticket: JoinTicket? = null
    private var pollJob: Job? = null
    private var shownAt = 0L
    /** Подсказки к условию (номера в `hints`), открытые до ответа на текущий показ упражнения; новый показ — с нуля. */
    private val hintsOpened = mutableSetOf<Int>()
    private var goalDoneBefore = false

    init {
        viewModelScope.launch {
            env.client.collectLatest { c ->
                c.session.state.collect { s ->
                    when (s) {
                        is SessionState.Authenticated -> _account.value = s.account
                        is SessionState.Anonymous -> onSignedOut(s.reason)
                        SessionState.Unknown -> Unit
                    }
                }
            }
        }
        restore()
    }

    // ── навигация ──
    private val top: Route get() = _routes.value.last()

    private fun push(r: Route) = _routes.update { it + r }
    private fun replaceAll(vararg r: Route) { _routes.value = r.toList() }
    private fun replaceTop(r: Route) = _routes.update { it.dropLast(1) + r }

    /** Системный «Назад». false — выйти из приложения (корень стека). */
    fun onBack(): Boolean {
        val r = top
        if (r is Route.Main && r.tab == StudentTab.Path) {
            when (val f = _flow.value) {
                is FlowState.Lesson -> { dispatch(if (f.lesson.quit) FlowEvent.Stay else FlowEvent.Quit); return true }
                is FlowState.Starting -> { dispatch(FlowEvent.RunFailed); return true }
                is FlowState.Completing -> { if (f.failed) dispatch(FlowEvent.Leave); return true }
                is FlowState.Result, is FlowState.Streak, is FlowState.Achievement, is FlowState.Empty -> { continueFlow(); return true }
                is FlowState.LeagueUp -> { continueFlow(); return true }
                is FlowState.Trail -> Unit
            }
        }
        if (r is Route.Main && r.tab != StudentTab.Path) { selectTab(StudentTab.Path); return true }
        if (r == Route.ClassCode && _codeStep.value == CodeStep.Nick) { _codeStep.value = CodeStep.Code; return true }
        // Ушли с ожидания — опрос заявки прекращается (сама заявка остаётся у учителя до решения или срока).
        if (r == Route.Wait) { pollJob?.cancel(); ticket = null }
        if (r == Route.SelfStart && _selfStep.value != ru.teletau.feature.student.login.SelfStep.Age) {
            _selfStep.value = ru.teletau.feature.student.login.SelfStep.entries[_selfStep.value.ordinal - 1]
            return true
        }
        if (r == Route.JoinClass) { joinJob?.cancel(); _join.value = ru.teletau.feature.student.tabs.JoinState.Code }
        if (_routes.value.size > 1) { _routes.update { it.dropLast(1) }; return true }
        return false
    }

    fun openSettings() { _health.value = HealthState.Idle; push(Route.Settings) }
    fun openScan() { _scan.value = ScanState.Idle; push(Route.Scan) }
    fun openClassCode() {
        _codeStep.value = CodeStep.Code
        _codeError.value = null
        _submitError.value = null
        push(Route.ClassCode)
    }

    fun selectTab(tab: StudentTab) {
        if (top == Route.Words || top == Route.LoginCard || top == Route.JoinClass || top == Route.Board) _routes.update { it.dropLast(1) }
        val r = top
        if (r !is Route.Main) return
        // Данные вкладки загружает сам экран вкладки при показе (MainShell).
        replaceTop(Route.Main(tab))
    }

    fun dismissToast() { _toast.value = null }
    private fun toast(text: String) { _toast.value = text }

    // ── сессия ──
    private fun restore() {
        _startupError.value = null
        viewModelScope.launch {
            val started = env.now()
            val next: List<Route> = try {
                when (val s = client.session.restore()) {
                    is SessionState.Authenticated -> homeOf(s.account)
                    else -> listOf(Route.Welcome)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Без сети, но вход сохранён — открываем тропу (там «Нет связи» с повтором).
                val cached = client.session.cachedAccount()
                if (cached != null && e is NetworkFailure) {
                    _account.value = cached
                    homeOf(cached)
                } else if (e is NetworkFailure || e is ApiProblem) {
                    _startupError.value = e
                    return@launch
                } else {
                    listOf(Route.Welcome)
                }
            }
            val wait = 700 - (env.now() - started)
            if (wait > 0) delay(wait)
            _routes.value = next
            if (next.first() is Route.Main) loadTrail()
        }
    }

    fun retryStartup() = restore()

    /** Начать без восстановления (сеть не вернулась, а нужен вход заново). */
    fun startOver() {
        _startupError.value = null
        replaceAll(Route.Welcome)
    }

    /**
     * Фраза дня для карточки на старте: грузится тихо, раз на адрес сервера. API молчит или пары нет — карточки
     * нет, старт не ломается (как «Сәләм!»/ничего на веб-лендинге).
     */
    fun loadPhraseOfDay() {
        val url = env.apiBaseUrl.value
        if (phraseForUrl == url) return
        phraseForUrl = url
        _phrase.value = null
        viewModelScope.launch {
            _phrase.value = try {
                client.getPhraseOfDay().pair
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Витрина необязательна: без фразы старт выглядит как обычно.
                null
            }
        }
    }

    private fun homeOf(me: Me): List<Route> = if (me.nickname == null) listOf(Route.Nickname).also { loadNicks() } else listOf(Route.Main(StudentTab.Path))

    private fun onSignedOut(reason: String?) {
        _account.value = null
        val r = top
        if (r is Route.Main || r == Route.Joined || r == Route.Nickname) {
            _ended.value = sessionEndedText(reason)
            resetLearning()
            replaceAll(Route.Welcome)
        }
    }

    private fun resetLearning() {
        _flow.value = initialFlow
        _course.value = Resource.Loading
        _progress.value = Resource.Loading
        _league.value = Resource.Loading
        _hive.value = Resource.Loading
        _cells.value = Resource.Loading
        _words.value = Resource.Loading
        _achievements.value = Resource.Loading
        _card.value = Resource.Loading
        _fresh.value = null
    }

    fun askLeave() { _leaving.value = true }
    fun stay() { _leaving.value = false }
    fun logout() {
        _leaving.value = false
        viewModelScope.launch {
            client.logout()
            _ended.value = null
            resetLearning()
            replaceAll(Route.Welcome)
        }
    }

    // ── настройки ──
    val apiBaseUrl: StateFlow<String> get() = env.apiBaseUrl
    val webBaseOverride: StateFlow<String?> get() = env.webBaseOverride
    val appVersion: String get() = env.appVersion
    val speaker get() = env.speaker
    val sounds get() = env.sounds
    val theme get() = env.theme

    /** «Тёмная тема» в профиле: выбор на устройстве. */
    fun setDarkTheme(on: Boolean) = env.theme.setDark(on)

    /** «Звуки» в профиле; включили — сразу короткий звук, чтобы было слышно, что работает. */
    fun setSounds(on: Boolean) {
        env.sounds.setEnabled(on)
        if (on) env.sounds.play(ru.teletau.feature.student.common.UiSound.Correct)
    }

    // ── знакомство с пчелой (первый заход на тропу, ещё ни одного урока) ──
    private val _introClosed = MutableStateFlow<String?>(null)

    /** Аккаунт, для которого знакомство закрыли в этой сессии. */
    val introClosed: StateFlow<String?> = _introClosed.asStateFlow()

    /** Видел ли ученик знакомство на этом устройстве. */
    fun introSeen(accountId: String): Boolean = _introClosed.value == accountId || env.introSeen(accountId)

    /** «Пропустить» / «Посмотреть тропу»: больше не показывать на этом устройстве. */
    fun closeIntro() {
        val id = _account.value?.id ?: return
        env.saveIntroSeen(id)
        _introClosed.value = id
    }

    /** «Начать урок» на последнем листе: закрыть знакомство и сразу первый урок. */
    fun introStart() {
        closeIntro()
        _course.value.data?.let { ru.teletau.feature.student.learn.nextNode(it) }?.let(::start)
    }

    /** Адрес сайта: заданный вручную или выведенный из адреса API (записи «/audio/…», кабинет учителя). */
    val webBase: StateFlow<String> = combine(env.apiBaseUrl, env.webBaseOverride) { api, web -> web ?: webBaseFor(api) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, env.webBaseOverride.value ?: webBaseFor(env.apiBaseUrl.value))

    val teacherUrl: String get() = webBase.value + "/teacher/login"

    fun checkServer(url: String) {
        _health.value = HealthState.Checking
        viewModelScope.launch {
            _health.value = try {
                apiCall { env.probe(normalizeUrl(url)).system.getHealth() }
                HealthState.Ok
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiProblem) {
                if (e.status == 503) HealthState.Ok else HealthState.Failed("Сервер ответил с ошибкой ${e.status}.")
            } catch (_: Exception) {
                HealthState.Failed("Нет связи с сервером. Проверьте адрес и что телефон в той же сети Wi‑Fi.")
            }
        }
    }

    fun saveServer(url: String, web: String) {
        val normalized = normalizeUrl(url)
        val webUrl = web.trim().takeIf { it.isNotEmpty() }?.let(::normalizeUrl)
        val changed = normalized != env.apiBaseUrl.value
        env.setServer(normalized, webUrl)
        if (changed) {
            resetLearning()
            replaceAll(Route.Welcome)
        } else {
            onBack()
        }
    }

    private fun normalizeUrl(url: String): String {
        val u = url.trim().trimEnd('/')
        return if (u.startsWith("http://") || u.startsWith("https://")) u else "http://$u"
    }

    // ── вход по QR ──
    fun resetScan() { _scan.value = ScanState.Idle }

    fun onScanned(raw: String) {
        val parsed = LoginCardCodec.parse(raw)
        if (parsed !is LoginCardParseResult.Ok) {
            _scan.value = ScanState.Error("Это не карточка ученика. Попробуй ещё раз.")
            return
        }
        _scan.value = ScanState.Pending
        viewModelScope.launch {
            try {
                // Сканер один для обеих карточек (ADR 0022): TT1 — место класса, TP1 — личная «Учусь сам».
                val personal = parsed.card.kind == LoginCardKind.PERSONAL
                val me = try {
                    withShortRetry { if (personal) client.loginWithLoginCard(parsed.card.payload) else client.loginWithQr(parsed.card.payload) }
                } catch (e: ApiProblem) {
                    if (personal && e.code in PERSONAL_CARD_ERRORS) {
                        _scan.value = ScanState.Error(PERSONAL_CARD_ERRORS.getValue(e.code!!))
                        return@launch
                    }
                    throw e
                }
                _account.value = me
                _ended.value = null
                _scan.value = ScanState.Idle
                if (me.nickname != null) {
                    replaceAll(Route.Main(StudentTab.Path))
                    loadTrail()
                } else {
                    replaceAll(Route.Nickname)
                    loadNicks()
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _scan.value = ScanState.Error(describeForChild(e))
            }
        }
    }

    /** Короткий 429 — очередь, а не блокировка: молча повторить (как retry.ts веба). */
    private suspend fun <T> withShortRetry(block: suspend () -> T): T {
        repeat(2) {
            try {
                return block()
            } catch (e: ApiProblem) {
                if (!e.isShortRateLimit()) throw e
                delay(((e.retryAfter ?: 1).coerceAtLeast(1)) * 1000L)
            }
        }
        return block()
    }

    // ── «Учусь сам» ──
    fun openSelf() {
        _selfStep.value = ru.teletau.feature.student.login.SelfStep.Age
        _age.value = null
        _goal.value = ru.teletau.feature.student.login.DEFAULT_GOAL
        _submitError.value = null
        push(Route.SelfStart)
    }

    fun pickAge(a: ru.teletau.core.network.models.AgeBand) { _age.value = a }
    fun pickGoal(g: Int) { _goal.value = g }

    fun selfNext() {
        when (_selfStep.value) {
            ru.teletau.feature.student.login.SelfStep.Age -> if (_age.value != null) {
                _selfStep.value = ru.teletau.feature.student.login.SelfStep.Nick
                if (_nicks.value !is Resource.Ready) loadNicks()
            }
            ru.teletau.feature.student.login.SelfStep.Nick -> startSelf(null)
        }
    }

    /** «Начать»: аккаунт без ПДн и сразу тропа. Цель дня не передаётся — сервер ставит 2 (меняется в профиле). */
    fun startSelf(goal: Int?) {
        val age = _age.value ?: return
        val nick = _picked.value ?: return
        _submitting.value = true
        _submitError.value = null
        viewModelScope.launch {
            try {
                val me = withShortRetry { client.startSelf(nick, age, goal) }
                _account.value = me
                _ended.value = null
                replaceAll(Route.Main(StudentTab.Path))
                loadTrail()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _submitError.value = describeForChild(e)
            } finally {
                _submitting.value = false
            }
        }
    }

    // ── карточка входа ──
    fun openCard() {
        _cardError.value = null
        _cardConfirm.value = false
        push(Route.LoginCard)
        loadCard()
    }

    fun loadCard() {
        if (_account.value?.loginCard == null) return
        _card.value = Resource.Loading
        viewModelScope.launch {
            _card.value = try {
                Resource.Ready(apiCall { client.identity.getMyLoginCard() })
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiProblem) {
                if (e.status == 404) Resource.Ready(null) else Resource.Failed(e)
            } catch (e: Exception) {
                Resource.Failed(e)
            }
        }
    }

    fun askNewCard() { _cardConfirm.value = true }
    fun cancelNewCard() { _cardConfirm.value = false }

    /** «Сделать карточку» / «Сделать новую»: прежняя сразу перестаёт действовать, здесь вход остаётся. */
    fun issueCard() {
        _cardBusy.value = true
        _cardError.value = null
        viewModelScope.launch {
            try {
                val fresh = apiCall { client.identity.issueMyLoginCard() }
                _card.value = Resource.Ready(fresh)
                _cardConfirm.value = false
                _account.value?.takeIf { it.loginCard != ru.teletau.core.network.models.LoginCardStatus.issued }?.let {
                    val me = it.copy(loginCard = ru.teletau.core.network.models.LoginCardStatus.issued)
                    client.session.updateAccount(me)
                    _account.value = me
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _cardError.value = describeForChild(e)
                _cardConfirm.value = false
            } finally {
                _cardBusy.value = false
            }
        }
    }

    fun cardSaved(ok: Boolean) {
        if (ok) toast("Картинка сохранена в галерею.") else _cardError.value = "Не получилось сохранить картинку. Сделай снимок экрана."
    }

    // ── вступить в класс ──
    fun openJoin() {
        _join.value = ru.teletau.feature.student.tabs.JoinState.Code
        _code.value = ""
        _codeError.value = null
        push(Route.JoinClass)
    }

    fun submitJoinClass() {
        when (val p = ClassCodeCodec.parse(_code.value)) {
            is ClassCodeParseResult.Error -> { _codeError.value = CODE_ERRORS[p.error]; return }
            is ClassCodeParseResult.Ok -> Unit
        }
        _submitting.value = true
        _codeError.value = null
        viewModelScope.launch {
            try {
                val t = withShortRetry { apiCall { client.identity.requestClassJoin(ru.teletau.core.network.models.ClassJoinRequest(_code.value)) } }
                _join.value = ru.teletau.feature.student.tabs.JoinState.Waiting(t.propertyClass.title)
                pollJoin(t.requestId, t.propertyClass.title, t.pollIntervalSeconds)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _codeError.value = describeForChild(e)
            } finally {
                _submitting.value = false
            }
        }
    }

    private fun pollJoin(requestId: String, title: String, interval: Int) {
        joinJob?.cancel()
        joinJob = viewModelScope.launch {
            while (true) {
                delay(interval.coerceAtLeast(1) * 1000L)
                try {
                    val t = apiCall { client.identity.getClassJoinStatus(requestId) }
                    when (t.status) {
                        JoinRequestStatus.approved -> {
                            val me = apiCall { client.identity.getMe() }
                            client.session.updateAccount(me)
                            _account.value = me
                            _join.value = ru.teletau.feature.student.tabs.JoinState.Code
                            replaceAll(Route.Main(StudentTab.Hive))
                            loadHive()
                            return@launch
                        }
                        JoinRequestStatus.rejected -> { _join.value = ru.teletau.feature.student.tabs.JoinState.Rejected; return@launch }
                        JoinRequestStatus.expired, JoinRequestStatus.consumed -> { _join.value = ru.teletau.feature.student.tabs.JoinState.Expired; return@launch }
                        JoinRequestStatus.pending -> _join.value = ru.teletau.feature.student.tabs.JoinState.Waiting(title)
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: ApiProblem) {
                    if (e.status == 404) { _join.value = ru.teletau.feature.student.tabs.JoinState.Expired; return@launch }
                    _join.value = ru.teletau.feature.student.tabs.JoinState.Waiting(title, describeForChild(e))
                } catch (e: Exception) {
                    _join.value = ru.teletau.feature.student.tabs.JoinState.Waiting(title, describeForChild(e))
                }
            }
        }
    }

    fun joinAgain() {
        joinJob?.cancel()
        _code.value = ""
        _join.value = ru.teletau.feature.student.tabs.JoinState.Code
    }

    // ── цель дня ──
    fun openGoal() { _goal.value = _account.value?.dailyGoal ?: ru.teletau.feature.student.login.DEFAULT_GOAL; _submitError.value = null; _goalDialog.value = true }
    fun closeGoal() { _goalDialog.value = false }

    fun saveGoal() {
        _submitting.value = true
        _submitError.value = null
        viewModelScope.launch {
            try {
                val me = apiCall { client.identity.updateMe(UpdateMeRequest(dailyGoal = _goal.value)) }
                client.session.updateAccount(me)
                _account.value = me
                _goalDialog.value = false
                load(_progress) { apiCall { client.progress.getMyProgress() } }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _submitError.value = describeForChild(e)
            } finally {
                _submitting.value = false
            }
        }
    }

    // ── ник ──
    fun loadNicks() {
        _picked.value = null
        _nicks.value = Resource.Loading
        viewModelScope.launch {
            _nicks.value = try {
                Resource.Ready(apiCall { client.identity.suggestNicknames(3) }.items)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Resource.Failed(e)
            }
        }
    }

    fun pickNick(id: String) { _picked.value = id }

    /** Первый вход по карточке: PATCH /me { nicknameId } → «Ты в классе». */
    fun submitNick() {
        val id = _picked.value ?: return
        _submitting.value = true
        _submitError.value = null
        viewModelScope.launch {
            try {
                val me = apiCall { client.identity.updateMe(UpdateMeRequest(nicknameId = id)) }
                client.session.updateAccount(me)
                _account.value = me
                replaceAll(Route.Joined)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _submitError.value = describeForChild(e)
            } finally {
                _submitting.value = false
            }
        }
    }

    /** «Это не моя карточка — выйти». */
    fun notMyCard() {
        viewModelScope.launch {
            client.logout()
            replaceAll(Route.Welcome, Route.Scan)
        }
    }

    // ── код класса ──
    fun onCode(v: String) {
        _code.value = v
        _codeError.value = null
    }

    fun codeNext() {
        when (val p = ClassCodeCodec.parse(_code.value)) {
            is ClassCodeParseResult.Error -> _codeError.value = CODE_ERRORS[p.error]
            is ClassCodeParseResult.Ok -> {
                _codeError.value = null
                _codeStep.value = CodeStep.Nick
                if (_nicks.value !is Resource.Ready) loadNicks()
            }
        }
    }

    fun submitJoin() {
        val nickId = _picked.value ?: return
        val nick = _nicks.value.data?.firstOrNull { it.id == nickId } ?: return
        _submitting.value = true
        _submitError.value = null
        viewModelScope.launch {
            try {
                val t = withShortRetry { client.requestClassCode(_code.value, nickId) }
                ticket = JoinTicket(t.requestId, t.pollToken, t.propertyClass.title, nick.text, t.pollIntervalSeconds)
                _code.value = ""
                _wait.value = WaitState.Pending(t.propertyClass.title, nick.text)
                replaceTop(Route.Wait)
                startPolling()
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiProblem) {
                if (e.code == "class_code_not_found") {
                    _codeError.value = describeForChild(e)
                    _codeStep.value = CodeStep.Code
                } else {
                    _submitError.value = describeForChild(e)
                }
            } catch (e: Exception) {
                _submitError.value = describeForChild(e)
            } finally {
                _submitting.value = false
            }
        }
    }

    private fun startPolling() {
        pollJob?.cancel()
        val t = ticket ?: run { _wait.value = WaitState.Missing; return }
        pollJob = viewModelScope.launch {
            while (true) {
                try {
                    val res = client.pollClassCode(t.requestId, t.pollToken)
                    val approved = res.session
                    if (approved != null) {
                        _account.value = approved.account
                        ticket = null
                        replaceAll(Route.Joined)
                        return@launch
                    }
                    when (res.status) {
                        JoinRequestStatus.pending -> {
                            _wait.value = WaitState.Pending(t.classTitle, t.nickname)
                            delay(res.pollIntervalSeconds.coerceAtLeast(1) * 1000L)
                        }
                        JoinRequestStatus.rejected -> { ticket = null; _wait.value = WaitState.Rejected; return@launch }
                        JoinRequestStatus.expired -> { ticket = null; _wait.value = WaitState.Expired; return@launch }
                        else -> { ticket = null; _wait.value = WaitState.Consumed; return@launch }
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: ApiProblem) {
                    when (e.status) {
                        404 -> { ticket = null; _wait.value = WaitState.Expired; return@launch }
                        403 -> {
                            ticket = null
                            _wait.value = if (e.code == "class_archived") WaitState.Closed("Класс закрыт", describeForChild(e)) else WaitState.Closed("Вход закрыт", "Подойди к учителю.")
                            return@launch
                        }
                        else -> {
                            _wait.value = WaitState.Pending(t.classTitle, t.nickname, error = describeForChild(e))
                            delay(maxOf(3, t.pollIntervalSeconds) * 1000L)
                        }
                    }
                } catch (e: Exception) {
                    _wait.value = WaitState.Pending(t.classTitle, t.nickname, offline = true)
                    delay(maxOf(3, t.pollIntervalSeconds) * 1000L)
                }
            }
        }
    }

    fun waitAgain() {
        pollJob?.cancel()
        ticket = null
        _codeStep.value = CodeStep.Code
        replaceTop(Route.ClassCode)
    }

    fun waitLeave() {
        pollJob?.cancel()
        ticket = null
        replaceAll(Route.Welcome, Route.Scan)
    }

    fun goTrail() {
        replaceAll(Route.Main(StudentTab.Path))
        loadTrail()
    }

    // ── данные вкладок ──
    private fun <T> load(target: MutableStateFlow<Resource<T>>, block: suspend () -> T) {
        val old = target.value.data
        target.value = if (old != null) Resource.Ready(old, refreshing = true) else Resource.Loading
        viewModelScope.launch {
            target.value = try {
                Resource.Ready(block())
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (old != null && e is NetworkFailure) Resource.Ready(old).also { toast("Нет связи. Проверь интернет.") } else Resource.Failed(e)
            }
        }
    }

    fun loadTrail() {
        load(_course) { apiCall { client.learning.getCourse() } }
        load(_progress) { apiCall { client.progress.getMyProgress() } }
    }

    /** Вернулись на «Путь» с другой вкладки — тихо обновить тропу (новые задания учителя), не стирая экран. */
    fun refreshTrail() {
        if (_course.value is Resource.Ready && _flow.value is FlowState.Trail) loadTrail()
    }

    fun loadLeague() = load(_league) { apiCall { client.competition.getCurrentLeague() } }

    /** «Доска почёта» с вкладки «Лига»: публичный топ школ и классов за период. */
    fun openBoard() {
        push(Route.Board)
        loadBoard()
    }

    fun loadBoard() = load(_board) { client.getPublicLeaderboard(_boardPeriod.value) }

    /** Сменили период сегментом — грузим доску заново: прошлая неделя на месте месяца ввести в заблуждение. */
    fun pickBoardPeriod(period: PublicLeaderboardPeriod) {
        if (_boardPeriod.value == period) return
        _boardPeriod.value = period
        _board.value = Resource.Loading
        loadBoard()
    }

    fun loadHive() {
        val klass = studentClass(_account.value) ?: return
        load(_hive) { apiCall { client.competition.getClassHive(klass.id) } }
    }

    fun loadWords() = load(_words) { apiCall { client.learning.listMyWords() } }

    /** «Мой словарь» из профиля. */
    fun openWords() {
        push(Route.Words)
        loadWords()
    }

    /** «Повторить» в словаре: на тропу и сразу повторение. */
    fun reviewFromWords() {
        replaceAll(Route.Main(StudentTab.Path))
        startReview()
    }

    fun loadProfile() {
        // Словарь не обязателен для профиля: без него карточка «Мой словарь» — без чисел.
        load(_words) { apiCall { client.learning.listMyWords() } }
        load(_progress) { apiCall { client.progress.getMyProgress() } }
        if (_course.value !is Resource.Ready) load(_course) { apiCall { client.learning.getCourse() } }
        loadAchievements()
        val id = _account.value?.id
        viewModelScope.launch {
            _cells.value = _cells.value.data?.let { Resource.Ready(it, true) } ?: Resource.Loading
            _cells.value = try {
                val page = apiCall { client.consensus.listMyCorpusCells(limit = 1) }
                if (id != null) {
                    val seen = env.cellsSeen(id)
                    val (matured, _, honeyFinal) = page.summary
                    if (seen != null && matured > seen.first) _fresh.value = FreshHoney(matured - seen.first, maxOf(0, honeyFinal - seen.second))
                    env.saveCellsSeen(id, matured, honeyFinal)
                }
                Resource.Ready(page)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Resource.Failed(e)
            }
        }
    }

    /** Награды тихо: без тоста о сети; при сбое остаются прежние, а если их не было — блок не показывается. */
    private fun loadAchievements() {
        val old = _achievements.value.data
        _achievements.value = if (old != null) Resource.Ready(old, refreshing = true) else Resource.Loading
        viewModelScope.launch {
            _achievements.value = try {
                Resource.Ready(apiCall { client.learning.listMyAchievements() })
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (old != null) Resource.Ready(old) else Resource.Failed(e)
            }
        }
    }

    /** Новые награды из итога урока — сразу в профиль, не дожидаясь перезагрузки. */
    private fun mergeAchievements(fresh: List<ru.teletau.core.network.models.Achievement>) {
        val cur = _achievements.value.data ?: return
        val byId = fresh.associateBy { it.id }
        val list = cur.achievements.map { byId[it.id] ?: it }
        _achievements.value = Resource.Ready(cur.copy(achievements = list, earned = list.count { it.earnedOn != null }))
    }

    // ── урок ──
    private fun dispatch(e: FlowEvent) {
        val before = _flow.value
        val after = reduce(before, e)
        _flow.value = after
        if (after is FlowState.Lesson) {
            val l = after.lesson
            val beforeKey = (before as? FlowState.Lesson)?.lesson?.let { "${it.queue.firstOrNull()}:${it.shownBefore[it.queue.firstOrNull()]}" }
            val afterKey = "${l.queue.firstOrNull()}:${l.shownBefore[l.queue.firstOrNull()]}"
            if (beforeKey != afterKey) {
                shownAt = env.now()
                hintsOpened.clear()
            }
        }
        if (after is FlowState.Completing && before !is FlowState.Completing) complete(after)
        if (after is FlowState.Completing && before is FlowState.Completing && before.failed && !after.failed) complete(after)
        if (after is FlowState.Trail && before !is FlowState.Trail) {
            loadTrail()
            _words.value = _words.value.data?.let { Resource.Ready(it, refreshing = true) } ?: Resource.Loading
            _league.value = Resource.Loading
            _hive.value = Resource.Loading
        }
        if (after is FlowState.Result && before !is FlowState.Result) {
            after.after.summary.newAchievements?.takeIf { it.isNotEmpty() }?.let(::mergeAchievements)
            val result = after.after.summary.leagueResult
            if (result != null && result.outcome != LeagueOutcome.promoted) {
                viewModelScope.launch { runCatching { apiCallUnit { client.competition.markLeagueResultSeen(LeagueResultSeenRequest(result.weekStart)) } } }
            }
        }
    }

    fun start(node: TrailNode) {
        if (node.state == NodeState.locked) return
        begin(NodeRef(node.id, node.kind.toRunKind()))
    }

    /** «Повторить»: короткий урок из слов, срок которых наступил (POST /reviews/runs). */
    fun startReview() = begin(REVIEW_NODE)

    /** «Пройти испытание» у закрытого места (`CourseUnit.jump`): открыть его, не проходя уроки перед ним. */
    fun startJump(unit: CourseUnit) {
        if (unit.jump == null) return
        begin(jumpNode(unit.id))
    }

    private fun begin(ref: NodeRef) {
        if (_flow.value !is FlowState.Trail) return
        goalDoneBefore = _progress.value.data?.streak?.extendedToday ?: false
        val runId = Uuid7.next(env.now())
        dispatch(FlowEvent.Start(ref, runId))
        viewModelScope.launch {
            try {
                val run = when (ref.kind) {
                    RunKind.review -> apiCall { client.learning.startReviewRun(StartLessonRunRequest(runId)) }
                    // Испытание — задания «Испытаний места», без новых слов.
                    RunKind.jump -> apiCall { client.learning.startJumpRun(ref.id, StartLessonRunRequest(runId)) }
                    // Карточки «Новое слово» — только в уроке и только по запросу; в повторении их нет.
                    else -> apiCall { client.learning.startLessonRun(ref.id, StartLessonRunRequest(runId, accepts = setOf(ru.teletau.core.network.models.RunFeature.wordIntro))) }
                }
                dispatch(FlowEvent.RunReady(run, env.now()))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (_flow.value is FlowState.Starting) {
                    dispatch(FlowEvent.RunFailed)
                    val what = if (ref.kind == RunKind.jump) "Испытание не открылось." else "Урок не открылся."
                    toast(if (e is NetworkFailure) "Нет связи. $what" else describeForChild(e))
                }
            }
        }
    }

    fun check(answer: AttemptAnswer) {
        val l = (_flow.value as? FlowState.Lesson)?.lesson ?: return
        val exercise = currentExercise(l) ?: return
        // Карточка «Новое слово» ответа не ждёт: попытку не отправляем (сервер ответил бы 422).
        if (l.checking || l.feedback != null || exercise is ru.teletau.core.network.models.RunExercise.WordIntroWrapper) return
        val attemptId = l.attemptId ?: Uuid7.next(env.now())
        dispatch(FlowEvent.Check(attemptId))
        val latency = (env.now() - shownAt).coerceIn(0, 3_600_000).toInt()
        // Открытые подсказки — в ответ: мёд тот же, но слово вернётся в повторение раньше (Hard). Нет подсказок — нет поля.
        val hints = hintsOpened.size.coerceAtMost(12).takeIf { it > 0 }
        viewModelScope.launch {
            try {
                val request = AttemptRequest(attemptId = attemptId, exerciseId = exercise.id, answer = answer, latencyMs = latency, hintsUsed = hints)
                val result = apiCall { client.learning.submitLessonAttempt(l.run.runId, request) }
                dispatch(FlowEvent.VerdictReady(result))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                dispatch(FlowEvent.AttemptFailed)
                toast(if (e is NetworkFailure) "Нет связи. Нажми «Проверить» ещё раз." else describeForChild(e))
            }
        }
    }

    /**
     * Ученик открыл подсказку к слову условия (номер в `hints`). Считаются разные подсказки этого показа упражнения,
     * открытые до ответа; открытая после «Проверить» не считается — ответ уже дан.
     */
    fun hintOpened(index: Int) {
        val l = (_flow.value as? FlowState.Lesson)?.lesson ?: return
        if (l.checking || l.feedback != null) return
        hintsOpened += index
    }

    fun next() = dispatch(FlowEvent.Next)
    fun quit() = dispatch(FlowEvent.Quit)
    fun stayInLesson() = dispatch(FlowEvent.Stay)
    fun leaveLesson() = dispatch(FlowEvent.Leave)
    fun retryComplete() = dispatch(FlowEvent.RetryComplete)

    private fun complete(state: FlowState.Completing) {
        viewModelScope.launch {
            try {
                val summary = apiCall { client.learning.completeLessonRun(state.lesson.run.runId) }
                dispatch(FlowEvent.Completed(summary, showStreak = summary.streak.extendedToday && !goalDoneBefore))
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                dispatch(FlowEvent.CompleteFailed)
            }
        }
    }

    fun continueFlow() {
        val f = _flow.value
        if (f is FlowState.LeagueUp) {
            val week = f.after.summary.leagueResult?.weekStart
            _leagueBusy.value = true
            viewModelScope.launch {
                if (week != null) runCatching { apiCallUnit { client.competition.markLeagueResultSeen(LeagueResultSeenRequest(week)) } }
                _leagueBusy.value = false
                dispatch(FlowEvent.Continue)
            }
            return
        }
        dispatch(FlowEvent.Continue)
    }

    /** «Знакомство · урок 3»: тема юнита и номер урока среди уроков юнита; у испытания для перехода — само место. */
    fun placeOf(node: NodeRef): LessonPlace {
        if (node == REVIEW_NODE) return LessonPlace()
        val c = _course.value.data ?: return LessonPlace()
        if (node.kind == RunKind.jump) return c.units.firstOrNull { it.id == node.id }?.let { LessonPlace(it.topicRu, place = it.place) } ?: LessonPlace()
        val nodeId = node.id
        val unit = c.units.firstOrNull { u -> u.nodes.any { it.id == nodeId } } ?: return LessonPlace()
        val lessons = unit.nodes.filter { it.kind != NodeKind.helpLanguage }
        val i = lessons.indexOfFirst { it.id == nodeId }
        return LessonPlace(unit.topicRu, if (i >= 0) i + 1 else null)
    }
}
