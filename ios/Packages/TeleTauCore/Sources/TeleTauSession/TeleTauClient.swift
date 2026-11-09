import Foundation
import TeleTauAPI
import OpenAPIRuntime
import OpenAPIURLSession

// Типы — только из сгенерированного клиента (CLAUDE.md, правило 1): здесь короткие имена, а не свои DTO.
public typealias Course = Components.Schemas.Course
public typealias CourseUnit = Components.Schemas.CourseUnit
public typealias TrailNode = Components.Schemas.TrailNode
public typealias LessonRun = Components.Schemas.LessonRun
public typealias RunExercise = Components.Schemas.RunExercise
public typealias AttemptRequest = Components.Schemas.AttemptRequest
public typealias AttemptAnswer = Components.Schemas.AttemptAnswer
public typealias AttemptResult = Components.Schemas.AttemptResult
public typealias LessonRunSummary = Components.Schemas.LessonRunSummary
public typealias MyProgress = Components.Schemas.MyProgress
public typealias LeagueStanding = Components.Schemas.LeagueStanding
public typealias ClassHive = Components.Schemas.ClassHive
public typealias MyCellsPage = Components.Schemas.MyCellsPage
public typealias NicknameSuggestion = Components.Schemas.NicknameSuggestion
public typealias ClassCodeLoginTicket = Components.Schemas.ClassCodeLoginTicket
public typealias ClassCodeLoginStatus = Components.Schemas.ClassCodeLoginStatus
public typealias RunKind = Components.Schemas.RunKind
public typealias DailyGoal = Components.Schemas.DailyGoal
public typealias MyWords = Components.Schemas.MyWords
public typealias AudioClip = Components.Schemas.AudioClip
public typealias AgeBand = Components.Schemas.AgeBand
public typealias PersonalLoginCard = Components.Schemas.LoginCard
public typealias ClassJoinTicket = Components.Schemas.ClassJoinTicket
public typealias PlaceJump = Components.Schemas.PlaceJump
public typealias JumpResult = Components.Schemas.JumpResult
public typealias Achievement = Components.Schemas.Achievement
public typealias MyAchievements = Components.Schemas.MyAchievements

/// Операции, которые нужны приложению ученика. Экраны зависят от протокола: в приложении — `TeleTauClient`,
/// в превью и тестах — подставной сервер.
public protocol StudentBackend: Sendable {
    var session: SessionStore { get }

    func loginWithQr(payload: String) async throws -> Me
    func requestClassCode(code: String, nicknameId: String) async throws -> ClassCodeLoginTicket
    func pollClassCode(requestId: String, pollToken: String) async throws -> ClassCodeLoginStatus
    func logout() async
    func me() async throws -> Me
    func chooseNickname(_ nicknameId: String) async throws -> Me
    func suggestNicknames(count: Int) async throws -> [NicknameSuggestion]

    // «Учусь сам» (ADR 0022)
    func createSelf(nicknameId: String, ageBand: AgeBand, dailyGoal: Int?) async throws -> Me
    func loginWithCard(payload: String) async throws -> Me
    /// Карточка ещё не выпущена — nil.
    func loginCard() async throws -> PersonalLoginCard?
    func issueLoginCard() async throws -> PersonalLoginCard
    func joinClass(code: String) async throws -> ClassJoinTicket
    func joinStatus(requestId: String) async throws -> ClassJoinTicket
    func setDailyGoal(_ goal: Int) async throws -> Me

    func course() async throws -> Course
    func startRun(lessonId: String, runId: String) async throws -> LessonRun
    /// Повторение слов, срок которых наступил (`POST /reviews/runs`).
    func startReview(runId: String) async throws -> LessonRun
    /// Испытание для перехода к закрытому месту (`POST /units/{unitId}/jump-runs`): сдал — место и места перед ним открыты.
    func startJump(unitId: String, runId: String) async throws -> LessonRun
    func attempt(runId: String, _ request: AttemptRequest) async throws -> AttemptResult
    func complete(runId: String) async throws -> LessonRunSummary
    func progress() async throws -> MyProgress
    func league() async throws -> LeagueStanding
    func leagueResultSeen(weekStart: String) async throws
    func hive(classId: String) async throws -> ClassHive
    func myCells() async throws -> MyCellsPage
    /// «Мой словарь» (`GET /me/words`).
    func myWords() async throws -> MyWords
    /// Награды ученика (`GET /me/achievements`): все награды набора, полученные — с днём, остальные — с прогрессом.
    func myAchievements() async throws -> MyAchievements
}

