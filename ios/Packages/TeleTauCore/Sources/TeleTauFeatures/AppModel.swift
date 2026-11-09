import AuthCodes
import DesignSystem
import Foundation
import TeleTauAPI
import TeleTauSession
import Observation

/// Заявка на вход по коду класса — только в памяти: секрет опроса не хранится дольше срока заявки.
public struct JoinTicket: Equatable, Sendable {
    public let requestId: String
    public let pollToken: String
    public let expiresAt: Date
    public let pollIntervalSeconds: Int
    public let classTitle: String
    public let nickname: String
}

/// Корневая модель приложения: адрес сервера, сессия ученика и маршрут между экранами входа и вкладками.
@MainActor
@Observable
public final class AppModel {
    public enum Route: Equatable {
        case launching
        case start
        case scan
        case classCode
        /// «Учусь сам»: возраст → ник → цель дня.
        case selfStart
        case wait(JoinTicket)
        case nickname
        case joined
        case student
    }

    public private(set) var route: Route = .launching
    public private(set) var account: Me?
    /// Почему сессия закончилась (`code` ответа) — экран входа объясняет, что делать.
    public private(set) var endedReason: String?
    public private(set) var backend: any StudentBackend
    public private(set) var apiURL: URL
    public private(set) var student: StudentModel?

    private let session: SessionStore
    private let defaults: UserDefaults
    private let configuredWebURL: String?
    private let makeBackend: @Sendable (URL, SessionStore) -> any StudentBackend
    @ObservationIgnored private var listener: Task<Void, Never>?

    public init(
        session: SessionStore,
        defaults: UserDefaults = .standard,
        configuredAPIURL: String?,
        configuredWebURL: String?,
        makeBackend: @escaping @Sendable (URL, SessionStore) -> any StudentBackend = { TeleTauClient.live(baseURL: $0, session: $1) }
    ) {
        self.session = session
        self.defaults = defaults
        self.configuredWebURL = configuredWebURL
        savedWebURL = defaults.string(forKey: ServerAddress.webDefaultsKey)
        self.makeBackend = makeBackend
        let saved = defaults.string(forKey: ServerAddress.defaultsKey).flatMap(ServerAddress.normalize)
        let url = saved ?? configuredAPIURL.flatMap(ServerAddress.normalize) ?? URL(string: "http://localhost:4000")!
        apiURL = url
        backend = makeBackend(url, session)
    }

    /// Приложение на устройстве: сессия в Keychain, адрес API — из Info.plist (`TeleTauAPIBaseURL`) или настроек.
    public static func live() -> AppModel {
        let info = Bundle.main.infoDictionary ?? [:]
        return AppModel(
            session: SessionStore(secure: KeychainStore()),
            configuredAPIURL: info["TeleTauAPIBaseURL"] as? String,
            configuredWebURL: info["TeleTauWebURL"] as? String
        )
    }

    /// Сайт для учителя: кабинет учителя — только в вебе.
    /// Адрес сайта: с экрана настроек, иначе из настроек сборки (`TeleTauWebURL`), иначе тот же хост на порту веба.
    /// Нужен кнопке «Я учитель» и записям произношения с относительным адресом (`/audio/…`).
    public var webURL: URL {
        ServerAddress.webURL(api: apiURL, configured: savedWebURL ?? configuredWebURL)
    }

    /// Адрес сайта, введённый на экране настроек (nil — по умолчанию).
    public private(set) var savedWebURL: String?

    /// Сайт для учителя: кабинет учителя — только в вебе.
    public var teacherURL: URL {
        webURL.appendingPathComponent("teacher/login")
    }

    // MARK: - Запуск

    public func launch() async {
        listen()
        account = await session.currentAccount
        route = .start
        // Аккаунт мог измениться (ник, класс) — обновляем молча; нет сети — остаётся сохранённый.
        if await session.hasSession, let me = try? await backend.me() { account = me }
    }

    private func listen() {
        guard listener == nil else { return }
        let stream = session
        listener = Task { [weak self] in
            for await event in await stream.events() {
                guard let self else { return }
                switch event {
                case .signedIn(let me), .accountUpdated(let me):
                    account = me
                    if student?.me.id == me.id { student?.me = me }
                case .signedOut(let reason):
                    signedOut(reason: reason)
                }
            }
        }
    }

    private func signedOut(reason: String?) {
        account = nil
        student = nil
        if reason != nil { endedReason = reason }
        switch route {
        case .student, .nickname, .joined: route = reason == nil ? .start : .scan
        default: break
        }
    }

    // MARK: - Переходы

    public func goStart() { route = .start }
    public func goScan() { route = .scan }
    public func goClassCode() { route = .classCode }
    public func goSelf() { route = .selfStart }

