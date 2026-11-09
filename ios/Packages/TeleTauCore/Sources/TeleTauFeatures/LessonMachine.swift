import Foundation
import TeleTauAPI
import TeleTauSession

// Один автомат состояний тропы, урока и потока после урока — порт `machine.ts` веба (docs/plans/M2.md §3 «Ч4»):
//
//   trail ─start→ starting ─runReady→ lesson ⟲ (check → verdict → next) ─последнее упражнение→ completing
//     ↑              └─runFailed→ trail                                                         │ completed
//     └─ leagueUp ←continue─ achievement ←continue─ streak ←continue─ result ←────────────────────┘
//
// После итога — только нужные шаги по порядку: серия (урок продлил её), новые награды (newAchievements), новая лига.
//
// Карточка «Новое слово» (word_intro) ответа не ждёт: «Дальше» (next) без вердикта и без запроса, не повторяется.
// Ошибочное упражнение возвращается в конец урока («Повторим в конце урока»), когда сервер ответил retry: true,
// но не больше maxRetries раз. Дуэль не повторяется: в ней нет неверного ответа. Испытание для перехода к закрытому
// месту (`jump`) ошибок не повторяет; ответ с runEnded: true заканчивает его — «Дальше» сразу ведёт к завершению.
// Побочные эффекты (запросы) выполняет `StudentModel` по состоянию; сам автомат — чистая функция
// (TeleTauFeaturesTests/LessonMachineTests).

/// Что начинаем: узел тропы, повторение слов (id «review», вид `review`) или испытание для перехода к месту
/// (id места, вид `jump`).
public struct NodeRef: Equatable, Sendable {
    public let id: String
    public let kind: RunKind

    public init(id: String, kind: RunKind) {
        self.id = id
        self.kind = kind
    }

    public init(_ node: TrailNode) {
        id = node.id
        kind = switch node.kind {
        case .lesson: .lesson
        case .helpLanguage: .helpLanguage
        case .placeTest: .placeTest
        }
    }

    public static let review = NodeRef(id: "review", kind: .review)

    /// Испытание для перехода к закрытому месту (`POST /units/{unitId}/jump-runs`).
    public static func jump(_ unit: CourseUnit) -> NodeRef { NodeRef(id: unit.id, kind: .jump) }

    /// Узел тропы, который «запечатывается» после урока (у повторения и испытания для перехода его нет).
    var sealable: String? {
        switch kind {
        case .review, .jump: nil
        case .lesson, .helpLanguage, .placeTest: id
        }
    }
}

public struct LessonState: Equatable, Sendable {
    public var run: LessonRun
    public var node: NodeRef
    /// Очередь показа: id упражнений; текущее — первое.
    public var queue: [String]
    /// Упражнения, которые больше не покажем (решены или исчерпали повторы).
    public var finished: [String] = []
    /// Сколько раз упражнение уже вернулось в конец.
    public var retries: [String: Int] = [:]
    /// Сколько показов упражнения было до этого (0 — первый показ).
    public var shownBefore: [String: Int] = [:]
    public var feedback: AttemptResult?
    public var checking = false
    public var quit = false
    /// attemptId текущего ответа: повтор после сбоя сети уходит с тем же id (сервер не засчитает дважды).
    public var attemptId: String?
    public var startedAt: Date

    public init(run: LessonRun, node: NodeRef, startedAt: Date) {
        self.run = run
        self.node = node
        self.queue = run.exercises.map(\.exerciseId)
        self.startedAt = startedAt
    }

    public var current: RunExercise? {
        guard let id = queue.first else { return nil }
        return run.exercises.first { $0.exerciseId == id }
    }

    /// Сейчас — карточка «Новое слово»: ответа нет, «Дальше» ведёт к следующему упражнению.
    public var isIntro: Bool { current?.isIntro ?? false }

    /// Текущее упражнение показывается повторно (после ошибки).
    public var isRetry: Bool {
        guard let id = queue.first else { return false }
        return (shownBefore[id] ?? 0) > 0
    }

    /// Прогресс урока 0–1: решённые упражнения, включая текущее, если его вердикт засчитан.
    public var progress: Double {
        let total = run.exercises.count
        guard total > 0 else { return 0 }
        let counted = feedback.map { $0.verdict != .wrong ? 1 : 0 } ?? 0
        return min(1, Double(finished.count + counted) / Double(total))
    }

    /// Неверный ответ вернётся в конец урока (повторы не исчерпаны).
    public var willRetry: Bool {
        guard let id = queue.first, let f = feedback else { return false }
        return f.verdict == .wrong && f.retry && (retries[id] ?? 0) < LessonMachine.maxRetries
    }

    /// Ключ показа: упражнение и номер показа — новое упражнение сбрасывает черновик ответа.
    public var stepKey: String {
        let id = queue.first ?? ""
        return "\(id):\(shownBefore[id] ?? 0)"
    }
}

public struct AfterLesson: Equatable, Sendable {
    public let node: NodeRef
    public let run: LessonRun
    public let summary: LessonRunSummary
    /// Этот урок выполнил цель дня (первый урок суток) — показать экран серии.
    public let showStreak: Bool

    public init(node: NodeRef, run: LessonRun, summary: LessonRunSummary, showStreak: Bool) {
        self.node = node
        self.run = run
        self.summary = summary
        self.showStreak = showStreak
    }
}

