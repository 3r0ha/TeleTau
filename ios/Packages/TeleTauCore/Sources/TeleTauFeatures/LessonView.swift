import DesignSystem
import TeleTauAPI
import TeleTauSession
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Черновик ответа на текущее упражнение (до «Проверить»).
public enum AnswerDraft: Equatable, Sendable {
    case tiles([String])
    case choice(String)
    case text(String)
    case duel(DuelChoice)
    /// «Пары»: соединённые пары и сколько их нужно (ответ — только все пары сразу).
    case pairs([Components.Schemas.PairLink], needed: Int)

    /// Ответ для `POST /lesson-runs/{runId}/attempts`; nil — проверять ещё нечего.
    var answer: AttemptAnswer? {
        switch self {
        case .tiles(let ids): ids.isEmpty ? nil : .tiles(.init(_type: .tiles, tileIds: ids))
        case .choice(let id): .choice(.init(_type: .choice, optionId: id))
        case .text(let t): t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : .text(.init(_type: .text, text: t))
        case .duel(let c): .duel(.init(_type: .duel, choice: c))
        case .pairs(let links, let needed): links.count == needed && needed > 0 ? .pairs(.init(_type: .pairs, pairs: links)) : nil
        }
    }
}

/// Плеер урока (prototype 05–12): крестик и прогресс, задание, «Проверить» в зоне большого пальца, после ответа —
/// лист «Верно / Почти / Пока не так / Голос учтён» с одной кнопкой «Дальше». Ответ окрашивается вместе с листом.
struct LessonPlayerView: View {
    let lesson: LessonState
    let onCheck: @MainActor (AttemptAnswer) -> Void
    let onNext: @MainActor () -> Void
    let onQuit: @MainActor () -> Void
    let onStay: @MainActor () -> Void
    let onLeave: @MainActor () -> Void
    /// Открыта подсказка к слову условия (номер в `hints`): ответ уйдёт с `hintsUsed`.
    let onHint: @MainActor @Sendable (Int) -> Void
    @State private var draft: AnswerDraft?
    /// Верные ответы подряд в этом уроке (огонёк «3 подряд» на листе): ошибка обнуляет счёт.
    @State private var combo: Int
    @State private var counted: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.teletauStaticRender) private var staticRender

    init(lesson: LessonState, draft: AnswerDraft? = nil, combo: Int = 0, onCheck: @escaping @MainActor (AttemptAnswer) -> Void, onNext: @escaping @MainActor () -> Void,
         onQuit: @escaping @MainActor () -> Void, onStay: @escaping @MainActor () -> Void, onLeave: @escaping @MainActor () -> Void,
         onHint: @escaping @MainActor @Sendable (Int) -> Void = { _ in }) {
        self.lesson = lesson
        self.onCheck = onCheck
        self.onNext = onNext
        self.onQuit = onQuit
        self.onStay = onStay
        self.onLeave = onLeave
        self.onHint = onHint
        _draft = State(initialValue: draft)
        _combo = State(initialValue: combo)
        _counted = State(initialValue: lesson.feedback?.attemptId)
    }

    var body: some View {
        let exercise = lesson.current
        let total = lesson.run.exercises.count
        let done = Int((lesson.progress * Double(total)).rounded())
        let disabled = lesson.feedback != nil || lesson.checking
        VStack(spacing: 0) {
            HStack(spacing: TeleTauSpace.s300) {
                IconButton(.x, label: "Выйти из урока", action: onQuit)
                TeleTauProgressBar(value: Double(done), total: Double(total), label: "Прогресс урока")
                    .accessibilityValue(Text("Пройдено \(done) из \(total)"))
            }
            .padding(.top, TeleTauSpace.s300)
            .padding(.bottom, TeleTauSpace.s150)
            .padding(.horizontal, TeleTauSpace.s400)
            .frame(maxWidth: TeleTauSize.columnNarrow)
            TeleTauScroll {
                Column {
                    ZStack {
                        if let exercise {
                            ExerciseBody(exercise: exercise, draft: $draft, disabled: disabled, retry: lesson.isRetry, review: lesson.run.kind == .review,
                                         result: lesson.feedback, onSubmit: check)
                                .environment(\.teletauHintOpened, onHint)
                                .id(lesson.stepKey)
                                // Следующее задание въезжает справа; при «Уменьшении движения» — просто появляется.
                                .transition(reduceMotion ? .opacity : .asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
                        }
                    }
                    .animation(reduceMotion ? nil : .easeOut(duration: TeleTauDuration.base), value: lesson.stepKey)
                }
                .padding(.top, TeleTauSpace.s350)
                .padding(.bottom, TeleTauSpace.s450)
            }
            footer(exercise)
        }
        .background(TeleTauColor.bg.ignoresSafeArea())
        .overlay {
            if lesson.quit {
                TeleTauDialog(art: .beeSympathy, title: "Уже уходишь?", text: "Урок начнётся сначала.") {
                    TeleTauButton("Остаться", action: onStay)
                    LinkButton("Выйти", tone: .danger, action: onLeave)
                }
            }
        }
        .onChange(of: lesson.stepKey) {
            draft = nil
            // Новое слово — мягкий звук знакомства.
            if lesson.isIntro { UISound.shared.play(.newWord) }
        }
        .onAppear { if lesson.isIntro, !staticRender { UISound.shared.play(.newWord) } }
        .onChange(of: lesson.feedback?.attemptId) { _, id in verdictArrived(id) }
        .sensoryFeedback(trigger: lesson.feedback?.verdict) { _, verdict in
            switch verdict {
            case .correct, .typo: .success
            case .almost: .impact(weight: .light)
            case .wrong: .error
            case .recorded: .selection
            case nil: nil
            }
        }
    }

    /// Вердикт пришёл: звук и счёт «подряд» — по одному разу на ответ.
    private func verdictArrived(_ id: String?) {
        guard let id, id != counted, let verdict = lesson.feedback?.verdict else { return }
        counted = id
        switch verdict {
        case .correct, .typo: UISound.shared.play(.correct)
        case .almost: UISound.shared.play(.almost)
        case .wrong: UISound.shared.play(.wrong)
        case .recorded: UISound.shared.play(.voted)
        }
        if verdict != .recorded { combo = verdict == .wrong ? 0 : combo + 1 }
    }

    private func check() {
        guard lesson.feedback == nil, !lesson.checking, let answer = draft?.answer else { return }
        onCheck(answer)
    }

    @ViewBuilder
    private func footer(_ exercise: RunExercise?) -> some View {
        if let feedback = lesson.feedback, let exercise {
            LessonFeedback(exercise: exercise, result: feedback, draft: draft, retryLater: lesson.willRetry, index: lesson.finished.count, combo: combo, onNext: onNext)
                .transition(.move(edge: .bottom))
        } else if lesson.isIntro {
            // «Новое слово»: ответа нет — сразу «Дальше», без запроса.
            Column { TeleTauButton("Дальше", action: onNext) }
                .padding(.top, TeleTauSpace.s350)
                .padding(.bottom, TeleTauSpace.s450)
                .background(TeleTauColor.bg)
                .overlay(alignment: .top) { Rectangle().fill(TeleTauColor.borderSubtle).frame(height: TeleTauSpace.s050) }
        } else {
            let duel = exercise?.isDuel ?? false
            Column {
                TeleTauButton(duel ? "Отдать голос" : "Проверить", variant: duel ? .violet : .primary, loading: lesson.checking, action: check)
                    .disabled(draft?.answer == nil)
            }
            .padding(.top, TeleTauSpace.s350)
            .padding(.bottom, TeleTauSpace.s450)
            .background(TeleTauColor.bg)
            .overlay(alignment: .top) { Rectangle().fill(TeleTauColor.borderSubtle).frame(height: TeleTauSpace.s050) }
        }
    }
}

