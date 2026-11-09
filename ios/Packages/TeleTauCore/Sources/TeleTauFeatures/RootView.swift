import DesignSystem
import TeleTauAPI
import TeleTauSession
import SwiftUI

/// Корень приложения: старт, вход ученика и вкладки. Экраны входа — в режиме «Пчёлка» (возраст ещё неизвестен,
/// крупные цели подходят всем), вкладки — в режиме по `Me.uiMode`.
public struct TeleTauRootView: View {
    @State private var app: AppModel
    @State private var settings = false
    /// «Тёмная тема» из профиля; без выбора — светлая.
    @AppStorage(AppTheme.defaultsKey) private var theme: AppTheme = .light
    @Environment(\.openURL) private var openURL

    public init(app: AppModel) {
        _app = State(initialValue: app)
        TeleTauFonts.register()
    }

    public var body: some View {
        Group {
            switch app.route {
            case .launching:
                SplashView()
            case .start:
                StartView(
                    account: app.account,
                    onStudent: app.goScan,
                    onSelf: app.goSelf,
                    onTeacher: { openURL(app.teacherURL) },
                    onEmail: { openURL(app.emailLoginURL) },
                    onResume: app.resume,
                    onNotMe: { Task { await app.logout() } },
                    onSettings: { settings = true }
                )
            case .scan:
                ScanView(backend: app.backend, endedReason: app.endedReason, onBack: app.goStart, onNoCard: app.goClassCode) { me in
                    app.enter(me, firstTime: me.nickname == nil)
                }
                .environment(\.teletauMode, .bee)
            case .selfStart:
                SelfOnboardingView(backend: app.backend, onBack: app.goStart) { me in app.enter(me, firstTime: false) }
                    .environment(\.teletauMode, .bee)
            case .classCode:
                ClassCodeView(backend: app.backend, onBack: app.goScan, onTicket: app.waitForTeacher)
                    .environment(\.teletauMode, .bee)
            case .wait(let ticket):
                WaitView(backend: app.backend, ticket: ticket, onApproved: app.joined, onAgain: app.goClassCode,
                         onLeave: app.goScan)
                    .environment(\.teletauMode, .bee)
            case .nickname:
                NicknameView(backend: app.backend, onChosen: app.joined, onNotMine: { Task { await app.logout() } })
                    .environment(\.teletauMode, .bee)
            case .joined:
                if let me = app.account {
                    JoinedView(me: me, onTrail: app.goTrail, onLogout: { Task { await app.logout() } })
                        .environment(\.teletauMode, TeleTauMode(me.uiMode))
                }
            case .student:
                if let student = app.student {
                    StudentRootView(model: student, onLogout: { Task { await app.logout() } })
                        .environment(\.teletauMode, student.mode)
                }
            }
        }
        .environment(\.teletauWebBase, app.webURL)
        .task { await app.launch() }
        .sheet(isPresented: $settings) {
            ServerSettingsView(current: app.apiURL, currentWeb: app.savedWebURL, defaultWeb: ServerAddress.webURL(api: app.apiURL, configured: nil),
                               onSave: { await app.setServer($0, web: $1) }, onClose: { settings = false })
                .presentationDetents([.medium])
        }
        // Тема всего окна: токены TeleTauColor — динамические цвета, они берут схему из окружения SwiftUI.
        .preferredColorScheme(theme.colorScheme)
    }
}

extension TeleTauMode {
    init(_ mode: Components.Schemas.UiMode?) {
        switch mode {
        case .bee: self = .bee
        case .keeper: self = .keeper
        default: self = .bortnik
        }
    }
}

/// Вкладки ученика и поток урока поверх них.
struct StudentRootView: View {
    @Bindable var model: StudentModel
    let onLogout: @MainActor () -> Void
    @State private var leaving = false

