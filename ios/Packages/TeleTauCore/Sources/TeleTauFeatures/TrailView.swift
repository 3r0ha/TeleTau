import DesignSystem
import TeleTauAPI
import TeleTauSession
import SwiftUI

/// Текущее место экспедиции: юнит с текущим узлом, иначе первый незаконченный открытый, иначе последний открытый.
func currentUnit(_ course: Course) -> CourseUnit? {
    course.units.first { $0.nodes.contains { $0.state == .current } }
        ?? course.units.first { $0.state == .open && $0.nodes.contains { $0.state != .done } }
        ?? course.units.last { $0.state == .open }
}

func nextNode(_ course: Course) -> TrailNode? {
    let all = course.units.flatMap(\.nodes)
    return all.first { $0.state == .current } ?? all.first { $0.state == .open }
}

/// Название места: башкирское (из контента с флагом проверки носителем), иначе русское.
@MainActor
func placeName(_ place: Components.Schemas.Place, size: CGFloat, weight: Font.Weight = TeleTauFontWeight.black, color: Color = TeleTauColor.textPrimary) -> some View {
    Group {
        if let ba = place.titleBa {
            BashkirText(ba.text, size: size, weight: weight, color: color).fixedSize(horizontal: false, vertical: true)
        } else {
            Text(verbatim: place.titleRu).teletauDisplay(size, weight).foregroundStyle(color)
        }
    }
}

/// Верхняя панель тропы (prototype `.topbar`): серия, мёд и значок лиги.
struct LearnTopBar: View {
    let progress: MyProgress?
    let onLeague: @MainActor () -> Void
    var showDivider = false

    var body: some View {
        let streak = progress?.streak.current ?? 0
        let honey = progress?.honey.total ?? 0
        HStack {
            if let goal = progress?.dailyGoal {
                GoalMeter(done: goal.done, target: goal.target)
                Spacer()
            }
            HStack(spacing: TeleTauSpace.s150) {
                IconView(.fire, size: TeleTauSize.icon).foregroundStyle(streak > 0 ? TeleTauColor.streakFill : TeleTauColor.lockedText)
                Text(progress == nil ? "–" : "\(streak)").teletauDisplay(TeleTauFontSize.button, TeleTauFontWeight.black).monospacedDigit()
                    .foregroundStyle(streak > 0 ? TeleTauColor.streakText : TeleTauColor.textTertiary)
            }
            .frame(minWidth: TeleTauSize.touchMin, minHeight: TeleTauSize.touchMin)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Серия: \(streak) \(Format.plural(streak, ("день", "дня", "дней"))) подряд"))
            Spacer()
            HStack(spacing: TeleTauSpace.s150) {
                IconView(.drop, size: TeleTauSize.icon).foregroundStyle(TeleTauColor.accentFill)
                Text(progress == nil ? "–" : "\(honey)").teletauDisplay(TeleTauFontSize.button, TeleTauFontWeight.black).monospacedDigit()
                    .foregroundStyle(TeleTauColor.accentText)
            }
            .frame(minWidth: TeleTauSize.touchMin, minHeight: TeleTauSize.touchMin)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Мёд: \(honey)"))
            Spacer()
            if let tier = progress?.league?.tier {
                Button(action: onLeague) {
                    IllustrationView(LeagueBadges.badge(tier), width: 30)
                        .frame(width: TeleTauSize.touchMin, height: TeleTauSize.touchMin)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Лига \(Format.tierName(tier).gen)"))
            } else {
                Color.clear.frame(width: TeleTauSize.touchMin, height: TeleTauSize.touchMin)
            }
        }
        .padding(.horizontal, TeleTauSpace.s400)
        .frame(minHeight: 60)
        .frame(maxWidth: TeleTauSize.columnNarrow)
        .frame(maxWidth: .infinity)
        .background(TeleTauColor.bg)
        .overlay(alignment: .bottom) {
            if showDivider { Rectangle().fill(TeleTauColor.borderSubtle).frame(height: TeleTauSpace.s050) }
        }
    }
}

enum LeagueBadges {
    static func badge(_ tier: LeagueTier) -> Illustration {
        switch tier {
        case .clover: .badgeClover
        case .buckwheat: .badgeBuckwheat
        case .sweetclover: .badgeSweetclover
        case .fireweed: .badgeFireweed
        case .linden: .badgeLinden
        }
    }
}

/// Тропа «Тропа + Экспедиция» (prototype 01–04): места с узлами и декорациями. У текущего места вместо вывески —
/// компактная шапка (картинка-полоса, название, прогресс), над ним — плашки «на сегодня» (задание учителя, повторение).
/// Узел «Начать» виден с первого экрана; текущее место не первое — тропа открывается сразу на нём (`TrailScroll`).
struct TrailContent: View {
    let course: Course
    let sealed: String?
    let busy: String?
    let onStart: @MainActor (TrailNode) -> Void
    var onReview: (@MainActor () -> Void)?
    /// Сегодня по Уфе — для сроков заданий учителя.
    var today: String = AssignmentText.ufaDay()
    /// Верх плашек и шапки текущего места и низ шапки (в координатах прокрутки) — для липкого баннера.
    var onHereTop: @MainActor (CGFloat) -> Void = { _ in }
    var onHeadBottom: @MainActor (CGFloat) -> Void = { _ in }
    var onUnitTop: @MainActor (String, CGFloat) -> Void = { _, _ in }
    var hint: TrailHint?
    var onLocked: @MainActor (TrailNode) -> Void = { _ in }
    /// «Пройти испытание» у закрытого места (`CourseUnit.jump`); nil — без предложения.
    var onJump: (@MainActor (CourseUnit) -> Void)?
    /// Рендер без прокрутки (снимки): тропа сразу с текущего места — как после открытия на нём.
    var fromHere = false
    /// Всё открытое пройдено — сначала «На сегодня всё», тропа — по кнопке.
    @State private var showTrail = false
    @Environment(\.teletauMode) private var mode