struct ExerciseBody: View {
    let exercise: RunExercise
    @Binding var draft: AnswerDraft?
    let disabled: Bool
    let retry: Bool
    let review: Bool
    let result: AttemptResult?
    let onSubmit: @MainActor () -> Void

    var body: some View {
        Group {
            switch exercise {
            case .tilesRuBa(let e): TilesTask(exercise: e, draft: $draft, disabled: disabled, retry: retry, result: result)
            case .choiceBaRu(let e): ChoiceTask(exercise: e, draft: $draft, disabled: disabled, retry: retry, result: result)
            case .freeRuBa(let e): FreeTask(exercise: e, draft: $draft, disabled: disabled, retry: retry, result: result, onSubmit: onSubmit)
            case .duel(let e): DuelTask(exercise: e, draft: $draft, disabled: disabled)
            case .matchPairs(let e): PairsTask(exercise: e, draft: $draft, disabled: disabled, retry: retry, result: result)
            case .wordIntro(let e): WordIntroTask(exercise: e)
            }
        }
        .environment(\.teletauReviewRun, review)
    }
}

/// Тон ответа после проверки: верно — зелень, не так — коралл, почти — мёд (голос в дуэли не окрашивается).
func answerVerdict(_ result: AttemptResult?) -> AnswerVerdict? {
    switch result?.verdict {
    case .wrong: .bad
    case .almost: .almost
    case .correct, .typo: .ok
    case .recorded, nil: nil
    }
}

