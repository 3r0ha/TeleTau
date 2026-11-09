import DesignSystem
import SwiftUI
import TeleTauAPI
import TeleTauSession

// Награды (порт Achievements.tsx веба): сота-значок, блок «Награды» в профиле, лист подробностей, экран «Новая награда!».
// Набор наград и тексты приходят с сервера; клиент только показывает их.

// MARK: - Значок и тон

/// Тон соты награды: полученная — цвет по значку (заливки токенов, как у сот тропы и счётчиков профиля), иначе — воск.
enum AwardTone: Equatable {
    case honey, streak, green, water, violet, locked

    /// Тон по значку (`AchievementIcon`); незнакомый значок — мёд.
    static func of(_ a: Achievement) -> AwardTone {
        guard a.earnedOn != nil else { return .locked }
        return switch a.icon {
        case "fire": .streak
        case "seal-check", "map-pin", "flag-banner": .green
        case "book-open", "books": .water
        case "scales": .violet
        default: .honey
        }
    }

    var face: Color {
        switch self {
        case .honey: TeleTauColor.accentFill
        case .streak: TeleTauColor.streakFill
        case .green: TeleTauColor.successFill
        case .water: TeleTauColor.infoFill
        case .violet: TeleTauColor.violetBright
        case .locked: TeleTauColor.lockedFill
        }
    }

    var lip: Color {
        switch self {
        case .honey: TeleTauColor.accentLip
        case .streak: TeleTauColor.streakLip
        case .green: TeleTauColor.successLip
        case .water: TeleTauColor.infoLip
        case .violet: TeleTauColor.violetLip
        case .locked: TeleTauColor.lockedLip
        }
    }

    var ink: Color {
        switch self {
        case .honey: TeleTauColor.accentOn
        case .streak, .green, .water: TeleTauColor.textOnFill
        case .violet: TeleTauColor.violetOn
        case .locked: TeleTauColor.lockedText
        }
    }

    /// Ореол крупной соты.
    var soft: Color {
        switch self {
        case .honey, .locked: TeleTauColor.accentSoft
        case .streak: TeleTauColor.streakSoft
        case .green: TeleTauColor.successSoft
        case .water: TeleTauColor.infoSoft
        case .violet: TeleTauColor.violetSoft
        }
    }
}

extension Achievement {
    /// Значок награды — иконка Phosphor; незнакомый — звезда.
    var badgeIcon: TeleTauIcon {
        switch icon {
        case "footprints": .footprints
        case "seal-check": .sealCheck
        case "fire": .fire
        case "target": .target
        case "book-open": .bookOpen
        case "books": .books
        case "scales": .scales
        case "map-pin": .mapPin
        case "flag-banner": .flagBanner
        default: .star
        }
    }

    var earned: Bool { earnedOn != nil }

    /// Для VoiceOver: «7 дней подряд, получена 5 ноября» / «7 дней подряд, 5 из 7» / «…, ещё не получена».
    var spokenLabel: String {
        if let earnedOn { return "\(titleRu), получена \(Format.dayLong(earnedOn))" }
        if target > 1 { return "\(titleRu), \(progress) из \(target)" }
        return "\(titleRu), ещё не получена"
    }
}

/// Размер соты-значка: плитка профиля, лист подробностей, экран «Новая награда!». Пропорции — как узел тропы (HexNode).
enum AwardBadgeSize {
    case tile, medium, hero

    var width: CGFloat { switch self { case .tile: 64; case .medium: 96; case .hero: 140 } }
    var height: CGFloat { switch self { case .tile: 56; case .medium: 84; case .hero: 122 } }
    var lip: CGFloat { switch self { case .tile: 6; case .medium: 8; case .hero: 10 } }
    var radius: CGFloat { switch self { case .tile: 11; case .medium: 15; case .hero: 22 } }
    var icon: CGFloat { switch self { case .tile: 28; case .medium: 42; case .hero: 62 } }