    nonisolated static let space = "trail"
    /// Якорь «ты здесь»: плашки и шапка текущего места.
    nonisolated static let hereID = "trail-here"

    var body: some View {
        let unit = currentUnit(course)
        let next = nextNode(course)
        let due = course.review?.due ?? 0
        let pills = TodayPills(course: course, due: due, busy: busy, today: today, onStart: onStart, onReview: onReview)
        if next == nil && !showTrail {
            VStack(spacing: TeleTauSpace.s200) {
                pills
                EmptyStateView(art: .emptyAllDone, title: "На сегодня всё",
                               text: "Все уроки пройдены. Новые скоро появятся.") {
                    TeleTauButton("На тропу", variant: pills.isEmpty ? .primary : .secondary) { showTrail = true }
                }
            }
            .padding(.horizontal, TeleTauSpace.s400)
            .padding(.top, TeleTauSpace.s300)
        } else {
            let placeIndex = unit.flatMap { u in course.units.firstIndex { $0.id == u.id } } ?? -1
            let skip = fromHere && placeIndex > 0 ? placeIndex : 0
            VStack(spacing: 0) {
                VStack(spacing: 0) {
                    if placeIndex < 0, !pills.isEmpty { pills.padding(.bottom, TeleTauSpace.s200) }
                    ForEach(Array(course.units.enumerated().dropFirst(skip)), id: \.element.id) { index, u in
                        let here = index == placeIndex
                        VStack(spacing: 0) {
                            if here, !pills.isEmpty { pills.padding(.bottom, TeleTauSpace.s200) }
                            UnitSection(unit: u, here: here, withBee: here && mode.showsMascot, sealed: sealed, busy: busy, onStart: onStart,
                                        hint: hint, onLocked: onLocked, onJump: onJump, onHeadBottom: onHeadBottom)
                                .onGeometryChange(for: CGFloat.self) { $0.frame(in: .named(Self.space)).minY } action: { onUnitTop(u.id, $0) }
                        }
                        // Открылась тропа на текущем месте — плашки чуть ниже верхней панели.
                        .padding(.top, here && index > skip ? TeleTauSpace.s200 : 0)
                        .onGeometryChange(for: CGFloat.self) { $0.frame(in: .named(Self.space)).minY } action: { if here { onHereTop($0) } }
                        .id(here ? Self.hereID : "unit-\(u.id)")
                        .padding(.top, index == skip ? 0 : here ? TeleTauSpace.s300 : TeleTauSpace.s500)
                    }
                }
                .padding(.top, skip > 0 ? 0 : TeleTauSpace.s200)
                .padding(.horizontal, -TeleTauSpace.s100)
                PathEnd(course: course, unit: unit)
                    .padding(.bottom, TeleTauSpace.s600)
            }
            .padding(.horizontal, TeleTauSpace.s400)
            .padding(.top, skip > 0 ? 0 : TeleTauSpace.s100)
        }
    }
}

/// Подсказка у закрытого узла: какой узел и что сказать.
struct TrailHint: Equatable {
    let node: String
    let text: String
}

/// Экран вкладки «Путь»: панель, прокрутка тропы и липкий баннер места.
struct TrailScreen: View {
    let course: Course
    let progress: MyProgress?
    let sealed: String?
    let busy: String?
    let onStart: @MainActor (TrailNode) -> Void
    var onReview: (@MainActor () -> Void)?
    /// «Пройти испытание» у закрытого места.
    var onJump: (@MainActor (CourseUnit) -> Void)?
    let onLeague: @MainActor () -> Void
    /// Для снимков: подсказка у закрытого узла уже показана.
    var hint: TrailHint?
    /// Для снимков: «Сегодня» по Уфе (сроки заданий учителя).
    var today: String = AssignmentText.ufaDay()

    var body: some View {
        VStack(spacing: 0) {
            LearnTopBar(progress: progress, onLeague: onLeague)
            TrailScroll(course: course, sealed: sealed, busy: busy, onStart: onStart, onReview: onReview, onJump: onJump, hint: hint, today: today)
        }
    }
}

private struct TrailScroll: View {
    let course: Course
    let sealed: String?
    let busy: String?
    let onStart: @MainActor (TrailNode) -> Void
    let onReview: (@MainActor () -> Void)?
    let onJump: (@MainActor (CourseUnit) -> Void)?
    let today: String
    @State private var hint: TrailHint?
    @State private var hintTask: Task<Void, Never>?
    @State private var hereTop: CGFloat = .infinity
    @State private var headBottom: CGFloat = -.infinity
    @State private var unitTops: [String: CGFloat] = [:]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.teletauStaticRender) private var staticRender

    /// Сколько держится подсказка у закрытого узла.
    static let hintSeconds = 3.2
    /// Полоса у верхнего края прокрутки, где стоит липкий баннер.
    static let barZone: CGFloat = 80

    init(course: Course, sealed: String?, busy: String?, onStart: @escaping @MainActor (TrailNode) -> Void, onReview: (@MainActor () -> Void)?,
         onJump: (@MainActor (CourseUnit) -> Void)?, hint: TrailHint?, today: String) {
        self.course = course
        self.sealed = sealed
        self.busy = busy
        self.onStart = onStart
        self.onReview = onReview
        self.onJump = onJump
        self.today = today
        _hint = State(initialValue: hint)
    }

    /// Липкий баннер места: место, мимо которого прокручиваем; не нужен, пока у верхнего края плашки или шапка места.
    private var barUnit: CourseUnit? {
        var id: String?
        for u in course.units where (unitTops[u.id] ?? .infinity) < Self.barZone { id = u.id }
        guard let id, !(hereTop < Self.barZone && headBottom > 0) else { return nil }
        return course.units.first { $0.id == id }
    }

