import DesignSystem
import TeleTauAPI
import TeleTauSession
import SwiftUI

/// Где урок на тропе — для подписи «Знакомство · урок 4» (из GET /course).
struct LessonPlace: Equatable, Sendable {
    var topicRu: String?
    /// Номер урока среди уроков юнита (с 1).
    var lessonNumber: Int?

    static func of(_ course: Course?, nodeId: String) -> LessonPlace {
        guard let unit = course?.units.first(where: { $0.nodes.contains { $0.id == nodeId } }) else { return LessonPlace() }
        let lessons = unit.nodes.filter { $0.kind != .helpLanguage }
        let i = lessons.firstIndex { $0.id == nodeId }
        return LessonPlace(topicRu: unit.topicRu, lessonNumber: i.map { $0 + 1 })
    }
}

/// Полноэкранный шаг после урока (prototype `.full`): рисунок (иллюстрация или сота награды), заголовок, текст,
/// одна кнопка внизу. `centered` — содержимое по центру экрана; не помещается — прокрутка сверху, как у остальных шагов.
struct AfterScreen<Visual: View, Content: View>: View {
    let visual: Visual
    var violet = false
    var centered = false
    let action: String
    var actionVariant: TeleTauButtonVariant = .primary
    var busy = false
    let onAction: @MainActor () -> Void
    let content: Content

    init(visual: Visual, violet: Bool = false, centered: Bool = false, action: String, actionVariant: TeleTauButtonVariant = .primary,
         busy: Bool = false, onAction: @escaping @MainActor () -> Void, @ViewBuilder content: () -> Content) {
        self.visual = visual
        self.violet = violet
        self.centered = centered
        self.action = action
        self.actionVariant = actionVariant
        self.busy = busy
        self.onAction = onAction
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            if centered {
                ViewThatFits(in: .vertical) {
                    Column { stack }.frame(maxHeight: .infinity)
                    scroll
                }
            } else {
                scroll
            }
            Column {
                TeleTauButton(action, variant: actionVariant, loading: busy, action: onAction)
            }
            .padding(.top, TeleTauSpace.s400)
            .padding(.bottom, 22)
        }
        .background((violet ? TeleTauColor.violetSoft : TeleTauColor.bg).ignoresSafeArea())
    }

    private var stack: some View {
        VStack(spacing: 0) {
            visual
            content
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
    }

    private var scroll: some View {
        TeleTauScroll {
            Column {
                stack.padding(.top, TeleTauSpace.s800)
            }
        }
    }
}

extension AfterScreen where Visual == AfterArt {
    init(art: Illustration, artLabel: String?, wide: Bool = false, violet: Bool = false, action: String, actionVariant: TeleTauButtonVariant = .primary,
         busy: Bool = false, onAction: @escaping @MainActor () -> Void, @ViewBuilder content: () -> Content) {
        self.init(visual: AfterArt(art: art, label: artLabel, wide: wide), violet: violet, action: action, actionVariant: actionVariant,
                  busy: busy, onAction: onAction, content: content)
    }
}

/// Иллюстрация шага после урока.
struct AfterArt: View {
    let art: Illustration
    let label: String?
    let wide: Bool

    var body: some View {
        IllustrationView(art, width: wide ? 260 : 236, label: label)
            .padding(.top, TeleTauSpace.s450)
            .padding(.bottom, TeleTauSpace.s150)
    }
}

struct AfterTitle: View {
    let text: String
    var body: some View {
        Text(text)
            .teletauDisplay(TeleTauFontSize.title1, TeleTauFontWeight.black)
            .foregroundStyle(TeleTauColor.textPrimary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, TeleTauSpace.s250)
            .padding(.bottom, TeleTauSpace.s150)
            .accessibilityAddTraits(.isHeader)
    }
}

struct AfterLead: View {
    let text: Text
    var body: some View {
        text
            .teletauText(TeleTauFontSize.body)
            .foregroundStyle(TeleTauColor.textSecondary)
            .lineSpacing(TeleTauFontSize.body * (TeleTauLineHeight.body - 1))
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 330)
            .padding(.bottom, 22)
    }
}

