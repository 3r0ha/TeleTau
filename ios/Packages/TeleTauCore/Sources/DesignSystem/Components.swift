import SwiftUI

// MARK: - Чип

/// Метка (prototype `.chip`): «Новое слово», «Помоги языку», «Квест выполнен».
public struct Chip: View {
    public enum Tone: Sendable { case honey, green, water, coral, violet, neutral, solid }

    let text: String
    let icon: TeleTauIcon?
    let tone: Tone

    public init(_ text: String, icon: TeleTauIcon? = nil, tone: Tone = .honey) {
        self.text = text
        self.icon = icon
        self.tone = tone
    }

    private var colors: (bg: Color, ink: Color) {
        switch tone {
        case .honey: (TeleTauColor.accentSoft, TeleTauColor.accentText)
        case .green: (TeleTauColor.successSoft, TeleTauColor.successText)
        case .water: (TeleTauColor.infoSoft, TeleTauColor.infoText)
        case .coral: (TeleTauColor.dangerSoft, TeleTauColor.dangerText)
        case .violet: (TeleTauColor.violetSoft, TeleTauColor.violetText)
        case .neutral: (TeleTauColor.bgSunken, TeleTauColor.textSecondary)
        case .solid: (TeleTauColor.accentFill, TeleTauColor.accentOn)
        }
    }

    public var body: some View {
        HStack(spacing: TeleTauSpace.s150) {
            if let icon { IconView(icon, size: TeleTauFontSize.callout) }
            Text(text).teletauDisplay(TeleTauFontSize.label, TeleTauFontWeight.extrabold, relativeTo: .caption)
        }
        .foregroundStyle(colors.ink)
        .padding(.vertical, TeleTauSpace.s150)
        .padding(.horizontal, TeleTauSpace.s300)
        .background(colors.bg, in: Capsule())
        .overlay {
            if tone == .neutral { Capsule().strokeBorder(TeleTauColor.borderSubtle, lineWidth: TeleTauSpace.s050) }
        }
    }
}

// MARK: - Прогресс

/// Полоса прогресса (prototype `.progress`): медовая заливка с «губой» снизу и бликом; справа — «3 из 7».
public struct TeleTauProgressBar: View {
    let value: Double
    let total: Double
    let valueText: String?
    let label: String

    public init(value: Double, total: Double, label: String, valueText: String? = nil) {
        self.value = value
        self.total = total
        self.label = label
        self.valueText = valueText
    }

    private var fraction: CGFloat { total > 0 ? CGFloat(min(1, max(0, value / total))) : 0 }

    public var body: some View {
        HStack(spacing: TeleTauSpace.s250) {
            GeometryReader { geo in
                let h = TeleTauSize.progress
                let w = fraction > 0 ? max(h, geo.size.width * fraction) : 0
                ZStack(alignment: .leading) {
                    Capsule().fill(TeleTauColor.lockedFill)
                    if w > 0 {
                        ZStack(alignment: .top) {
                            Capsule().fill(TeleTauColor.accentLip)
                            Capsule().fill(TeleTauColor.accentFill).padding(.bottom, TeleTauSize.lipSmall)
                            Capsule()
                                .fill(TeleTauColor.highlight.opacity(0.45))
                                .frame(height: TeleTauSpace.s100)
                                .padding(.horizontal, TeleTauSpace.s200)
                                .padding(.top, TeleTauSpace.s050 + 1)
                        }
                        .frame(width: w)
                    }
                }
                .frame(height: h)
            }
            .frame(height: TeleTauSize.progress)
            if let valueText {
                Text(valueText)
                    .teletauDisplay(TeleTauFontSize.footnote, TeleTauFontWeight.extrabold)
                    .foregroundStyle(TeleTauColor.textSecondary)
                    .monospacedDigit()
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(valueText ?? "\(Int(value)) из \(Int(total))"))
    }
}

// MARK: - Карточка

public extension View {
    /// Карточка (prototype `.card`): поверхность, рамка 2 pt `borderSubtle`, радиус 24.
    func teletauCard(padding: CGFloat = TeleTauSpace.s400, radius: CGFloat = TeleTauRadius.card) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(TeleTauColor.surface, in: shape)
            .overlay { shape.strokeBorder(TeleTauColor.borderSubtle, lineWidth: TeleTauSpace.s050) }
    }
}

/// Заголовок и подпись карточки (prototype `.card__title`, `.card__sub`).
public struct CardTitle: View {
    let title: String
    let sub: String?