/// Клиент API ученика поверх сгенерированного `Client`: устройство, сессия, ошибки → `APIError`.
public final class TeleTauClient: StudentBackend {
    public let session: SessionStore
    public let baseURL: URL
    private let api: Client

    public init(baseURL: URL, session: SessionStore, transport: any ClientTransport) {
        self.baseURL = baseURL
        self.session = session
        let configuration = Configuration(dateTranscoder: FlexibleISO8601Transcoder())
        // Обновление токенов — отдельным клиентом без авторизации: оно само не должно уходить на обновление.
        let refreshClient = Client(serverURL: baseURL, configuration: configuration, transport: transport, middlewares: [ProblemMiddleware()])
        let refresher: Refresher = { refreshToken, installId in
            try await refreshClient.refreshSession(body: .json(.init(refreshToken: refreshToken, deviceInstallId: installId))).ok.body.json
        }
        api = Client(
            serverURL: baseURL,
            configuration: configuration,
            transport: transport,
            middlewares: [ProblemMiddleware(), AuthMiddleware(store: session, refresher: refresher)]
        )
    }

    /// URLSession с короткими таймаутами: на уроке ребёнок не ждёт минуту, а видит «Нет связи».
    public static func live(baseURL: URL, session: SessionStore) -> TeleTauClient {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        config.waitsForConnectivity = false
        config.httpCookieStorage = nil
        config.urlCache = nil
        let transport = URLSessionTransport(configuration: .init(session: URLSession(configuration: config)))
        return TeleTauClient(baseURL: baseURL, session: session, transport: transport)
    }

    private var device: Components.Schemas.DeviceInfo {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        return .init(installId: session.installId, platform: .ios, appVersion: version.map { String($0.prefix(32)) })
    }

    /// Любая ошибка вызова → `APIError`.
    private func call<T: Sendable>(_ body: () async throws -> T) async throws -> T {
        do {
            return try await body()
        } catch {
            throw APIError.from(error)
        }
    }

    // MARK: - Вход и сессия

    public func loginWithQr(payload: String) async throws -> Me {
        let device = device
        let auth = try await call { try await api.loginWithQrCard(body: .json(.init(payload: payload, device: device))).ok.body.json }
        await session.adopt(auth)
        return auth.account
    }

    public func requestClassCode(code: String, nicknameId: String) async throws -> ClassCodeLoginTicket {
        let device = device
        return try await call {
            try await api.requestClassCodeLogin(body: .json(.init(code: code, nicknameId: nicknameId, device: device))).accepted.body.json
        }
    }

    public func pollClassCode(requestId: String, pollToken: String) async throws -> ClassCodeLoginStatus {
        let installId = session.installId
        let status = try await call {
            try await api.getClassCodeLoginStatus(
                path: .init(requestId: requestId),
                headers: .init(xPollToken: pollToken, xDeviceInstallId: installId)
            ).ok.body.json
        }
        if let auth = status.session { await session.adopt(auth) }
        return status
    }

    /// Выход на этом устройстве: сервер отзывает семейство сессии, локально всё стирается в любом случае.
    public func logout() async {
        if await session.hasSession {
            _ = try? await api.logout(body: .json(.init(allDevices: false)))
        }
        await session.clear()
    }

    public func me() async throws -> Me {
        let me = try await call { try await api.getMe().ok.body.json }
        await session.updateAccount(me)
        return me
    }

    public func chooseNickname(_ nicknameId: String) async throws -> Me {
        let me = try await call { try await api.updateMe(body: .json(.init(nicknameId: nicknameId))).ok.body.json }
        await session.updateAccount(me)
        return me
    }

    public func suggestNicknames(count: Int = 3) async throws -> [NicknameSuggestion] {
        try await call { try await api.suggestNicknames(query: .init(count: count)).ok.body.json.items }
    }