/// «Урок пройден!» (prototype 13-result): мёд, точность, время, новые слова.
struct ResultView: View {
    let run: LessonRun
    let summary: LessonRunSummary
    let place: LessonPlace
    let onContinue: @MainActor () -> Void

    var body: some View {
        let helping = run.kind == .helpLanguage
        let reviewing = run.kind == .review
        let title = helping ? "Спасибо за помощь!" : reviewing ? "Повторение пройдено!" : run.kind == .placeTest ? "Испытание пройдено!" : "Урок пройден!"
        let pending = summary.honey.pendingFromVotes
        let parts = [place.topicRu, helping ? "Помоги языку" : place.lessonNumber.map { "урок \($0)" } ?? run.titleRu].compactMap { $0 }
        let lead = parts.joined(separator: " · ") + (helping && pending > 0 ? " · ещё +\(pending) мёда созреет позже" : "")
        AfterScreen(art: .sceneLessonComplete, artLabel: "Пчела радуется на запечатанных сотах", action: "Дальше", onAction: onContinue) {
            AfterTitle(text: title)
            if !reviewing { AfterLead(text: Text(lead)) }
            GoalNote(summary: summary)
            HStack(spacing: TeleTauSpace.s250) {
                StatTile(label: "Мёд", value: "+\(summary.honey.total)", icon: .drop)
                StatTile(label: "Точность", value: "\(Int((summary.accuracy * 100).rounded()))%")
                StatTile(label: "Время", value: Format.duration(summary.durationSeconds))
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Итог урока"))
            if !summary.newWords.isEmpty {
                HStack(alignment: .top, spacing: TeleTauSpace.s300) {
                    IllustrationView(.beeRead, width: 60)
                    VStack(alignment: .leading, spacing: TeleTauSpace.s200) {
                        Text("НОВЫЕ СЛОВА")
                            .teletauDisplay(TeleTauFontSize.caption, TeleTauFontWeight.extrabold)
                            .tracking(0.6)
                            .foregroundStyle(TeleTauColor.textTertiary)
                            .accessibilityAddTraits(.isHeader)
                        FlowLayout(spacing: TeleTauSpace.s150, lineSpacing: TeleTauSpace.s150) {
                            ForEach(summary.newWords, id: \.text) { word in
                                BashkirText(word.text, size: TeleTauFontSize.callout)
                                    .fixedSize()
                                    .padding(.vertical, TeleTauSpace.s150)
                                    .padding(.horizontal, TeleTauSpace.s250)
                                    .background(TeleTauColor.accentSoft, in: Capsule())
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .multilineTextAlignment(.leading)
                .teletauCard(padding: TeleTauSpace.s350, radius: TeleTauRadius.panel)
                .padding(.top, TeleTauSpace.s400)
            }
        }
        .successHapticOnAppear()
        .soundOnAppear(.complete)
    }
}

/// Итог испытания для перехода (`summary.jump`): сдано — «Место открыто», название места и мёд; не сдано — «Пока рано».
struct JumpResultView: View {
    let jump: JumpResult
    let summary: LessonRunSummary
    /// Место, к которому переходили (`jump.unitId` в курсе); нет курса — без названия.
    let place: Components.Schemas.Place?
    let onContinue: @MainActor () -> Void

    var body: some View {
        if jump.passed {
            AfterScreen(art: .beeProud, artLabel: "Пчела с медалью-сотой", action: "Дальше", onAction: onContinue) {
                AfterTitle(text: "Место открыто")
                if let place {
                    HStack(alignment: .firstTextBaseline, spacing: TeleTauSpace.s150) {
                        placeName(place, size: TeleTauFontSize.title3, color: TeleTauColor.accentText).fixedSize()
                        if place.titleBa != nil {
                            Text(verbatim: place.titleRu)
                                .teletauDisplay(TeleTauFontSize.button, TeleTauFontWeight.bold)
                                .foregroundStyle(TeleTauColor.textTertiary)
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .padding(.bottom, TeleTauSpace.s600)
                }
                GoalNote(summary: summary)
                StatTile(label: "Мёд", value: "+\(summary.honey.total)", icon: .drop)
                    .frame(maxWidth: 140)
            }
            .successHapticOnAppear()
            .soundOnAppear(.complete)
        } else {
            AfterScreen(art: .beeSympathy, artLabel: nil, action: "К урокам", onAction: onContinue) {
                AfterTitle(text: "Пока рано")
            }
        }
    }
}

/// Серия (prototype 14-streak): дни подряд, неделя сотами, заморозки — одной строкой.
struct StreakView: View {
    let summary: LessonRunSummary
    let onContinue: @MainActor () -> Void

    var body: some View {
        let streak = summary.streak
        AfterScreen(art: .sceneStreak, artLabel: "Цепочка сот с огоньками", wide: true, action: "Дальше", onAction: onContinue) {
            Text("\(streak.current)")
                .teletauDisplay(TeleTauFontSize.board, TeleTauFontWeight.black)
                .monospacedDigit()
                .foregroundStyle(TeleTauColor.streakFill)
                .padding(.top, -TeleTauSpace.s150)
                .accessibilityHidden(true)
            Text(Format.plural(streak.current, ("день подряд", "дня подряд", "дней подряд")))
                .teletauDisplay(TeleTauFontSize.title1, TeleTauFontWeight.black)
                .foregroundStyle(TeleTauColor.textPrimary)
                .padding(.bottom, TeleTauSpace.s150)
                .accessibilityLabel(Text("\(streak.current) \(Format.plural(streak.current, ("день подряд", "дня подряд", "дней подряд")))"))
                .accessibilityAddTraits(.isHeader)
            AfterLead(text: Text(streakLead))
            VStack(spacing: TeleTauSpace.s300) {
                HStack(spacing: TeleTauSpace.s150) {
                    ForEach(streak.week, id: \.date) { day in
                        WeekDayCell(day: day, today: day.date == streak.today)
                    }
                }
                HStack(spacing: TeleTauSpace.s150) {
                    IllustrationView(.itemStreakFreeze, width: 26)
                    Text(streak.freezes > 0 ? "\(streak.freezes) \(Format.plural(streak.freezes, ("заморозка", "заморозки", "заморозок"))) в запасе" : "Заморозок в запасе нет")
                        .teletauDisplay(TeleTauFontSize.footnote, TeleTauFontWeight.extrabold)
                        .foregroundStyle(TeleTauColor.textSecondary)
                }
            }
            .padding(.top, TeleTauSpace.s350)
            .padding(.horizontal, TeleTauSpace.s250)
            .padding(.bottom, TeleTauSpace.s300)
            .frame(maxWidth: .infinity)
            .background(TeleTauColor.surface, in: RoundedRectangle(cornerRadius: TeleTauRadius.panel, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: TeleTauRadius.panel, style: .continuous).strokeBorder(TeleTauColor.borderSubtle, lineWidth: TeleTauSpace.s050) }
        }
        .soundOnAppear(.streak)
    }
}

struct WeekDayCell: View {
    let day: StreakDay
    let today: Bool

    var body: some View {
        let (face, lip, empty): (Color, Color, Bool) = switch day.status {
        case .done: (TeleTauColor.accentFill, TeleTauColor.accentLip, false)
        case .frozen: (TeleTauColor.infoFill, TeleTauColor.infoLip, false)
        case .missed, .today, .future: (TeleTauColor.surface, TeleTauColor.borderDefault, true)
        }
        let text = switch day.status {
        case .done: "цель выполнена"
        case .frozen: "заморозка"
        case .missed: "пропуск"
        case .today: "сегодня"
        case .future: "впереди"
        }
        VStack(spacing: TeleTauSpace.s150) {
            Text(Format.weekdayShort(day.date))
                .teletauDisplay(TeleTauFontSize.caption, TeleTauFontWeight.extrabold)
                .foregroundStyle(today ? TeleTauColor.textPrimary : TeleTauColor.textTertiary)
            ZStack(alignment: .top) {
                if empty {
                    RoundedHex(cornerRadius: 3.5).fill(face).frame(width: 30, height: 26).offset(y: 1)
                    RoundedHex(cornerRadius: 3.5).stroke(lip, lineWidth: 2).frame(width: 30, height: 26).offset(y: 1)
                } else {
                    RoundedHex(cornerRadius: 3.5).fill(lip).frame(width: 32, height: 28).offset(y: 3)
                    RoundedHex(cornerRadius: 3.5).fill(face).frame(width: 32, height: 28)
                }
            }
            .frame(width: 32, height: 31, alignment: .top)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(Format.weekdayShort(day.date)): \(text)"))
    }
}

/// «Новая лига — Кипрей!» (prototype 15-league-up): Аҡбуҙат несёт выше, значок новой лиги.
struct LeagueUpView: View {
    let result: Components.Schemas.LeagueResult
    let busy: Bool
    let onContinue: @MainActor () -> Void

    var body: some View {
        let from = Format.tierName(result.tierBefore)
        let to = Format.tierName(result.tierAfter)
        // «Аҡбуҙат» — needs_native_review (docs/native-review-queue.md, №5).
        AfterScreen(art: .sceneLeagueUp, artLabel: "Крылатый жеребёнок Аҡбуҙат", violet: true, action: "Дальше", actionVariant: .violet,
                    busy: busy, onAction: onContinue) {
            AfterTitle(text: "Новая лига — \(to.nom)!")
            AfterLead(text: Text("Ты среди лучших в Лиге \(from.gen)."))
            IllustrationView(LeagueBadges.badge(result.tierAfter), width: 96, label: "Значок Лиги \(to.gen)")
        }
        .successHapticOnAppear()
        .soundOnAppear(.levelUp)
    }
}

/// Упражнений нет (prototype 20-empty-done): у «Помоги языку» закончились дуэли для этого ученика.
struct NothingToDoView: View {
    let kind: RunKind
    let onContinue: @MainActor () -> Void

    var body: some View {
        let (title, lead) = switch kind {
        case .helpLanguage: ("Все пары уже оценены", "Новые появятся позже.")
        case .review: ("Пока нечего повторять", "Новые слова появятся после уроков.")
        case .lesson, .placeTest, .jump: ("Здесь пока пусто", "В этом уроке пока нет заданий.")
        }
        AfterScreen(art: .emptyAllDone, artLabel: nil, action: "На тропу", onAction: onContinue) {
            AfterTitle(text: title)
            AfterLead(text: Text(lead))
        }
    }
}

/// Заставка (prototype 22-splash): медовый экран с летящей пчелой.
struct SplashView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: TeleTauSpace.s150) {
            IllustrationView(.beeFly, width: 200).floating(reduceMotion: reduceMotion)
            // «ТелеТау» — имя бренда, needs_native_review (docs/native-review-queue.md, №1).
            BashkirText("ТелеТау", size: TeleTauFontSize.display, weight: TeleTauFontWeight.black, color: TeleTauColor.accentOn, alignment: .center)
                .fixedSize()
            Text("башкирский язык каждый день")
                .teletauDisplay(TeleTauFontSize.body, TeleTauFontWeight.bold)
                .opacity(0.8)
        }
        .foregroundStyle(TeleTauColor.accentOn)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(TeleTauColor.accentFill.ignoresSafeArea())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Открываем тропу"))
    }
}

extension StreakView {
    /// Серия — по одному уроку в день, цель дня — соты (может быть ещё не выполнена).
    var streakLead: String {
        summary.streak.current <= 1 ? "Серия началась. Приходи завтра." : "Приходи завтра, чтобы не прервать серию."
    }
}

/// Цель дня на итоге урока: выполнена этим уроком — сота «запечатывается»; ещё нет — сколько сот осталось.
/// Выполнена раньше — ничего не показываем.
struct GoalNote: View {
    let summary: LessonRunSummary
    @State private var sealed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if let goal = summary.dailyGoal, summary.dailyGoalReached == true || !goal.met {
            let reached = summary.dailyGoalReached == true
            let left = goal.target - goal.done
            HStack(spacing: TeleTauSpace.s300) {
                GoalMeter(done: goal.done, target: goal.target)
                    .scaleEffect(reached && !sealed && !reduceMotion ? 0.7 : 1)
                RichText([.ru(reached ? "Цель дня выполнена" : "Ещё \(left) \(Format.plural(left, ("сота", "соты", "сот"))) до цели дня")], size: TeleTauFontSize.callout)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.vertical, TeleTauSpace.s250)
            .padding(.horizontal, TeleTauSpace.s350)
            .background(reached ? TeleTauColor.accentSoft : TeleTauColor.bgSunken, in: RoundedRectangle(cornerRadius: TeleTauRadius.panel, style: .continuous))
            .padding(.bottom, TeleTauSpace.s400)
            .accessibilityElement(children: .combine)
            .onAppear {
                guard reached, !reduceMotion else { sealed = true; return }
                withAnimation(.spring(duration: TeleTauDuration.hop, bounce: 0.5)) { sealed = true }
            }
        }
    }
}

/// Цель дня (prototype `.goal`): сота наполняется мёдом по доле выполненного, рядом — «1 из 2 сот».
/// Выполнено — сота полная и с галочкой.
struct GoalMeter: View {
    let done: Int
    let target: Int

    var body: some View {
        let shown = min(done, target)
        let share = target > 0 ? CGFloat(shown) / CGFloat(target) : 0
        let met = target > 0 && done >= target
        HStack(spacing: TeleTauSpace.s150) {
            ZStack {
                RoundedHex(cornerRadius: 5).fill(TeleTauColor.lockedFill)
                Rectangle().fill(TeleTauColor.accentFill)
                    .frame(height: 26 * share)
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .clipShape(RoundedHex(cornerRadius: 5))
                RoundedHex(cornerRadius: 4).stroke(TeleTauColor.accentLip.opacity(0.5), lineWidth: 2).padding(2)
                if met { IconView(.check, size: 14).foregroundStyle(TeleTauColor.accentOn) }
            }
            .frame(width: 30, height: 26)
            VStack(alignment: .leading, spacing: 0) {
                Text("\(shown) из \(target)")
                Text("сот")
            }
            .teletauDisplay(TeleTauFontSize.label, TeleTauFontWeight.extrabold)
            .monospacedDigit()
            .foregroundStyle(met ? TeleTauColor.accentText : TeleTauColor.textSecondary)
        }
        .frame(minHeight: TeleTauSize.touchMin)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Цель дня: \(shown) из \(target)\(met ? ", выполнена" : "")"))
    }
}

extension View {
    /// Хаптика «успех» при появлении экрана (docs/05 §9): итог урока, новая лига.
    func successHapticOnAppear() -> some View {
        modifier(SuccessHaptic())
    }
}

private struct SuccessHaptic: ViewModifier {
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .sensoryFeedback(.success, trigger: shown)
            .onAppear { shown = true }
    }
}

extension View {
    /// Звук интерфейса при появлении экрана (итог, серия, новая лига) — один раз.
    func soundOnAppear(_ name: UISound.Name) -> some View {
        modifier(SoundOnAppear(name: name))
    }
}

private struct SoundOnAppear: ViewModifier {
    let name: UISound.Name
    @State private var played = false
    @Environment(\.teletauStaticRender) private var staticRender

    func body(content: Content) -> some View {
        content.onAppear {
            guard !played, !staticRender else { return }
            played = true
            UISound.shared.play(name)
        }
    }
}