    public init(_ title: String, sub: String? = nil) {
        self.title = title
        self.sub = sub
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TeleTauSpace.s100) {
            Text(title)
                .teletauDisplay(TeleTauFontSize.headline, TeleTauFontWeight.black)
                .foregroundStyle(TeleTauColor.textPrimary)
                .accessibilityAddTraits(.isHeader)
            if let sub {
                Text(sub)
                    .teletauText(TeleTauFontSize.footnote)
                    .foregroundStyle(TeleTauColor.textSecondary)
                    .lineSpacing(TeleTauFontSize.footnote * (TeleTauLineHeight.body - 1))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Тон шестиугольника

public enum HexTone: String, Sendable, CaseIterable {
    case honey, green, water, violet, coral, locked, empty

    var fill: Color {
        switch self {
        case .honey: TeleTauColor.accentFill
        case .green: TeleTauColor.successFill
        case .water: TeleTauColor.infoFill
        case .violet: TeleTauColor.violetFill
        case .coral: TeleTauColor.dangerFill
        case .locked: TeleTauColor.lockedFill
        case .empty: TeleTauColor.surface
        }
    }

    var lip: Color {
        switch self {
        case .honey: TeleTauColor.accentLip
        case .green: TeleTauColor.successLip
        case .water: TeleTauColor.infoLip
        case .violet: TeleTauColor.violetLip
        case .coral: TeleTauColor.dangerLip
        case .locked: TeleTauColor.lockedLip
        case .empty: TeleTauColor.borderDefault
        }
    }

    var soft: Color {
        switch self {
        case .honey: TeleTauColor.accentSoft
        case .green: TeleTauColor.successSoft
        case .water: TeleTauColor.infoSoft
        case .violet: TeleTauColor.violetSoft
        case .coral: TeleTauColor.dangerSoft
        case .locked, .empty: TeleTauColor.bgSunken
        }
    }

    /// Цвета аватаров по кругу (prototype AVA): соседние места различаются.
    static let avatarTones: [HexTone] = [.honey, .green, .water, .violet, .coral]

    /// Стабильный цвет по строке (ник): тот же хеш, что `toneFor` веба (h = h·31 + код UTF-16).
    public static func forKey(_ key: String) -> HexTone {
        var h: UInt32 = 0
        for unit in key.utf16 { h = h &* 31 &+ UInt32(unit) }
        return avatarTones[Int(h % UInt32(avatarTones.count))]
    }
}

// MARK: - Узел тропы

public enum HexNodeState: Sendable { case done, current, open, locked }

/// Узел тропы — ячейка 78×68 с «губой» 7 pt (prototype v2 `nodeHtml`): пройденный — мёд с галочкой, текущий — с
/// кольцом, «Помоги языку» — фиолетовый, закрытый — воск.
public struct HexNode: View {
    public static let width: CGFloat = 78
    public static let height: CGFloat = 68
    public static let lip: CGFloat = 7

    let state: HexNodeState
    let violet: Bool
    let icon: TeleTauIcon
    let progress: Double

    public init(state: HexNodeState, violet: Bool = false, icon: TeleTauIcon, progress: Double = 0) {
        self.state = state
        self.violet = violet
        self.icon = icon
        self.progress = progress
    }

    private var face: Color { state == .locked ? TeleTauColor.lockedFill : violet ? TeleTauColor.violetBright : TeleTauColor.accentFill }
    private var lipColor: Color { state == .locked ? TeleTauColor.lockedLip : violet ? TeleTauColor.violetLip : TeleTauColor.accentLip }
    private var ink: Color { state == .locked ? TeleTauColor.lockedText : violet ? TeleTauColor.violetOn : TeleTauColor.accentOn }

    public var body: some View {
        ZStack(alignment: .top) {
            if state == .current {
                RoundedHex(cornerRadius: 14)
                    .stroke(TeleTauColor.lockedFill, lineWidth: 6)
                    .frame(width: Self.width + 20, height: Self.height + 18)
                    .offset(y: -9)
                if progress > 0 {
                    RoundedHex(cornerRadius: 14)
                        .trim(from: 0, to: progress)
                        .stroke(TeleTauColor.accentFill, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                        .frame(width: Self.width + 20, height: Self.height + 18)
                        .offset(y: -9)
                }
            }
            RoundedHex(cornerRadius: 13).fill(lipColor)
                .frame(width: Self.width, height: Self.height)
                .offset(y: Self.lip)
            RoundedHex(cornerRadius: 13).fill(face)
                .frame(width: Self.width, height: Self.height)
            if state != .locked {
                RoundedHex(cornerRadius: 8)
                    .trim(from: 0.02, to: 0.14)
                    .stroke(TeleTauColor.highlight.opacity(0.35), style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .frame(width: Self.width - 26, height: Self.height - 26)
                    .offset(y: 9)
            }
            IconView(icon, size: 32)
                .foregroundStyle(ink)
                .frame(width: Self.width, height: Self.height)
        }
        .frame(width: Self.width, height: Self.height + Self.lip, alignment: .top)
    }
}

/// Нажатие на узел «утапливает» ячейку на высоту губы.
public struct HexNodeButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .offset(y: configuration.isPressed ? HexNode.lip / 2 : 0)
            .animation(reduceMotion ? nil : .easeOut(duration: TeleTauDuration.press), value: configuration.isPressed)
    }
}

// MARK: - Аватар ника

/// Аватары ников (avatars.ts веба): существительное ника → картинка `avatar-<slug>`. Порядок — как словарь API.
public enum NicknameAvatar {
    static let nouns: [(String, Illustration)] = [
        ("пчела", .avatarBee), ("шмель", .avatarBumblebee), ("сова", .avatarOwl), ("ёж", .avatarHedgehog),
        ("лиса", .avatarFox), ("барсук", .avatarBadger), ("белка", .avatarSquirrel), ("медведь", .avatarBear),
        ("рысь", .avatarLynx), ("сокол", .avatarFalcon), ("ласточка", .avatarSwallow), ("журавль", .avatarCrane),
        ("синица", .avatarTit), ("бобёр", .avatarBeaver), ("стрекоза", .avatarDragonfly), ("заяц", .avatarHare),
        ("куница", .avatarMarten), ("филин", .avatarEagleOwl), ("цапля", .avatarHeron), ("дельфин", .avatarDolphin),
        ("комета", .avatarComet), ("кедр", .avatarCedar), ("звезда", .avatarStar), ("клён", .avatarMaple),
        ("ромашка", .avatarChamomile), ("ветер", .avatarWind), ("берёза", .avatarBirch), ("маяк", .avatarLighthouse),
        ("рябина", .avatarRowan), ("компас", .avatarCompass), ("волна", .avatarWave), ("родник", .avatarSpring),
        ("солнце", .avatarSun), ("облако", .avatarCloud), ("озеро", .avatarLake), ("перо", .avatarFeather),
    ]

    private static func fold(_ s: String) -> String {
        s.lowercased(with: Locale(identifier: "ru")).replacingOccurrences(of: "ё", with: "е")
    }

    private static let byNoun: [String: Illustration] = Dictionary(uniqueKeysWithValues: nouns.map { (fold($0.0), $0.1) })

    /// Аватар по нику: последнее слово — существительное словаря; иначе nil (цветной шестиугольник).
    public static func illustration(for nickname: String?) -> Illustration? {
        guard let noun = nickname?.split(whereSeparator: \.isWhitespace).last else { return nil }
        return byNoun[fold(String(noun))]
    }
}

/// Шестиугольный аватар ника (HexAvatar веба): персонаж в рамке тона на мягкой подложке; без ника — цветная сота.
public struct HexAvatar: View {
    let nickname: String?
    let size: CGFloat
    let lip: Bool
    let badge: String?

    public init(nickname: String?, size: CGFloat = 44, lip: Bool = false, badge: String? = nil) {
        self.nickname = nickname
        self.size = size
        self.lip = lip
        self.badge = badge
    }

    public var body: some View {
        let w = size
        let h = (size * 0.875).rounded()
        let r = max(3, size * 0.12)
        let frame = max(2, (size * 0.05).rounded())
        let lipH = lip ? max(3, (size * 0.08).rounded()) : 0
        let tone = HexTone.forKey(nickname ?? "")
        let art = NicknameAvatar.illustration(for: nickname)
        ZStack(alignment: .top) {
            if lipH > 0 {
                RoundedHex(cornerRadius: r).fill(tone.lip).frame(width: w, height: h).offset(y: lipH)
            }
            if let art {
                RoundedHex(cornerRadius: r).fill(tone.soft).frame(width: w, height: h)
                IllustrationView(art)
                    .frame(width: w * 0.88, height: h * 0.94, alignment: .bottom)
                    .frame(width: w, height: h, alignment: .bottom)
                    .clipShape(RoundedHex(cornerRadius: r))
                RoundedHex(cornerRadius: r).stroke(tone.fill, lineWidth: frame).frame(width: w - frame, height: h - frame).offset(y: frame / 2)
            } else {
                RoundedHex(cornerRadius: r).fill(tone.fill).frame(width: w, height: h)
            }
            if let badge {
                Text(badge)
                    .teletauDisplay(max(11, size * 0.26), TeleTauFontWeight.black)
                    .monospacedDigit()
                    .foregroundStyle(TeleTauColor.textPrimary)
                    .padding(.horizontal, TeleTauSpace.s150)
                    .background(TeleTauColor.surface, in: Capsule())
                    .overlay { Capsule().strokeBorder(tone.lip, lineWidth: 1.5) }
                    .offset(y: h + lipH - size * 0.2)
            }
        }
        .frame(width: w, height: h + lipH + (badge == nil ? 0 : size * 0.16), alignment: .top)
        .accessibilityHidden(true)
    }
}

// MARK: - Соты

/// Соты (prototype comb): ряд ячеек 30×26 зигзагом — мёд, нектар и пустые.
public struct HoneyComb: View {
    let total: Int
    let filled: Int
    let nectar: Int
    let perRow: Int

    static let cw: CGFloat = 30
    static let ch: CGFloat = 26
    static let step: CGFloat = cw - 6
    static let drop: CGFloat = ch / 2
    static let row: CGFloat = ch + drop + 4

    public init(total: Int, filled: Int, nectar: Int = 0, perRow: Int = 12) {
        self.total = max(0, total)
        self.filled = filled
        self.nectar = nectar
        self.perRow = perRow
    }

    public var body: some View {
        let cols = max(1, min(perRow, total))
        let rows = max(1, Int((Double(total) / Double(cols)).rounded(.up)))
        let width = Self.cw + CGFloat(cols - 1) * Self.step
        let height = CGFloat(rows) * Self.row - 4
        Canvas { ctx, _ in
            for i in 0..<total {
                let col = i % cols, row = i / cols
                let x = CGFloat(col) * Self.step
                let y = CGFloat(row) * Self.row + (col % 2 == 1 ? Self.drop : 0)
                let rect = CGRect(x: x, y: y, width: Self.cw, height: Self.ch)
                if i < filled {
                    ctx.fill(RoundedHex(cornerRadius: 4).path(in: rect), with: .color(TeleTauColor.accentFill))
                } else if i < filled + nectar {
                    let p = RoundedHex(cornerRadius: 4).path(in: rect.insetBy(dx: 1, dy: 1))
                    ctx.fill(p, with: .color(TeleTauColor.accentFill.opacity(0.32)))
                    ctx.stroke(p, with: .color(TeleTauColor.accentLip.opacity(0.55)), lineWidth: 2)
                } else {
                    let p = RoundedHex(cornerRadius: 4).path(in: rect.insetBy(dx: 1, dy: 1))
                    ctx.fill(p, with: .color(TeleTauColor.surface))
                    ctx.stroke(p, with: .color(TeleTauColor.borderDefault), lineWidth: 2)
                }
            }
        }
        .frame(width: width, height: height)
        .accessibilityHidden(true)
    }
}

// MARK: - Плитка слова

/// Плитка слова (prototype `.tile`): башкирское слово в Nunito; использованная — пустой воск на своём месте.
public struct WordTile: View {
    let text: String
    let used: Bool
    let verdict: AnswerVerdict?
    let action: @MainActor () -> Void
    @Environment(\.teletauMode) private var mode
    @Environment(\.isEnabled) private var isEnabled

    public init(_ text: String, used: Bool = false, verdict: AnswerVerdict? = nil, action: @escaping @MainActor () -> Void) {
        self.text = text
        self.used = used
        self.verdict = verdict
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            BashkirText(text, size: TeleTauFontSize.headline, color: used ? Color.clear : verdict?.ink ?? TeleTauColor.textPrimary)
                .fixedSize()
                .padding(.vertical, 9)
                .padding(.horizontal, TeleTauSpace.s400)
                .frame(minHeight: mode == .bee ? TeleTauSize.touchChild : TeleTauSize.touchMin + 5)
        }
        .buttonStyle(TileButtonStyle(used: used, selectedEdge: verdict?.edge, background: verdict?.soft ?? TeleTauColor.surface))
        .disabled(used)
        .accessibilityHidden(used)
    }
}

struct TileButtonStyle: ButtonStyle {
    let used: Bool
    var selectedEdge: Color? = nil
    var background: Color = TeleTauColor.surface
    var radius: CGFloat = TeleTauRadius.tile
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        let edge = used ? TeleTauColor.lockedFill : (selectedEdge ?? TeleTauColor.borderDefault)
        let pressed = configuration.isPressed && !used
        configuration.label
            .background(used ? TeleTauColor.lockedFill : background, in: shape)
            .overlay { shape.strokeBorder(edge, lineWidth: TeleTauSpace.s050) }
            .offset(y: pressed ? TeleTauSize.lipSmall : 0)
            .padding(.bottom, used ? 0 : TeleTauSize.lipSmall)
            .background { if !used { shape.fill(edge).padding(.top, TeleTauSize.lipSmall) } }
            .padding(.top, used ? TeleTauSize.lipSmall : 0)
            .contentShape(shape)
            .animation(reduceMotion ? nil : .easeOut(duration: TeleTauDuration.press), value: pressed)
    }
}

// MARK: - Варианты ответа

/// Итог ответа на варианте или плитке после «Проверить»: верно — зелень с галочкой, не так — коралл с крестиком,
/// почти — мёд (цвет вместе со значком: не только цветом).
public enum AnswerVerdict: Sendable, Equatable {
    case ok, bad, almost

