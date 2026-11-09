import DesignSystem
import TeleTauAPI
import TeleTauSession
import SwiftUI

extension EnvironmentValues {
    /// Забег повторения слов: метка «Повторение» вместо «Новое слово».
    @Entry var teletauReviewRun: Bool = false
}

/// «Соедини пары» (match_pairs): нажми слово, а потом его перевод. Соединённая пара — общий цвет и номер;
/// после проверки — «верно» или «не так» у каждой пары (цвет вместе с номером и значком, не только цветом).
struct PairsTask: View {
    let exercise: Components.Schemas.MatchPairsExercise
    @Binding var draft: AnswerDraft?
    let disabled: Bool
    let retry: Bool
    let result: AttemptResult?
    @State private var picked: (left: Bool, id: String)?
    @Environment(\.teletauMode) private var mode

    typealias Link = Components.Schemas.PairLink

    private var links: [Link] {
        if case .pairs(let l, _) = draft { l } else { [] }
    }

    private func update(_ next: [Link]) {
        draft = .pairs(next, needed: exercise.left.count)
    }

    private func tap(left: Bool, id: String) {
        UISound.shared.play(.tap)
        if let linked = links.first(where: { (left ? $0.left : $0.right) == id }) {
            update(links.filter { $0 != linked })
            picked = (left, id)
            return
        }
        if let p = picked, p.left != left {
            update(links + [left ? Link(left: id, right: p.id) : Link(left: p.id, right: id)])
            picked = nil
            return
        }
        picked = (picked?.left == left && picked?.id == id) ? nil : (left, id)
    }

    static let tones: [HexTone] = [.honey, .water, .green, .violet, .coral]

