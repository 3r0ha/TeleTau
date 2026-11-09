import SwiftUI

/// Вид кнопки действия (prototype v2 `.btn`): лицевая часть, под ней «губа» глубокого цвета.
public enum TeleTauButtonVariant: Sendable {
    case primary, secondary, violet, danger, success

    var face: Color {
        switch self {
        case .primary: TeleTauColor.accentFill
        case .secondary: TeleTauColor.surface
        case .violet: TeleTauColor.violetFill
        case .danger: TeleTauColor.dangerFill
        case .success: TeleTauColor.successFill
        }
    }

    var lip: Color {
        switch self {
        case .primary: TeleTauColor.accentLip
        case .secondary: TeleTauColor.borderDefault
        case .violet: TeleTauColor.violetLip
        case .danger: TeleTauColor.dangerLip
        case .success: TeleTauColor.successLip
        }
    }

    var ink: Color {
        switch self {
        case .primary: TeleTauColor.accentOn
        case .secondary: TeleTauColor.accentText
        case .violet: TeleTauColor.violetOn
        case .danger, .success: TeleTauColor.textOnFill
        }
    }

    var edge: Color? { self == .secondary ? TeleTauColor.borderDefault : nil }
}

/// Кнопка действия: Nunito, высота 52 pt (56 в «Пчёлке»), губа 4 pt; неактивная — воск. `loading` — индикатор
/// вместо значка, нажатия не принимаются.
public struct TeleTauButton: View {
    private let title: String
    private let icon: TeleTauIcon?
    private let variant: TeleTauButtonVariant
    private let loading: Bool
    private let action: @MainActor () -> Void

    @Environment(\.teletauMode) private var mode

    public init(_ title: String, icon: TeleTauIcon? = nil, variant: TeleTauButtonVariant = .primary, loading: Bool = false, action: @escaping @MainActor () -> Void) {
        self.title = title
        self.icon = icon
        self.variant = variant
        self.loading = loading
        self.action = action
    }

    public var body: some View {
        Button {
            if !loading { action() }
        } label: {
            HStack(spacing: TeleTauSpace.s200) {
                if loading {
                    ProgressView().controlSize(.small).tint(variant.ink)
                } else if let icon {
                    IconView(icon, size: TeleTauSize.iconSmall)
                }
                Text(title)
                    .teletauDisplay(TeleTauFontSize.button, TeleTauFontWeight.extrabold)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, TeleTauSpace.s500)
            .padding(.vertical, TeleTauSpace.s250)
            .frame(maxWidth: .infinity, minHeight: mode.buttonHeight)
        }
        .buttonStyle(LipButtonStyle(variant: variant))
        .accessibilityLabel(Text(title))
        .accessibilityAddTraits(loading ? .updatesFrequently : [])
    }
}

/// Стиль кнопки с «губой». Рисуется SwiftUI целиком: одинаково на iOS и в рендере на macOS.
struct LipButtonStyle: ButtonStyle {
    let variant: TeleTauButtonVariant
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: TeleTauRadius.button, style: .continuous)
        let sunk = configuration.isPressed && isEnabled
        let face = isEnabled ? variant.face : TeleTauColor.lockedFill
        let lip = isEnabled ? variant.lip : TeleTauColor.lockedLip
        configuration.label
            .foregroundStyle(isEnabled ? variant.ink : TeleTauColor.lockedText)
            .background(face, in: shape)
            .overlay {
                if let edge = variant.edge, isEnabled { shape.strokeBorder(edge, lineWidth: TeleTauSpace.s050) }
            }
            .offset(y: sunk ? TeleTauSize.lip : 0)
            .padding(.bottom, TeleTauSize.lip)
            .background {
                shape.fill(lip).padding(.top, TeleTauSize.lip)
            }
            .contentShape(shape)
            .animation(reduceMotion ? nil : .easeOut(duration: TeleTauDuration.press), value: sunk)
    }
}

/// Главная кнопка экрана: медовая `TeleTauButton`.
public struct PrimaryButton: View {
    private let title: String
    private let action: @MainActor () -> Void

    public init(_ title: String, action: @escaping @MainActor () -> Void) {
        self.title = title
        self.action = action
    }

    public var body: some View {
        TeleTauButton(title, variant: .primary, action: action)
    }
}

/// Текстовая кнопка (prototype `.link-btn`): «Другие варианты», «Выйти», «Не ждать и выйти».
public struct LinkButton: View {
    public enum Tone: Sendable { case honey, danger, neutral }

    private let title: String
    private let icon: TeleTauIcon?
    private let tone: Tone
    private let action: @MainActor () -> Void

    @Environment(\.teletauMode) private var mode
    @Environment(\.isEnabled) private var isEnabled

    public init(_ title: String, icon: TeleTauIcon? = nil, tone: Tone = .honey, action: @escaping @MainActor () -> Void) {
        self.title = title
        self.icon = icon
        self.tone = tone
        self.action = action
    }

    private var color: Color {
        guard isEnabled else { return TeleTauColor.lockedText }
        return switch tone {
        case .honey: TeleTauColor.accentText
        case .danger: TeleTauColor.dangerText
        case .neutral: TeleTauColor.textSecondary
        }
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: TeleTauSpace.s150) {
                if let icon { IconView(icon, size: TeleTauSize.iconSmall) }
                Text(title).teletauDisplay(TeleTauFontSize.callout, TeleTauFontWeight.extrabold)
            }
            .foregroundStyle(color)
            .padding(.horizontal, TeleTauSpace.s350)
            .frame(minHeight: mode.touchTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Кнопка-значок 44 pt (56 в «Пчёлке»): крестик урока, настройки.
public struct IconButton: View {
    private let icon: TeleTauIcon
    private let label: String
    private let action: @MainActor () -> Void
    @Environment(\.teletauMode) private var mode

    public init(_ icon: TeleTauIcon, label: String, action: @escaping @MainActor () -> Void) {
        self.icon = icon
        self.label = label
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            IconView(icon, size: TeleTauSize.icon)
                .foregroundStyle(TeleTauColor.textTertiary)
                .frame(width: mode.touchTarget, height: mode.touchTarget)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
    }
}

/// Переключатель (web `.switch`): зелёная дорожка с белой ручкой; подпись слева. Рисуется своими фигурами —
/// одинаково на iOS и в снимках экранов.
public struct TeleTauSwitchStyle: ToggleStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        Button {
            withAnimation(reduceMotion ? nil : .easeOut(duration: TeleTauDuration.fast)) { configuration.isOn.toggle() }
        } label: {
            HStack(spacing: TeleTauSpace.s300) {
                configuration.label
                Spacer(minLength: TeleTauSpace.s200)
                Capsule()
                    .fill(configuration.isOn ? TeleTauColor.successFill : TeleTauColor.lockedFill)
                    .overlay { Capsule().strokeBorder(configuration.isOn ? TeleTauColor.successLip : TeleTauColor.borderDefault, lineWidth: TeleTauSpace.s050) }
                    .frame(width: 52, height: 32)
                    .overlay(alignment: configuration.isOn ? .trailing : .leading) {
                        Circle().fill(TeleTauColor.surface).frame(width: 24, height: 24).padding(.horizontal, TeleTauSpace.s100)
                    }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isToggle)
        .accessibilityValue(Text(configuration.isOn ? "включено" : "выключено"))
    }
}