    public var edge: Color {
        switch self {
        case .ok: TeleTauColor.successLip
        case .bad: TeleTauColor.dangerLip
        case .almost: TeleTauColor.accentLip
        }
    }

    public var soft: Color {
        switch self {
        case .ok: TeleTauColor.successSoft
        case .bad: TeleTauColor.dangerSoft
        case .almost: TeleTauColor.accentSoft
        }
    }

    public var ink: Color {
        switch self {
        case .ok: TeleTauColor.successText
        case .bad: TeleTauColor.dangerText
        case .almost: TeleTauColor.accentText
        }
    }

    public var fill: Color {
        switch self {
        case .ok: TeleTauColor.successFill
        case .bad: TeleTauColor.dangerFill
        case .almost: TeleTauColor.accentFill
        }
    }
}

/// Вариант ответа (prototype `.option`): метка-номер и текст; выбранный — граница `accentText` и мёд в метке.
/// После проверки — `verdict`: верный вариант зелёный с галочкой, неверный выбранный — коралловый с крестиком.
public struct AnswerOption: View {
    public enum Tone: Sendable { case honey, violet }

    let mark: String
    let text: String
    let bashkir: Bool
    let selected: Bool
    let tone: Tone
    let verdict: AnswerVerdict?
    let action: @MainActor () -> Void
    @Environment(\.teletauMode) private var mode

