#if canImport(AppKit)
import AppKit
import DesignSystem
import Foundation
import ImageIO
import SwiftUI
import Testing
@testable import TeleTauAPI
@testable import TeleTauFeatures

// Экраны ученика в эталонные снимки: ImageRenderer на macOS (рантайма iOS-симулятора нет), 390 pt шириной, @2x.
// Фактический рендер — в .build/snapshots/ пакета; эталоны — Tests/TeleTauFeaturesTests/__Snapshots__/ и перезаписываются
// только явно: TELETAU_RECORD_SNAPSHOTS=1 swift test --package-path ios/Packages/TeleTauCore (после ревью картинки).
// Платформенные контролы (ScrollView, UITextView, камера) ImageRenderer не рисует — экраны рендерятся с
// `teletauStaticRender`: то же содержимое без прокрутки.

enum Snap {
    static let width: CGFloat = 390
    static let scale: CGFloat = 2
    static let channelTolerance = 8
    /// Доля отличающихся пикселей: сглаживание шрифтов между версиями macOS.
    static let maxDiffShare = 0.003
    static let record = ProcessInfo.processInfo.environment["TELETAU_RECORD_SNAPSHOTS"] == "1"

    static let referenceDirectory = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("__Snapshots__", isDirectory: true)
    static let actualDirectory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent(".build/snapshots", isDirectory: true)

    @MainActor
    static func render(_ view: some View, height: CGFloat, dark: Bool = false, mode: TeleTauMode = .bortnik) -> CGImage? {
        TeleTauFonts.register()
        let content = view
            .frame(width: width, height: height)
            .background(TeleTauColor.bg)
            .environment(\.colorScheme, dark ? .dark : .light)
            .environment(\.teletauStaticRender, true)
            .environment(\.teletauMode, mode)
            .environment(\.teletauWebBase, URL(string: "http://192.168.1.5:3000"))
            .environment(\.locale, Locale(identifier: "ru"))
        let renderer = ImageRenderer(content: content)
        renderer.proposedSize = ProposedViewSize(width: width, height: height)
        renderer.scale = scale
        var image: CGImage?
        NSAppearance(named: dark ? .darkAqua : .aqua)?.performAsCurrentDrawingAppearance {
            image = renderer.cgImage
        }
        return image
    }

    /// Пишет рендер, при записи — эталон; иначе сверяет с эталоном попиксельно (с допуском).
    @MainActor
    static func check(_ name: String, _ view: some View, height: CGFloat = 844, dark: Bool = false, mode: TeleTauMode = .bortnik) throws {
        let image = try #require(render(view, height: height, dark: dark, mode: mode), "ImageRenderer не вернул изображение: \(name)")
        let file = "\(name).png"
        let actual = try save(image, to: actualDirectory.appendingPathComponent(file))
        if record { _ = try save(image, to: referenceDirectory.appendingPathComponent(file)) }
        let referenceURL = referenceDirectory.appendingPathComponent(file)
        guard FileManager.default.fileExists(atPath: referenceURL.path) else {
            Issue.record("Нет эталона \(referenceURL.path). Запишите осознанно: TELETAU_RECORD_SNAPSHOTS=1 swift test --package-path ios/Packages/TeleTauCore")
            return
        }
        let source = try #require(CGImageSourceCreateWithURL(referenceURL as CFURL, nil))
        let reference = try #require(CGImageSourceCreateImageAtIndex(source, 0, nil))
        let a = pixels(image), b = pixels(reference)
        try #require(image.width == reference.width && image.height == reference.height,
                     "\(name): размер \(image.width)×\(image.height) ≠ эталону \(reference.width)×\(reference.height)")
        var differing = 0
        for i in stride(from: 0, to: a.count, by: 4) {
            if abs(Int(a[i]) - Int(b[i])) > channelTolerance || abs(Int(a[i + 1]) - Int(b[i + 1])) > channelTolerance
                || abs(Int(a[i + 2]) - Int(b[i + 2])) > channelTolerance { differing += 1 }
        }
        let share = Double(differing) / Double(image.width * image.height)
        #expect(share <= maxDiffShare, "\(name): отличается \(String(format: "%.2f", share * 100))% пикселей. Рендер: \(actual.path)")
    }

    static func pixels(_ image: CGImage) -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
        bytes.withUnsafeMutableBytes { buffer in
            let ctx = CGContext(data: buffer.baseAddress, width: image.width, height: image.height, bitsPerComponent: 8,
                                bytesPerRow: image.width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        }
        return bytes
    }

    static func save(_ image: CGImage, to url: URL) throws -> URL {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try #require(NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]))
        try data.write(to: url, options: .atomic)
        return url
    }
}