/// Метка над заголовком — только «Ещё раз» (после ошибки) и «Повторение»: тип задания уже в заголовке.
struct TaskKind: View {
    let retry: Bool
    @Environment(\.teletauReviewRun) private var review

    var body: some View {
        if retry || review {
            Chip(retry ? "Ещё раз" : "Повторение", icon: .arrowsClockwise)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct TaskTitle: View {
    let text: String

    var body: some View {
        Text(text)
            .teletauDisplay(TeleTauFontSize.title2, TeleTauFontWeight.black)
            .foregroundStyle(TeleTauColor.textPrimary)
            .lineSpacing(TeleTauFontSize.title2 * (TeleTauLineHeight.snug - 1))
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, TeleTauSpace.s250)
            .padding(.bottom, TeleTauSpace.s450)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Пчела с репликой-пузырём (prototype `.prompt`): русская фраза, которую переводим. В «Хранителе» — без пчелы.
struct PromptBubble: View {
    let bee: Illustration
    let text: String
    /// Подсказки к словам условия (только в уроке).
    var hints: [PromptHint]? = nil
    @Environment(\.teletauMode) private var mode
    @Environment(\.teletauOpenHint) private var openHint
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: TeleTauRadius.panel, style: .continuous)
        HStack(alignment: .bottom, spacing: TeleTauSpace.s250) {
            if mode.showsMascot {
                IllustrationView(bee, width: mode == .bee ? 116 : 104).floating(reduceMotion: reduceMotion)
            }
            Group {
                if let hints, !hints.isEmpty {
                    HintedText(text: text, hints: hints, size: TeleTauFontSize.headline, open: openHint)
                } else {
                    Text(text)
                        .teletauText(TeleTauFontSize.headline)
                        .foregroundStyle(TeleTauColor.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
                .padding(.vertical, TeleTauSpace.s350)
                .padding(.horizontal, TeleTauSpace.s400)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(TeleTauColor.surface, in: shape)
                .overlay { shape.strokeBorder(TeleTauColor.borderDefault, lineWidth: TeleTauSpace.s050) }
                .overlay(alignment: .bottomLeading) {
                    if mode.showsMascot {
                        Rectangle()
                            .fill(TeleTauColor.surface)
                            .frame(width: 14, height: 14)
                            .overlay(alignment: .leading) { Rectangle().fill(TeleTauColor.borderDefault).frame(width: TeleTauSpace.s050) }
                            .overlay(alignment: .bottom) { Rectangle().fill(TeleTauColor.borderDefault).frame(height: TeleTauSpace.s050) }
                            .rotationEffect(.degrees(45))
                            .offset(x: -8, y: -18)
                    }
                }
                .padding(.bottom, mode.showsMascot ? 26 : 0)
        }
        .padding(.bottom, TeleTauSpace.s450)
        // Пузырь перевода ложится поверх ответа ниже.
        .zIndex(1)
    }
}

/// «Переведи на башкирский» — собери ответ из плиток (tiles_ru_ba, prototype 05–06).
struct TilesTask: View {
    let exercise: Components.Schemas.TilesExercise
    @Binding var draft: AnswerDraft?
    let disabled: Bool
    let retry: Bool
    var result: AttemptResult?
    @Environment(\.teletauMode) private var mode

    private var picked: [String] {
        if case .tiles(let ids) = draft { ids } else { [] }
    }

    private func text(_ id: String) -> String { exercise.tiles.first { $0.id == id }?.text ?? "" }

    var body: some View {
        let tileHeight: CGFloat = mode == .bee ? 57 : 49
        let row = tileHeight + 13
        VStack(spacing: 0) {
            TaskKind(retry: retry)
            TaskTitle(text: "Переведи на башкирский")
            PromptBubble(bee: .beeExplain, text: exercise.promptRu, hints: exercise.hints)
            FlowLayout(spacing: TeleTauSpace.s200, lineSpacing: 13) {
                ForEach(picked, id: \.self) { id in
                    WordTile(text(id), verdict: answerVerdict(result).flatMap { $0 == .almost ? .ok : $0 }) {
                        UISound.shared.play(.tap)
                        draft = .tiles(picked.filter { $0 != id })
                    }
                }
            }
            .padding(.top, TeleTauSpace.s150)
            .frame(maxWidth: .infinity, minHeight: row * 2, alignment: .topLeading)
            .background(alignment: .top) {
                VStack(spacing: 0) {
                    ForEach(0..<2, id: \.self) { _ in
                        VStack(spacing: 0) {
                            Spacer(minLength: 0)
                            Rectangle().fill(TeleTauColor.borderDefault).frame(height: TeleTauSpace.s050)
                            Spacer().frame(height: TeleTauSpace.s050)
                        }
                        .frame(height: row)
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Твой ответ — нажми на слово, чтобы убрать"))
            FlowLayout(spacing: TeleTauSpace.s200, lineSpacing: TeleTauSpace.s250, center: true) {
                ForEach(exercise.tiles, id: \.id) { tile in
                    WordTile(tile.text, used: picked.contains(tile.id)) {
                        UISound.shared.play(.tap)
                        draft = .tiles(picked + [tile.id])
                    }
                }
            }
            .padding(.top, 26)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Слова"))
        }
        .disabled(disabled)
    }
}

/// «Что значит это слово?» — узнавание при первом знакомстве (choice_ba_ru, prototype 07).
struct ChoiceTask: View {
    let exercise: Components.Schemas.ChoiceExercise
    @Binding var draft: AnswerDraft?
    let disabled: Bool
    let retry: Bool
    var result: AttemptResult?

    var body: some View {
        let selected: String? = if case .choice(let id) = draft { id } else { nil }
        VStack(spacing: 0) {
            TaskKind(retry: retry)
            TaskTitle(text: "Что значит это слово?")
            HStack(alignment: .center, spacing: TeleTauSpace.s300) {
                BashkirText(exercise.prompt, size: TeleTauFontSize.title1, weight: TeleTauFontWeight.black)
                    .frame(maxWidth: .infinity, alignment: .leading)
                ClipSpeakButton(clip: exercise.promptAudio, size: .large, label: "Послушать: \(exercise.prompt)")
            }
                .padding(TeleTauSpace.s450)
                .frame(maxWidth: .infinity, minHeight: 84, alignment: .leading)
                .background(TeleTauColor.accentSoft, in: RoundedRectangle(cornerRadius: TeleTauRadius.panel, style: .continuous))
                .padding(.bottom, TeleTauSpace.s450)
            VStack(spacing: TeleTauSpace.s250) {
                ForEach(Array(exercise.options.enumerated()), id: \.element.id) { i, option in
                    AnswerOption(mark: "\(i + 1)", text: option.textRu, selected: selected == option.id, verdict: verdict(option.id, selected: selected)) {
                        UISound.shared.play(.tap)
                        draft = .choice(option.id)
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Варианты перевода"))
        }
        .disabled(disabled)
    }
}

/// «Напиши по-башкирски» — ввод с панелью башкирских букв (free_ru_ba, prototype 08–09).
struct FreeTask: View {
    let exercise: Components.Schemas.FreeInputExercise
    @Binding var draft: AnswerDraft?
    let disabled: Bool
    let retry: Bool
    var result: AttemptResult?
    let onSubmit: @MainActor () -> Void
    @State private var insertion = TextInsertion()
    @Environment(\.teletauStaticRender) private var staticRender

    private var text: Binding<String> {
        Binding(
            get: { if case .text(let t) = draft { t } else { "" } },
            set: { draft = .text($0) }
        )
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: TeleTauRadius.panel, style: .continuous)
        VStack(spacing: 0) {
            TaskKind(retry: retry)
            TaskTitle(text: "Напиши по-башкирски")
            PromptBubble(bee: .beeThink, text: exercise.promptRu, hints: exercise.hints)
            ZStack(alignment: .topLeading) {
                if text.wrappedValue.isEmpty {
                    Text("Твой ответ")
                        .teletauText(TeleTauFontSize.title3, TeleTauFontWeight.medium)
                        .foregroundStyle(TeleTauColor.textTertiary)
                        .padding(TeleTauSpace.s300)
                        .accessibilityHidden(true)
                }
                #if canImport(UIKit)
                if !staticRender {
                    BashkirTextView(text: text, insertion: insertion, editable: !disabled, onSubmit: onSubmit,
                                    accessibilityLabel: "Перевод на башкирский: \(exercise.promptRu)")
                        .frame(minHeight: 110)
                } else {
                    staticText
                }
                #else
                staticText
                #endif
            }
            .padding(TeleTauSpace.s100)
            .frame(maxWidth: .infinity, minHeight: 118, alignment: .topLeading)
            .background(answerVerdict(result)?.soft ?? TeleTauColor.surface, in: shape)
            .overlay { shape.strokeBorder(answerVerdict(result)?.edge ?? TeleTauColor.borderDefault, lineWidth: TeleTauSpace.s050) }
            LetterPanel(letters: exercise.letters) { letter in
                if !insertion.insert(letter) { text.wrappedValue += letter }
            }
            .disabled(disabled)
            .padding(.top, TeleTauSpace.s300)
        }
    }

    private var staticText: some View {
        BashkirText(text.wrappedValue, size: TeleTauFontSize.title3, weight: TeleTauFontWeight.medium)
            .padding(TeleTauSpace.s300)
            .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

/// Вставка буквы из панели в позицию курсора поля ввода.
@MainActor
final class TextInsertion {
    #if canImport(UIKit)
    weak var textView: UITextView?
    #endif

    /// false — поля нет (рендер без платформенных контролов): букву допишет вызывающий.
    func insert(_ s: String) -> Bool {
        #if canImport(UIKit)
        guard let textView else { return false }
        textView.insertText(s)
        return true
        #else
        return false
        #endif
    }
}

#if canImport(UIKit)
/// Поле ввода башкирского текста: Nunito (формы Ҫ, Ҙ), без автозамены и заглавной буквы; Enter — «Проверить».
struct BashkirTextView: UIViewRepresentable {
    @Binding var text: String
    let insertion: TextInsertion
    let editable: Bool
    let onSubmit: @MainActor () -> Void
    let accessibilityLabel: String

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.backgroundColor = .clear
        // Язык набора `ba` — в атрибутах: CoreText включает формы Ҫ и Ҙ (`locl BSH`) только по нему.
        view.typingAttributes = context.coordinator.attributes
        view.adjustsFontForContentSizeCategory = true
        view.tintColor = UIColor(TeleTauColor.focus)
        view.autocorrectionType = .no
        view.autocapitalizationType = .none
        view.spellCheckingType = .no
        view.smartQuotesType = .no
        view.smartDashesType = .no
        view.returnKeyType = .done
        view.textContainerInset = UIEdgeInsets(top: TeleTauSpace.s300, left: TeleTauSpace.s200, bottom: TeleTauSpace.s300, right: TeleTauSpace.s200)
        view.accessibilityLabel = accessibilityLabel
        view.accessibilityLanguage = "ba"
        view.delegate = context.coordinator
        insertion.textView = view
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.parent = self
        if view.text != text { view.attributedText = NSAttributedString(string: text, attributes: context.coordinator.attributes) }
        view.typingAttributes = context.coordinator.attributes
        view.isEditable = editable
        insertion.textView = view
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: BashkirTextView
        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFontMetrics(forTextStyle: .title3).scaledFont(for: TeleTauFonts.ctFont(.display, size: TeleTauFontSize.title3, weight: TeleTauFontWeight.medium) as UIFont),
            .foregroundColor: UIColor(TeleTauColor.textPrimary),
            NSAttributedString.Key(kCTLanguageAttributeName as String): "ba",
        ]

        init(_ parent: BashkirTextView) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
        }

        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            if text == "\n" {
                parent.onSubmit()
                return false
            }
            return true
        }
    }
}
#endif

/// Дуэль «Помоги языку» (prototype 10): исходная фраза, два варианта и «Оба подходят / Не знаю» — без чужих голосов.
struct DuelTask: View {
    let exercise: Components.Schemas.DuelExercise
    @Binding var draft: AnswerDraft?
    let disabled: Bool
    @Environment(\.teletauMode) private var mode

    var body: some View {
        let choice: DuelChoice? = if case .duel(let c) = draft { c } else { nil }
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: TeleTauSpace.s200) {
                VStack(alignment: .leading, spacing: 0) {
                    Chip("Помоги языку", icon: .scales, tone: .violet)
                    TaskTitle(text: "Какой перевод лучше?")
                }
                if mode.showsMascot { IllustrationView(.sceneDuel, width: 84).padding(.top, TeleTauSpace.s300) }
            }
            VStack(alignment: .leading, spacing: TeleTauSpace.s100) {
                Text("ПО-РУССКИ")
                    .teletauDisplay(TeleTauFontSize.caption, TeleTauFontWeight.bold)
                    .tracking(0.7)
                    .foregroundStyle(TeleTauColor.violetText)
                Text(exercise.sourceRu)
                    .teletauDisplay(TeleTauFontSize.headline, TeleTauFontWeight.extrabold)
                    .foregroundStyle(TeleTauColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, TeleTauSpace.s350)
            .padding(.horizontal, TeleTauSpace.s400)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(TeleTauColor.violetSoft, in: RoundedRectangle(cornerRadius: TeleTauRadius.panel, style: .continuous))
            .padding(.bottom, TeleTauSpace.s400)
            VStack(spacing: TeleTauSpace.s300) {
                AnswerOption(mark: "A", text: exercise.a, bashkir: true, selected: choice == .a, tone: .violet) { draft = .duel(.a) }
                AnswerOption(mark: "B", text: exercise.b, bashkir: true, selected: choice == .b, tone: .violet) { draft = .duel(.b) }
            }
            HStack(spacing: TeleTauSpace.s200) {
                Pill("Оба подходят", selected: choice == .both) { draft = .duel(.both) }
                Pill("Не знаю", selected: choice == .skip) { draft = .duel(.skip) }
            }
            .padding(.top, TeleTauSpace.s350)
        }
        .disabled(disabled)
        .accessibilityElement(children: .contain)
    }
}

/// Лист после ответа: тексты — как `Feedback` веба.
struct LessonFeedback: View {
    let exercise: RunExercise
    let result: AttemptResult
    let draft: AnswerDraft?
    let retryLater: Bool
    let index: Int
    var combo = 0
    let onNext: @MainActor () -> Void
    @Environment(\.teletauMode) private var mode

    static let okTitles = ["Верно!", "Точно!"]
    /// Огонёк «N подряд» — с трёх верных ответов подряд.
    static let comboFrom = 3

    private var okTitle: String { Self.okTitles[index % Self.okTitles.count] }
    private var badge: String? { combo >= Self.comboFrom ? "\(combo) подряд" : nil }

    /// Верный вариант: у выбора — русский вариант, у плиток и ввода — башкирская фраза.
    private var choiceOption: String? {
        guard case .choiceBaRu(let e) = exercise else { return nil }
        return e.options.first { $0.id == result.correctOptionId }?.textRu ?? result.meaningRu
    }

    private var correct: String { result.correctAnswer?.text ?? "" }

    private var answerRuns: [TextRun]? {
        if case .choiceBaRu = exercise { return choiceOption.map { [.ru($0, TeleTauFontWeight.semibold)] } }
        return correct.isEmpty ? nil : [.ba(correct)]
    }

    private var meaning: [TextRun]? {
        switch exercise {
        case .choiceBaRu(let e):
            guard let option = choiceOption else { return nil }
            return [.ba(e.prompt), .ru(" — «\(option)»")]
        case .duel, .matchPairs, .wordIntro:
            return nil
        case .tilesRuBa(let e):
            return correct.isEmpty ? nil : [.ba(correct), .ru(" — «\(trimPunctuation(result.meaningRu ?? e.promptRu))»")]
        case .freeRuBa(let e):
            return correct.isEmpty ? nil : [.ba(correct), .ru(" — «\(trimPunctuation(result.meaningRu ?? e.promptRu))»")]
        }
    }

    private func trimPunctuation(_ s: String) -> String {
        var t = Substring(s)
        while let last = t.last, ".!?".contains(last) { t = t.dropLast() }
        return String(t)
    }

    /// Строка листа; если у верного ответа есть запись носителя — «Послушать» рядом.
    private func line(_ runs: [TextRun], listen: Bool = false, size: CGFloat = TeleTauFontSize.body) -> some View {
        HStack(spacing: TeleTauSpace.s250) {
            RichText(runs, size: size).frame(maxWidth: .infinity, alignment: .leading)
            if listen { ClipSpeakButton(clip: result.correctAnswer?.audio, size: .sheet, label: "Послушать: \(correct)") }
        }
    }

    var body: some View {
        if case .matchPairs(let e) = exercise {
            let links: [Components.Schemas.PairLink] = if case .pairs(let l, _) = draft { l } else { [] }
            PairsFeedback(exercise: e, result: result, links: links, retryLater: retryLater, title: okTitle, badge: badge, onNext: onNext)
        } else {
            verdictSheet
        }
    }

    @ViewBuilder
    private var verdictSheet: some View {
        switch result.verdict {
        case .correct:
            FeedbackSheet(tone: .ok, title: okTitle, badge: badge, actionLabel: "Дальше", action: onNext) {
                if let meaning { line(meaning, listen: true) }
            }
        case .typo:
            FeedbackSheet(tone: .ok, title: "Верно, но с опечаткой", badge: badge, actionLabel: "Дальше", action: onNext) {
                if let answerRuns { line([.ru("Правильно: ")] + answerRuns, listen: true) }
            }
        case .almost:
            // Засчитано, но одна башкирская буква заменена похожей русской: слово с этой буквой — крупно.
            FeedbackSheet(tone: .almost, title: "Почти!", art: .beeSurprise, actionLabel: "Дальше", action: onNext) {
                VStack(alignment: .leading, spacing: TeleTauSpace.s100) {
                    if !correct.isEmpty { line(HintedAnswer.runs(correct, hint: result.hint), listen: true, size: TeleTauFontSize.title3) }
                    if let hint = result.hint {
                        let got = hint.got != hint.expected ? [TextRun.ru("», а не «"), .ba(hint.got, TeleTauFontWeight.regular)] : []
                        RichText([.ru("Засчитано. Здесь пишется «"), .ba(hint.expected, TeleTauFontWeight.regular)] + got + [.ru("».")], size: TeleTauFontSize.body)
                    } else {
                        Text("Засчитано. Сравни со своим ответом.")
                    }
                }
            }
        case .wrong:
            FeedbackSheet(tone: .bad, title: "Пока не так", actionLabel: "Дальше", action: onNext) {
                VStack(alignment: .leading, spacing: TeleTauSpace.s100) {
                    if let answerRuns { line([.ru("Правильно: ")] + answerRuns, listen: true) }
                    // «Пчёлке» — без лишних строк: только верный ответ.
                    if retryLater, mode != .bee { Text("Повторим в конце урока.") }
                }
            }
        case .recorded:
            FeedbackSheet(tone: .voted, title: "Голос учтён", art: .beeCheer, actionLabel: "Дальше", action: onNext) {
                Text("Итог появится в профиле.")
            }
        }
    }
}

/// Верное слово с выделенной буквой, которой ответ отличался (`LetterHint`: номер слова и буквы в нём).
enum HintedAnswer {
    static func runs(_ text: String, hint: Components.Schemas.LetterHint?) -> [TextRun] {
        guard let hint else { return [.ba(text, TeleTauFontWeight.black)] }
        // Слова — по пробелам, буквы в слове — только буквы (знаки препинания не считаются), как HintedAnswer веба.
        var runs: [TextRun] = []
        var word = -1
        var inWord = false
        var letter = -1
        var plain = ""
        for ch in text {
            let isSpace = ch.isWhitespace
            if !isSpace, !inWord { word += 1; letter = -1 }
            inWord = !isSpace
            if word == hint.token, ch.isLetter {
                letter += 1
                if letter == hint.index, String(ch).lowercased() == hint.expected {
                    if !plain.isEmpty { runs.append(.ba(plain, TeleTauFontWeight.black)); plain = "" }
                    runs.append(.ba(String(ch), TeleTauFontWeight.black, marked: true))
                    continue
                }
            }
            plain.append(ch)
        }
        if !plain.isEmpty { runs.append(.ba(plain, TeleTauFontWeight.black)) }
        return runs
    }
}

/// Урок открывается: тот же каркас, вместо задания — скелетон.
struct LessonLoadingView: View {
    let onLeave: @MainActor () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: TeleTauSpace.s300) {
                IconButton(.x, label: "Выйти из урока", action: onLeave)
                TeleTauProgressBar(value: 0, total: 1, label: "Прогресс урока")
            }
            .padding(.top, TeleTauSpace.s300)
            .padding(.horizontal, TeleTauSpace.s400)
            VStack(alignment: .leading, spacing: TeleTauSpace.s400) {
                Skeleton(width: 140, height: 30, radius: TeleTauRadius.button)
                Skeleton(width: 280, height: 30)
                Skeleton(height: 120, radius: TeleTauRadius.card)
                Skeleton(height: 60, radius: TeleTauRadius.button)
            }
            .padding(TeleTauSpace.s400)
            .accessibilityElement()
            .accessibilityLabel(Text("Открываем урок"))
            Spacer()
        }
        .background(TeleTauColor.bg.ignoresSafeArea())
    }
}

/// Итог урока сохраняется; при сбое — повтор с тем же runId (сервер не начислит дважды).
struct LessonSavingView: View {
    let failed: Bool
    let onRetry: @MainActor () -> Void
    let onLeave: @MainActor () -> Void

    var body: some View {
        VStack {
            Spacer()
            if failed {
                EmptyStateView(art: .emptyError, title: "Итог не сохранился", text: "Проверь интернет. Ответы не пропадут.") {
                    TeleTauButton("Попробовать снова", action: onRetry)
                    LinkButton("На тропу", tone: .neutral, action: onLeave)
                }
            } else {
                VStack(spacing: TeleTauSpace.s400) {
                    Skeleton(width: 220, height: 220, radius: TeleTauRadius.card)
                    Skeleton(width: 200, height: 30)
                }
                .accessibilityElement()
                .accessibilityLabel(Text("Сохраняем урок"))
            }
            Spacer()
        }
        .padding(.horizontal, TeleTauSpace.s400)
        .frame(maxWidth: .infinity)
        .background(TeleTauColor.bg.ignoresSafeArea())
    }
}

extension ChoiceTask {
    /// Верный вариант — зелёный с галочкой; неверный выбранный — коралловый с крестиком.
    func verdict(_ id: String, selected: String?) -> AnswerVerdict? {
        guard let result, result.verdict != .recorded else { return nil }
        if id == result.correctOptionId { return .ok }
        if id == selected, result.verdict == .wrong { return .bad }
        return nil
    }
}