    // MARK: - «Учусь сам» (ADR 0022)

    public func createSelf(nicknameId: String, ageBand: AgeBand, dailyGoal: Int?) async throws -> Me {
        let device = device
        let auth = try await call {
            try await api.createSelfLearner(body: .json(.init(device: device, nicknameId: nicknameId, ageBand: ageBand, dailyGoal: dailyGoal))).created.body.json
        }
        await session.adopt(auth)
        return auth.account
    }

    public func loginWithCard(payload: String) async throws -> Me {
        let device = device
        let auth = try await call { try await api.loginWithLoginCard(body: .json(.init(payload: payload, device: device))).ok.body.json }
        await session.adopt(auth)
        return auth.account
    }

    public func loginCard() async throws -> PersonalLoginCard? {
        do {
            return try await call { try await api.getMyLoginCard().ok.body.json }
        } catch APIError.problem(let p) where p.status == 404 {
            return nil
        }
    }

    public func issueLoginCard() async throws -> PersonalLoginCard {
        let card = try await call { try await api.issueMyLoginCard().created.body.json }
        if var me = await session.currentAccount, me.loginCard != .issued {
            me.loginCard = .issued
            await session.updateAccount(me)
        }
        return card
    }

    public func joinClass(code: String) async throws -> ClassJoinTicket {
        try await call { try await api.requestClassJoin(body: .json(.init(code: code))).accepted.body.json }
    }

    public func joinStatus(requestId: String) async throws -> ClassJoinTicket {
        try await call { try await api.getClassJoinStatus(path: .init(requestId: requestId)).ok.body.json }
    }

    public func setDailyGoal(_ goal: Int) async throws -> Me {
        let me = try await call { try await api.updateMe(body: .json(.init(dailyGoal: goal))).ok.body.json }
        await session.updateAccount(me)
        return me
    }

    // MARK: - Тропа и урок

    public func course() async throws -> Course {
        try await call { try await api.getCourse().ok.body.json }
    }

    /// Урок с карточками «Новое слово» (`accepts: [word_intro]`): приложение их показывает. В повторении карточек нет.
    public func startRun(lessonId: String, runId: String) async throws -> LessonRun {
        try await call { try await api.startLessonRun(path: .init(lessonId: lessonId), body: .json(.init(runId: runId, accepts: [.wordIntro]))).created.body.json }
    }

    public func startReview(runId: String) async throws -> LessonRun {
        try await call { try await api.startReviewRun(body: .json(.init(runId: runId))).created.body.json }
    }

    public func startJump(unitId: String, runId: String) async throws -> LessonRun {
        try await call { try await api.startJumpRun(path: .init(unitId: unitId), body: .json(.init(runId: runId, accepts: [.wordIntro]))).created.body.json }
    }

    public func attempt(runId: String, _ request: AttemptRequest) async throws -> AttemptResult {
        try await call { try await api.submitLessonAttempt(path: .init(runId: runId), body: .json(request)).ok.body.json }
    }

    public func complete(runId: String) async throws -> LessonRunSummary {
        try await call { try await api.completeLessonRun(path: .init(runId: runId)).ok.body.json }
    }

    public func progress() async throws -> MyProgress {
        try await call { try await api.getMyProgress().ok.body.json }
    }

    public func league() async throws -> LeagueStanding {
        try await call { try await api.getCurrentLeague().ok.body.json }
    }

    public func leagueResultSeen(weekStart: String) async throws {
        _ = try await call { try await api.markLeagueResultSeen(body: .json(.init(weekStart: weekStart))).noContent }
    }

    public func hive(classId: String) async throws -> ClassHive {
        try await call { try await api.getClassHive(path: .init(id: classId)).ok.body.json }
    }

    public func myCells() async throws -> MyCellsPage {
        try await call { try await api.listMyCorpusCells(query: .init(limit: 1)).ok.body.json }
    }

    public func myWords() async throws -> MyWords {
        try await call { try await api.listMyWords().ok.body.json }
    }

    public func myAchievements() async throws -> MyAchievements {
        try await call { try await api.listMyAchievements().ok.body.json }
    }
}
