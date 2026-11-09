import CoreText
import Foundation
import SwiftUI

/// Шрифты «Борть» (docs/05 §4): Nunito — заголовки, цифры, кнопки и весь башкирский текст (в нём есть `locl BSH`:
/// башкирские формы Ҫ и Ҙ); Golos Text — русский текст. Файлы — копия packages/design-tokens/fonts
/// (тест DesignSystemTests сверяет их побайтно), вариативные: вес задаётся осью `wght` явно.
public enum TeleTauFonts {
    public enum Family: String, Sendable, CaseIterable {
        /// Заголовки, цифры, кнопки, башкирский текст.
        case display = "Nunito-VariableFont_wght"
        /// Русский текст.
        case text = "GolosText-VariableFont_wght"

        var url: URL? { Bundle.module.url(forResource: rawValue, withExtension: "ttf", subdirectory: "Fonts") }
    }

    /// Регистрирует шрифты в процессе (один раз). Вызывать при старте приложения и в тестах рендера.
    @discardableResult
    public static func register() -> Bool {
        registered
    }

    private static let registered: Bool = {
        var ok = true
        for family in Family.allCases {
            guard let url = family.url else { ok = false; continue }
            var error: Unmanaged<CFError>?
            if !CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) {
                // Уже зарегистрирован (повторный запуск тестов в процессе) — не ошибка.
                let code = (error?.takeRetainedValue()).map { CFErrorGetCode($0) } ?? 0
                if code != CTFontManagerError.alreadyRegistered.rawValue { ok = false }
            }
        }
        return ok
    }()

    /// Числовой вес оси `wght` для веса токена.
    static func axisWeight(_ weight: Font.Weight) -> CGFloat {
        switch weight {
        case .black: 900
        case .heavy: 800
        case .bold: 700
        case .semibold: 600
        case .medium: 500
        case .light: 300
        case .thin, .ultraLight: 200
        default: 400
        }
    }

    private static let wght: Int = 0x7767_6874 // 'wght'

    // CTFontDescriptor неизменяем и потокобезопасен (Core Foundation), но не помечен Sendable.
    nonisolated(unsafe) private static let descriptors: [Family: CTFontDescriptor] = {
        _ = registered
        var out: [Family: CTFontDescriptor] = [:]
        for family in Family.allCases {
            guard let url = family.url,
                  let list = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor],
                  let first = list.first else { continue }
            out[family] = first
        }
        return out
    }()

    /// CTFont нужного семейства, размера и веса; нет файла — системный шрифт того же веса.
    public static func ctFont(_ family: Family, size: CGFloat, weight: Font.Weight) -> CTFont {
        guard let base = descriptors[family] else {
            return CTFontCreateUIFontForLanguage(.system, size, nil) ?? CTFontCreateWithName("Helvetica" as CFString, size, nil)
        }
        let descriptor = CTFontDescriptorCreateCopyWithVariation(base, wght as CFNumber, axisWeight(weight))
        return CTFontCreateWithFontDescriptor(descriptor, size, nil)
    }

    public static func font(_ family: Family, size: CGFloat, weight: Font.Weight) -> Font {
        Font(ctFont(family, size: size, weight: weight))
    }
}

/// Текст в шрифте «Борть» с размером из токенов, который масштабируется Dynamic Type (до 200 % без обрезаний —
/// экраны прокручиваются) и в режиме «Пчёлка» (`TeleTauMode.bee`, ×1,125 как `fontScale.bee`).
struct TeleTauFontModifier: ViewModifier {
    let family: TeleTauFonts.Family
    let size: CGFloat
    let weight: Font.Weight
    let relativeTo: Font.TextStyle

    @Environment(\.teletauMode) private var mode
    @ScaledMetric private var scale: CGFloat

    init(family: TeleTauFonts.Family, size: CGFloat, weight: Font.Weight, relativeTo: Font.TextStyle) {
        self.family = family
        self.size = size
        self.weight = weight
        self.relativeTo = relativeTo
        _scale = ScaledMetric(wrappedValue: 100, relativeTo: relativeTo)
    }

    func body(content: Content) -> some View {
        content.font(TeleTauFonts.font(family, size: size * scale / 100 * mode.fontScale, weight: weight))
    }
}

public extension View {
    /// Nunito: заголовки, цифры, кнопки.
    func teletauDisplay(_ size: CGFloat, _ weight: Font.Weight = TeleTauFontWeight.black, relativeTo: Font.TextStyle = .body) -> some View {
        modifier(TeleTauFontModifier(family: .display, size: size, weight: weight, relativeTo: relativeTo))
    }

    /// Golos Text: русский текст.
    func teletauText(_ size: CGFloat, _ weight: Font.Weight = TeleTauFontWeight.regular, relativeTo: Font.TextStyle = .body) -> some View {
        modifier(TeleTauFontModifier(family: .text, size: size, weight: weight, relativeTo: relativeTo))
    }
}