/// Вкладка с нижней навигацией — как в приложении.
struct WithTabBar<Content: View>: View {
    let tab: StudentTab
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            content.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            StudentTabBar(current: tab) { _ in }
        }
    }
}

@MainActor
@Suite("Экраны ученика: эталонные снимки", .serialized)
struct ScreenSnapshotTests {
    let noop: @MainActor () -> Void = {}

    @Test("Тропа: шапка места, плашка «Повторить 3 слова», узел «Начать» на первом экране, цель дня")
    func trail() throws {
        let screen = WithTabBar(tab: .path) {
            TrailScreen(course: Fixture.course, progress: Fixture.progress, sealed: nil, busy: nil, onStart: { _ in }, onReview: noop, onLeague: noop)
        }
        try Snap.check("trail", screen)
        try Snap.check("trail-dark", screen, dark: true)
    }

    @Test("Знакомство с пчелой: два листа поверх тропы")
    func intro() throws {
        for (step, name) in [(0, "intro"), (1, "intro-goal")] {
            try Snap.check(name, ZStack {
                WithTabBar(tab: .path) {
                    TrailScreen(course: Fixture.courseNew, progress: Fixture.progressNew, sealed: nil, busy: nil, onStart: { _ in }, onLeague: noop)
                }
                TrailIntroView(goal: 2, step: step, onStart: noop, onClose: noop)
            })
        }
    }

    @Test("Тропа: закрытый узел подсказывает, что пройти сначала")
    func lockedHint() throws {
        try Snap.check("trail-locked-hint", WithTabBar(tab: .path) {
            TrailScreen(course: Fixture.course, progress: Fixture.progress, sealed: nil, busy: nil, onStart: { _ in }, onReview: noop, onLeague: noop,
                        hint: TrailHint(node: "u01-vezhlivye-slova", text: TeleTauFeatures.lockedHint(Fixture.course, nodeId: "u01-vezhlivye-slova")))
        }, height: 1700)
    }

    @Test("Тропа: плашки «Задание учителя» и «Повторить» над шапкой места, «Начать» — над вкладками")
    func trailToday() throws {
        try Snap.check("trail-today", WithTabBar(tab: .path) {
            TrailScreen(course: Fixture.courseToday, progress: Fixture.progress, sealed: nil, busy: nil, onStart: { _ in }, onReview: noop, onLeague: noop, today: "2026-11-05")
        })
    }

    @Test("Тропа: текущее место второе — тропа открывается на нём")
    func trailSecondPlace() throws {
        try Snap.check("trail-second-place", WithTabBar(tab: .path) {
            TrailScreen(course: Fixture.courseSecondPlace, progress: Fixture.progress, sealed: nil, busy: nil, onStart: { _ in }, onReview: noop, onLeague: noop)
        })
    }

    @Test("Тропа: задания учителя — активное и выполненное")
    func trailTasks() throws {
        try Snap.check("trail-tasks", TeleTauScroll { TrailContent(course: Fixture.courseWithTasks, sealed: nil, busy: nil, onStart: { _ in }, onReview: noop, today: "2026-11-05") }, height: 1300)
    }

    @Test("Тропа целиком: места с вывесками и декорациями")
    func trailFull() throws {
        try Snap.check("trail-full", TeleTauScroll { TrailContent(course: Fixture.course, sealed: nil, busy: nil, onStart: { _ in }) }, height: 2340)
    }

