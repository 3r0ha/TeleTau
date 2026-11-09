import SwiftUI

/// Стартовый экран-проверка: токены «Борть», обе темы и башкирские глифы.
///
/// Башкирские строки — `BashkirText` (Nunito, CoreText с языком `ba`: формы Ҫ и Ҙ).
/// Все цвета и размеры — из `TeleTauTokens.generated.swift`. Размеры шрифтов масштабируются
/// Dynamic Type через `@ScaledMetric`; если содержимое перестаёт помещаться, экран
/// переключается на `ScrollView`, поэтому крупный шрифт не обрезает вёрстку.
public struct StartScreen: View {
    /// Бренд. needs_native_review: docs/native-review-queue.md, строка 1.
    static let brandTitle = "ТелеТау"
    static let subtitle = "Башкирская языковая школа"
    /// Все 9 особых букв башкирского алфавита в обоих регистрах (docs/05-design-system.md §4).
    static let glyphTestLine = "Ә ә Ө ө Ү ү Ғ ғ Ҡ ҡ Ң ң Ҙ ҙ Ҫ ҫ Һ һ"
    static let glyphCaption = "Башкирские буквы"
    static let startTitle = "Начать"
    static let hexLabel = "Медовая ячейка сот"

    private let onStart: @MainActor () -> Void

    @ScaledMetric(relativeTo: .title3) private var subtitleSize = TeleTauFontSize.bodyLarge
    @ScaledMetric(relativeTo: .footnote) private var captionSize = TeleTauFontSize.footnote
    @ScaledMetric(relativeTo: .largeTitle) private var hexHeight = TeleTauSpace.s1600 * 2

    public init(onStart: @escaping @MainActor () -> Void = {}) {
        self.onStart = onStart
    }

    public var body: some View {
        // Помещается — экран без прокрутки (распорки центрируют блок, кнопка прижата к низу).
        // Не помещается (крупный Dynamic Type, маленький экран) — то же содержимое в ScrollView.
        // Попутно это делает экран видимым для ImageRenderer: платформенный ScrollView он не рисует.
        ViewThatFits(in: .vertical) {
            content
            ScrollView {
                content
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { TeleTauColor.bg.ignoresSafeArea() }
    }

    private var content: some View {
        VStack(spacing: TeleTauSpace.s600) {
            Spacer(minLength: 0)
            VStack(spacing: TeleTauSpace.s800) {
                header
                honeyCell
                glyphCard
            }
            Spacer(minLength: 0)
            PrimaryButton(Self.startTitle, action: onStart)
        }
        .padding(.horizontal, TeleTauSpace.s600)
        .padding(.vertical, TeleTauSpace.s800)
        .frame(maxWidth: .infinity)
    }

    private var header: some View {
        VStack(spacing: TeleTauSpace.s200) {
            BashkirText(Self.brandTitle, size: TeleTauFontSize.title1, weight: TeleTauFontWeight.black, alignment: .center)
                .fixedSize()
                .accessibilityAddTraits(.isHeader)
            Text(Self.subtitle)
                .font(.system(size: subtitleSize, weight: TeleTauFontWeight.regular, design: .rounded))
                .foregroundStyle(TeleTauColor.textSecondary)
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var honeyCell: some View {
        HexCell()
            .fill(TeleTauColor.accentFill)
            // «Губа» ячейки, как у кнопки: тот же шестиугольник глубоким мёдом, сдвинутый вниз.
            .background { HexCell().fill(TeleTauColor.accentLip).offset(y: TeleTauSize.lip) }
            .aspectRatio(HexCell.aspectRatio, contentMode: .fit)
            .frame(height: hexHeight)
            .accessibilityElement()
            .accessibilityLabel(Text(Self.hexLabel))
            .accessibilityAddTraits(.isImage)
    }

    private static let cardShape = RoundedRectangle(cornerRadius: TeleTauRadius.card, style: .continuous)

    private var glyphCard: some View {
        VStack(spacing: TeleTauSpace.s200) {
            Text(Self.glyphCaption)
                .font(.system(size: captionSize, weight: TeleTauFontWeight.semibold, design: .rounded))
                .foregroundStyle(TeleTauColor.textSecondary)
            BashkirText(Self.glyphTestLine, size: TeleTauFontSize.title3, weight: TeleTauFontWeight.regular, alignment: .center)
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .padding(TeleTauSpace.s400)
        .frame(maxWidth: .infinity)
        .background(TeleTauColor.surface, in: Self.cardShape)
        // Толщина границы карточки — 2 pt (прототип v2); отдельного токена толщины нет, берём шаг s050.
        .overlay { Self.cardShape.strokeBorder(TeleTauColor.borderSubtle, lineWidth: TeleTauSpace.s050) }
        .accessibilityElement(children: .combine)
    }
}

#Preview("Светлая") {
    StartScreen()
}

#Preview("Тёмная") {
    StartScreen()
        .preferredColorScheme(.dark)
}