    var body: some View {
        ZStack(alignment: .bottom) {
            switch model.flow {
            case .trail:
                if model.showSplash && model.course.value == nil && model.course.error == nil {
                    SplashView()
                } else {
                    tabs
                }
            case .starting:
                LessonLoadingView(onLeave: model.leave)
            case .empty(let node):
                NothingToDoView(kind: node.kind, onContinue: model.continueAfter)
            case .lesson(let lesson):
                LessonPlayerView(lesson: lesson, onCheck: model.check, onNext: model.next, onQuit: model.quit, onStay: model.stay, onLeave: model.leave,
                                 onHint: { model.hintOpened($0) })
            case .completing(_, let failed):
                LessonSavingView(failed: failed, onRetry: model.retryComplete, onLeave: model.leave)
            case .result(let after):
                if let jump = after.summary.jump {
                    JumpResultView(jump: jump, summary: after.summary, place: model.course.value?.units.first { $0.id == jump.unitId }?.place,
                                   onContinue: model.continueAfter)
                } else {
                    ResultView(run: after.run, summary: after.summary, place: LessonPlace.of(model.course.value, nodeId: after.node.id), onContinue: model.continueAfter)
                }
            case .streak(let after):
                StreakView(summary: after.summary, onContinue: model.continueAfter)
            case .achievement(let after):
                NewAchievementView(achievements: after.summary.newAchievements ?? [], onContinue: model.continueAfter)
            case .leagueUp(let after):
                if let result = after.summary.leagueResult {
                    LeagueUpView(result: result, busy: model.leagueBusy, onContinue: model.continueAfter)
                }
            }
            if let toast = model.toast {
                Toast(text: toast)
                    .padding(.bottom, 96)
                    .transition(.opacity)
                    .task(id: toast) {
                        try? await Task.sleep(for: .seconds(4))
                        model.toast = nil
                    }
            }
        }
        .task { await model.loadTrail() }
    }

