import Foundation
@testable import TeleTauAPI
@testable import TeleTauFeatures
@testable import TeleTauSession

/// Сервер-заглушка для логики моделей: курс и прогресс — из фикстур, забег повторения и ответы — для урока;
/// остальное не вызывается.
struct StubBackend: StudentBackend {
    struct Unexpected: Error {}

    var progress: S.MyProgress
    var courseValue: S.Course = Fixture.course
    /// Забег повторения (`startReview`); nil — урок не начнётся.
    var review: S.LessonRun?
    /// Забег испытания для перехода (`startJump`); nil — испытание не начнётся.
    var jump: S.LessonRun?
    /// Награды (`myAchievements`); nil — запрос падает, профиль без наград.
    var achievements: S.MyAchievements?
    /// Отправленные ответы: на каждый — «Верно».
    let attempts = AttemptLog()
    let session = SessionStore(secure: InMemorySecureStore())

    init(progress: S.MyProgress) {
        self.progress = progress
    }

    func course() async throws -> Course { courseValue }
    func progress() async throws -> MyProgress { progress }

    func loginWithQr(payload: String) async throws -> Me { throw Unexpected() }
    func requestClassCode(code: String, nicknameId: String) async throws -> ClassCodeLoginTicket { throw Unexpected() }
    func pollClassCode(requestId: String, pollToken: String) async throws -> ClassCodeLoginStatus { throw Unexpected() }
    func logout() async {}
    func me() async throws -> Me { throw Unexpected() }
    func chooseNickname(_ nicknameId: String) async throws -> Me { throw Unexpected() }
    func suggestNicknames(count: Int) async throws -> [NicknameSuggestion] { throw Unexpected() }
    func createSelf(nicknameId: String, ageBand: AgeBand, dailyGoal: Int?) async throws -> Me { throw Unexpected() }
    func loginWithCard(payload: String) async throws -> Me { throw Unexpected() }
    func loginCard() async throws -> PersonalLoginCard? { throw Unexpected() }
    func issueLoginCard() async throws -> PersonalLoginCard { throw Unexpected() }
    func joinClass(code: String) async throws -> ClassJoinTicket { throw Unexpected() }
    func joinStatus(requestId: String) async throws -> ClassJoinTicket { throw Unexpected() }
    func setDailyGoal(_ goal: Int) async throws -> Me { throw Unexpected() }
    func startRun(lessonId: String, runId: String) async throws -> LessonRun { throw Unexpected() }
    func startReview(runId: String) async throws -> LessonRun {
        guard let review else { throw Unexpected() }
        return review
    }

    func startJump(unitId: String, runId: String) async throws -> LessonRun {
        guard let jump, jump.lessonId == unitId else { throw Unexpected() }
        return jump
    }

    func attempt(runId: String, _ request: AttemptRequest) async throws -> AttemptResult {
        attempts.append(request)
        return .init(attemptId: request.attemptId, exerciseId: request.exerciseId, verdict: .correct, firstAttempt: true, retry: false)
    }

    func complete(runId: String) async throws -> LessonRunSummary { throw Unexpected() }
    func league() async throws -> LeagueStanding { throw Unexpected() }
    func leagueResultSeen(weekStart: String) async throws {}
    func hive(classId: String) async throws -> ClassHive { throw Unexpected() }
    func myCells() async throws -> MyCellsPage { throw Unexpected() }
    func myWords() async throws -> MyWords { throw Unexpected() }
    func myAchievements() async throws -> MyAchievements {
        guard let achievements else { throw Unexpected() }
        return achievements
    }
}

/// Журнал запросов заглушки: модель шлёт их из своих задач, тест читает после.
final class AttemptLog: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [AttemptRequest] = []

    func append(_ request: AttemptRequest) {
        lock.lock()
        defer { lock.unlock() }
        items.append(request)
    }

    var all: [AttemptRequest] {
        lock.lock()
        defer { lock.unlock() }
        return items
    }
}
