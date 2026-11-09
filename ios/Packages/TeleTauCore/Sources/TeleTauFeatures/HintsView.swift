import DesignSystem
import TeleTauAPI
import SwiftUI

typealias PromptHint = Components.Schemas.PromptHint

extension EnvironmentValues {
    /// Для снимков: какая подсказка условия уже открыта.
    @Entry var teletauOpenHint: Int?
    /// Урок: ученик открыл подсказку условия (номер в `hints`) — ответ уйдёт с `hintsUsed`.
    @Entry var teletauHintOpened: @MainActor @Sendable (Int) -> Void = { _ in }
}

/// Кусок условия для раскладки по словам: слово (или подсказка), пробел перед ним и номер подсказки.
struct PromptChunk: Equatable {
    var text: String
    var spaceBefore: Bool
    var hint: Int?
}

enum PromptChunks {
    /// Режет условие на слова; подсказки — целыми кусками. Каждая подсказка ищется с конца предыдущей
    /// (по порядку, без пересечений, `text` — подстрока `promptRu` в точности); ненайденная пропускается.
    static func split(_ text: String, hints: [PromptHint]) -> [PromptChunk] {
        var chunks: [PromptChunk] = []
        var pendingSpace = false
        func plain(_ s: Substring) {
            var word = ""
            var wordSpace = pendingSpace
            for ch in s {
                if ch.isWhitespace {
                    if !word.isEmpty { chunks.append(PromptChunk(text: word, spaceBefore: wordSpace && !chunks.isEmpty, hint: nil)); word = "" }
                    pendingSpace = true
                    wordSpace = true
                } else {
                    if word.isEmpty { wordSpace = pendingSpace }
                    word.append(ch)
                    pendingSpace = false
                }
            }
            if !word.isEmpty { chunks.append(PromptChunk(text: word, spaceBefore: wordSpace && !chunks.isEmpty, hint: nil)) }
        }
        var at = text.startIndex
        for (i, hint) in hints.enumerated() where !hint.text.isEmpty {
            guard let r = text.range(of: hint.text, range: at..<text.endIndex) else { continue }
            plain(text[at..<r.lowerBound])
            chunks.append(PromptChunk(text: hint.text, spaceBefore: pendingSpace && !chunks.isEmpty, hint: i))
            pendingSpace = false
            at = r.upperBound
        }
        plain(text[at...])
        return chunks
    }
}

/// Русское условие с подсказками к словам: слово подчёркнуто пунктиром, нажатие открывает пузырь с
/// переводом из словаря курса (башкирский — CoreText, `ba`). Открыт один пузырь; повторное нажатие или нажатие на
/// пузырь закрывает его. В «Пчёлке» перевод крупнее.
struct HintedText: View {
    let text: String
    let hints: [PromptHint]
    let size: CGFloat
    @State private var open: Int?
    @Environment(\.teletauMode) private var mode
    @Environment(\.teletauHintOpened) private var hintOpened

    init(text: String, hints: [PromptHint], size: CGFloat, open: Int? = nil) {
        self.text = text
        self.hints = hints
        self.size = size
        _open = State(initialValue: open)
    }