    @Test("Урок: плитки")
    func tiles() throws {
        let view = LessonPlayerView(lesson: Fixture.lesson(at: 0), draft: .tiles(["t3", "t1"]), onCheck: { _ in }, onNext: noop, onQuit: noop, onStay: noop, onLeave: noop)
        try Snap.check("lesson-tiles", view)
        try Snap.check("lesson-tiles-dark", view, dark: true)
    }

    @Test("Урок: верно — плитки зелёные, огонёк «3 подряд»")
    func tilesCombo() throws {
        try Snap.check("lesson-combo", LessonPlayerView(lesson: Fixture.lesson(at: 0, feedback: Fixture.correctTiles), draft: .tiles(["t3", "t1"]), combo: 3,
                                                        onCheck: { _ in }, onNext: noop, onQuit: noop, onStay: noop, onLeave: noop))
        try Snap.check("lesson-combo-dark", LessonPlayerView(lesson: Fixture.lesson(at: 0, feedback: Fixture.correctTiles), draft: .tiles(["t3", "t1"]), combo: 3,
                                                             onCheck: { _ in }, onNext: noop, onQuit: noop, onStay: noop, onLeave: noop), dark: true)
        try Snap.check("lesson-tiles-wrong", LessonPlayerView(lesson: Fixture.lesson(at: 0, feedback: Fixture.wrongTiles), draft: .tiles(["t1", "t3"]),
                                                              onCheck: { _ in }, onNext: noop, onQuit: noop, onStay: noop, onLeave: noop))
    }

    @Test("Урок: «Новое слово» и подсказки к словам условия")
    func wordIntro() throws {
        let player = { (l: LessonState) in LessonPlayerView(lesson: l, onCheck: { _ in }, onNext: {}, onQuit: {}, onStay: {}, onLeave: {}) }
        try Snap.check("lesson-word-intro", player(Fixture.introLesson(at: 0)))
        try Snap.check("lesson-word-intro-dark", player(Fixture.introLesson(at: 0)), dark: true)
        try Snap.check("lesson-word-intro-long", player(Fixture.introLesson(at: 1)), mode: .bee)
        try Snap.check("lesson-hint", player(Fixture.introLesson(at: 2)).environment(\.teletauOpenHint, 1))
        try Snap.check("lesson-hint-bee", player(Fixture.introLesson(at: 4)).environment(\.teletauOpenHint, 0), mode: .bee)
    }

    @Test("Урок: выбор перевода и «Пока не так»")
    func choiceWrong() throws {
        try Snap.check("lesson-choice", LessonPlayerView(lesson: Fixture.lesson(at: 1), draft: .choice("o2"), onCheck: { _ in }, onNext: noop, onQuit: noop, onStay: noop, onLeave: noop))
        try Snap.check("lesson-choice-wrong", LessonPlayerView(lesson: Fixture.lesson(at: 1, feedback: Fixture.wrongChoice), draft: .choice("o2"),
                                                               onCheck: { _ in }, onNext: noop, onQuit: noop, onStay: noop, onLeave: noop))
    }

    @Test("Урок: ввод с панелью башкирских букв и «Почти!»")
    func freeAlmost() throws {
        try Snap.check("lesson-input", LessonPlayerView(lesson: Fixture.lesson(at: 2), draft: .text("даф"), onCheck: { _ in }, onNext: noop, onQuit: noop, onStay: noop, onLeave: noop))
        try Snap.check("lesson-almost", LessonPlayerView(lesson: Fixture.lesson(at: 2, feedback: Fixture.almost), draft: .text("дафтәр"),
                                                         onCheck: { _ in }, onNext: noop, onQuit: noop, onStay: noop, onLeave: noop))
    }

