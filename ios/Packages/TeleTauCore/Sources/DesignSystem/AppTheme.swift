import Foundation
import SwiftUI

/// Тема приложения — выключатель «Тёмная тема» в профиле. Настройка устройства: хранится в `UserDefaults`
/// (`@AppStorage(AppTheme.defaultsKey)`), на сервер не уходит. Пока ученик ничего не выбирал — тема светлая,
/// системная тема не учитывается.
public enum AppTheme: String, CaseIterable, Sendable {
    case light, dark

    public static let defaultsKey = "teletau.theme"

    /// Выбор выключателем «Тёмная тема».
    public init(dark: Bool) {
        self = dark ? .dark : .light
    }

    /// Для `preferredColorScheme` на корне: тема задаётся всегда, а не берётся из системы.
    public var colorScheme: ColorScheme {
        switch self {
        case .light: .light
        case .dark: .dark
        }
    }

    /// Сохранённый выбор; не выбирал или значение неизвестно — `.light`.
    public static func stored(in defaults: UserDefaults = .standard) -> AppTheme {
        defaults.string(forKey: defaultsKey).flatMap(AppTheme.init(rawValue:)) ?? .light
    }

    public static func store(dark: Bool, in defaults: UserDefaults = .standard) {
        defaults.set(AppTheme(dark: dark).rawValue, forKey: defaultsKey)
    }
}