    var body: some View {
        let chunks = PromptChunks.split(text, hints: hints)
        FlowText(glue: chunks.map { !$0.spaceBefore }) {
            ForEach(Array(chunks.enumerated()), id: \.offset) { _, chunk in
                if let i = chunk.hint {
                    word(chunk.text, hint: i)
                } else {
                    Text(verbatim: chunk.text).teletauText(size).foregroundStyle(TeleTauColor.textPrimary)
                }
            }
        }
        .overlayPreferenceValue(HintAnchor.self) { anchor in
            GeometryReader { geo in
                if let anchor, let open, hints.indices.contains(open) {
                    HintPopLayout(anchor: geo[anchor]) {
                        HintPop(translation: hints[open].translation.text, size: mode == .bee ? TeleTauFontSize.title2 : TeleTauFontSize.title3)
                        HintTail()
                    }
                    .onTapGesture { self.open = nil }
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func word(_ text: String, hint i: Int) -> some View {
        Button {
            UISound.shared.play(.tap)
            open = open == i ? nil : i
            if open == i {
                hintOpened(i)
                AccessibilityNotification.Announcement(hints[i].translation.text).post()
            }
        } label: {
            Text(verbatim: text)
                .teletauText(size)
                .foregroundStyle(TeleTauColor.textPrimary)
                .overlay(alignment: .bottom) {
                    DottedLine()
                        .stroke(open == i ? TeleTauColor.accentText : TeleTauColor.textTertiary,
                                style: StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: [0.1, 4]))
                        .frame(height: 1.5)
                        .offset(y: 1)
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .anchorPreference(key: HintAnchor.self, value: .bounds) { open == i ? $0 : nil }
        .accessibilityLabel(Text(text))
        .accessibilityHint(Text("Показать перевод"))
        .accessibilityValue(Text(open == i ? hints[i].translation.text : ""))
    }
}

private struct HintAnchor: PreferenceKey {
    static let defaultValue: Anchor<CGRect>? = nil
    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        value = value ?? nextValue()
    }
}

private struct DottedLine: Shape {
    func path(in rect: CGRect) -> Path {
        Path { p in
            p.move(to: CGPoint(x: rect.minX + 1, y: rect.midY))
            p.addLine(to: CGPoint(x: rect.maxX - 1, y: rect.midY))
        }
    }
}

/// Пузырь с переводом: тёмный, как подсказка на тропе; не шире 220 pt.
private struct HintPop: View {
    let translation: String
    let size: CGFloat

    var body: some View {
        CappedWidth(max: 220) {
            BashkirText(translation, size: size, weight: TeleTauFontWeight.extrabold, color: TeleTauColor.bg)
                .padding(.vertical, TeleTauSpace.s250)
                .padding(.horizontal, TeleTauSpace.s350)
        }
        .background(TeleTauColor.textPrimary, in: RoundedRectangle(cornerRadius: TeleTauRadius.tile, style: .continuous))
        .accessibilityHidden(true)
    }
}

private struct HintTail: View {
    var body: some View {
        Rectangle().fill(TeleTauColor.textPrimary).frame(width: 12, height: 12).rotationEffect(.degrees(45))
    }
}

/// Пузырь под словом: хвостик у слова, пузырь по центру слова, но не за краями условия.
private struct HintPopLayout: Layout {
    let anchor: CGRect
    static let gap: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        proposal.replacingUnspecifiedDimensions()
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard subviews.count == 2 else { return }
        let pop = subviews[0].sizeThatFits(.unspecified)
        let top = bounds.minY + anchor.maxY + Self.gap
        // Пузырь может выйти за рамку условия на поле пузыря-реплики, но не дальше.
        let minX = bounds.minX - TeleTauSpace.s300, maxX = bounds.maxX + TeleTauSpace.s300
        let x = min(max(bounds.minX + anchor.midX - pop.width / 2, minX), maxX - pop.width)
        subviews[1].place(at: CGPoint(x: bounds.minX + anchor.midX, y: top + 2), anchor: .center, proposal: .unspecified)
        subviews[0].place(at: CGPoint(x: x, y: top), proposal: ProposedViewSize(pop))
    }
}

/// Строка из слов с переносом: склеенные куски (знак препинания за подсказкой) не разрываются.
struct FlowText: Layout {
    /// `glue[i]` — кусок `i` стоит вплотную к предыдущему (без пробела).
    let glue: [Bool]
    var lineSpacing: CGFloat = TeleTauSpace.s100

    struct Line {
        var items: [(index: Int, x: CGFloat)] = []
        var height: CGFloat = 0
    }

    private func lines(_ subviews: Subviews, width: CGFloat) -> [Line] {
        let space = spaceWidth
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        // Группы: кусок и всё, что приклеено к нему следом.
        var groups: [[Int]] = []
        for i in subviews.indices {
            if i > 0, glue.indices.contains(i), glue[i], !groups.isEmpty { groups[groups.count - 1].append(i) } else { groups.append([i]) }
        }
        var result: [Line] = [Line()]
        var x: CGFloat = 0
        for group in groups {
            let w = group.reduce(0) { $0 + sizes[$1].width }
            let lead = x > 0 ? space : 0
            if x > 0, x + lead + w > width {
                result.append(Line())
                x = 0
            } else {
                x += lead
            }
            for i in group {
                result[result.count - 1].items.append((i, x))
                result[result.count - 1].height = max(result[result.count - 1].height, sizes[i].height)
                x += sizes[i].width
            }
        }
        return result
    }

    private var spaceWidth: CGFloat { 5 }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .greatestFiniteMagnitude
        let ls = lines(subviews, width: width)
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let used = ls.map { line in line.items.last.map { $0.x + sizes[$0.index].width } ?? 0 }.max() ?? 0
        let height = ls.reduce(0) { $0 + $1.height } + lineSpacing * CGFloat(max(0, ls.count - 1))
        return CGSize(width: proposal.width ?? used, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for line in lines(subviews, width: bounds.width) {
            for item in line.items {
                subviews[item.index].place(at: CGPoint(x: bounds.minX + item.x, y: y), proposal: .unspecified)
            }
            y += line.height + lineSpacing
        }
    }
}

/// «Новое слово» (word_intro): слово крупно, «Послушать» (если есть запись носителя), перевод и пчела-учитель —
/// перед упражнениями с этим словом. Ответа нет: «Дальше» в подвале урока.
struct WordIntroTask: View {
    let exercise: Components.Schemas.WordIntroExercise
    @Environment(\.teletauMode) private var mode
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let text = exercise.word.text
        let long = text.count > 14
        let shape = RoundedRectangle(cornerRadius: TeleTauRadius.card, style: .continuous)
        VStack(spacing: 0) {
            TaskTitle(text: "Новое слово")
            if mode.showsMascot {
                IllustrationView(.beeTeacher, width: 136)
                    .floating(reduceMotion: reduceMotion)
                    .padding(.bottom, TeleTauSpace.s300)
                    .accessibilityHidden(true)
            }
            VStack(spacing: TeleTauSpace.s250) {
                HStack(alignment: .center, spacing: TeleTauSpace.s300) {
                    BashkirText(text, size: long ? TeleTauFontSize.title2 : TeleTauFontSize.title1 + 4, weight: TeleTauFontWeight.black)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    ClipSpeakButton(clip: exercise.word.audio, size: .large, label: "Послушать: \(text)")
                }
                Rectangle().fill(TeleTauColor.borderSubtle).frame(height: TeleTauSpace.s050)
                Text(exercise.translationRu)
                    .teletauText(TeleTauFontSize.title3, TeleTauFontWeight.medium)
                    .foregroundStyle(TeleTauColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.vertical, TeleTauSpace.s500)
            .padding(.horizontal, TeleTauSpace.s500)
            .background(TeleTauColor.surface, in: shape)
            .overlay { shape.strokeBorder(TeleTauColor.accentSoftBorder, lineWidth: TeleTauSpace.s050) }
            .background { shape.fill(TeleTauColor.accentFill).offset(y: TeleTauSize.lip) }
            .accessibilityElement(children: .combine)
        }
    }
}
