import Foundation
import SwiftUI
import Testing
@testable import DesignSystem

// «Тёмная тема» в профиле: выбор хранится на устройстве, без выбора тема светлая (системная не учитывается); токены берут
// схему из окружения.

@Suite("DesignSystem: тема приложения")
struct AppThemeTests {
    private func freshDefaults() throws -> UserDefaults {
        try #require(UserDefaults(suiteName: "teletau.tests.theme.\(UUID().uuidString)"))
    }

    @Test("Без выбора — светлая, даже в тёмной системе: корень задаёт светлую схему, а не системную")
    func lightByDefault() throws {
        let defaults = try freshDefaults()
        let theme = AppTheme.stored(in: defaults)
        #expect(theme == .light)
        #expect(theme.colorScheme == .light)
    }

    @Test("Прежнее значение «как в системе» и неизвестное значение — светлая тема", arguments: ["system", "sepia"])
    func unknownStoredValue(raw: String) throws {
        let defaults = try freshDefaults()
        defaults.set(raw, forKey: AppTheme.defaultsKey)
        #expect(AppTheme.stored(in: defaults) == .light)
        #expect(AppStorage(wrappedValue: AppTheme.light, AppTheme.defaultsKey, store: defaults).wrappedValue == .light)
    }

    @Test("Выбор сохраняется и читается; корень задаёт схему выбора", arguments: [true, false])
    func storedChoice(dark: Bool) throws {
        let defaults = try freshDefaults()
        AppTheme.store(dark: dark, in: defaults)
        let theme = AppTheme.stored(in: defaults)
        #expect(theme == (dark ? .dark : .light))
        #expect(theme.colorScheme == (dark ? .dark : .light))
    }

    @Test("@AppStorage экранов читает и пишет тот же ключ и формат, что AppTheme.stored/store")
    func appStorageShares() throws {
        let defaults = try freshDefaults()
        AppTheme.store(dark: true, in: defaults)
        #expect(AppStorage(wrappedValue: AppTheme.light, AppTheme.defaultsKey, store: defaults).wrappedValue == .dark)
        defaults.set(AppTheme.light.rawValue, forKey: AppTheme.defaultsKey)
        #expect(AppStorage(wrappedValue: AppTheme.light, AppTheme.defaultsKey, store: defaults).wrappedValue == .light)
        let other = try freshDefaults()
        #expect(AppStorage(wrappedValue: AppTheme.light, AppTheme.defaultsKey, store: other).wrappedValue == .light)
    }

    /// На главном акторе: динамический NSColor/UIColor разрешается на главном потоке, вне его `resolve(in:)` ждёт его вечно.
    @Test("Цвета токенов берут схему из окружения SwiftUI, а не только из системы", .timeLimit(.minutes(1)))
    @MainActor
    func tokensFollowEnvironment() {
        var light = EnvironmentValues()
        light.colorScheme = .light
        var dark = EnvironmentValues()
        dark.colorScheme = .dark
        for (color, lightHex, darkHex) in [(TeleTauColor.bg, 0xFFFCF5, 0x131F24), (TeleTauColor.textPrimary, 0x3B2716, 0xF1F7FB)] {
            #expect(hex(color.resolve(in: light)) == lightHex)
            #expect(hex(color.resolve(in: dark)) == darkHex)
        }
    }

    /// Компоненты `Color.Resolved` — линейные; сравниваем в гамма-sRGB, как записаны токены.
    private func hex(_ c: Color.Resolved) -> Int? {
        guard let srgb = CGColorSpace(name: CGColorSpace.sRGB),
              let parts = c.cgColor.converted(to: srgb, intent: .defaultIntent, options: nil)?.components, parts.count >= 3 else { return nil }
        func byte(_ v: CGFloat) -> Int { Int((v * 255).rounded()) }
        return byte(parts[0]) << 16 | byte(parts[1]) << 8 | byte(parts[2])
    }
}