    @Test("Урок: ввод в режиме «Пчёлка» — буквы по 5 в ряд, цели 56 pt")
    func freeBee() throws {
        try Snap.check("lesson-input-bee", LessonPlayerView(lesson: Fixture.lesson(at: 2), draft: .text("дәфтәр"), onCheck: { _ in }, onNext: noop, onQuit: noop, onStay: noop, onLeave: noop),
                       mode: .bee)
    }

    @Test("Урок: дуэль «Помоги языку» и «Голос учтён»")
    func duel() throws {
        try Snap.check("lesson-duel", LessonPlayerView(lesson: Fixture.lesson(at: 3), draft: .duel(.a), onCheck: { _ in }, onNext: noop, onQuit: noop, onStay: noop, onLeave: noop))
        try Snap.check("lesson-duel-voted", LessonPlayerView(lesson: Fixture.lesson(at: 3, feedback: Fixture.voted), draft: .duel(.a),
                                                             onCheck: { _ in }, onNext: noop, onQuit: noop, onStay: noop, onLeave: noop))
    }

    @Test("Урок: «Соедини пары»")
    func pairs() throws {
        let links: [S.PairLink] = [.init(left: "l1", right: "r3"), .init(left: "l2", right: "r4")]
        try Snap.check("lesson-pairs", LessonPlayerView(lesson: Fixture.lesson(at: 4), draft: .pairs(links, needed: 4), onCheck: { _ in }, onNext: noop, onQuit: noop, onStay: noop, onLeave: noop))
    }

    @Test("Урок: «Уже уходишь?»")
    func quit() throws {
        var lesson = Fixture.lesson(at: 1)
        lesson.quit = true
        try Snap.check("lesson-quit", LessonPlayerView(lesson: lesson, onCheck: { _ in }, onNext: noop, onQuit: noop, onStay: noop, onLeave: noop))
    }

    @Test("После урока: итог, серия, новая лига")
    func afterLesson() throws {
        try Snap.check("result", ResultView(run: Fixture.run, summary: Fixture.summary, place: LessonPlace(topicRu: "Знакомство", lessonNumber: 3), onContinue: noop), height: 1000)
        try Snap.check("streak", StreakView(summary: Fixture.summary, onContinue: noop))
        try Snap.check("league-up", LeagueUpView(result: Fixture.summary.leagueResult!, busy: false, onContinue: noop))
    }