    /// Текущее место не первое — тропа открывается сразу на нём.
    private var opensHere: Bool {
        guard let unit = currentUnit(course) else { return false }
        return (course.units.firstIndex { $0.id == unit.id } ?? 0) > 0
    }

    var body: some View {
        ScrollViewReader { proxy in
            ZStack(alignment: .top) {
                TeleTauScroll {
                    TrailContent(course: course, sealed: sealed, busy: busy, onStart: onStart, onReview: onReview, today: today,
                                 onHereTop: { hereTop = $0 }, onHeadBottom: { headBottom = $0 }, onUnitTop: { unitTops[$0] = $1 },
                                 hint: hint, onLocked: showHint, onJump: onJump, fromHere: staticRender && sealed == nil)
                }
                .coordinateSpace(.named(TrailContent.space))
                if let unit = barUnit {
                    UnitBar(unit: unit)
                        .padding(.top, TeleTauSpace.s200)
                        .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(reduceMotion ? nil : .easeOut(duration: TeleTauDuration.base), value: barUnit?.id)
            .animation(reduceMotion ? nil : .easeOut(duration: TeleTauDuration.base), value: hint)
            // После урока тропа открывается на только что запечатанной соте; текущее место не первое — на нём.
            .onAppear {
                if let sealed {
                    DispatchQueue.main.async { proxy.scrollTo(sealed, anchor: .center) }
                } else if opensHere {
                    DispatchQueue.main.async { proxy.scrollTo(TrailContent.hereID, anchor: .top) }
                }
            }
        }
        .onDisappear { hintTask?.cancel() }
    }

    private func showHint(_ node: TrailNode) {
        let text = lockedHint(course, nodeId: node.id)
        hint = TrailHint(node: node.id, text: text)
        AccessibilityNotification.Announcement(text).post()
        hintTask?.cancel()
        hintTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(Self.hintSeconds))
            guard !Task.isCancelled else { return }
            hint = nil
        }
    }
}

/// Липкий баннер места (prototype `.unit-bar`): цвет места, название места и тема.
struct UnitBar: View {
    let unit: CourseUnit

    var body: some View {
        let art = PlaceArt.of(unit.place.slug)
        VStack(alignment: .leading, spacing: TeleTauSpace.s100) {
            placeName(unit.place, size: TeleTauFontSize.caption, weight: TeleTauFontWeight.extrabold, color: TeleTauColor.textOnFill)
                .fixedSize()
                .opacity(0.85)
            Text(unit.topicRu).teletauDisplay(TeleTauFontSize.bodyLarge, TeleTauFontWeight.black)
        }
        .foregroundStyle(TeleTauColor.textOnFill)
        .padding(.vertical, TeleTauSpace.s250)
        .padding(.horizontal, TeleTauSpace.s400)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(art.tone.fill, in: RoundedRectangle(cornerRadius: TeleTauRadius.button, style: .continuous))
        .background {
            RoundedRectangle(cornerRadius: TeleTauRadius.button, style: .continuous).fill(art.tone.lip).offset(y: TeleTauSize.lip)
        }
        .padding(.horizontal, TeleTauSpace.s400)
        .accessibilityHidden(true)
    }
}

/// Шапка текущего места (вместо вывески): картинка-полоса справа растворяется в карточке, слева — название, тема и
/// сколько пройдено, по нижнему краю — тонкая медовая полоса прогресса. Компактная: тропа под ней видна с первого экрана.
struct UnitHead: View {
    let unit: CourseUnit

    var body: some View {
        let art = PlaceArt.of(unit.place.slug)
        let done = unit.nodes.filter { $0.state == .done }.count
        let total = unit.nodes.count
        let shape = RoundedRectangle(cornerRadius: TeleTauRadius.panel, style: .continuous)
        VStack(alignment: .leading, spacing: TeleTauSpace.s050) {
            // Башкирское название и русское рядом; не помещаются в строку — русское уходит вниз.
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: TeleTauSpace.s150) { title(art) }
                VStack(alignment: .leading, spacing: 0) { title(art) }
            }
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text(verbatim: "\(unit.topicRu) · ")
                    .teletauText(TeleTauFontSize.footnote)
                    .foregroundStyle(TeleTauColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(done) из \(total)")
                    .teletauText(TeleTauFontSize.footnote, TeleTauFontWeight.bold)
                    .foregroundStyle(TeleTauColor.accentText)
                    .fixedSize()
            }
        }
        .padding(.top, TeleTauSpace.s250)
        .padding(.horizontal, TeleTauSpace.s400)
        .padding(.bottom, TeleTauSpace.s350)
        // Текст — на спокойной левой части шапки, на рисунок не заходит.
        .modifier(LeadingShare(share: 0.64))
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
        .background(alignment: .trailing) {
            if let hero = art.hero {
                GeometryReader { geo in
                    IllustrationFill(hero, height: geo.size.height, anchor: UnitPoint(x: 0.62, y: 0.58))
                        .frame(width: geo.size.width * 0.56)
                        .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: TeleTauColor.surface, location: 0.46)],
                                             startPoint: .leading, endPoint: .trailing))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
        }
        .background(TeleTauColor.surface)
        .overlay(alignment: .bottom) { HeadProgress(fraction: total > 0 ? CGFloat(done) / CGFloat(total) : 0) }
        .clipShape(shape)
        .overlay { shape.strokeBorder(TeleTauColor.borderSubtle, lineWidth: TeleTauSpace.s050) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(placeLabel), \(unit.topicRu). Пройдено \(done) из \(total)"))
        .accessibilityAddTraits(.isHeader)
    }

    private var placeLabel: String {
        unit.place.titleBa.map { "\($0.text), \(unit.place.titleRu)" } ?? unit.place.titleRu
    }

    @ViewBuilder
    private func title(_ art: PlaceArt) -> some View {
        placeName(unit.place, size: TeleTauFontSize.title3).fixedSize()
        if unit.place.titleBa != nil {
            Text(verbatim: unit.place.titleRu)
                .teletauDisplay(TeleTauFontSize.callout, TeleTauFontWeight.bold)
                .foregroundStyle(TeleTauColor.textTertiary)
                .fixedSize()
        }
    }
}