    /// Почта для взрослых — только на сайте (вход, «Сохранить прогресс по почте»).
    public var emailLoginURL: URL { webURL.appendingPathComponent("teacher/login") }
    public var saveEmailURL: URL { webURL.appendingPathComponent("me/email") }

    /// «Продолжить» на старте: сессия на устройстве уже есть.
    public func resume() {
        guard let account else { return }
        enter(account, firstTime: false)
    }

    /// Вход выполнен: без ника — выбор ника; повторный вход — сразу тропа.
    func enter(_ me: Me, firstTime: Bool) {
        account = me
        endedReason = nil
        if me.nickname == nil {
            route = .nickname
        } else if firstTime {
            route = .joined
        } else {
            openStudent(me)
        }
    }

    func openStudent(_ me: Me) {
        if student?.me.id != me.id { student = StudentModel(backend: backend, me: me, defaults: defaults) }
        route = .student
    }

    func goTrail() {
        guard let account else { route = .start; return }
        openStudent(account)
    }

    func waitForTeacher(_ ticket: JoinTicket) { route = .wait(ticket) }

    /// Заявку одобрили — сессия выдана, «Ты в классе».
    func joined(_ me: Me) {
        account = me
        route = .joined
    }

    public func logout() async {
        await backend.logout()
        account = nil
        student = nil
        route = .start
    }

    // MARK: - Адрес сервера

    /// Сохраняет адрес API для демо; другой сервер — другая сессия, поэтому локальный выход.
    @discardableResult
    public func setServer(_ input: String, web webInput: String = "") async -> Bool {
        guard let url = ServerAddress.normalize(input) else { return false }
        let web = webInput.trimmingCharacters(in: .whitespacesAndNewlines)
        if web.isEmpty {
            defaults.removeObject(forKey: ServerAddress.webDefaultsKey)
            savedWebURL = nil
        } else {
            guard let webURL = ServerAddress.normalize(web) else { return false }
            defaults.set(webURL.absoluteString, forKey: ServerAddress.webDefaultsKey)
            savedWebURL = webURL.absoluteString
        }
        defaults.set(url.absoluteString, forKey: ServerAddress.defaultsKey)
        guard url != apiURL else { return true }
        await session.clear()
        apiURL = url
        backend = makeBackend(url, session)
        account = nil
        student = nil
        route = .start
        return true
    }
}

/// Вкладки ученика: тропа, урок и поток после урока (автомат `LessonMachine`), лига, класс, профиль.
@MainActor
@Observable
public final class StudentModel {
    public internal(set) var me: Me
    public var tab: StudentTab = .path
    /// Открыта «Моя карточка входа» (вкладка «Профиль») или «Вступить в класс» (вкладка «Класс»).
    public var showCard = false
    public var showJoin = false
    public private(set) var flow: FlowState = .trail(sealed: nil)
    public private(set) var course: Loadable<Course> = .loading
    public private(set) var progress: Loadable<MyProgress> = .loading
    public private(set) var league: Loadable<LeagueStanding> = .loading
    public private(set) var hive: Loadable<ClassHive> = .loading
    public private(set) var cells: Loadable<MyCellsPage> = .loading
    /// «Мой словарь»: для профиля необязателен — без него ссылка на словарь без чисел.
    public private(set) var words: Loadable<MyWords> = .loading
    /// Открыт «Мой словарь» (вкладка «Профиль»).
    public var showWords = false
    /// Награды: для профиля необязательны — не загрузились, профиль без блока «Награды».
    public private(set) var achievements: Loadable<MyAchievements> = .loading
    /// Открыт лист награды (вкладка «Профиль»).
    public var award: Achievement?
    public private(set) var fresh: (count: Int, honey: Int)?
    public private(set) var leagueBusy = false
    public var toast: String?
    public private(set) var showSplash = true

    /// Знакомство с пчелой уже показано на этом устройстве (для этого ученика).
    public private(set) var introSeen: Bool

    let backend: any StudentBackend
    private let defaults: UserDefaults
    @ObservationIgnored private var shownAt = Date()
    /// Подсказки к условию (номера в `hints`), открытые до ответа, и показ упражнения, к которому они относятся.
    @ObservationIgnored private var hintsOpened: (step: String, hints: Set<Int>) = ("", [])

    public init(backend: any StudentBackend, me: Me, defaults: UserDefaults = .standard) {
        self.backend = backend
        self.me = me
        self.defaults = defaults
        introSeen = defaults.bool(forKey: Self.introKey(me.id))
    }

    public var mode: TeleTauMode {
        switch me.uiMode {
        case .bee: .bee
        case .keeper: .keeper
        default: .bortnik
        }
    }