    var body: some View {
        VStack(spacing: 0) {
            TaskKind(retry: retry)
            TaskTitle(text: "Соедини пары")
            if mode != .bee {
                Text("Нажми слово и его перевод")
                    .teletauText(TeleTauFontSize.callout)
                    .foregroundStyle(TeleTauColor.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, -TeleTauSpace.s300)
                    .padding(.bottom, TeleTauSpace.s400)
            }
            HStack(alignment: .top, spacing: TeleTauSpace.s300) {
                VStack(spacing: TeleTauSpace.s250) {
                    ForEach(exercise.left, id: \.id) { word in
                        item(left: true, id: word.id, text: word.text, bashkir: true)
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Слова"))
                VStack(spacing: TeleTauSpace.s250) {
                    ForEach(exercise.right, id: \.id) { t in
                        item(left: false, id: t.id, text: t.textRu, bashkir: false)
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Переводы"))
            }
        }
        .disabled(disabled)
    }

    private func item(left: Bool, id: String, text: String, bashkir: Bool) -> some View {
        let index = links.firstIndex { (left ? $0.left : $0.right) == id }
        let link = index.map { links[$0] }
        let correct = Dictionary((result?.correctPairs ?? []).map { ($0.left, $0.right) }, uniquingKeysWith: { a, _ in a })
        let verdict: Bool? = result != nil && link != nil ? correct[link!.left] == link!.right : nil
        let selected = picked?.left == left && picked?.id == id
        let tone = index.map { Self.tones[$0 % Self.tones.count] }
        let edge: Color? = verdict == false ? TeleTauColor.dangerText : verdict == true ? TeleTauColor.successText
            : selected ? TeleTauColor.accentText : tone.map(\.lipColor)
        let status = [index.map { "пара \($0 + 1)" }, verdict == true ? "верно" : verdict == false ? "не так" : nil].compactMap { $0 }.joined(separator: ", ")
        return Button { tap(left: left, id: id) } label: {
            HStack(spacing: TeleTauSpace.s200) {
                if let index {
                    Text("\(index + 1)")
                        .teletauDisplay(TeleTauFontSize.footnote, TeleTauFontWeight.black)
                        .foregroundStyle(TeleTauColor.textOnFill)
                        .frame(width: 24, height: 24)
                        .background(tone?.fillColor ?? TeleTauColor.accentFill, in: Circle())
                }
                Group {
                    if bashkir {
                        BashkirText(text, size: TeleTauFontSize.bodyLarge)
                    } else {
                        Text(verbatim: text).teletauText(TeleTauFontSize.body)
                    }
                }
                .foregroundStyle(TeleTauColor.textPrimary)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                if let verdict {
                    IconView(verdict ? .check : .x, size: 16).foregroundStyle(verdict ? TeleTauColor.successText : TeleTauColor.dangerText)
                }
            }
            .padding(.vertical, TeleTauSpace.s300)
            .padding(.horizontal, TeleTauSpace.s300)
            .frame(minHeight: TeleTauSize.touchChild)
        }
        .buttonStyle(PairButtonStyle(edge: edge, background: selected ? TeleTauColor.accentSoft : (tone?.softColor ?? TeleTauColor.surface)))
        .accessibilityLabel(Text(verbatim: text))
        .accessibilityValue(Text(status))
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

private struct PairButtonStyle: ButtonStyle {
    let edge: Color?
    let background: Color

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: TeleTauRadius.button, style: .continuous)
        let line = edge ?? TeleTauColor.borderDefault
        configuration.label
            .background(background, in: shape)
            .overlay { shape.strokeBorder(line, lineWidth: TeleTauSpace.s050) }
            .offset(y: configuration.isPressed ? TeleTauSize.lipSmall : 0)
            .padding(.bottom, TeleTauSize.lipSmall)
            .background { shape.fill(line).padding(.top, TeleTauSize.lipSmall) }
    }
}

private extension HexTone {
    var fillColor: Color {
        switch self {
        case .honey: TeleTauColor.accentFill
        case .water: TeleTauColor.infoFill
        case .green: TeleTauColor.successFill
        case .violet: TeleTauColor.violetBright
        case .coral: TeleTauColor.dangerFill
        case .locked, .empty: TeleTauColor.lockedFill
        }
    }

    var lipColor: Color {
        switch self {
        case .honey: TeleTauColor.accentLip
        case .water: TeleTauColor.infoLip
        case .green: TeleTauColor.successLip
        case .violet: TeleTauColor.violetLip
        case .coral: TeleTauColor.dangerLip
        case .locked, .empty: TeleTauColor.borderDefault
        }
    }

    var softColor: Color {
        switch self {
        case .honey: TeleTauColor.accentSoft
        case .water: TeleTauColor.infoSoft
        case .green: TeleTauColor.successSoft
        case .violet: TeleTauColor.violetSoft
        case .coral: TeleTauColor.dangerSoft
        case .locked, .empty: TeleTauColor.surface
        }
    }
}

/// Лист после «Пар»: все на месте — «Верно!»; иначе — какие пары правильные.
struct PairsFeedback: View {
    let exercise: Components.Schemas.MatchPairsExercise
    let result: AttemptResult
    let links: [Components.Schemas.PairLink]
    let retryLater: Bool
    let title: String
    let badge: String?
    let onNext: @MainActor () -> Void
    @Environment(\.teletauMode) private var mode

    var body: some View {
        if result.verdict == .wrong {
            let chosen = Dictionary(links.map { ($0.left, $0.right) }, uniquingKeysWith: { a, _ in a })
            let wrong = (result.correctPairs ?? []).filter { chosen[$0.left] != $0.right }
            FeedbackSheet(tone: .bad, title: "Пока не так", actionLabel: "Дальше", action: onNext) {
                VStack(alignment: .leading, spacing: TeleTauSpace.s100) {
                    Text("Правильно так:")
                    ForEach(wrong, id: \.left) { p in
                        let word = exercise.left.first { $0.id == p.left }?.text ?? ""
                        let ru = exercise.right.first { $0.id == p.right }?.textRu ?? ""
                        RichText([.ba(word), .ru(" — «\(ru)»")], size: TeleTauFontSize.body)
                    }
                    if retryLater, mode != .bee { Text("Повторим в конце урока.") }
                }
            }
        } else {
            FeedbackSheet(tone: .ok, title: title, badge: badge, actionLabel: "Дальше", action: onNext) { EmptyView() }
        }
    }
}