    public init(mark: String, text: String, bashkir: Bool = false, selected: Bool, tone: Tone = .honey, verdict: AnswerVerdict? = nil,
                action: @escaping @MainActor () -> Void) {
        self.mark = mark
        self.text = text
        self.bashkir = bashkir
        self.selected = selected
        self.tone = tone
        self.verdict = verdict
        self.action = action
    }

    public var body: some View {
        let violet = tone == .violet
        let markSize: CGFloat = violet ? 34 : 30
        Button(action: action) {
            HStack(spacing: TeleTauSpace.s350) {
                Group {
                    if let verdict, verdict != .almost {
                        IconView(verdict == .ok ? .check : .x, size: 18).foregroundStyle(TeleTauColor.textOnFill)
                    } else {
                        Text(mark)
                            .teletauDisplay(violet ? TeleTauFontSize.body : TeleTauFontSize.footnote, violet ? TeleTauFontWeight.black : TeleTauFontWeight.extrabold)
                            .foregroundStyle(markInk)
                    }
                }
                .frame(width: markSize, height: markSize)
                .background(verdict.map(\.fill) ?? markFill, in: RoundedRectangle(cornerRadius: TeleTauRadius.mark, style: .continuous))
                .overlay {
                    if !violet, verdict == nil {
                        RoundedRectangle(cornerRadius: TeleTauRadius.mark, style: .continuous)
                            .strokeBorder(selected ? TeleTauColor.accentLip : TeleTauColor.borderDefault, lineWidth: TeleTauSpace.s050)
                    }
                }
                Group {
                    if bashkir {
                        BashkirText(text, size: violet ? TeleTauFontSize.title3 : mode.learningText, weight: violet ? TeleTauFontWeight.semibold : TeleTauFontWeight.bold,
                                    color: verdict?.ink ?? TeleTauColor.textPrimary)
                    } else {
                        Text(verbatim: text).teletauText(TeleTauFontSize.bodyLarge, verdict == .ok ? TeleTauFontWeight.bold : TeleTauFontWeight.regular)
                            .foregroundStyle(verdict?.ink ?? TeleTauColor.textPrimary)
                    }
                }
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.vertical, violet ? TeleTauSpace.s400 : TeleTauSpace.s350)
            .padding(.horizontal, TeleTauSpace.s400)
            .frame(minHeight: mode.touchTarget)
        }
        .buttonStyle(TileButtonStyle(
            used: false,
            selectedEdge: verdict?.edge ?? (selected ? (violet ? TeleTauColor.violetText : TeleTauColor.accentText) : nil),
            background: verdict?.soft ?? (selected ? (violet ? TeleTauColor.violetSoft : TeleTauColor.accentSoft) : TeleTauColor.surface),
            radius: violet ? TeleTauRadius.panel : TeleTauRadius.button
        ))
        .accessibilityAddTraits(selected ? [.isSelected] : [])
        .accessibilityValue(Text(verdict == .ok ? "верный ответ" : verdict == .bad ? "не так" : ""))
    }

