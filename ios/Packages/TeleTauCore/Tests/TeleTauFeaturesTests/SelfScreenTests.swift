#if canImport(AppKit)
import AuthCodes
import DesignSystem
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SwiftUI
import Testing
@testable import TeleTauAPI
@testable import TeleTauFeatures
@testable import TeleTauSession

/// Сервер, которого нет: снимки экранов не ходят в сеть (данные — из предустановок экранов).
struct OfflineTransport: ClientTransport {
    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
        throw URLError(.notConnectedToInternet)
    }
}

@MainActor
let offlineBackend: any StudentBackend = TeleTauClient(
    baseURL: URL(string: "http://192.168.1.5:4000")!, session: SessionStore(secure: InMemorySecureStore()), transport: OfflineTransport()
)

@MainActor
@Suite("«Учусь сам»: эталонные снимки", .serialized)
struct SelfScreenSnapshotTests {
    let noop: @MainActor () -> Void = {}

    @Test("Старт: «Я ученик», «Учусь сам», «Я учитель»")
    func start() throws {
        let view = StartView(account: nil, onStudent: noop, onSelf: noop, onTeacher: noop, onEmail: noop, onResume: noop, onNotMe: noop, onSettings: noop)
        try Snap.check("start", view)
        try Snap.check("start-dark", view, dark: true)
        try Snap.check("start-resume", StartView(account: Fixture.me, onStudent: noop, onSelf: noop, onTeacher: noop, onEmail: noop, onResume: noop,
                                                 onNotMe: noop, onSettings: noop), height: 1000)
    }

    @Test("Онбординг: возраст и ник; цель дня — в профиле")
    func onboarding() throws {
        try Snap.check("self-age", SelfOnboardingView(backend: offlineBackend, onBack: noop, onStarted: { _ in },
                                                      preset: (.age, .age1114, nil)), mode: .bee)
        try Snap.check("self-nick", SelfOnboardingView(backend: offlineBackend, onBack: noop, onStarted: { _ in },
                                                       preset: (.nick, .age1114, Fixture.nicks)), mode: .bee)
        var goal = 2
        try Snap.check("goal-dialog", GoalDialog(goal: Binding(get: { goal }, set: { goal = $0 }), busy: false, error: nil, onSave: noop, onClose: noop))
    }

    @Test("Моя карточка входа: ещё нет и выпущена (QR CoreImage)")
    func card() throws {
        try Snap.check("card-none", LoginCardView(backend: offlineBackend, me: Fixture.meSolo, site: "teletau.study", onBack: noop, preset: .loaded(nil)))
        try Snap.check("card", LoginCardView(backend: offlineBackend, me: Fixture.meSolo, site: "teletau.study", onBack: noop, preset: .loaded(Fixture.loginCard)), height: 1000)
        try Snap.check("card-dark", LoginCardView(backend: offlineBackend, me: Fixture.meSolo, site: "teletau.study", onBack: noop, preset: .loaded(Fixture.loginCard)),
                       height: 1000, dark: true)
        try Snap.check("card-poster", LoginCardPoster(card: Fixture.loginCard, nickname: "Мудрая сова", site: "teletau.study")
            .scaleEffect(390.0 / 540.0).frame(width: 390, height: 488), height: 488)
    }

    @Test("Профиль «Учусь сам»: карточка входа, цель дня")
    func profileSolo() throws {
        try Snap.check("profile-solo", WithTabBar(tab: .me) {
            TeleTauScroll { Column { ProfileContent(me: Fixture.meSolo, progress: Fixture.progress, cells: Fixture.cells, course: Fixture.course, fresh: nil,
                                                  words: Fixture.words, onLogout: noop) } }
        }, height: 1500)
    }

    @Test("Класс: без класса, вступить по коду, ожидание; взрослому — лига")
    func joinClass() throws {
        try Snap.check("hive-no-class", WithTabBar(tab: .hive) { TeleTauScroll { Column { NoClassView(me: Fixture.meSolo, onJoin: noop, onLeague: noop) } } })
        try Snap.check("hive-adult", WithTabBar(tab: .hive) { TeleTauScroll { Column { NoClassView(me: Fixture.meAdult, onJoin: noop, onLeague: noop) } } })
        try Snap.check("join-class", JoinClassView(backend: offlineBackend, nickname: "Мудрая сова", onBack: noop, onJoined: {}))
        try Snap.check("join-wait", JoinClassView(backend: offlineBackend, nickname: "Мудрая сова", onBack: noop, onJoined: {}, preset: Fixture.joinTicket))
    }
}

@Suite("«Учусь сам»: логика")
struct SelfLogicTests {
    @Test("QR карточки читается обратно и несёт полезную нагрузку TP1 как есть")
    func qrRoundTrip() throws {
        let mask = try #require(QRImage.mask(Fixture.loginCard.payload))
        // Как на экране: тёмные модули по маске на белом, с тихой зоной в 4 модуля.
        let side = CGFloat(mask.width + 8) * 8
        let canvas = CGRect(x: 0, y: 0, width: side, height: side)
        let maskImage = CIImage(cgImage: mask).samplingNearest().transformed(by: CGAffineTransform(scaleX: 8, y: 8).translatedBy(x: 4, y: 4))
        let ciImage = CIImage(color: .black).cropped(to: canvas).applyingFilter("CIBlendWithAlphaMask", parameters: [
            kCIInputBackgroundImageKey: CIImage(color: .white).cropped(to: canvas),
            kCIInputMaskImageKey: maskImage,
        ])
        let detector = try #require(CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]))
        let text = (detector.features(in: ciImage).first as? CIQRCodeFeature)?.messageString
        #expect(text == Fixture.loginCard.payload)
        #expect(try LoginCardCodec.parse(text ?? "").get().kind == .personal)
    }

    @Test("Выход: без карточки и почты — «Сначала сделай карточку»")
    func leaveTexts() {
        var me = Fixture.meSolo
        me.loginCard = S.LoginCardStatus.none
        #expect(LeaveText.noWayBack(me))
        #expect(LeaveText.text(me) == "Без неё мёд и серию не вернуть.")
        #expect(LeaveText.text(Fixture.meSolo) == "Войти снова можно по твоей карточке.")
        #expect(LeaveText.text(Fixture.me) == "Войти снова можно по карточке или коду класса.")
        #expect(DailyGoalChoice.title(nil) == "2 урока в день")
        #expect(DailyGoalChoice.title(1) == "1 урок в день")
    }

    @Test("«Послушать»: запись из ответа API (относительный /audio/<id>.m4a и files[]) играется с сайта")
    func audioFromContract() throws {
        let json = #"{"url":"/audio/063d0f07d15ef02e.m4a","files":[{"url":"/audio/063d0f07d15ef02e.m4a","type":"audio/mp4"},{"url":"/audio/063d0f07d15ef02e.ogg","type":"audio/ogg"}]}"#
        let clip = try JSONDecoder().decode(S.AudioClip.self, from: Data(json.utf8))
        #expect(ClipAddress.resolve(clip.url, webBase: URL(string: "http://192.168.1.5:3000"))?.absoluteString == "http://192.168.1.5:3000/audio/063d0f07d15ef02e.m4a")
    }
}
#endif