    private var tabs: some View {
        VStack(spacing: 0) {
            Group {
                switch model.tab {
                case .path:
                    switch model.course {
                    case .loaded(let course):
                        TrailScreen(course: course, progress: model.progress.value, sealed: model.sealed, busy: model.busyNode,
                                    onStart: model.start, onReview: model.startReview, onJump: model.startJump, onLeague: { model.tab = .league })
                    case .failed(let e):
                        VStack(spacing: 0) {
                            LearnTopBar(progress: model.progress.value, onLeague: { model.tab = .league })
                            TeleTauScroll { Column { LoadErrorView(error: e) { Task { await model.loadTrail() } } } }
                        }
                    case .loading:
                        VStack(spacing: 0) {
                            LearnTopBar(progress: model.progress.value, onLeague: { model.tab = .league })
                            Column { LoadingBlock(rows: 4, label: "Открываем тропу") }
                            Spacer()
                        }
                    }
                case .league:
                    TabPage(load: model.loadLeague, loadable: model.league, label: "Загружаем лигу") { league in
                        LeagueContent(league: league, now: Date(), onTrail: { model.tab = .path })
                    }
                case .hive:
                    if model.showJoin {
                        JoinClassView(backend: model.backend, nickname: model.me.nickname ?? "", onBack: { model.showJoin = false },
                                      onJoined: model.joinedClass)
                    } else if let klass = studentClass(model.me) {
                        TabPage(load: model.loadHive, loadable: model.hive, label: "Загружаем улей") { hive in
                            HiveContent(hive: hive, title: klass.title, schoolName: klass.schoolName)
                        }
                    } else {
                        TeleTauScroll { Column { NoClassView(me: model.me, onJoin: { model.showJoin = true }, onLeague: { model.tab = .league }) } }
                    }
                case .me:
                    ProfileTab(model: model) { leaving = true }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            StudentTabBar(current: model.tab) { tab in
                model.tab = tab
                model.showWords = false
                model.showCard = false
                model.showJoin = false
                model.award = nil
            }
        }
        .background(TeleTauColor.bg.ignoresSafeArea())
        .overlay {
            AwardSheet(award: model.tab == .me ? model.award : nil, onClose: { model.award = nil })
        }
        .overlay {
            if model.showIntro, model.tab == .path {
                TrailIntroView(goal: model.introGoal, onStart: { model.closeIntro(start: true) }, onClose: { model.closeIntro(start: false) })
                    .transition(.opacity)
            }
        }
        .overlay {
            if leaving {
                let noWayBack = LeaveText.noWayBack(model.me)
                TeleTauDialog(art: noWayBack ? .beeThink : .beeSympathy, title: noWayBack ? "Сначала сделай карточку" : "Уже уходишь?", text: LeaveText.text(model.me)) {
                    if noWayBack {
                        TeleTauButton("Сделать карточку") {
                            leaving = false
                            model.tab = .me
                            model.showCard = true
                        }
                    } else {
                        TeleTauButton("Остаться") { leaving = false }
                    }
                    LinkButton("Выйти", tone: .danger, action: onLogout)
                }
            }
        }
    }
}

/// Вкладка с загрузкой: скелетон, ошибка с повтором или содержимое; обновляется при каждом открытии.
struct TabPage<Value: Sendable, Content: View>: View {
    let load: @MainActor () async -> Void
    let loadable: Loadable<Value>
    let label: String
    @ViewBuilder let content: (Value) -> Content

    var body: some View {
        TeleTauScroll {
            Column {
                switch loadable {
                case .loaded(let value): content(value)
                case .failed(let e): LoadErrorView(error: e) { Task { await load() } }
                case .loading: LoadingBlock(rows: 3, label: label)
                }
            }
        }
        .refreshable { await load() }
        .task { await load() }
    }
}

struct ProfileTab: View {
    @Bindable var model: StudentModel
    let onLogout: @MainActor () -> Void
    @Environment(\.openURL) private var openURL
    @Environment(\.teletauWebBase) private var webBase
    @State private var goalOpen = false
    @State private var goal = DailyGoalChoice.standard
    @State private var goalBusy = false
    @State private var goalError: String?

    var body: some View {
        if model.showCard {
            LoginCardView(backend: model.backend, me: model.me, site: webBase?.host() ?? "", onBack: { model.showCard = false })
        } else if model.showWords {
            TabPage(load: model.loadWords, loadable: model.words, label: "Открываем словарь") { words in
                WordsContent(data: words, onBack: { model.showWords = false }, onReview: model.reviewFromWords,
                             onTrail: { model.showWords = false; model.tab = .path })
            }
        } else {
            profile
        }
    }

    /// «Я учитель» — заявка учителя на сайте (у приложения нет кабинета учителя).
    private var teacherLink: (@MainActor () -> Void)? {
        guard let url = webBase?.appendingPathComponent("teacher/apply") else { return nil }
        let open = openURL
        return { open(url) }
    }

    private var profile: some View {
        TeleTauScroll {
            Column {
                if let progress = model.progress.value, let cells = model.cells.value, let course = model.course.value {
                    ProfileContent(me: model.me, progress: progress, cells: cells, course: course, fresh: model.fresh,
                                   words: model.words.value, achievements: model.achievements.value, onAward: { model.award = $0 },
                                   onWords: { model.showWords = true }, onCard: { model.showCard = true },
                                   onEmail: { if let webBase { openURL(webBase.appendingPathComponent("me/email")) } },
                                   onGoal: {
                                       goal = model.me.dailyGoal ?? DailyGoalChoice.standard
                                       goalError = nil
                                       goalOpen = true
                                   },
                                   onTeacher: teacherLink,
                                   onLogout: onLogout)
                } else if let error = model.cells.error ?? model.progress.error ?? model.course.error {
                    LoadErrorView(error: error) { Task { await model.loadProfile() } }
                } else {
                    LoadingBlock(rows: 4, label: "Загружаем профиль")
                }
            }
        }
        .refreshable { await model.loadProfile() }
        .task { await model.loadProfile() }
        .overlay {
            if goalOpen {
                GoalDialog(goal: $goal, busy: goalBusy, error: goalError, onSave: {
                    Task {
                        goalBusy = true
                        do {
                            try await model.setDailyGoal(goal)
                            goalOpen = false
                        } catch {
                            goalError = ChildText.describe(APIError.from(error))
                        }
                        goalBusy = false
                    }
                }, onClose: { goalOpen = false })
            }
        }
    }
}
