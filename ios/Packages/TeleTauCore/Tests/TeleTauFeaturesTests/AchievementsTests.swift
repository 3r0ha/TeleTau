@testable import DesignSystem
import Foundation
import Testing
@testable import TeleTauAPI
@testable import TeleTauFeatures

// Награды: значок и тон по AchievementIcon, подписи для VoiceOver, загрузка вместе с профилем.

@Suite("Награды: значки и подписи")
struct AchievementTextTests {
    @Test("Значок — по AchievementIcon; незнакомый — звезда мёдом")
    func icons() {
        #expect(Fixture.award("first-lesson").badgeIcon == .footprints)
        #expect(Fixture.award("perfect-lesson").badgeIcon == .sealCheck)
        #expect(Fixture.award("streak-7").badgeIcon == .fire)
        #expect(Fixture.award("goal-7").badgeIcon == .target)
        #expect(Fixture.award("words-10").badgeIcon == .bookOpen)
        #expect(Fixture.award("words-50").badgeIcon == .books)
        #expect(Fixture.award("first-vote").badgeIcon == .scales)
        #expect(Fixture.award("first-place").badgeIcon == .mapPin)
        #expect(Fixture.award("all-places").badgeIcon == .flagBanner)
        let unknown = S.Achievement(id: "lesson-100", titleRu: "100 уроков", descriptionRu: "Пройди 100 уроков", icon: "rocket-launch",
                                    earnedOn: "2026-11-05", progress: 100, target: 100)
        #expect(unknown.badgeIcon == .star)
        #expect(AwardTone.of(unknown) == .honey)
    }

    @Test("Тон: полученная — цвет по значку, ещё не полученная — воск")
    func tones() {
        #expect(AwardTone.of(Fixture.award("streak-3", earnedOn: "2026-11-05")) == .streak)
        #expect(AwardTone.of(Fixture.award("perfect-lesson", earnedOn: "2026-11-05")) == .green)
        #expect(AwardTone.of(Fixture.award("first-place", earnedOn: "2026-11-05")) == .green)
        #expect(AwardTone.of(Fixture.award("words-50", earnedOn: "2026-11-05")) == .water)
        #expect(AwardTone.of(Fixture.award("votes-10", earnedOn: "2026-11-05")) == .violet)
        #expect(AwardTone.of(Fixture.award("first-lesson", earnedOn: "2026-11-05")) == .honey)
        #expect(AwardTone.of(Fixture.award("streak-7", progress: 5)) == .locked)
    }

    @Test("VoiceOver: «получена 5 ноября», «5 из 7» или «ещё не получена»")
    func spoken() {
        #expect(Fixture.award("streak-7", earnedOn: "2026-11-05").spokenLabel == "7 дней подряд, получена 5 ноября")
        #expect(Fixture.award("streak-7", progress: 5).spokenLabel == "7 дней подряд, 5 из 7")
        #expect(Fixture.award("first-place").spokenLabel == "Место пройдено, ещё не получена")
        #expect(Format.dayLong("2026-11-05") == "5 ноября")
        #expect(Format.dayLong("2027-01-31") == "31 января")
        #expect(Format.dayLong("сегодня") == "")
    }

    @Test("Демо-набор: 5 из 12 получены, у полученных прогресс равен цели")
    func demoSet() {
        let data = Fixture.achievements
        #expect(data.earned == 5)
        #expect(data.total == 12)
        #expect(data.achievements.filter { $0.earnedOn != nil }.allSatisfy { $0.progress == $0.target })
    }
}

@MainActor
@Suite("Награды в профиле")
struct AchievementsModelTests {
    @Test("Загружаются вместе с профилем")
    func loaded() async throws {
        var backend = StubBackend(progress: Fixture.progress)
        backend.achievements = Fixture.achievements
        let model = StudentModel(backend: backend, me: Fixture.me, defaults: try #require(UserDefaults(suiteName: "teletau.tests.awards.\(UUID().uuidString)")))
        await model.loadProfile()
        #expect(model.achievements.value == Fixture.achievements)
        #expect(model.progress.value != nil)
    }

    @Test("Не загрузились — блока нет, остальной профиль загружен")
    func failed() async throws {
        let model = StudentModel(backend: StubBackend(progress: Fixture.progress), me: Fixture.me,
                                 defaults: try #require(UserDefaults(suiteName: "teletau.tests.awards.\(UUID().uuidString)")))
        await model.loadProfile()
        #expect(model.achievements.value == nil)
        #expect(model.achievements.error != nil)
        #expect(model.progress.value == Fixture.progress)
        #expect(model.course.value != nil)
    }
}
