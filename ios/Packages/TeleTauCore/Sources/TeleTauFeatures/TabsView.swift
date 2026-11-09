import DesignSystem
import TeleTauAPI
import TeleTauSession
import SwiftUI

// MARK: - Лига

/// Вкладка «Лига» (prototype 16-league): лиги медоносов, таблица недели с зонами повышения и понижения.
struct LeagueContent: View {
    let league: LeagueStanding
    let now: Date
    let onTrail: @MainActor () -> Void

    var body: some View {
        let tiers = Format.tiers
        let index = tiers.firstIndex(of: league.tier) ?? 0
        let next = index + 1 < tiers.count ? tiers[index + 1] : nil
        let name = Format.tierName(league.tier)
        let members = league.members
        let lastUp = members.lastIndex { $0.zone == .promote } ?? -1
        let firstDown = members.firstIndex { $0.zone == .demote } ?? -1
        let climbing = next != nil && members.contains { $0.me && $0.zone == .promote }
        VStack(spacing: TeleTauSpace.s400) {
            HStack(alignment: .center, spacing: TeleTauSpace.s100) {
                ForEach(Array(tiers.enumerated()), id: \.offset) { i, tier in
                    IllustrationView(LeagueBadges.badge(tier), width: i == index ? 104 : 54)
                        .saturation(i > index ? 0 : 1)
                        .opacity(i > index ? 0.45 : 1)
                }
            }
            .accessibilityHidden(true)
            .padding(.top, TeleTauSpace.s200)
            VStack(spacing: TeleTauSpace.s150) {
                Text("Лига \(name.gen)")
                    .teletauDisplay(TeleTauFontSize.title2, TeleTauFontWeight.black)
                    .foregroundStyle(TeleTauColor.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Group {
                    if let next, league.zones.promote > 0 {
                        Text("Первые \(league.zones.promote) перейдут в Лигу \(Format.tierName(next).gen).\nИтоги \(Format.weekEndsIn(league.endsAt, now: now)).")
                    } else {
                        Text("Это высшая лига.\nИтоги \(Format.weekEndsIn(league.endsAt, now: now)).")
                    }
                }
                .teletauText(TeleTauFontSize.callout)
                .foregroundStyle(TeleTauColor.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            }
            if climbing {
                HStack(spacing: TeleTauSpace.s300) {
                    IllustrationView(.beeProud, width: 58)
                    VStack(alignment: .leading, spacing: TeleTauSpace.s100) {
                        Text("Ты в зоне повышения")
                            .teletauDisplay(TeleTauFontSize.headline, TeleTauFontWeight.black)
                            .foregroundStyle(TeleTauColor.successText)
                        Text("Удержи место до конца недели.")
                            .teletauText(TeleTauFontSize.footnote)
                            .foregroundStyle(TeleTauColor.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(TeleTauSpace.s350)
                .background(TeleTauColor.successSoft, in: RoundedRectangle(cornerRadius: TeleTauRadius.panel, style: .continuous))
            }
            if members.isEmpty {
                EmptyStateView(art: .beeIdle, title: "Лига ждёт тебя", text: "Пройди урок, чтобы попасть в таблицу.", compact: true) {
                    TeleTauButton("На тропу", action: onTrail)
                }
            } else {
                let shape = RoundedRectangle(cornerRadius: TeleTauRadius.panel, style: .continuous)
                VStack(spacing: 0) {
                    ForEach(Array(members.enumerated()), id: \.offset) { i, m in
                        if i == firstDown, firstDown > 0 { divider; LeagueZoneView(up: false) }
                        if i > 0 { divider }
                        LeagueRowView(rank: m.rank, nickname: m.nickname ?? "Участник", points: m.points, me: m.me, promote: m.zone == .promote)
                        if i == lastUp, lastUp < members.count - 1 { divider; LeagueZoneView(up: true) }
                    }
                }
                .background(TeleTauColor.surface)
                .clipShape(shape)
                .overlay { shape.strokeBorder(TeleTauColor.borderSubtle, lineWidth: TeleTauSpace.s050) }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Лига \(name.gen): участники недели"))
            }
        }
        .padding(.bottom, TeleTauSpace.s600)
    }

    private var divider: some View {
        Rectangle().fill(TeleTauColor.borderSubtle).frame(height: TeleTauSpace.s050)
    }
}

// MARK: - Класс

/// Вкладка «Класс» (prototype 17-class): улей класса — квест недели в сотах и сколько ребят занимались.
/// Только агрегаты: никаких рейтингов отдельных детей (docs/05 §8, п. 5).
struct HiveContent: View {
    let hive: ClassHive
    let title: String
    let schoolName: String

    static let comb = 12

    var body: some View {
        let quest = hive.quest
        let filled = quest.goal > 0 ? min(Self.comb, Int((Double(min(quest.progress, quest.goal)) / Double(quest.goal) * Double(Self.comb)).rounded())) : 0
        let active = hive.participation.active
        let total = hive.participation.total
        VStack(spacing: TeleTauSpace.s400) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: TeleTauSpace.s150) {
                    RichText([.display("Улей ")] + classTitleRuns(title, kind: .display, weight: TeleTauFontWeight.black), size: TeleTauFontSize.title2)
                        .accessibilityAddTraits(.isHeader)
                    Text("\(schoolName) · \(total) \(Format.plural(total, ("ученик", "ученика", "учеников")))")
                        .teletauText(TeleTauFontSize.callout)
                        .foregroundStyle(TeleTauColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                IllustrationView(.sceneClassHive, width: 104)
            }
            VStack(alignment: .leading, spacing: TeleTauSpace.s300) {
                CardTitle("Квест недели", sub: quest.titleRu)
                if quest.completed { Chip("Квест выполнен", icon: .check, tone: .green) }
                HoneyComb(total: Self.comb, filled: filled)
                TeleTauProgressBar(value: Double(min(quest.progress, quest.goal)), total: Double(quest.goal), label: "Квест недели", valueText: "\(quest.progress) из \(quest.goal)")
            }
            .teletauCard()
            VStack(alignment: .leading, spacing: TeleTauSpace.s300) {
                CardTitle("На этой неделе", sub: "Занимались \(active) из \(total)")
                HoneyComb(total: total, filled: active, perRow: Self.comb)
                    .accessibilityElement()
                    .accessibilityLabel(Text("Занимались \(active) из \(total)"))
                if !hive.days.isEmpty { HiveDays(days: hive.days) }
            }
            .teletauCard()
        }
        .padding(.top, TeleTauSpace.s400)
        .padding(.bottom, TeleTauSpace.s600)
    }
}

/// Сколько ребят занимались в каждый день недели — столбики без имён.
struct HiveDays: View {
    let days: [Components.Schemas.HiveDay]
    static let barHeight: CGFloat = 44

    var body: some View {
        let max = Swift.max(1, days.map(\.active).max() ?? 1)
        VStack(spacing: TeleTauSpace.s300) {
            Rectangle().fill(TeleTauColor.borderSubtle).frame(height: TeleTauSpace.s050)
            HStack(alignment: .bottom, spacing: 0) {
                ForEach(days, id: \.date) { d in
                    let h = d.active > 0 ? Swift.max(6, (CGFloat(d.active) / CGFloat(max) * Self.barHeight).rounded()) : 3
                    VStack(spacing: TeleTauSpace.s150) {
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .fill(d.active > 0 ? TeleTauColor.accentFill : TeleTauColor.lockedFill)
                            .frame(width: 22, height: h)
                            .frame(height: Self.barHeight, alignment: .bottom)
                        Text(Format.weekdayShort(d.date))
                            .teletauDisplay(TeleTauFontSize.caption, TeleTauFontWeight.extrabold)
                            .foregroundStyle(TeleTauColor.textTertiary)
                    }
                    .frame(maxWidth: .infinity)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text("\(Format.weekdayShort(d.date)): \(d.active)"))
                }
            }
        }
    }
}

// MARK: - Профиль

/// Вкладка «Профиль» (prototype 18-profile): серия, мёд, слова, голоса, награды, «Мой вклад в словарь» и экспедиция.
struct ProfileContent: View {
    let me: Me
    let progress: MyProgress
    let cells: MyCellsPage
    let course: Course
    /// Созрело с прошлого захода (счётчики видимого — на этом устройстве).
    let fresh: (count: Int, honey: Int)?
    /// «Мой словарь» — необязателен: без него ссылка без чисел, а слов — из счётчиков прогресса.
    var words: MyWords? = nil
    /// Награды — необязательны: не загрузились — блока нет.
    var achievements: MyAchievements? = nil
    var onAward: @MainActor (Achievement) -> Void = { _ in }
    var onWords: @MainActor () -> Void = {}
    var onCard: @MainActor () -> Void = {}
    var onEmail: @MainActor () -> Void = {}
    var onGoal: @MainActor () -> Void = {}
    var onTeacher: (@MainActor () -> Void)?
    let onLogout: @MainActor () -> Void

    var body: some View {
        let klass = studentClass(me)
        let wordCount = words?.summary.total ?? progress.wordsLearned
        let votes = progress.votes.total
        let summary = cells.summary
        let cellsTotal = min(24, summary.matured + summary.pending)
        VStack(spacing: TeleTauSpace.s400) {
            HStack(spacing: TeleTauSpace.s400) {
                HexAvatar(nickname: me.nickname, size: 88, lip: true)
                VStack(alignment: .leading, spacing: TeleTauSpace.s150) {
                    Text(me.nickname ?? "")
                        .teletauDisplay(TeleTauFontSize.title2, TeleTauFontWeight.black)
                        .foregroundStyle(TeleTauColor.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                    if let klass {
                        RichText(classTitleRuns(klass.title) + [.ru(" · \(klass.schoolName)")], size: TeleTauFontSize.callout, color: TeleTauColor.textSecondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.top, TeleTauSpace.s400)
            Grid(horizontalSpacing: TeleTauSpace.s250, verticalSpacing: TeleTauSpace.s250) {
                GridRow {
                    ProfileStat(icon: .fire, tint: TeleTauColor.streakFill, value: progress.streak.current,
                                label: Format.plural(progress.streak.current, ("день подряд", "дня подряд", "дней подряд")))
                    ProfileStat(icon: .drop, tint: TeleTauColor.accentFill, value: progress.honey.total, label: "мёда")
                }
                GridRow {
                    ProfileStat(icon: .bookOpen, tint: TeleTauColor.infoFill, value: wordCount, label: Format.plural(wordCount, ("слово", "слова", "слов")))
                    ProfileStat(icon: .scales, tint: TeleTauColor.violetBright, value: votes,
                                label: Format.plural(votes, ("голос", "голоса", "голосов")))
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Мои итоги"))
            if let achievements { AchievementsCard(data: achievements, onOpen: onAward) }
            WordsLink(words: words, action: onWords)
            // «Учусь сам» (ADR 0022): вход с другого устройства — личная карточка; взрослому — ещё и почта (на сайте).
            if let state = me.loginCard {
                ProfileLink(icon: .identificationCard, tint: TeleTauColor.accentText, background: TeleTauColor.accentSoft, title: "Моя карточка входа",
                            subtitle: state == .issued ? "Вход с другого устройства" : "Чтобы не потерять мёд и серию", action: onCard)
            }
            if me.kind == .adult, me.profile == nil {
                ProfileLink(icon: .envelopeSimple, tint: TeleTauColor.infoFill, background: TeleTauColor.infoSoft, title: "Сохранить прогресс по почте",
                            subtitle: "Вход с любого устройства", action: onEmail)
            }
            if let fresh { MaturedBanner(count: fresh.count, honey: fresh.honey) }
            VStack(alignment: .leading, spacing: TeleTauSpace.s300) {
                HStack(alignment: .top) {
                    CardTitle("Мой вклад в словарь", sub: cellsText(summary, total: cellsTotal))
                    if summary.matured > 0 { IllustrationView(.sceneWordAccepted, width: 96) }
                }
                if cellsTotal > 0 {
                    HoneyComb(total: cellsTotal, filled: min(summary.matured, cellsTotal), nectar: max(0, cellsTotal - summary.matured))
                }
            }
            .teletauCard()
            SettingsCard(me: me, onGoal: onGoal, onTeacher: onTeacher, onLogout: onLogout)
        }
        .padding(.bottom, TeleTauSpace.s600)
    }

    /// «7 в словаре · 5 ждут итога · +15 мёда созревает».
    private func cellsText(_ s: Components.Schemas.CellsSummary, total: Int) -> String {
        guard total > 0 else { return "Голосуй в «Помоги языку» на тропе." }
        return ["\(s.matured) в словаре",
                s.pending > 0 ? "\(s.pending) \(Format.plural(s.pending, ("ждёт", "ждут", "ждут"))) итога" : nil,
                s.honeyPending > 0 ? "+\(s.honeyPending) мёда созревает" : nil]
            .compactMap { $0 }
            .joined(separator: " · ")
    }
}

/// Настройки профиля: цель дня, звуки, тёмная тема, «Я учитель» (взрослому с почтой), выход.
struct SettingsCard: View {
    let me: Me
    let onGoal: @MainActor () -> Void
    var onTeacher: (@MainActor () -> Void)?
    let onLogout: @MainActor () -> Void
    @State private var sounds = UISound.shared.enabled
    @AppStorage(AppTheme.defaultsKey) private var theme: AppTheme = .light
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: TeleTauSpace.s300) {
                IconView(.target, size: TeleTauSize.icon).foregroundStyle(TeleTauColor.textTertiary)
                VStack(alignment: .leading, spacing: TeleTauSpace.s050) {
                    Text("Цель дня").teletauText(TeleTauFontSize.body, TeleTauFontWeight.semibold).foregroundStyle(TeleTauColor.textPrimary)
                    Text(DailyGoalChoice.title(me.dailyGoal)).teletauText(TeleTauFontSize.footnote).foregroundStyle(TeleTauColor.textSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
                LinkButton("Изменить", action: onGoal)
                    .accessibilityLabel(Text("Изменить цель дня"))
            }
            .padding(.vertical, TeleTauSpace.s150)
            .padding(.leading, TeleTauSpace.s200)
            divider
            Toggle(isOn: $sounds) {
                HStack(spacing: TeleTauSpace.s300) {
                    IconView(sounds ? .speakerHigh : .speakerSlash, size: TeleTauSize.icon).foregroundStyle(TeleTauColor.textTertiary)
                    Text("Звуки").teletauText(TeleTauFontSize.body, TeleTauFontWeight.semibold).foregroundStyle(TeleTauColor.textPrimary)
                }
            }
            .toggleStyle(TeleTauSwitchStyle())
            .frame(minHeight: TeleTauSize.touchMin)
            .padding(.vertical, TeleTauSpace.s150)
            .padding(.horizontal, TeleTauSpace.s200)
            .onChange(of: sounds) { _, on in
                UISound.shared.enabled = on
                if on { UISound.shared.play(.correct) }
            }
            divider
            // «Тёмная тема»: настройка устройства, сразу меняет тему всего приложения (корень — preferredColorScheme).
            // Положение — тема на экране: корень всегда задаёт схему выбора.
            Toggle(isOn: Binding(get: { colorScheme == .dark }, set: { theme = AppTheme(dark: $0) })) {
                HStack(spacing: TeleTauSpace.s300) {
                    IconView(.moon, size: TeleTauSize.icon).foregroundStyle(TeleTauColor.textTertiary)
                    Text("Тёмная тема").teletauText(TeleTauFontSize.body, TeleTauFontWeight.semibold).foregroundStyle(TeleTauColor.textPrimary)
                }
            }
            .toggleStyle(TeleTauSwitchStyle())
            .frame(minHeight: TeleTauSize.touchMin)
            .padding(.vertical, TeleTauSpace.s150)
            .padding(.horizontal, TeleTauSpace.s200)
            if let onTeacher, me.kind == .adult, me.teacherStatus == .none, me.profile != nil {
                divider
                Button(action: onTeacher) {
                    HStack(spacing: TeleTauSpace.s300) {
                        IconView(.chalkboardTeacher, size: TeleTauSize.icon).foregroundStyle(TeleTauColor.textTertiary)
                        Text("Я учитель").teletauText(TeleTauFontSize.body, TeleTauFontWeight.semibold).foregroundStyle(TeleTauColor.accentText)
                        Spacer()
                    }
                    .frame(minHeight: TeleTauSize.touchMin)
                    .padding(.horizontal, TeleTauSpace.s200)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            divider
            HStack {
                LinkButton("Выйти", icon: .signOut, tone: .danger, action: onLogout)
                Spacer()
            }
        }
        .teletauCard(padding: TeleTauSpace.s200)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Настройки"))
    }

    private var divider: some View {
        Rectangle().fill(TeleTauColor.borderSubtle).frame(height: TeleTauSpace.s050).padding(.horizontal, TeleTauSpace.s200)
    }
}

struct ProfileStat: View {
    let icon: TeleTauIcon
    let tint: Color
    let value: Int
    let label: String

    var body: some View {
        HStack(alignment: .top, spacing: TeleTauSpace.s250) {
            IconView(icon, size: TeleTauSize.iconLarge).foregroundStyle(tint)
            VStack(alignment: .leading, spacing: TeleTauSpace.s050) {
                Text("\(value)").teletauDisplay(TeleTauFontSize.title3, TeleTauFontWeight.black).monospacedDigit()
                    .foregroundStyle(TeleTauColor.textPrimary)
                Text(label).teletauText(TeleTauFontSize.label)
                    .foregroundStyle(TeleTauColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .teletauCard(padding: TeleTauSpace.s350, radius: TeleTauRadius.panel)
        .accessibilityElement(children: .combine)
    }
}

/// «Мёд созрел!»: с прошлого захода в профиль созрели варианты, за которые голосовал ученик.
struct MaturedBanner: View {
    let count: Int
    let honey: Int

    var body: some View {
        let plus = honey > 0 ? " · +\(honey) мёда" : ""
        let text = "\(count) \(Format.plural(count, ("перевод", "перевода", "переводов"))) с твоим голосом \(Format.plural(count, ("вошёл", "вошли", "вошли"))) в словарь\(plus)"
        HStack(spacing: TeleTauSpace.s300) {
            IllustrationView(.sceneHoneyMatured, width: 92)
            VStack(alignment: .leading, spacing: TeleTauSpace.s100) {
                Text("Мёд созрел!")
                    .teletauDisplay(TeleTauFontSize.headline, TeleTauFontWeight.black)
                    .foregroundStyle(TeleTauColor.accentText)
                Text(text)
                    .teletauText(TeleTauFontSize.footnote)
                    .foregroundStyle(TeleTauColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TeleTauSpace.s350)
        .background(TeleTauColor.accentSoft, in: RoundedRectangle(cornerRadius: TeleTauRadius.panel, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Класс ученика (первый, где он ученик).
func studentClass(_ me: Me?) -> Components.Schemas.MyClass? {
    me?.classes.first { $0.role == .student } ?? me?.classes.first
}