public enum FlowState: Equatable, Sendable {
    case trail(sealed: String?)
    case starting(NodeRef, runId: String)
    /// Забег без упражнений: у «Помоги языку» закончились дуэли для этого аккаунта.
    case empty(NodeRef)
    case lesson(LessonState)
    case completing(LessonState, failed: Bool)
    case result(AfterLesson)
    case streak(AfterLesson)
    /// «Новая награда!» — награды, полученные этим уроком (`summary.newAchievements`), одним экраном.
    case achievement(AfterLesson)
    case leagueUp(AfterLesson)
}

public enum FlowEvent: Sendable {
    case start(NodeRef, runId: String)
    case runReady(LessonRun, now: Date)
    case runFailed
    case check(attemptId: String)
    case verdict(AttemptResult)
    case attemptFailed
    case next
    case quit
    case stay
    case leave
    case completed(LessonRunSummary, showStreak: Bool)
    case completeFailed
    case retryComplete
    case `continue`
}

public enum LessonMachine {
    public static let maxRetries = 3

    public static func reduce(_ state: FlowState, _ event: FlowEvent) -> FlowState {
        switch (state, event) {
        case (.trail, .start(let node, let runId)):
            return .starting(node, runId: runId)
        case (.starting(let node, _), .runReady(let run, let now)):
            return run.exercises.isEmpty ? .empty(node) : .lesson(LessonState(run: run, node: node, startedAt: now))
        case (.starting, .runFailed):
            return .trail(sealed: nil)

        case (.lesson(var l), .check(let attemptId)):
            guard l.feedback == nil, !l.checking, !l.isIntro else { return state }
            l.checking = true
            l.attemptId = l.attemptId ?? attemptId
            return .lesson(l)
        case (.lesson(var l), .verdict(let result)):
            guard l.checking else { return state }
            l.checking = false
            l.feedback = result
            return .lesson(l)
        case (.lesson(var l), .attemptFailed):
            l.checking = false
            return .lesson(l)
        case (.lesson(var l), .next):
            guard l.feedback != nil || l.isIntro, let id = l.queue.first else { return state }
            // Испытание окончено досрочно (ошибок больше, чем можно): оставшиеся упражнения не показываем.
            let ended = l.feedback?.runEnded == true
            let retry = !ended && l.willRetry
            l.queue.removeFirst()
            if ended { l.queue.removeAll() }
            if retry {
                l.queue.append(id)
                l.retries[id, default: 0] += 1
            } else {
                l.finished.append(id)
            }
            l.shownBefore[id, default: 0] += 1
            l.feedback = nil
            l.attemptId = nil
            return l.queue.isEmpty ? .completing(l, failed: false) : .lesson(l)
        case (.lesson(var l), .quit):
            l.quit = true
            return .lesson(l)
        case (.lesson(var l), .stay):
            l.quit = false
            return .lesson(l)
        case (.lesson, .leave):
            return .trail(sealed: nil)

        case (.completing(let l, _), .completed(let summary, let showStreak)):
            return .result(AfterLesson(node: l.node, run: l.run, summary: summary, showStreak: showStreak))
        case (.completing(let l, _), .completeFailed):
            return .completing(l, failed: true)
        case (.completing(let l, _), .retryComplete):
            return .completing(l, failed: false)
        case (.completing, .leave):
            return .trail(sealed: nil)

        case (.empty, .continue):
            return .trail(sealed: nil)
        case (.result(let after), .continue):
            return next(after: .result, after)
        case (.streak(let after), .continue):
            return next(after: .streak, after)
        case (.achievement(let after), .continue):
            return next(after: .achievement, after)
        case (.leagueUp(let after), .continue):
            return next(after: .leagueUp, after)
        default:
            return state
        }
    }

    /// Экраны после урока по порядку; показываются только нужные этому уроку (`wants`).
    enum AfterStep: CaseIterable {
        case result, streak, achievement, leagueUp
    }

    static func wants(_ step: AfterStep, _ after: AfterLesson) -> Bool {
        switch step {
        case .result: true
        case .streak: after.showStreak
        case .achievement: !(after.summary.newAchievements ?? []).isEmpty
        case .leagueUp: after.summary.leagueResult?.outcome == .promoted
        }
    }

    /// Следующий нужный шаг после `current`; шагов больше нет — тропа (узел урока «запечатывается»).
    private static func next(after current: AfterStep, _ after: AfterLesson) -> FlowState {
        let steps = AfterStep.allCases
        let rest = steps.drop { $0 != current }.dropFirst()
        guard let step = rest.first(where: { wants($0, after) }) else { return .trail(sealed: after.node.sealable) }
        return switch step {
        case .result: .result(after)
        case .streak: .streak(after)
        case .achievement: .achievement(after)
        case .leagueUp: .leagueUp(after)
        }
    }
}

public extension RunExercise {
    /// `id` упражнения в забеге — `exerciseId` ответа.
    var exerciseId: String {
        switch self {
        case .tilesRuBa(let e): e.id
        case .choiceBaRu(let e): e.id
        case .freeRuBa(let e): e.id
        case .duel(let e): e.id
        case .matchPairs(let e): e.id
        case .wordIntro(let e): e.id
        }
    }

    /// Карточка «Новое слово» — без ответа.
    var isIntro: Bool {
        if case .wordIntro = self { true } else { false }
    }

    var isDuel: Bool {
        if case .duel = self { true } else { false }
    }
}