    // MARK: - Загрузка

    public func loadTrail() async {
        async let c: Void = loadCourse()
        async let p: Void = loadProgress()
        let started = Date()
        _ = await (c, p)
        // Заставка не короче 0,7 с — иначе мигнёт.
        let left = 0.7 - Date().timeIntervalSince(started)
        if showSplash, left > 0 { try? await Task.sleep(for: .seconds(left)) }
        showSplash = false
    }

    func loadCourse() async {
        if course.value == nil { course = .loading }
        do { course = .loaded(try await backend.course()) } catch { if course.value == nil { course = .failed(APIError.from(error)) } }
    }

    func loadProgress() async {
        do { progress = .loaded(try await backend.progress()) } catch { if progress.value == nil { progress = .failed(APIError.from(error)) } }
    }

    public func loadLeague() async {
        if league.value == nil { league = .loading }
        do { league = .loaded(try await backend.league()) } catch { league = .failed(APIError.from(error)) }
    }

    public func loadHive() async {
        guard let klass = studentClass(me) else { return }
        if hive.value == nil { hive = .loading }
        do { hive = .loaded(try await backend.hive(classId: klass.id)) } catch { hive = .failed(APIError.from(error)) }
    }

    public func loadProfile() async {
        async let p: Void = loadProgress()
        async let c: Void = loadCourse()
        async let w: Void = loadWords()
        async let a: Void = loadAchievements()
        do {
            let page = try await backend.myCells()
            cells = .loaded(page)
            updateFresh(page.summary)
        } catch {
            cells = .failed(APIError.from(error))
        }
        _ = await (p, c, w, a)
    }

    public func loadAchievements() async {
        do { achievements = .loaded(try await backend.myAchievements()) } catch { if achievements.value == nil { achievements = .failed(APIError.from(error)) } }
    }

    /// Учитель пустил в класс: свежий аккаунт (класс уже в `GET /me`) и улей класса.
    public func joinedClass() async {
        if let fresh = try? await backend.me() { me = fresh }
        showJoin = false
        hive = .loading
        await loadHive()
    }

    public func setDailyGoal(_ goal: Int) async throws {
        me = try await backend.setDailyGoal(goal)
        await loadProgress()
    }

    public func loadWords() async {
        if words.value == nil { words = .loading }
        do { words = .loaded(try await backend.myWords()) } catch { if words.value == nil { words = .failed(APIError.from(error)) } }
    }

    /// «Повторить» из словаря: на тропу, и повторение начинается сразу.
    public func reviewFromWords() {
        showWords = false
        tab = .path
        startReview()
    }

    /// «Мёд созрел!»: что ученик уже видел — счётчики на этом устройстве (номер аккаунта и числа, без ПДн).
    private func updateFresh(_ s: Components.Schemas.CellsSummary) {
        let key = "teletau.cells-seen.\(me.id)"
        if let seen = defaults.dictionary(forKey: key) as? [String: Int], let matured = seen["matured"], s.matured > matured {
            fresh = (s.matured - matured, max(0, s.honeyFinal - (seen["honey"] ?? 0)))
        }
        defaults.set(["matured": s.matured, "honey": s.honeyFinal], forKey: key)
    }

    // MARK: - Урок

    private func send(_ event: FlowEvent) {
        let before = flow
        flow = LessonMachine.reduce(flow, event)
        guard flow != before else { return }
        runEffects(after: before)
    }

    public func start(_ node: TrailNode) {
        guard node.state != .locked else { return }
        send(.start(NodeRef(node), runId: UUIDv7.make()))
    }

    /// «Повторить»: короткий урок из слов, срок повторения которых наступил.
    public func startReview() {
        send(.start(.review, runId: UUIDv7.make()))
    }

    /// «Пройти испытание» у закрытого места: сдал — место открыто без уроков перед ним.
    public func startJump(_ unit: CourseUnit) {
        guard unit.jump != nil else { return }
        send(.start(.jump(unit), runId: UUIDv7.make()))
    }

    public func check(_ answer: AttemptAnswer) {
        guard case .lesson(let l) = flow, let exercise = l.current, !l.checking, l.feedback == nil, !l.isIntro else { return }
        let attemptId = l.attemptId ?? UUIDv7.make()
        send(.check(attemptId: attemptId))
        let latency = Int(Date().timeIntervalSince(shownAt) * 1000)
        // Открытые подсказки — в ответ: мёд тот же, но слово вернётся в повторение раньше (Hard). Нет подсказок — нет поля.
        let hints = hintsOpened.step == Self.hintStep(l) ? min(hintsOpened.hints.count, 12) : 0
        let request = AttemptRequest(attemptId: attemptId, exerciseId: exercise.exerciseId, answer: answer, latencyMs: min(3_600_000, max(0, latency)),
                                     hintsUsed: hints > 0 ? hints : nil)
        Task {
            do {
                send(.verdict(try await backend.attempt(runId: l.run.runId, request)))
            } catch {
                send(.attemptFailed)
                let e = APIError.from(error)
                toast = e.isOffline ? "Нет связи. Нажми «Проверить» ещё раз." : ChildText.describe(e)
            }
        }
    }