/// Содержимое занимает долю ширины слева (переносится по ней), а сам блок — всю ширину.
private struct LeadingShare: ViewModifier {
    let share: CGFloat

    func body(content: Content) -> some View {
        LeadingShareLayout(share: share) { content }
    }
}

private struct LeadingShareLayout: Layout {
    let share: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let s = subviews.first else { return .zero }
        guard let width = proposal.width else { return s.sizeThatFits(proposal) }
        let fitted = s.sizeThatFits(ProposedViewSize(width: width * share, height: nil))
        return CGSize(width: width, height: fitted.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width * share, height: bounds.height))
    }
}

/// Сколько пройдено на месте — тонкой медовой полосой по нижнему краю шапки.
private struct HeadProgress: View {
    let fraction: CGFloat

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                TeleTauColor.lockedFill
                if fraction > 0 {
                    UnevenRoundedRectangle(bottomTrailingRadius: 3, topTrailingRadius: 3, style: .continuous)
                        .fill(TeleTauColor.accentFill)
                        .frame(width: geo.size.width * min(1, fraction))
                }
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

/// Юнит на тропе: подложка места, вывеска (у текущего — шапка места) и дорожка с узлами.
struct UnitSection: View {
    let unit: CourseUnit
    /// Текущее место: шапка вместо вывески.
    let here: Bool
    let withBee: Bool
    let sealed: String?
    let busy: String?
    let onStart: @MainActor (TrailNode) -> Void
    var hint: TrailHint?
    var onLocked: @MainActor (TrailNode) -> Void = { _ in }
    var onJump: (@MainActor (CourseUnit) -> Void)?
    var onHeadBottom: @MainActor (CGFloat) -> Void = { _ in }