    var ribbonFont: CGFloat {
        switch self {
        case .tile: TeleTauFontSize.caption
        case .medium: TeleTauFontSize.footnote
        case .hero: TeleTauFontSize.body
        }
    }

    var ribbonMinWidth: CGFloat { switch self { case .tile: 26; case .medium: 32; case .hero: 40 } }

    var ribbonPadding: EdgeInsets {
        switch self {
        case .tile: EdgeInsets(top: TeleTauSpace.s050, leading: TeleTauSpace.s150, bottom: TeleTauSpace.s050, trailing: TeleTauSpace.s150)
        case .medium: EdgeInsets(top: TeleTauSpace.s050, leading: TeleTauSpace.s200, bottom: TeleTauSpace.s050, trailing: TeleTauSpace.s200)
        case .hero: EdgeInsets(top: TeleTauSpace.s100, leading: TeleTauSpace.s250, bottom: TeleTauSpace.s100, trailing: TeleTauSpace.s250)
        }
    }

    /// Насколько лента с числом выступает под соту (место под неё оставляет родитель).
    var ribbonDrop: CGFloat { self == .hero ? TeleTauSpace.s150 : TeleTauSpace.s100 }
}

/// Сота-значок награды: полученная — цветная с бликом, ещё нет — воск. У наград с числом (`target` > 1) — лента
/// с числом поверх нижнего края. Крупная полученная — с ореолом из двух сот. `rise` — сота поднимается с пружиной,
/// по ней проходит блик (без анимации при «Уменьшении движения» и в рендере снимков).
struct AwardBadge: View {
    static let halo = CGSize(width: 260, height: 226)
    /// Длина штриха блика и промежутка: на соте виден один-два коротких штриха.
    static let shineDash: [CGFloat] = [16, 200]

    let achievement: Achievement
    var size: AwardBadgeSize = .tile
    var rise = false
    /// Задержка подъёма в ряду из нескольких сот.
    var riseDelay: Double = 0

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.teletauStaticRender) private var staticRender
    @State private var risen = false
    @State private var glint: CGFloat = 0

    private var animates: Bool { rise && !reduceMotion && !staticRender }

    var body: some View {
        let tone = AwardTone.of(achievement)
        let w = size.width, h = size.height, r = size.radius
        let up = risen || !animates
        ZStack(alignment: .topLeading) {
            RoundedHex(cornerRadius: r).fill(tone.lip)
                .frame(width: w, height: h)
                .offset(y: size.lip)
            RoundedHex(cornerRadius: r).fill(tone.face)
                .frame(width: w, height: h)
            if tone != .locked {
                RoundedHex(cornerRadius: r * 0.6)
                    .stroke(TeleTauColor.highlight.opacity(0.4),
                            style: StrokeStyle(lineWidth: 3, lineCap: .round, dash: Self.shineDash, dashPhase: glint))
                    .frame(width: w - r * 2, height: h - r * 2)
                    .offset(x: r, y: r * 0.7)
            }
            IconView(achievement.badgeIcon, size: size.icon)
                .foregroundStyle(tone.ink)
                .frame(width: w, height: h)
        }
        .frame(width: w, height: h + size.lip, alignment: .topLeading)
        .overlay(alignment: .bottom) {
            if achievement.target > 1 {
                ribbon(tone).offset(y: size.ribbonDrop)
            }
        }
        .background(alignment: .top) {
            if size == .hero, tone != .locked {
                ZStack {
                    RoundedHex(cornerRadius: 40).fill(tone.soft.opacity(0.55))
                        .frame(width: Self.halo.width, height: Self.halo.height)
                    RoundedHex(cornerRadius: 32).fill(tone.soft)
                        .frame(width: Self.halo.width - 56, height: Self.halo.height - 48)
                }
                .frame(width: Self.halo.width, height: Self.halo.height)
                .offset(y: h / 2 - Self.halo.height / 2)
            }
        }
        .scaleEffect(up ? 1 : 0.55, anchor: .bottom)
        .offset(y: up ? 0 : 40)
        .opacity(up ? 1 : 0)
        .accessibilityHidden(true)
        .onAppear {
            guard animates, !risen else { return }
            withAnimation(.timingCurve(TeleTauEasing.spring, duration: TeleTauDuration.rise).delay(TeleTauDuration.slow + riseDelay)) { risen = true }
            withAnimation(.timingCurve(TeleTauEasing.inOut, duration: TeleTauDuration.glint).delay(TeleTauDuration.slow + riseDelay + TeleTauDuration.rise)) {
                glint = -Self.shineDash.reduce(0, +)
            }
        }
    }

    private func ribbon(_ tone: AwardTone) -> some View {
        Text("\(achievement.target)")
            .teletauDisplay(size.ribbonFont, TeleTauFontWeight.black)
            .monospacedDigit()
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(tone == .locked ? TeleTauColor.textTertiary : TeleTauColor.textPrimary)
            .padding(size.ribbonPadding)
            .frame(minWidth: size.ribbonMinWidth)
            .background(TeleTauColor.surface, in: Capsule())
            .overlay { Capsule().strokeBorder(tone.lip, lineWidth: TeleTauSpace.s050) }
            // Число дублирует подпись: при крупном шрифте лента не растёт дальше соты.
            .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }
}