    @Test("Испытание для перехода: «Уже знаешь?» у вывески закрытого места, «Место открыто», «Пока рано»")
    func jump() throws {
        // Место — как на тропе (отступы TrailContent): вывеска, предложение испытания, закрытая дорожка.
        try Snap.check("trail-jump", UnitSection(unit: Fixture.courseJump.units[1], here: false, withBee: false, sealed: nil, busy: nil,
                                                 onStart: { _ in }, onJump: { _ in })
            .padding(.horizontal, TeleTauSpace.s300)
            .padding(.top, TeleTauSpace.s400)
            .frame(maxHeight: .infinity, alignment: .top), height: 820)
        let passed = Fixture.jumpSummary(passed: true)
        let failed = Fixture.jumpSummary(passed: false)
        let place = Fixture.courseJump.units[1].place
        try Snap.check("jump-passed", JumpResultView(jump: try #require(passed.jump), summary: passed, place: place, onContinue: noop))
        try Snap.check("jump-failed", JumpResultView(jump: try #require(failed.jump), summary: failed, place: place, onContinue: noop))
    }

    @Test("Вкладки: лига, класс, профиль")
    func tabs() throws {
        try Snap.check("league", WithTabBar(tab: .league) {
            TeleTauScroll { Column { LeagueContent(league: Fixture.league, now: Fixture.leagueNow, onTrail: noop) } }
        }, height: 1100)
        try Snap.check("class", WithTabBar(tab: .hive) {
            TeleTauScroll { Column { HiveContent(hive: Fixture.hive, title: "5 «Б»", schoolName: "Демо-школа № 1") } }
        })
        try Snap.check("profile", WithTabBar(tab: .me) {
            TeleTauScroll { Column { ProfileContent(me: Fixture.me, progress: Fixture.progress, cells: Fixture.cells, course: Fixture.course, fresh: (2, 6), words: Fixture.words, onLogout: noop) } }
        }, height: 1100)
    }

    @Test("Профиль в тёмной теме: выключатель «Тёмная тема» включён")
    func profileDark() throws {
        try Snap.check("profile-dark", WithTabBar(tab: .me) {
            TeleTauScroll { Column { ProfileContent(me: Fixture.me, progress: Fixture.progress, cells: Fixture.cells, course: Fixture.course, fresh: nil, words: Fixture.words, onLogout: noop) } }
        }, height: 1100, dark: true)
    }

    /// Профиль с наградами демо-ученика (5 из 12).
    func awardsProfile() -> some View {
        WithTabBar(tab: .me) {
            TeleTauScroll { Column { ProfileContent(me: Fixture.me, progress: Fixture.progress, cells: Fixture.cells, course: Fixture.course, fresh: nil,
                                                    words: Fixture.words, achievements: Fixture.achievements, onLogout: noop) } }
        }
    }

    @Test("Награды в профиле: соты по 3 в ряд — полученные с днём, остальные воском с прогрессом и лентой с числом")
    func awards() throws {
        try Snap.check("awards-profile", awardsProfile(), height: 1580)
        try Snap.check("awards-profile-dark", awardsProfile(), height: 1580, dark: true)
    }

    @Test("Лист награды: полученная — «Получена 5 ноября», в процессе — полоса «5 из 7»")
    func awardSheet() throws {
        let list = Fixture.achievements.achievements
        let earned = try #require(list.first { $0.id == "streak-3" })
        let going = try #require(list.first { $0.id == "streak-7" })
        for (award, name) in [(earned, "awards-sheet-earned"), (going, "awards-sheet-progress")] {
            let screen = ZStack { awardsProfile(); AwardSheet(award: award, onClose: noop) }
            try Snap.check(name, screen)
            try Snap.check("\(name)-dark", screen, dark: true)
        }
    }

    @Test("«Новая награда!» после урока: крупная сота на ореоле из сот; несколько — «Новые награды!» одним экраном")
    func awardNew() throws {
        let view = NewAchievementView(achievements: try #require(Fixture.summaryWithAward.newAchievements), onContinue: noop)
        try Snap.check("awards-new", view)
        try Snap.check("awards-new-dark", view, dark: true)
        try Snap.check("awards-new-many", NewAchievementView(achievements: [Fixture.award("words-10", earnedOn: "2026-11-05"),
                                                                             Fixture.award("first-place", earnedOn: "2026-11-05")], onContinue: noop))
    }

    @Test("«Мой словарь»: «повторить» и «выучено», «Послушать» только у записи AAC")
    func words() throws {
        try Snap.check("words", WithTabBar(tab: .me) {
            TeleTauScroll { Column { WordsContent(data: Fixture.words, onBack: noop, onReview: noop, onTrail: noop) } }
        }, height: 1000)
        try Snap.check("words-empty", WithTabBar(tab: .me) {
            TeleTauScroll { Column { WordsContent(data: .init(summary: .init(total: 0, learned: 0, review: 0), words: []), onBack: noop, onReview: noop, onTrail: noop) } }
        })
    }

    @Test("Пустые и офлайн-состояния")
    func states() throws {
        try Snap.check("offline", WithTabBar(tab: .path) {
            VStack(spacing: 0) {
                LearnTopBar(progress: nil, onLeague: noop)
                TeleTauScroll { Column { LoadErrorView(error: .offline) {} } }
            }
        })
        try Snap.check("league-empty", WithTabBar(tab: .league) {
            TeleTauScroll { Column { LeagueContent(league: .init(week: Fixture.league.week, endsAt: Fixture.league.endsAt, tier: .clover, zones: .init(promote: 5, demote: 0), members: []),
                                                 now: Fixture.leagueNow, onTrail: noop) } }
        })
    }
}
#endif