    private var markFill: Color {
        switch (tone, selected) {
        case (.honey, true): TeleTauColor.accentFill
        case (.honey, false): Color.clear
        case (.violet, true): TeleTauColor.violetFill
        case (.violet, false): TeleTauColor.violetSoft
        }
    }

    private var markInk: Color {
        switch (tone, selected) {
        case (.honey, true): TeleTauColor.accentOn
        case (.honey, false): TeleTauColor.textTertiary
        case (.violet, true): TeleTauColor.violetOn
        case (.violet, false): TeleTauColor.violetText
        }
    }
}

/// Таблетка (prototype `.pill`): «Оба подходят», «Не знаю».
public struct Pill: View {
    let text: String
    let selected: Bool
    let action: @MainActor () -> Void
    @Environment(\.teletauMode) private var mode

    public init(_ text: String, selected: Bool, action: @escaping @MainActor () -> Void) {
        self.text = text
        self.selected = selected
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Text(text)
                .teletauDisplay(TeleTauFontSize.footnote, TeleTauFontWeight.extrabold)
                .foregroundStyle(selected ? TeleTauColor.violetText : TeleTauColor.textSecondary)
                .padding(.horizontal, TeleTauSpace.s400)
                .frame(minHeight: mode.touchTarget)
                .background(selected ? TeleTauColor.violetSoft : TeleTauColor.surface, in: Capsule())
                .overlay { Capsule().strokeBorder(selected ? TeleTauColor.violetText : TeleTauColor.borderDefault, lineWidth: TeleTauSpace.s050) }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

// MARK: - Панель башкирских букв

/// Особые буквы башкирского (правильные кодовые точки, CLAUDE.md правило 7): ә ө ү ғ ҡ ң ҙ ҫ һ.
public let bashkirLetters: [String] = ["\u{04D9}", "\u{04E9}", "\u{04AF}", "\u{0493}", "\u{04A1}", "\u{04A3}", "\u{0499}", "\u{04AB}", "\u{04BB}"]

/// Панель башкирских букв (docs/05 §8, п. 2): на iOS нет башкирской раскладки — без панели ребёнок не введёт ҡ, ғ, ҙ.
/// В «Пчёлке» — по 5 в ряд и кнопки 56 pt.
public struct LetterPanel: View {
    let letters: [String]
    let onInsert: @MainActor (String) -> Void
    @Environment(\.teletauMode) private var mode
    @Environment(\.isEnabled) private var isEnabled

    public init(letters: [String] = bashkirLetters, onInsert: @escaping @MainActor (String) -> Void) {
        self.letters = letters.isEmpty ? bashkirLetters : letters
        self.onInsert = onInsert
    }

    public var body: some View {
        VStack(spacing: TeleTauSpace.s250) {
            let columns = Array(repeating: GridItem(.flexible(), spacing: TeleTauSpace.s150), count: mode == .bee ? 5 : 9)
            LazyVGrid(columns: columns, spacing: TeleTauSpace.s200) {
                ForEach(letters, id: \.self) { letter in
                    Button { onInsert(letter) } label: {
                        BashkirText(letter, size: TeleTauFontSize.title3, weight: TeleTauFontWeight.semibold)
                            .fixedSize()
                            .frame(maxWidth: .infinity, minHeight: mode == .bee ? TeleTauSize.touchChild : 46)
                    }
                    .buttonStyle(TileButtonStyle(used: false, radius: TeleTauRadius.iconButton))
                    .accessibilityLabel(Text(verbatim: letter))
                }
            }
        }
    }
}

// MARK: - Лист обратной связи

/// Лист обратной связи (prototype `.sheet`): «Верно», «Почти!», «Пока не так», «Голос учтён» — цвет вместе со
/// значком и заголовком (статус не передаётся только цветом).
public struct FeedbackSheet<Content: View>: View {
    public enum Tone: Sendable { case ok, bad, almost, voted }

    let tone: Tone
    let title: String
    let art: Illustration?
    let actionLabel: String
    let action: @MainActor () -> Void
    /// Огонёк справа от заголовка: «3 подряд».
    let badge: String?
    let content: Content

    public init(tone: Tone, title: String, art: Illustration? = nil, badge: String? = nil, actionLabel: String, action: @escaping @MainActor () -> Void,
                @ViewBuilder content: () -> Content) {
        self.tone = tone
        self.title = title
        self.art = art
        self.badge = badge
        self.actionLabel = actionLabel
        self.action = action
        self.content = content()
    }

    private var bg: Color {
        switch tone {
        case .ok: TeleTauColor.successSoft
        case .bad: TeleTauColor.dangerSoft
        case .almost: TeleTauColor.accentSoft
        case .voted: TeleTauColor.violetSoft
        }
    }

    private var ink: Color {
        switch tone {
        case .ok: TeleTauColor.successText
        case .bad: TeleTauColor.dangerText
        case .almost: TeleTauColor.accentText
        case .voted: TeleTauColor.violetText
        }
    }

    private var icon: TeleTauIcon? {
        switch tone {
        case .ok: .check
        case .bad: .x
        case .almost: .lightbulb
        case .voted: nil
        }
    }

    private var button: TeleTauButtonVariant {
        switch tone {
        case .ok: .success
        case .bad: .danger
        case .almost: .primary
        case .voted: .violet
        }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: TeleTauSpace.s300) {
                if let art { IllustrationView(art, width: 78) }
                VStack(alignment: .leading, spacing: TeleTauSpace.s200) {
                    HStack(spacing: TeleTauSpace.s250) {
                        if art == nil, let icon {
                            IconView(icon, size: TeleTauSize.iconSmall)
                                .foregroundStyle(ink)
                                .frame(width: 34, height: 34)
                                .background(TeleTauColor.surface, in: Circle())
                        }
                        Text(title)
                            .teletauDisplay(TeleTauFontSize.title3, TeleTauFontWeight.black)
                            .foregroundStyle(ink)
                            .accessibilityAddTraits(.isHeader)
                        if let badge {
                            Spacer(minLength: TeleTauSpace.s200)
                            HStack(spacing: TeleTauSpace.s100) {
                                IconView(.fire, size: 15).foregroundStyle(TeleTauColor.streakFill)
                                Text(badge).teletauDisplay(TeleTauFontSize.label, TeleTauFontWeight.extrabold).foregroundStyle(TeleTauColor.streakText)
                            }
                            .padding(.vertical, TeleTauSpace.s100)
                            .padding(.horizontal, TeleTauSpace.s250)
                            .background(TeleTauColor.surface, in: Capsule())
                        }
                    }
                    content
                        .teletauText(TeleTauFontSize.body)
                        .foregroundStyle(TeleTauColor.textPrimary)
                        .lineSpacing(TeleTauFontSize.body * (TeleTauLineHeight.body - 1))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.bottom, TeleTauSpace.s400)
            TeleTauButton(actionLabel, variant: button, action: action)
        }
        .padding(.top, TeleTauSpace.s450)
        .padding(.horizontal, TeleTauSpace.s400)
        .padding(.bottom, TeleTauSpace.s450)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(bg.ignoresSafeArea(edges: .bottom))
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Плитка итога

/// Плитка итога урока (prototype `.stile`): медовая шапка-подпись и крупное число.
public struct StatTile: View {
    let label: String
    let value: String
    let icon: TeleTauIcon?

    public init(label: String, value: String, icon: TeleTauIcon? = nil) {
        self.label = label
        self.value = value
        self.icon = icon
    }

    public var body: some View {
        let shape = RoundedRectangle(cornerRadius: TeleTauRadius.button, style: .continuous)
        VStack(spacing: 0) {
            Text(label.uppercased())
                .teletauDisplay(TeleTauFontSize.caption, TeleTauFontWeight.extrabold)
                .tracking(0.5)
                .foregroundStyle(TeleTauColor.accentOn)
                .padding(.vertical, TeleTauSpace.s150)
                .frame(maxWidth: .infinity)
                .background(TeleTauColor.accentFill)
            HStack(spacing: TeleTauSpace.s100) {
                if let icon { IconView(icon, size: TeleTauSize.iconSmall).foregroundStyle(TeleTauColor.accentFill) }
                Text(value).teletauDisplay(TeleTauFontSize.title3, TeleTauFontWeight.black).monospacedDigit()
                    .foregroundStyle(TeleTauColor.textPrimary)
            }
            .padding(.vertical, TeleTauSpace.s300)
            .frame(maxWidth: .infinity)
        }
        .background(TeleTauColor.surface)
        .clipShape(shape)
        .overlay { shape.strokeBorder(TeleTauColor.accentFill, lineWidth: TeleTauSpace.s050) }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Лига

/// Строка таблицы лиги (prototype `.row`): место, аватар ника, ник, «ты», очки.
public struct LeagueRowView: View {
    let rank: Int
    let nickname: String
    let points: Int
    let me: Bool
    let promote: Bool

    public init(rank: Int, nickname: String, points: Int, me: Bool, promote: Bool) {
        self.rank = rank
        self.nickname = nickname
        self.points = points
        self.me = me
        self.promote = promote
    }

    public var body: some View {
        HStack(spacing: TeleTauSpace.s300) {
            Text("\(rank)")
                .teletauDisplay(TeleTauFontSize.body, TeleTauFontWeight.black)
                .foregroundStyle(promote ? TeleTauColor.successText : TeleTauColor.textTertiary)
                .frame(width: 24)
            HexAvatar(nickname: nickname, size: 40)
            HStack(spacing: TeleTauSpace.s150) {
                Text(nickname)
                    .teletauText(TeleTauFontSize.body, TeleTauFontWeight.semibold)
                    .foregroundStyle(TeleTauColor.textPrimary)
                if me {
                    Text("ты")
                        .teletauDisplay(TeleTauFontSize.caption, TeleTauFontWeight.extrabold)
                        .foregroundStyle(TeleTauColor.accentOn)
                        .padding(.vertical, 3)
                        .padding(.horizontal, TeleTauSpace.s200)
                        .background(TeleTauColor.accentFill, in: Capsule())
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 3) {
                IconView(.drop, size: 16).foregroundStyle(TeleTauColor.accentFill)
                Text("\(points)").teletauDisplay(TeleTauFontSize.callout, TeleTauFontWeight.extrabold).monospacedDigit()
                    .foregroundStyle(TeleTauColor.textSecondary)
            }
        }
        .padding(.vertical, TeleTauSpace.s250)
        .padding(.horizontal, TeleTauSpace.s350)
        .frame(minHeight: 58)
        .background(me ? TeleTauColor.accentSoft : Color.clear)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(rank) место, \(nickname)\(me ? ", это ты" : ""), \(points) мёда"))
    }
}

/// Граница зоны повышения или понижения.
public struct LeagueZoneView: View {
    let up: Bool

    public init(up: Bool) {
        self.up = up
    }

    public var body: some View {
        HStack(spacing: TeleTauSpace.s150) {
            IconView(up ? .arrowUp : .arrowDown, size: 14)
            Text(up ? "ЗОНА ПОВЫШЕНИЯ" : "ЗОНА ПОНИЖЕНИЯ")
                .teletauDisplay(TeleTauFontSize.caption, TeleTauFontWeight.extrabold)
                .tracking(0.7)
        }
        .foregroundStyle(up ? TeleTauColor.successText : TeleTauColor.dangerText)
        .padding(TeleTauSpace.s200)
        .frame(maxWidth: .infinity)
        .background(up ? TeleTauColor.successSoft : TeleTauColor.dangerSoft)
    }
}

// MARK: - Пустое состояние

/// Пустое или ошибочное состояние (prototype 19–21): иллюстрация, заголовок, текст, действия.
public struct EmptyStateView<Actions: View>: View {
    let art: Illustration
    let title: String
    let text: Text?
    let custom: AnyView?
    let compact: Bool
    let actions: Actions

    /// Текст-вид (с башкирскими отрезками — `RichText`).
    public init(art: Illustration, title: String, compact: Bool = false, @ViewBuilder message: () -> some View, @ViewBuilder actions: () -> Actions) {
        self.art = art
        self.title = title
        self.text = nil
        self.custom = AnyView(message())
        self.compact = compact
        self.actions = actions()
    }

    public init(art: Illustration, title: String, text: String? = nil, compact: Bool = false, @ViewBuilder actions: () -> Actions) {
        self.init(art: art, title: title, message: text.map { Text(verbatim: $0) }, compact: compact, actions: actions)
    }

    /// Текст с оформлением (литера класса `lang="ba"`, башкирский фрагмент).
    public init(art: Illustration, title: String, message: Text?, compact: Bool = false, @ViewBuilder actions: () -> Actions) {
        self.art = art
        self.title = title
        self.text = message
        self.custom = nil
        self.compact = compact
        self.actions = actions()
    }

    public var body: some View {
        VStack(spacing: TeleTauSpace.s300) {
            IllustrationView(art, width: compact ? 140 : 236)
                .padding(.bottom, TeleTauSpace.s200)
            Text(title)
                .teletauDisplay(compact ? TeleTauFontSize.title3 : TeleTauFontSize.title1, TeleTauFontWeight.black)
                .foregroundStyle(TeleTauColor.textPrimary)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            if let text {
                text
                    .teletauText(TeleTauFontSize.body)
                    .foregroundStyle(TeleTauColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(TeleTauFontSize.body * (TeleTauLineHeight.body - 1))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 330)
            }
            if let custom { custom.frame(maxWidth: 330) }
            VStack(spacing: TeleTauSpace.s250) { actions }
                .padding(.top, TeleTauSpace.s300)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TeleTauSpace.s600)
    }
}

public extension EmptyStateView where Actions == EmptyView {
    init(art: Illustration, title: String, text: String? = nil, compact: Bool = false) {
        self.init(art: art, title: title, text: text, compact: compact) { EmptyView() }
    }
}

// MARK: - Сообщение

/// Сообщение под формой (prototype `.alert`): ошибка, «входим…», «нет связи».
public struct InlineAlert: View {
    public enum Tone: Sendable { case danger, honey, success }
    let tone: Tone
    let text: String

    public init(_ text: String, tone: Tone) {
        self.text = text
        self.tone = tone
    }

    public var body: some View {
        let (bg, ink, icon): (Color, Color, TeleTauIcon) = switch tone {
        case .danger: (TeleTauColor.dangerSoft, TeleTauColor.dangerText, .warningCircle)
        case .honey: (TeleTauColor.accentSoft, TeleTauColor.accentText, .info)
        case .success: (TeleTauColor.successSoft, TeleTauColor.successText, .checkCircle)
        }
        HStack(alignment: .top, spacing: TeleTauSpace.s250) {
            IconView(icon, size: TeleTauSize.iconSmall).foregroundStyle(ink)
            Text(text)
                .teletauText(TeleTauFontSize.footnote, TeleTauFontWeight.medium)
                .foregroundStyle(TeleTauColor.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TeleTauSpace.s300)
        .background(bg, in: RoundedRectangle(cornerRadius: TeleTauRadius.tile, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Скелетон

/// Заглушка загрузки: блок воска с бликом (без блика при «Уменьшении движения»).
public struct Skeleton: View {
    let width: CGFloat?
    let height: CGFloat
    let radius: CGFloat

    public init(width: CGFloat? = nil, height: CGFloat, radius: CGFloat = TeleTauRadius.small) {
        self.width = width
        self.height = height
        self.radius = radius
    }

    public var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(TeleTauColor.lockedFill)
            .frame(maxWidth: width ?? .infinity)
            .frame(width: width, height: height)
            .accessibilityHidden(true)
    }
}

// MARK: - Нижняя навигация

public enum StudentTab: String, CaseIterable, Sendable, Identifiable {
    case path, league, hive, me
    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .path: "Путь"
        case .league: "Лига"
        case .hive: "Класс"
        case .me: "Профиль"
        }
    }

    var icon: TeleTauIcon {
        switch self {
        case .path: .path
        case .league: .shieldStar
        case .hive: .usersThree
        case .me: .userCircle
        }
    }
}

/// Нижняя навигация ученика на 4 вкладки (prototype `.tabbar`): текущая — медовая подложка и граница.
public struct StudentTabBar: View {
    let current: StudentTab
    let onSelect: @MainActor (StudentTab) -> Void
    @Environment(\.teletauMode) private var mode

    public init(current: StudentTab, onSelect: @escaping @MainActor (StudentTab) -> Void) {
        self.current = current
        self.onSelect = onSelect
    }

    public var body: some View {
        HStack(spacing: TeleTauSpace.s100) {
            ForEach(StudentTab.allCases) { tab in
                let selected = tab == current
                Button { onSelect(tab) } label: {
                    VStack(spacing: TeleTauSpace.s050) {
                        IconView(tab.icon, size: TeleTauSize.iconLarge)
                            .foregroundStyle(selected ? TeleTauColor.accentLip : TeleTauColor.textTertiary)
                        Text(tab.title).teletauDisplay(TeleTauFontSize.caption, TeleTauFontWeight.extrabold)
                            .foregroundStyle(selected ? TeleTauColor.accentText : TeleTauColor.textTertiary)
                    }
                    .padding(.top, TeleTauSpace.s150)
                    .padding(.bottom, 5)
                    .frame(maxWidth: .infinity, minHeight: mode.touchTarget)
                    .background(selected ? TeleTauColor.accentSoft : Color.clear, in: RoundedRectangle(cornerRadius: TeleTauRadius.tile, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: TeleTauRadius.tile, style: .continuous)
                            .strokeBorder(selected ? TeleTauColor.accentText : Color.clear, lineWidth: TeleTauSpace.s050)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(tab.title))
                .accessibilityAddTraits(selected ? [.isSelected] : [])
            }
        }
        .padding(.top, TeleTauSpace.s200)
        .padding(.horizontal, TeleTauSpace.s250)
        .padding(.bottom, TeleTauSpace.s250)
        .frame(maxWidth: TeleTauSize.columnNarrow)
        .frame(maxWidth: .infinity)
        .background(TeleTauColor.bg.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(TeleTauColor.borderSubtle).frame(height: TeleTauSpace.s050) }
    }
}