    /// Ученик открыл подсказку к слову условия (номер в `hints`). Считаются разные подсказки этого показа упражнения,
    /// открытые до ответа; открытая после «Проверить» не считается — ответ уже дан.
    public func hintOpened(_ index: Int) {
        guard case .lesson(let l) = flow, l.feedback == nil, !l.checking, !l.isIntro else { return }
        let step = Self.hintStep(l)
        if hintsOpened.step != step { hintsOpened = (step, []) }
        hintsOpened.hints.insert(index)
    }

    /// Показ упражнения: забег, упражнение и номер показа (повтор после ошибки — новый показ, подсказки с нуля).
    private static func hintStep(_ l: LessonState) -> String { "\(l.run.runId)/\(l.stepKey)" }

    public func next() {
        send(.next)
        shownAt = Date()
    }

    public func quit() { send(.quit) }
    public func stay() { send(.stay) }
    public func leave() { send(.leave) }
    public func retryComplete() { send(.retryComplete) }

    public func continueAfter() {
        if case .leagueUp(let after) = flow, let week = after.summary.leagueResult?.weekStart {
            leagueBusy = true
            Task {
                try? await backend.leagueResultSeen(weekStart: week)
                leagueBusy = false
                send(.continue)
            }
            return
        }
        send(.continue)
    }

    private func runEffects(after before: FlowState) {
        switch flow {
        case .starting(let node, let runId):
            Task {
                do {
                    let run: LessonRun
                    switch node.kind {
                    case .review: run = try await backend.startReview(runId: runId)
                    case .jump: run = try await backend.startJump(unitId: node.id, runId: runId)
                    case .lesson, .helpLanguage, .placeTest: run = try await backend.startRun(lessonId: node.id, runId: runId)
                    }
                    shownAt = Date()
                    send(.runReady(run, now: Date()))
                } catch {
                    send(.runFailed)
                    let e = APIError.from(error)
                    let what = node.kind == .jump ? "Испытание не открылось." : "Урок не открылся."
                    toast = e.isOffline ? "Нет связи. \(what)" : ChildText.describe(e)
                }
            }
        case .completing(let l, false):
            // Экран серии — только если этот урок выполнил цель дня (до урока она не была выполнена).
            let goalDoneBefore = progress.value?.streak.extendedToday ?? false
            Task {
                do {
                    let summary = try await backend.complete(runId: l.run.runId)
                    send(.completed(summary, showStreak: summary.streak.extendedToday && !goalDoneBefore))
                } catch {
                    send(.completeFailed)
                }
            }
        case .result(let after):
            // Итог прошлой недели без повышения — отмечаем молча (празднуем только повышение).
            if let r = after.summary.leagueResult, r.outcome != .promoted {
                Task { try? await backend.leagueResultSeen(weekStart: r.weekStart) }
            }
        case .trail:
            if case .trail = before { return }
            // Вернулись на тропу после урока — свежие узлы и счётчики.
            Task {
                async let c: Void = loadCourse()
                async let p: Void = loadProgress()
                _ = await (c, p)
            }
        default:
            break
        }
    }

    /// Узел, урок которого сейчас открывается.
    public var busyNode: String? {
        if case .starting(let node, _) = flow { node.id } else { nil }
    }

    public var sealed: String? {
        if case .trail(let s) = flow { s } else { nil }
    }
}

// MARK: - Знакомство с пчелой

extension StudentModel {
    static func introKey(_ accountId: String) -> String { "teletau.intro-seen.\(accountId)" }

    /// Два листа знакомства — при первом входе, пока не пройден ни один урок и на тропе есть что начать.
    public var showIntro: Bool {
        guard !introSeen, case .trail = flow, progress.value?.lessonsCompleted == 0, let course = course.value else { return false }
        return nextNode(course) != nil
    }

    /// Цель дня в сотах — для второго листа знакомства.
    var introGoal: Int { progress.value?.dailyGoal?.target ?? me.dailyGoal ?? 2 }

    /// Закрыть знакомство; «Начать урок» — сразу открыть следующий урок тропы.
    public func closeIntro(start: Bool) {
        introSeen = true
        defaults.set(true, forKey: Self.introKey(me.id))
        if start, let node = course.value.flatMap(nextNode) { self.start(node) }
    }
}
