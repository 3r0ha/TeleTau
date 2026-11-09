import DesignSystem
import TeleTauSession
import SwiftUI

/// Прокрутка экрана. В рендере тестов (`teletauStaticRender`) — то же содержимое без ScrollView:
/// ImageRenderer платформенный ScrollView не рисует.
struct TeleTauScroll<Content: View>: View {
    let content: Content
    @Environment(\.teletauStaticRender) private var staticRender

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        if staticRender {
            // Фиксированная рамка по доступному месту: гибкая рамка выросла бы до высоты содержимого.
            GeometryReader { geo in
                VStack(spacing: 0) { content }
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
            }
            .clipped()
        } else {
            ScrollView { content }
                .scrollDismissesKeyboard(.interactively)
        }
    }
}

/// Колонка экрана ученика: 16 pt по краям, не шире `columnNarrow` на iPad.
struct Column<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(.horizontal, TeleTauSpace.s400)
            .frame(maxWidth: TeleTauSize.columnNarrow)
            .frame(maxWidth: .infinity)
    }
}

/// Перенос по строкам (плитки слов, новые слова).
struct FlowLayout: Layout {
    var spacing: CGFloat = TeleTauSpace.s200
    var lineSpacing: CGFloat = TeleTauSpace.s250
    var center = false

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.reduce(0) { $0 + $1.height } + CGFloat(max(0, rows.count - 1)) * lineSpacing
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = center ? bounds.minX + (bounds.width - row.width) / 2 : bounds.minX
            for index in row.items {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + lineSpacing
        }
    }

    private struct Row { var items: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for (index, view) in subviews.enumerated() {
            let size = view.sizeThatFits(.unspecified)
            let extra = row.items.isEmpty ? size.width : size.width + spacing
            if row.width + extra > width, !row.items.isEmpty {
                rows.append(row)
                row = Row()
            }
            row.width += row.items.isEmpty ? size.width : size.width + spacing
            row.items.append(index)
            row.height = max(row.height, size.height)
        }
        if !row.items.isEmpty { rows.append(row) }
        return rows
    }
}

/// Простая верхняя панель экранов входа: «назад» и заголовок по центру.
struct SimpleTopBar: View {
    let title: String
    var back: (@MainActor () -> Void)?

    var body: some View {
        ZStack {
            Text(title)
                .teletauDisplay(TeleTauFontSize.headline, TeleTauFontWeight.black)
                .foregroundStyle(TeleTauColor.textPrimary)
                .accessibilityAddTraits(.isHeader)
            HStack {
                if let back { IconButton(.arrowLeft, label: "Назад", action: back) }
                Spacer()
            }
        }
        .padding(.horizontal, TeleTauSpace.s200)
        .frame(minHeight: 60)
        .background(TeleTauColor.bg)
    }
}

/// Заголовок страницы (prototype `.page-title`) и подзаголовок.
struct PageTitle: View {
    let title: Text
    let lead: String?

    init(_ title: Text, lead: String? = nil) {
        self.title = title
        self.lead = lead
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TeleTauSpace.s150) {
            title
                .teletauDisplay(TeleTauFontSize.title2, TeleTauFontWeight.black)
                .foregroundStyle(TeleTauColor.textPrimary)
                .accessibilityAddTraits(.isHeader)
                .fixedSize(horizontal: false, vertical: true)
            if let lead {
                Text(lead)
                    .teletauText(TeleTauFontSize.callout)
                    .foregroundStyle(TeleTauColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Название класса «5 «Б»» отрезками: литера с башкирской буквой — башкирский отрезок (ClassTitle веба).
func classTitleRuns(_ title: String, kind: TextRun.Kind = .russian, weight: Font.Weight = TeleTauFontWeight.regular) -> [TextRun] {
    guard Format.hasBashkirLetters(title) else { return [TextRun(title, kind, weight: weight)] }
    return [TextRun(title, .bashkir, weight: weight)]
}

/// Ошибка загрузки экрана (LoadError веба): «Нет связи» или «Что-то сломалось» с повтором.
struct LoadErrorView: View {
    let error: APIError
    let retry: @MainActor () -> Void

    var body: some View {
        if error.isOffline {
            EmptyStateView(art: .emptyOffline, title: "Нет связи", text: "Проверь интернет.") {
                TeleTauButton("Попробовать снова", action: retry)
            }
        } else {
            EmptyStateView(art: .emptyError, title: "Что-то сломалось", text: ChildText.describe(error)) {
                TeleTauButton("Попробовать снова", action: retry)
            }
        }
    }
}

/// Загрузка вкладки: несколько блоков воска.
struct LoadingBlock: View {
    let rows: Int
    let label: String

    var body: some View {
        VStack(spacing: TeleTauSpace.s400) {
            ForEach(0..<rows, id: \.self) { i in
                Skeleton(height: i == 0 ? 120 : 84, radius: TeleTauRadius.card)
            }
        }
        .padding(.top, TeleTauSpace.s400)
        .accessibilityElement()
        .accessibilityLabel(Text(label))
    }
}

/// Диалог по центру экрана (prototype 12-lesson-quit): пчела, заголовок, текст, «Остаться» и опасное действие.
struct TeleTauDialog<Actions: View>: View {
    let art: Illustration
    let title: String
    let text: String
    let actions: Actions

    init(art: Illustration, title: String, text: String, @ViewBuilder actions: () -> Actions) {
        self.art = art
        self.title = title
        self.text = text
        self.actions = actions()
    }

    var body: some View {
        ZStack {
            TeleTauColor.scrim.opacity(0.45).ignoresSafeArea()
            VStack(spacing: TeleTauSpace.s300) {
                IllustrationView(art, width: 120)
                Text(title)
                    .teletauDisplay(TeleTauFontSize.title3, TeleTauFontWeight.black)
                    .foregroundStyle(TeleTauColor.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(text)
                    .teletauText(TeleTauFontSize.body)
                    .foregroundStyle(TeleTauColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(spacing: TeleTauSpace.s200) { actions }
                    .padding(.top, TeleTauSpace.s200)
            }
            .padding(TeleTauSpace.s600)
            .background(TeleTauColor.surface, in: RoundedRectangle(cornerRadius: TeleTauRadius.sheet, style: .continuous))
            .padding(.horizontal, TeleTauSpace.s400)
            .frame(maxWidth: TeleTauSize.columnNarrow)
            .accessibilityElement(children: .contain)
            .accessibilityAddTraits(.isModal)
        }
    }
}

/// Короткое сообщение внизу экрана («Нет связи — урок не открылся»).
struct Toast: View {
    let text: String

    var body: some View {
        HStack(spacing: TeleTauSpace.s250) {
            IconView(.warningCircle, size: TeleTauSize.iconSmall).foregroundStyle(TeleTauColor.dangerText)
            Text(text).teletauText(TeleTauFontSize.footnote, TeleTauFontWeight.medium).foregroundStyle(TeleTauColor.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(TeleTauSpace.s300)
        .background(TeleTauColor.surface, in: RoundedRectangle(cornerRadius: TeleTauRadius.tile, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: TeleTauRadius.tile, style: .continuous).strokeBorder(TeleTauColor.borderDefault, lineWidth: TeleTauSpace.s050) }
        .padding(.horizontal, TeleTauSpace.s400)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }
}