// MARK: - «Награды» в профиле

/// «Награды» в профиле: сетка сот по 3 в ряд (при крупном шрифте — по 2, при очень крупном — списком).
/// Полученные — цветные с днём, остальные — воском с прогрессом. Нажатие открывает лист подробностей.
struct AchievementsCard: View {
    let data: MyAchievements
    let onOpen: @MainActor (Achievement) -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    private var columns: Int {
        if typeSize >= .accessibility3 { return 1 }
        return typeSize.isAccessibilitySize ? 2 : 3
    }

    var body: some View {
        let list = data.achievements
        let columns = columns
        VStack(alignment: .leading, spacing: TeleTauSpace.s300) {
            HStack(alignment: .firstTextBaseline, spacing: TeleTauSpace.s200) {
                Text("Награды")
                    .teletauDisplay(TeleTauFontSize.headline, TeleTauFontWeight.black)
                    .foregroundStyle(TeleTauColor.textPrimary)
                Spacer(minLength: 0)
                Text("\(data.earned) из \(data.total)")
                    .teletauText(TeleTauFontSize.footnote, TeleTauFontWeight.bold)
                    .monospacedDigit()
                    .foregroundStyle(TeleTauColor.textSecondary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            VStack(spacing: columns == 1 ? TeleTauSpace.s200 : TeleTauSpace.s300) {
                ForEach(Array(stride(from: 0, to: list.count, by: columns)), id: \.self) { start in
                    HStack(alignment: .top, spacing: TeleTauSpace.s150) {
                        ForEach(list[start..<min(start + columns, list.count)], id: \.id) { a in
                            AwardTile(achievement: a, row: columns == 1) { onOpen(a) }
                        }
                        ForEach(0..<(columns - min(columns, list.count - start)), id: \.self) { _ in
                            Color.clear.frame(maxWidth: .infinity, maxHeight: 0)
                        }
                    }
                }
            }
        }
        .teletauCard()
        .accessibilityElement(children: .contain)
    }
}

/// Плитка награды: сота, название и день получения или прогресс. `row` — сота слева, текст справа (очень крупный шрифт).
struct AwardTile: View {
    let achievement: Achievement
    var row = false
    let action: @MainActor () -> Void

    var body: some View {
        let a = achievement
        Button(action: action) {
            Group {
                if row {
                    HStack(spacing: TeleTauSpace.s400) {
                        AwardBadge(achievement: a).padding(.bottom, TeleTauSpace.s150)
                        VStack(alignment: .leading, spacing: TeleTauSpace.s100) { texts }
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .multilineTextAlignment(.leading)
                } else {
                    VStack(spacing: TeleTauSpace.s100) {
                        AwardBadge(achievement: a).padding(.bottom, TeleTauSpace.s150)
                        texts
                    }
                    .multilineTextAlignment(.center)
                }
            }
            .padding(.top, TeleTauSpace.s150)
            .padding(.horizontal, TeleTauSpace.s050)
            .padding(.bottom, TeleTauSpace.s100)
            .frame(maxWidth: .infinity, alignment: row ? .leading : .top)
            .contentShape(RoundedRectangle(cornerRadius: TeleTauRadius.tile, style: .continuous))
        }
        .buttonStyle(AwardTileButtonStyle())
        .accessibilityLabel(Text(a.spokenLabel))
    }

    @ViewBuilder private var texts: some View {
        let a = achievement
        Text(a.titleRu)
            .teletauText(TeleTauFontSize.footnote, TeleTauFontWeight.bold)
            .lineSpacing(TeleTauFontSize.footnote * (TeleTauLineHeight.snug - 1))
            .foregroundStyle(a.earned ? TeleTauColor.textPrimary : TeleTauColor.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
        if let earnedOn = a.earnedOn {
            meta(Format.dayLong(earnedOn))
        } else if a.target > 1 {
            AwardMiniBar(value: a.progress, total: a.target)
                .padding(.top, TeleTauSpace.s050)
            meta("\(a.progress) из \(a.target)")
        }
    }

    private func meta(_ text: String) -> some View {
        Text(text)
            .teletauText(TeleTauFontSize.caption)
            .monospacedDigit()
            .foregroundStyle(TeleTauColor.textTertiary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Нажатие «утапливает» плитку на высоту губы.
struct AwardTileButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .offset(y: configuration.isPressed ? TeleTauSize.lipSmall : 0)
            .animation(reduceMotion ? nil : .easeOut(duration: TeleTauDuration.press), value: configuration.isPressed)
    }
}

/// Тонкая полоса прогресса в плитке.
struct AwardMiniBar: View {
    static let width: CGFloat = 64
    static let height: CGFloat = 6

    let value: Int
    let total: Int

    var body: some View {
        let share = total > 0 ? min(1, max(0, CGFloat(value) / CGFloat(total))) : 0
        ZStack(alignment: .leading) {
            Capsule().fill(TeleTauColor.lockedFill)
            if share > 0 {
                Capsule().fill(TeleTauColor.accentFill)
                    .frame(width: max(Self.height, Self.width * share))
            }
        }
        .frame(width: Self.width, height: Self.height)
        .accessibilityHidden(true)
    }
}

// MARK: - Лист награды

/// Лист награды снизу: крупная сота, что сделать, затем «Получена 5 ноября» или прогресс «5 из 7».
/// Закрывается крестиком, нажатием на затемнение и жестом «назад» VoiceOver. `award` nil — листа нет.
struct AwardSheet: View {
    let award: Achievement?
    let onClose: @MainActor () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.teletauMode) private var mode
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        ZStack(alignment: .bottom) {
            if award != nil {
                TeleTauColor.scrim.opacity(0.45)
                    .ignoresSafeArea()
                    .onTapGesture { onClose() }
                    .accessibilityHidden(true)
                    .transition(.opacity)
            }
            if let award {
                panel(award)
                    .transition(reduceMotion ? .opacity : .move(edge: .bottom))
            }
        }
        .animation(reduceMotion ? nil : .easeOut(duration: TeleTauDuration.base), value: award?.id)
    }

    private func panel(_ a: Achievement) -> some View {
        let shape = UnevenRoundedRectangle(topLeadingRadius: TeleTauRadius.sheet, topTrailingRadius: TeleTauRadius.sheet, style: .continuous)
        return Group {
            // Очень крупный шрифт: лист может не поместиться — тогда он прокручивается.
            if typeSize.isAccessibilitySize {
                TeleTauScroll { content(a) }
            } else {
                content(a)
            }
        }
        .frame(maxWidth: TeleTauSize.columnNarrow)
        .frame(maxWidth: .infinity)
        // Поверхность листа продолжается под домашний индикатор.
        .background { shape.fill(TeleTauColor.surface).ignoresSafeArea(edges: .bottom) }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityAction(.escape) { onClose() }
        // VoiceOver переходит в лист: он модальный, первым читается заголовок.
        .onAppear { AccessibilityNotification.ScreenChanged(nil).post() }
    }

    private func content(_ a: Achievement) -> some View {
        VStack(spacing: TeleTauSpace.s250) {
            HStack(alignment: .top, spacing: TeleTauSpace.s200) {
                // Пустое место слева той же ширины, что крестик: заголовок — по центру листа.
                Color.clear.frame(width: mode.touchTarget, height: mode.touchTarget)
                Text(a.titleRu)
                    .teletauDisplay(TeleTauFontSize.title3, TeleTauFontWeight.black)
                    .foregroundStyle(TeleTauColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, TeleTauSpace.s250)
                    .frame(maxWidth: .infinity)
                    .accessibilityAddTraits(.isHeader)
                IconButton(.x, label: "Закрыть", action: onClose)
            }
            AwardBadge(achievement: a, size: .medium)
                .padding(.top, TeleTauSpace.s200)
                .padding(.bottom, TeleTauSpace.s200)
            Text(a.descriptionRu)
                .teletauText(TeleTauFontSize.body)
                .foregroundStyle(TeleTauColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if let earnedOn = a.earnedOn {
                Text("Получена \(Format.dayLong(earnedOn))")
                    .teletauText(TeleTauFontSize.body, TeleTauFontWeight.bold)
                    .foregroundStyle(TeleTauColor.successText)
                    .fixedSize(horizontal: false, vertical: true)
            } else if a.target > 1 {
                TeleTauProgressBar(value: Double(a.progress), total: Double(a.target), label: a.titleRu, valueText: "\(a.progress) из \(a.target)")
                    .frame(maxWidth: 280)
            }
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, TeleTauSpace.s400)
        .padding(.top, TeleTauSpace.s400)
        .padding(.bottom, TeleTauSpace.s1000)
        .frame(maxWidth: .infinity)
    }
}

// MARK: - «Новая награда!» после урока

/// «Новая награда!» — шаг после итога и серии, перед новой лигой: сота поднимается с бликом на ореоле из сот.
/// Несколько наград за урок — все на одном экране «Новые награды!».
struct NewAchievementView: View {
    let achievements: [Achievement]
    let onContinue: @MainActor () -> Void

    var body: some View {
        let single = achievements.count == 1 ? achievements.first : nil
        AfterScreen(visual: visual(single), centered: true, action: "Дальше", onAction: onContinue) {
            AfterTitle(text: single == nil ? "Новые награды!" : "Новая награда!")
            if let single {
                Text(single.titleRu)
                    .teletauDisplay(TeleTauFontSize.title3, TeleTauFontWeight.black)
                    .foregroundStyle(TeleTauColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, TeleTauSpace.s600)
            } else {
                FlowLayout(spacing: TeleTauSpace.s350, lineSpacing: TeleTauSpace.s400, center: true) {
                    ForEach(Array(achievements.enumerated()), id: \.element.id) { i, a in
                        VStack(spacing: TeleTauSpace.s250) {
                            AwardBadge(achievement: a, size: .medium, rise: true, riseDelay: Double(min(i, 2)) * TeleTauDuration.stagger)
                                .padding(.bottom, TeleTauSpace.s150)
                            Text(a.titleRu)
                                .teletauText(TeleTauFontSize.body, TeleTauFontWeight.bold)
                                .lineSpacing(TeleTauFontSize.body * (TeleTauLineHeight.snug - 1))
                                .foregroundStyle(TeleTauColor.textPrimary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(width: 112)
                    }
                }
                .padding(.top, TeleTauSpace.s200)
                .padding(.bottom, TeleTauSpace.s400)
            }
        }
        .successHapticOnAppear()
        .soundOnAppear(.levelUp)
    }

    @ViewBuilder private func visual(_ single: Achievement?) -> some View {
        if let single {
            AwardBadge(achievement: single, size: .hero, rise: true)
                .frame(minHeight: 240)
        }
    }
}