    var body: some View {
        let art = PlaceArt.of(unit.place.slug)
        // Под шапкой тропинка начинается сразу; у первого текущего узла — запас под пузырь «Начать» (не наезжает на шапку).
        let trackTop: CGFloat = here ? (unit.nodes.first?.state == .current ? 56 : TeleTauSpace.s200) : 34
        VStack(spacing: 0) {
            if here {
                // Над дорожкой: тропинка выходит из-под шапки.
                UnitHead(unit: unit)
                    .onGeometryChange(for: CGFloat.self) { $0.frame(in: .named(TrailContent.space)).maxY } action: { onHeadBottom($0) }
                    .zIndex(1)
            } else {
                PlaceSign(unit: unit)
            }
            if unit.jump != nil, let onJump {
                // Над дорожкой: тропинка начинается чуть выше первого узла и уходит под кнопку.
                JumpOffer(unit: unit, busy: busy == NodeRef.jump(unit).id, onJump: onJump)
                    .padding(.top, TeleTauSpace.s400)
                    .zIndex(1)
            }
            TrackView(unit: unit, withBee: withBee, sealed: sealed, busy: busy, onStart: onStart, hint: hint, onLocked: onLocked)
                .padding(.top, trackTop)
        }
        .padding(.top, TeleTauSpace.s250)
        .padding(.horizontal, TeleTauSpace.s250)
        .padding(.bottom, TeleTauSpace.s200)
        .frame(maxWidth: .infinity)
        .background(art.tone.zone)
        .clipShape(RoundedRectangle(cornerRadius: TeleTauRadius.sheet, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Место \(unit.order) · \(unit.place.titleRu) · \(unit.topicRu)"))
    }
}

/// Вывеска места (prototype `.place-sign`): картинка-вывеска с чипом «Место 2», названием и темой.
struct PlaceSign: View {
    let unit: CourseUnit

    var body: some View {
        let art = PlaceArt.of(unit.place.slug)
        // Место, которое можно открыть испытанием, тоже закрыто: юнит открыт, но уроки перед ним не пройдены.
        let locked = unit.state == .locked || unit.jump != nil
        let allDone = !unit.nodes.isEmpty && unit.nodes.allSatisfy { $0.state == .done }
        let ink = art.signOnDark ? TeleTauColor.highlight : TeleTauColor.textOnFill
        Group {
            if let sign = art.sign {
                IllustrationView(sign)
            } else {
                TeleTauColor.accentSoft.frame(minHeight: 120)
            }
        }
        // Текст — накладкой на картинку: размер вывески задаёт картинка, углы обрезаются по ней.
        .overlay(alignment: .leading) {
            GeometryReader { geo in
                VStack(alignment: .leading, spacing: TeleTauSpace.s150) {
                    HStack(spacing: TeleTauSpace.s150) {
                        if locked { IconView(.lockSimple, size: 15) } else if allDone { IconView(.check, size: 15) }
                        Text("Место \(unit.order)").teletauDisplay(TeleTauFontSize.label, TeleTauFontWeight.extrabold)
                    }
                    .foregroundStyle(TeleTauColor.textOnFill)
                    .padding(.vertical, 5)
                    .padding(.horizontal, 11)
                    .background(TeleTauColor.highlight, in: Capsule())
                    placeName(unit.place, size: TeleTauFontSize.title3, color: art.sign == nil ? TeleTauColor.textPrimary : ink)
                    Text(unit.topicRu).teletauDisplay(TeleTauFontSize.headline, TeleTauFontWeight.extrabold)
                        .foregroundStyle(art.sign == nil ? TeleTauColor.textPrimary : ink)
                        .minimumScaleFactor(0.7)
                }
                .frame(width: geo.size.width * 0.42, height: geo.size.height, alignment: .leading)
                .padding(.leading, TeleTauSpace.s350)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: TeleTauRadius.panel, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Место \(unit.order)\(locked ? ", закрыто" : ""): \(unit.place.titleRu), \(unit.topicRu)"))
        .accessibilityAddTraits(.isHeader)
    }
}

/// «Уже знаешь?» под вывеской закрытого места (`CourseUnit.jump`): испытание открывает место без уроков перед ним.
struct JumpOffer: View {
    let unit: CourseUnit
    let busy: Bool
    let onJump: @MainActor (CourseUnit) -> Void

    var body: some View {
        VStack(spacing: TeleTauSpace.s250) {
            Text("Уже знаешь?")
                .teletauDisplay(TeleTauFontSize.headline, TeleTauFontWeight.black)
                .foregroundStyle(TeleTauColor.textPrimary)
            TeleTauButton("Пройти испытание", icon: .trophy, variant: .secondary, loading: busy) { onJump(unit) }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, TeleTauSpace.s200)
    }
}

/// Дорожка юнита: нарисованная тропинка (медовая там, где пройдено, песочная — впереди), декорации места,
/// узлы змейкой с подписями, пузырь «Начать» и пчела у текущего узла.
struct TrackView: View {
    let unit: CourseUnit
    let withBee: Bool
    let sealed: String?
    let busy: String?
    let onStart: @MainActor (TrailNode) -> Void
    var hint: TrailHint?
    var onLocked: @MainActor (TrailNode) -> Void = { _ in }
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let nodes = unit.nodes
        let cur = nodes.firstIndex { $0.state == .current } ?? -1
        let gapAt = cur > 0 ? cur : -1
        let height = TrackGeometry.rowTop(nodes.count, gapAt: gapAt)
        let mid = TrackGeometry.width / 2
        let art = PlaceArt.of(unit.place.slug)
        var pts: [CGPoint] = [CGPoint(x: mid, y: -48)]
        for i in nodes.indices { pts.append(CGPoint(x: mid + TrackGeometry.offset(i), y: TrackGeometry.rowTop(i, gapAt: gapAt) + TrackGeometry.nodeMid)) }
        pts.append(CGPoint(x: mid, y: height - 20))
        let lastDone = nodes.lastIndex { $0.state == .done } ?? -1
        let allDone = !nodes.isEmpty && lastDone == nodes.count - 1
        let walked = allDone ? pts.count - 1 : cur >= 0 ? cur + 1 : lastDone >= 0 ? lastDone + 1 : 0

        return ZStack(alignment: .topLeading) {
            if walked < pts.count - 1 {
                Road(points: Array(pts[walked...]), walked: false)
            }
            if walked > 0 {
                Road(points: Array(pts[...walked]), walked: true)
            }
            ForEach(Array(art.decos.enumerated()), id: \.offset) { _, d in
                if d.y < height + 40 {
                    IllustrationView(d.art, width: d.w)
                        .scaleEffect(x: d.flip ? -1 : 1, y: 1)
                        .rotationEffect(.degrees(d.rot))
                        .position(x: mid + d.x, y: d.y)
                }
            }
            if withBee, cur >= 0 {
                let x = TrackGeometry.offset(cur)
                let beeW: CGFloat = 92
                let beeH = beeW / IllustrationStore.aspect(.beeIdle)
                IllustrationView(.beeIdle, width: beeW)
                    .floating(reduceMotion: reduceMotion)
                    .position(x: mid + x + (x <= 0 ? 92 : -92), y: TrackGeometry.rowTop(cur, gapAt: gapAt) + TrackGeometry.nodeMid - beeH * 0.58 + beeH / 2)
            }
            ForEach(Array(nodes.enumerated()), id: \.element.id) { i, node in
                NodeCell(node: node, index: i, sealed: sealed == node.id, disabled: busy != nil, onStart: onStart,
                         hint: hint?.node == node.id ? hint?.text : nil, onLocked: onLocked)
                    .id(node.id)
                    .zIndex(hint?.node == node.id ? 1 : 0)
                    .position(x: mid + TrackGeometry.offset(i), y: TrackGeometry.rowTop(i, gapAt: gapAt) + (HexNode.height + HexNode.lip) / 2)
            }
        }
        .frame(width: TrackGeometry.width, height: height)
        .frame(maxWidth: .infinity)
    }
}

/// Тропинка: широкая полупрозрачная основа и пунктир по ней (cubic-кривые между узлами, как в вебе).
struct Road: View {
    let points: [CGPoint]
    let walked: Bool

    var body: some View {
        let path = Path { p in
            guard let first = points.first else { return }
            p.move(to: first)
            for (a, b) in zip(points, points.dropFirst()) {
                let dy = b.y - a.y
                p.addCurve(to: b, control1: CGPoint(x: a.x, y: a.y + dy / 2), control2: CGPoint(x: b.x, y: b.y - dy / 2))
            }
        }
        ZStack {
            path.stroke(walked ? TeleTauColor.accentFill.opacity(0.38) : TeleTauColor.textTertiary.opacity(0.12),
                        style: StrokeStyle(lineWidth: 30, lineCap: .round))
            path.stroke(walked ? TeleTauColor.accentLip.opacity(0.85) : TeleTauColor.textTertiary.opacity(0.3),
                        style: StrokeStyle(lineWidth: 4, lineCap: .round, dash: [1, 13]))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// Узел тропы с подписью и, у текущего, пузырём «Начать».
struct NodeCell: View {
    let node: TrailNode
    let index: Int
    let sealed: Bool
    let disabled: Bool
    let onStart: @MainActor (TrailNode) -> Void
    /// Нажали закрытый узел — пузырь «Сначала пройди «…»» над ним.
    var hint: String?
    var onLocked: @MainActor (TrailNode) -> Void = { _ in }
    @State private var shakes = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// «Штамп» только что запечатанной ячейки (docs/05 §9).
    @State private var stamp: CGFloat = 1

    static let iconCycle: [TeleTauIcon] = [.star, .chatCircleText, .bookOpen, .barbell]

    var icon: TeleTauIcon {
        if node.kind == .helpLanguage { return .scales }
        if node.kind == .placeTest { return node.state == .done ? .check : .trophy }
        if node.state == .done { return .check }
        switch node.icon {
        case .star: return .star
        case .chatCircleText: return .chatCircleText
        case .bookOpen: return .bookOpen
        case .barbell: return .barbell
        case nil: return Self.iconCycle[index % Self.iconCycle.count]
        }
    }

    var state: HexNodeState {
        switch node.state {
        case .done: .done
        case .current: .current
        case .open: .open
        case .locked: .locked
        }
    }

    var label: String {
        let what = node.kind == .lesson ? "Урок «\(node.titleRu)»" : node.titleRu
        switch node.state {
        case .current: return "\(what) — начать"
        case .done: return node.passedByTest == true ? "\(what), пройден испытанием" : "\(what), пройден"
        case .open: return "\(what), доступен"
        case .locked: return "\(what), закрыт"
        }
    }

    var body: some View {
        let hex = HexNode(state: state, violet: node.kind == .helpLanguage, icon: icon)
        // Подпись и пузырь — накладками: размер узла (78×75) не меняется, ряды тропы не съезжают.
        Group {
            if node.state == .locked {
                // Закрытый узел не начинает урок: качается и подсказывает, что пройти сначала.
                Button {
                    shakes += 1
                    onLocked(node)
                } label: { hex }
                    .buttonStyle(.plain)
                    .modifier(Shake(phase: reduceMotion ? 0 : CGFloat(shakes)))
                    .animation(reduceMotion ? nil : .linear(duration: TeleTauDuration.slow), value: shakes)
                    .sensoryFeedback(.warning, trigger: shakes)
            } else {
                Button { onStart(node) } label: { hex }
                    .buttonStyle(HexNodeButtonStyle())
                    .disabled(disabled)
                    .sensoryFeedback(.impact(weight: .light), trigger: sealed)
            }
        }
        .frame(width: HexNode.width, height: HexNode.height + HexNode.lip, alignment: .top)
        .overlay(alignment: .top) {
            Text(node.titleRu)
                .teletauDisplay(node.state == .current ? TeleTauFontSize.footnote : TeleTauFontSize.label, TeleTauFontWeight.extrabold)
                .foregroundStyle(node.state == .current ? TeleTauColor.accentText : TeleTauColor.textSecondary)
                .fixedSize()
                .offset(y: 81)
                .accessibilityHidden(true)
        }
        .overlay(alignment: .top) {
            if node.state == .current {
                StartBubble()
                    .bobbing(reduceMotion: reduceMotion)
                    .fixedSize()
                    // Над узлом: низ пузыря — у верха ячейки (нулевая рамка у верха, пузырь растёт вверх).
                    .frame(height: 0, alignment: .bottom)
                    .offset(y: -TeleTauSpace.s150)
                    .accessibilityHidden(true)
            }
        }
        .overlay(alignment: .top) {
            if let hint {
                LockedHint(text: hint, shift: LockedHint.shift(TrackGeometry.offset(index)))
                    .fixedSize()
                    .frame(height: 0, alignment: .bottom)
                    .offset(y: -TeleTauSpace.s250)
                    .transition(.opacity)
            }
        }
        .zIndex(hint == nil ? 0 : 1)
        .scaleEffect(stamp)
        .onAppear {
            guard sealed, !reduceMotion else { return }
            stamp = 0.7
            withAnimation(.spring(duration: TeleTauDuration.slow, bounce: 0.5)) { stamp = 1 }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(Text(hint ?? ""))
        .accessibilityAction { if node.state == .locked { onLocked(node) } else { onStart(node) } }
    }
}

/// Пузырь «Начать» над текущим узлом.
struct StartBubble: View {
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: TeleTauRadius.tile, style: .continuous)
        Text("Начать")
            .teletauDisplay(TeleTauFontSize.body, TeleTauFontWeight.black)
            .tracking(0.3)
            .foregroundStyle(TeleTauColor.accentText)
            .padding(.vertical, TeleTauSpace.s250)
            .padding(.horizontal, TeleTauSpace.s400)
            .background(TeleTauColor.surface, in: shape)
            .overlay { shape.strokeBorder(TeleTauColor.borderDefault, lineWidth: TeleTauSpace.s050) }
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(TeleTauColor.surface)
                    .frame(width: 12, height: 12)
                    .overlay(alignment: .bottomTrailing) {
                        Rectangle().fill(TeleTauColor.borderDefault).frame(width: 12, height: TeleTauSpace.s050)
                    }
                    .overlay(alignment: .trailing) {
                        Rectangle().fill(TeleTauColor.borderDefault).frame(width: TeleTauSpace.s050, height: 12)
                    }
                    .rotationEffect(.degrees(45))
                    .offset(y: 7)
            }
    }
}

/// Конец тропы: «Впереди ещё 2 места».
struct PathEnd: View {
    let course: Course
    let unit: CourseUnit?
    @Environment(\.teletauMode) private var mode

    var body: some View {
        let index = unit.flatMap { u in course.units.firstIndex { $0.id == u.id } } ?? -1
        let ahead = index >= 0 ? course.units.count - index - 1 : course.units.filter { $0.state == .locked }.count
        if ahead > 0 {
            VStack(spacing: TeleTauSpace.s250) {
                if mode.showsMascot { IllustrationView(.beeFly, width: 120) }
                Text("Впереди ещё \(ahead) \(Format.plural(ahead, ("место", "места", "мест")))")
                    .teletauDisplay(TeleTauFontSize.headline, TeleTauFontWeight.black)
                    .foregroundStyle(TeleTauColor.textPrimary)
            }
            .padding(.top, TeleTauSpace.s1000)
            .padding(.bottom, TeleTauSpace.s300)
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Движение

extension View {
    /// Пчела плавает вверх-вниз (`duration.float`); при «Уменьшении движения» — неподвижна.
    func floating(reduceMotion: Bool) -> some View {
        modifier(LoopMotion(enabled: !reduceMotion, duration: TeleTauDuration.float, offset: -TeleTauSpace.s150))
    }

    /// Пузырь «Начать» подпрыгивает (`duration.bob`).
    func bobbing(reduceMotion: Bool) -> some View {
        modifier(LoopMotion(enabled: !reduceMotion, duration: TeleTauDuration.bob, offset: -TeleTauSpace.s100))
    }
}

struct LoopMotion: ViewModifier {
    let enabled: Bool
    let duration: Double
    let offset: CGFloat
    @State private var up = false
    @Environment(\.teletauStaticRender) private var staticRender

    func body(content: Content) -> some View {
        content
            .offset(y: up ? offset : 0)
            .onAppear {
                guard enabled, !staticRender else { return }
                withAnimation(.timingCurve(TeleTauEasing.inOut, duration: duration / 2).repeatForever(autoreverses: true)) { up = true }
            }
    }
}

/// «Повторить N слов» в словаре: слова из пройденных уроков, срок которых наступил. Кнопка начинает короткое повторение.
struct ReviewCard: View {
    let due: Int
    let onReview: @MainActor () -> Void

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: TeleTauRadius.card, style: .continuous)
        VStack(spacing: TeleTauSpace.s300) {
            HStack(spacing: TeleTauSpace.s300) {
                IllustrationView(.beeRead, width: 60)
                Text(ReviewText.title(due))
                    .teletauDisplay(TeleTauFontSize.headline, TeleTauFontWeight.black)
                    .foregroundStyle(TeleTauColor.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            TeleTauButton("Начать", icon: .arrowsClockwise, action: onReview)
        }
        .padding(.top, TeleTauSpace.s300)
        .padding(.horizontal, TeleTauSpace.s400)
        .padding(.bottom, TeleTauSpace.s400)
        .background(TeleTauColor.accentSoft, in: shape)
        .overlay { shape.strokeBorder(TeleTauColor.accentSoftBorder, lineWidth: TeleTauSpace.s050) }
        .padding(.top, TeleTauSpace.s350)
    }
}

enum ReviewText {
    /// «Повторить 1 слово», «Повторить 2 слова», «Повторить 5 слов».
    static func title(_ due: Int) -> String { "Повторить \(due) \(Format.plural(due, ("слово", "слова", "слов")))" }
}

/// Плашки «на сегодня» над текущим местом: задания учителя (ADR 0021) и повторение слов — по строке, нажатие начинает
/// урок. Выполненное задание — зелёная строка с галочкой. Просроченных сервер не отдаёт — ребёнка не торопим и не стыдим.
struct TodayPills: View {
    let course: Course
    let due: Int
    let busy: String?
    let today: String
    let onStart: @MainActor (TrailNode) -> Void
    let onReview: (@MainActor () -> Void)?

    private var tasks: [Components.Schemas.StudentAssignment] { (course.assignments ?? []).sorted { !$0.done && $1.done } }
    private var review: (@MainActor () -> Void)? { due > 0 ? onReview : nil }

    var isEmpty: Bool { tasks.isEmpty && review == nil }

    /// Заданный урок ещё закрыт — плашка без действия (учитель откроет его сам).
    private func startAction(_ a: Components.Schemas.StudentAssignment, _ node: TrailNode?) -> (@MainActor () -> Void)? {
        if a.kind == .review { return onReview }
        guard let node, node.state != .locked else { return nil }
        return { onStart(node) }
    }

    var body: some View {
        let nodes = course.units.flatMap(\.nodes)
        if !isEmpty {
            VStack(spacing: TeleTauSpace.s200) {
                ForEach(tasks, id: \.id) { a in
                    if a.done {
                        TodayPill(tone: .done, icon: .checkCircle, kicker: "Задание учителя выполнено", title: AssignmentText.title(a))
                    } else {
                        let node = a.lessonId.flatMap { id in nodes.first { $0.id == id } }
                        let start = startAction(a, node)
                        TodayPill(tone: .task, icon: .chalkboardTeacher, kicker: "Задание учителя · \(AssignmentText.due(a.dueOn, today: today))",
                                  title: AssignmentText.title(a), busy: node.map { busy == $0.id } ?? false, action: start)
                    }
                }
                if let review {
                    TodayPill(tone: .review, icon: .arrowsClockwise, title: ReviewText.title(due), action: review)
                }
            }
        }
    }
}

/// Плашка «на сегодня»: значок, что сделать и «Начать» справа; вся строка — кнопка с «губой».
struct TodayPill: View {
    enum Tone { case task, review, done }

    let tone: Tone
    let icon: TeleTauIcon
    var kicker: String?
    let title: String
    var busy = false
    var action: (@MainActor () -> Void)?

    private var edge: Color {
        switch tone {
        case .task: TeleTauColor.infoFill
        case .review: TeleTauColor.accentSoftBorder
        case .done: TeleTauColor.successFill
        }
    }

    private var fill: Color {
        switch tone {
        case .task: TeleTauColor.infoSoft
        case .review: TeleTauColor.accentSoft
        case .done: TeleTauColor.successSoft
        }
    }

    var body: some View {
        if let action {
            Button { if !busy { action() } } label: { row(go: true) }
                .buttonStyle(TodayPillStyle(edge: edge, fill: fill))
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text([kicker, title].compactMap { $0 }.joined(separator: ". ")))
                .accessibilityHint(Text("Начать"))
                .accessibilityAddTraits(busy ? .updatesFrequently : [])
        } else {
            row(go: false)
                .background(fill, in: Self.shape)
                .overlay { Self.shape.strokeBorder(edge, lineWidth: TeleTauSpace.s050) }
                .accessibilityElement(children: .combine)
        }
    }

    static let shape = RoundedRectangle(cornerRadius: TeleTauRadius.button, style: .continuous)

    private func row(go: Bool) -> some View {
        HStack(spacing: TeleTauSpace.s300) {
            badge
            VStack(alignment: .leading, spacing: TeleTauSpace.s050) {
                if let kicker {
                    Text(kicker)
                        .teletauDisplay(TeleTauFontSize.label, TeleTauFontWeight.extrabold)
                        .foregroundStyle(tone == .done ? TeleTauColor.successText : TeleTauColor.infoText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(title)
                    .teletauDisplay(TeleTauFontSize.body, TeleTauFontWeight.black)
                    .foregroundStyle(TeleTauColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if go { goButton }
        }
        .padding(.vertical, TeleTauSpace.s100)
        .padding(.leading, TeleTauSpace.s150)
        .padding(.trailing, TeleTauSpace.s200)
        .frame(minHeight: 48)
    }

    @ViewBuilder private var badge: some View {
        if tone == .done {
            IconView(icon, size: 32).foregroundStyle(TeleTauColor.successFill)
        } else {
            IconView(icon, size: TeleTauSize.iconSmall)
                .foregroundStyle(tone == .task ? TeleTauColor.textOnFill : TeleTauColor.accentOn)
                .frame(width: 32, height: 32)
                .background(tone == .task ? TeleTauColor.infoFill : TeleTauColor.accentFill,
                            in: RoundedRectangle(cornerRadius: TeleTauRadius.small, style: .continuous))
        }
    }

    private var goButton: some View {
        let shape = RoundedRectangle(cornerRadius: TeleTauRadius.tile, style: .continuous)
        return Group {
            if busy {
                ProgressView().controlSize(.small).tint(TeleTauColor.accentOn)
            } else {
                Text("Начать").teletauDisplay(TeleTauFontSize.callout, TeleTauFontWeight.black)
            }
        }
        .foregroundStyle(TeleTauColor.accentOn)
        .padding(.horizontal, TeleTauSpace.s300)
        .frame(minWidth: 72, minHeight: 32)
        .background(TeleTauColor.accentFill, in: shape)
        .padding(.bottom, TeleTauSize.lipSmall)
        .background { shape.fill(TeleTauColor.accentLip).padding(.top, TeleTauSize.lipSmall) }
        .padding(.top, TeleTauSize.lipSmall)
    }
}

/// Нажатие плашки: строка опускается на «губу».
private struct TodayPillStyle: ButtonStyle {
    let edge: Color
    let fill: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        let shape = TodayPill.shape
        let sunk = configuration.isPressed
        configuration.label
            .background(fill, in: shape)
            .overlay { shape.strokeBorder(edge, lineWidth: TeleTauSpace.s050) }
            .offset(y: sunk ? TeleTauSize.lipSmall : 0)
            .padding(.bottom, TeleTauSize.lipSmall)
            .background { shape.fill(edge).padding(.top, TeleTauSize.lipSmall) }
            .contentShape(shape)
            .animation(reduceMotion ? nil : .easeOut(duration: TeleTauDuration.press), value: sunk)
    }
}

/// Покачивание закрытого узла (`duration.shake`): три коротких колебания по горизонтали.
struct Shake: GeometryEffect {
    var phase: CGFloat
    var animatableData: CGFloat {
        get { phase }
        set { phase = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 6 * sin(phase * .pi * 6), y: 0))
    }
}

/// Пузырь над закрытым узлом: «Сначала пройди «Моя школа»» (тёмный, с замком и хвостиком к узлу).
/// У краёв змейки пузырь сдвинут к середине, чтобы не уйти за экран; хвостик остаётся у узла.
struct LockedHint: View {
    let text: String
    var shift: CGFloat = 0

    static func shift(_ offset: CGFloat) -> CGFloat {
        offset == 0 ? 0 : (abs(offset) > 70 ? 44 : 24) * (offset < 0 ? 1 : -1)
    }

    var body: some View {
        CappedWidth(max: 220) {
            HStack(spacing: TeleTauSpace.s150) {
                IconView(.lockSimple, size: 16)
                Text(text)
                    .teletauDisplay(TeleTauFontSize.footnote, TeleTauFontWeight.extrabold)
                    .lineSpacing(TeleTauFontSize.footnote * (TeleTauLineHeight.snug - 1))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, TeleTauSpace.s250)
            .padding(.horizontal, TeleTauSpace.s350)
        }
        .foregroundStyle(TeleTauColor.bg)
        .background(TeleTauColor.textPrimary, in: RoundedRectangle(cornerRadius: TeleTauRadius.tile, style: .continuous))
        .overlay(alignment: .bottom) {
            Rectangle().fill(TeleTauColor.textPrimary).frame(width: 12, height: 12).rotationEffect(.degrees(45))
                .offset(x: -shift, y: 6)
        }
        .offset(x: shift)
        .accessibilityHidden(true)
    }
}

/// Ширина по содержимому, но не больше `max`: длинный текст переносится.
struct CappedWidth: Layout {
    let max: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let s = subviews.first else { return .zero }
        let width = min(s.sizeThatFits(.unspecified).width, max)
        return s.sizeThatFits(ProposedViewSize(width: width, height: nil))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: bounds.height))
    }
}

/// Подсказка у закрытого узла: какой урок пройти сначала.
func lockedHint(_ course: Course, nodeId: String) -> String {
    let all = course.units.flatMap(\.nodes)
    guard let i = all.firstIndex(where: { $0.id == nodeId }), i > 0 else { return "Сначала пройди предыдущие уроки" }
    let before = all[i - 1]
    if before.state == .current || before.state == .open { return "Сначала пройди «\(before.titleRu)»" }
    return "Сначала пройди предыдущие уроки"
}
