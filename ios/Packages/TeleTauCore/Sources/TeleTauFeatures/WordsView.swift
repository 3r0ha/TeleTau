import DesignSystem
import TeleTauAPI
import TeleTauSession
import SwiftUI

/// «Мой словарь» (как WordsScreen веба): слова из пройденных уроков — башкирское слово из контента, перевод,
/// разделы «На повторение» и «Выучено», «Послушать», если есть запись носителя. Вход — из профиля.
struct WordsContent: View {
    let data: MyWords
    let onBack: @MainActor () -> Void
    let onReview: @MainActor () -> Void
    let onTrail: @MainActor () -> Void

    var body: some View {
        let total = data.summary.total
        let review = data.summary.review
        let toReview = data.words.filter { $0.status == .review }
        let learned = data.words.filter { $0.status == .learned }
        VStack(alignment: .leading, spacing: TeleTauSpace.s400) {
            Button(action: onBack) {
                HStack(spacing: TeleTauSpace.s100) {
                    IconView(.caretLeft, size: TeleTauSize.iconSmall)
                    Text("Профиль").teletauDisplay(TeleTauFontSize.callout, TeleTauFontWeight.extrabold)
                }
                .foregroundStyle(TeleTauColor.accentText)
                .frame(minHeight: TeleTauSize.touchMin)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            PageTitle(Text("Мой словарь"),
                      lead: total > 0 ? "\(total) \(Format.plural(total, ("слово", "слова", "слов")))" + (review > 0 ? "" : " · все выучены") : nil)
            if total == 0 {
                EmptyStateView(art: .emptyAllDone, title: "Слов пока нет", text: "Они появятся после урока.", compact: true) {
                    TeleTauButton("На тропу", action: onTrail)
                }
            }
            if review > 0 {
                ReviewCard(due: review, onReview: onReview).padding(.top, -TeleTauSpace.s350)
            }
            if !toReview.isEmpty { WordList(title: "На повторение", words: toReview) }
            if !learned.isEmpty { WordList(title: "Выучено", words: learned) }
        }
        .padding(.top, TeleTauSpace.s200)
        .padding(.bottom, TeleTauSpace.s600)
    }
}

struct WordList: View {
    let title: String
    let words: [Components.Schemas.MyWord]

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: TeleTauRadius.card, style: .continuous)
        VStack(alignment: .leading, spacing: TeleTauSpace.s200) {
            Text(title.uppercased())
                .teletauDisplay(TeleTauFontSize.label, TeleTauFontWeight.extrabold)
                .tracking(0.5)
                .foregroundStyle(TeleTauColor.textTertiary)
                .accessibilityAddTraits(.isHeader)
                .accessibilityLabel(Text(title))
            VStack(spacing: 0) {
                ForEach(Array(words.enumerated()), id: \.element.id) { index, word in
                    if index > 0 { Rectangle().fill(TeleTauColor.borderSubtle).frame(height: TeleTauSpace.s050) }
                    WordRow(word: word)
                }
            }
            .background(TeleTauColor.surface)
            .clipShape(shape)
            .overlay { shape.strokeBorder(TeleTauColor.borderSubtle, lineWidth: TeleTauSpace.s050) }
        }
    }
}

struct WordRow: View {
    let word: Components.Schemas.MyWord

    var body: some View {
        HStack(spacing: TeleTauSpace.s250) {
            VStack(alignment: .leading, spacing: TeleTauSpace.s050) {
                BashkirText(word.word.text, size: TeleTauFontSize.headline, weight: TeleTauFontWeight.black)
                Text(word.translationRu)
                    .teletauText(TeleTauFontSize.callout)
                    .foregroundStyle(TeleTauColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            ClipSpeakButton(clip: word.word.audio, size: .small, label: "Послушать: \(word.word.text)")
        }
        .padding(.vertical, TeleTauSpace.s200)
        .padding(.leading, TeleTauSpace.s400)
        .padding(.trailing, TeleTauSpace.s300)
        .frame(minHeight: 64)
        .accessibilityElement(children: .combine)
    }
}

/// Ссылка «Мой словарь» в профиле: «Повторить N слов», «Все слова выучены» или «Пока пусто».
struct WordsLink: View {
    let words: MyWords?
    let action: @MainActor () -> Void

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: TeleTauRadius.card, style: .continuous)
        Button(action: action) {
            HStack(spacing: TeleTauSpace.s300) {
                IconView(.bookOpenText, size: TeleTauSize.iconLarge)
                    .foregroundStyle(TeleTauColor.infoFill)
                    .frame(width: 44, height: 44)
                    .background(TeleTauColor.infoSoft, in: RoundedRectangle(cornerRadius: TeleTauRadius.iconButton, style: .continuous))
                VStack(alignment: .leading, spacing: TeleTauSpace.s050) {
                    Text("Мой словарь")
                        .teletauDisplay(TeleTauFontSize.headline, TeleTauFontWeight.black)
                        .foregroundStyle(TeleTauColor.textPrimary)
                    if let words {
                        let s = words.summary
                        Text(s.review > 0 ? ReviewText.title(s.review) : s.total > 0 ? "Все слова выучены" : "Пока пусто")
                            .teletauText(TeleTauFontSize.footnote)
                            .foregroundStyle(TeleTauColor.textSecondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                IconView(.caretRight, size: TeleTauSize.iconSmall)
                    .foregroundStyle(TeleTauColor.textTertiary)
            }
            .padding(.vertical, TeleTauSpace.s350)
            .padding(.horizontal, TeleTauSpace.s400)
            .background(TeleTauColor.surface, in: shape)
            .overlay { shape.strokeBorder(TeleTauColor.borderSubtle, lineWidth: TeleTauSpace.s050) }
            .padding(.bottom, TeleTauSize.lipSmall)
            .background { shape.fill(TeleTauColor.borderSubtle).padding(.top, TeleTauSize.lipSmall) }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

/// Ссылка-плитка профиля: значок на мягкой подложке, название и строка пояснения.
struct ProfileLink: View {
    let icon: TeleTauIcon
    let tint: Color
    let background: Color
    let title: String
    let subtitle: String
    let action: @MainActor () -> Void

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: TeleTauRadius.card, style: .continuous)
        Button(action: action) {
            HStack(spacing: TeleTauSpace.s300) {
                IconView(icon, size: TeleTauSize.iconLarge)
                    .foregroundStyle(tint)
                    .frame(width: 44, height: 44)
                    .background(background, in: RoundedRectangle(cornerRadius: TeleTauRadius.iconButton, style: .continuous))
                VStack(alignment: .leading, spacing: TeleTauSpace.s050) {
                    Text(title).teletauDisplay(TeleTauFontSize.headline, TeleTauFontWeight.black).foregroundStyle(TeleTauColor.textPrimary)
                    Text(subtitle).teletauText(TeleTauFontSize.footnote).foregroundStyle(TeleTauColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                IconView(.caretRight, size: TeleTauSize.iconSmall).foregroundStyle(TeleTauColor.textTertiary)
            }
            .padding(.vertical, TeleTauSpace.s350)
            .padding(.horizontal, TeleTauSpace.s400)
            .background(TeleTauColor.surface, in: shape)
            .overlay { shape.strokeBorder(TeleTauColor.borderSubtle, lineWidth: TeleTauSpace.s050) }
            .padding(.bottom, TeleTauSize.lipSmall)
            .background { shape.fill(TeleTauColor.borderSubtle).padding(.top, TeleTauSize.lipSmall) }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}
