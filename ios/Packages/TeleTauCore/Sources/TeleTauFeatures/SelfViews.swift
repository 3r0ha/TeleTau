import AuthCodes
import CoreImage
import CoreImage.CIFilterBuiltins
import DesignSystem
import TeleTauAPI
import TeleTauSession
import SwiftUI
#if canImport(UIKit)
import Photos
import UIKit
#endif

// «Учусь сам» (ADR 0022): старт с двумя путями ученика, онбординг без ПДн (возраст диапазоном → ник → цель дня),
// личная карточка входа, вступление в класс по коду. Тексты — как в вебе (apps/web/test/screens/self/*).

// MARK: - Выбор строкой

/// Строка выбора (ChoiceGroup веба): метка слева по желанию, название, пояснение, галочка у выбранной.
struct ChoiceRow<Mark: View>: View {
    let title: String
    var detail: String?
    let selected: Bool
    let action: @MainActor () -> Void
    @ViewBuilder var mark: Mark
    @Environment(\.teletauMode) private var mode

    var body: some View {
        Button(action: action) {
            HStack(spacing: TeleTauSpace.s300) {
                mark
                VStack(alignment: .leading, spacing: TeleTauSpace.s050) {
                    Text(title).teletauText(TeleTauFontSize.bodyLarge, TeleTauFontWeight.medium).foregroundStyle(TeleTauColor.textPrimary)
                    if let detail {
                        Text(detail).teletauText(TeleTauFontSize.footnote).foregroundStyle(TeleTauColor.textSecondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if selected {
                    IconView(.check, size: 14)
                        .foregroundStyle(TeleTauColor.accentOn)
                        .frame(width: 26, height: 26)
                        .background(TeleTauColor.accentFill, in: Circle())
                }
            }
            .padding(.horizontal, TeleTauSpace.s400)
            .padding(.vertical, TeleTauSpace.s300)
            .frame(minHeight: max(56, mode.touchTarget))
        }
        .buttonStyle(TileButtonStyleProxy(selected: selected))
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

extension ChoiceRow where Mark == EmptyView {
    init(title: String, detail: String? = nil, selected: Bool, action: @escaping @MainActor () -> Void) {
        self.init(title: title, detail: detail, selected: selected, action: action) { EmptyView() }
    }
}

/// Рамка и «губа» строки выбора: выбранная — граница `accentText` и медовая подложка (не только цветом — ещё галочка).
struct TileButtonStyleProxy: ButtonStyle {
    let selected: Bool

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: TeleTauRadius.button, style: .continuous)
        let edge = selected ? TeleTauColor.accentText : TeleTauColor.borderDefault
        configuration.label
            .background(selected ? TeleTauColor.accentSoft : TeleTauColor.surface, in: shape)
            .overlay { shape.strokeBorder(edge, lineWidth: TeleTauSpace.s050) }
            .offset(y: configuration.isPressed ? TeleTauSize.lipSmall : 0)
            .padding(.bottom, TeleTauSize.lipSmall)
            .background { shape.fill(edge).padding(.top, TeleTauSize.lipSmall) }
    }
}

// MARK: - Старт

/// Старт (web `/`): два пути ученика — «Я ученик» (класс: карточка или код от учителя) и «Учусь сам» (без школы) —
/// и «Я учитель» (кабинет — на сайте). Открытая на устройстве сессия — ник, «Продолжить» и «Это не я».
struct StartView: View {
    let account: Me?
    let onStudent: @MainActor () -> Void
    let onSelf: @MainActor () -> Void
    let onTeacher: @MainActor () -> Void
    let onEmail: @MainActor () -> Void
    let onResume: @MainActor () -> Void
    let onNotMe: @MainActor () -> Void
    let onSettings: @MainActor () -> Void

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .topLeading) {
                IllustrationFill(.heroLanding, height: 370, anchor: UnitPoint(x: 0.62, y: 0.5))
                VStack(alignment: .leading, spacing: TeleTauSpace.s150) {
                    // «ТелеТау» — имя бренда, needs_native_review (docs/native-review-queue.md, №1).
                    BashkirText("ТелеТау", size: TeleTauFontSize.display, weight: TeleTauFontWeight.black, color: TeleTauColor.textOnFill)
                        .fixedSize()
                        .accessibilityAddTraits(.isHeader)
                    Text("Башкирский язык\nкаждый день")
                        .teletauDisplay(TeleTauFontSize.callout, TeleTauFontWeight.extrabold)
                        .foregroundStyle(TeleTauColor.textOnFill)
                }
                .padding(.top, TeleTauSpace.s800)
                .padding(.leading, TeleTauSpace.s500)
                HStack {
                    Spacer()
                    Button(action: onSettings) {
                        IconView(.gearSix, size: TeleTauSize.icon)
                            .foregroundStyle(TeleTauColor.textOnFill.opacity(0.7))
                            .frame(width: TeleTauSize.touchMin, height: TeleTauSize.touchMin)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Адрес сервера"))
                }
                .padding(TeleTauSpace.s200)
            }
            TeleTauScroll {
                VStack(spacing: TeleTauSpace.s300) {
                    if let account, account.nickname != nil || account.kind == .child {
                        VStack(spacing: TeleTauSpace.s300) {
                            HStack(spacing: TeleTauSpace.s300) {
                                if account.nickname != nil { HexAvatar(nickname: account.nickname, size: 48, lip: true) }
                                Text(account.nickname ?? (account.kind == .child ? "Вход ученика открыт" : "Вход по почте открыт"))
                                    .teletauDisplay(TeleTauFontSize.headline, TeleTauFontWeight.black)
                                    .foregroundStyle(TeleTauColor.textPrimary)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            TeleTauButton("Продолжить", action: onResume)
                            LinkButton("Это не я", tone: .neutral, action: onNotMe)
                        }
                        .teletauCard()
                    }
                    StartWay(art: .sceneClassHive, title: "Я ученик", text: "С классом: карточка или код", action: onStudent)
                    StartWay(art: .beeRead, title: "Учусь сам", text: "Без класса, в любом возрасте", action: onSelf)
                    StartWay(art: .beeTeacher, title: "Я учитель", text: "Класс и задания", action: onTeacher)
                    HStack(spacing: TeleTauSpace.s100) {
                        Text("Войти:").teletauText(TeleTauFontSize.footnote).foregroundStyle(TeleTauColor.textSecondary)
                        inlineLink("по карточке", action: onStudent)
                        Text("·").teletauText(TeleTauFontSize.footnote).foregroundStyle(TeleTauColor.textSecondary)
                        inlineLink("по почте", action: onEmail)
                    }
                    .frame(maxWidth: .infinity)
                }
                .padding(.horizontal, TeleTauSpace.s400)
                .padding(.top, TeleTauSpace.s600)
                .padding(.bottom, TeleTauSpace.s450)
                .frame(maxWidth: TeleTauSize.columnNarrow)
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Кто ты?"))
            }
        }
        .background(TeleTauColor.bg.ignoresSafeArea())
    }

    private func inlineLink(_ title: String, action: @escaping @MainActor () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .teletauText(TeleTauFontSize.footnote, TeleTauFontWeight.bold)
                .underline()
                .foregroundStyle(TeleTauColor.accentText)
                .frame(minHeight: TeleTauSize.touchMin)
        }
        .buttonStyle(.plain)
    }
}

/// Путь на старте: плитка с картинкой из серии, названием и строкой пояснения.
struct StartWay: View {
    let art: Illustration
    let title: String
    let text: String
    let action: @MainActor () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TeleTauSpace.s300) {
                IllustrationView(art, width: 72)
                VStack(alignment: .leading, spacing: TeleTauSpace.s050) {
                    Text(title).teletauDisplay(TeleTauFontSize.headline, TeleTauFontWeight.black).foregroundStyle(TeleTauColor.textPrimary)
                    Text(text).teletauText(TeleTauFontSize.footnote).foregroundStyle(TeleTauColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                IconView(.caretRight, size: TeleTauSize.iconSmall).foregroundStyle(TeleTauColor.accentText)
            }
            .padding(.vertical, TeleTauSpace.s300)
            .padding(.horizontal, TeleTauSpace.s400)
        }
        .buttonStyle(TileButtonStyleProxy(selected: false))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Онбординг «Учусь сам»

/// Цель дня: 1, 2 или 3 урока (по умолчанию 2), слева — соты: сколько уроков, столько ячеек мёда.
enum DailyGoalChoice {
    static let all = [1, 2, 3]
    static let standard = 2

    static func title(_ g: Int?) -> String {
        switch g ?? standard {
        case 1: "1 урок в день"
        case 3: "3 урока в день"
        default: "2 урока в день"
        }
    }

    static func detail(_ g: Int) -> String {
        switch g {
        case 1: "5 минут"
        case 3: "15 минут"
        default: "10 минут"
        }
    }
}

struct GoalPicker: View {
    @Binding var goal: Int

    var body: some View {
        VStack(spacing: TeleTauSpace.s250) {
            ForEach(DailyGoalChoice.all, id: \.self) { g in
                ChoiceRow(title: DailyGoalChoice.title(g), detail: DailyGoalChoice.detail(g), selected: goal == g, action: { goal = g }) {
                    HoneyComb(total: 3, filled: g)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Цель на день"))
    }
}

/// «Учусь сам»: возраст диапазоном → ник из словаря → сразу тропа. Цель дня — 2 урока по умолчанию, меняется в профиле
/// (отдельного шага цели нет ради короткого старта, docs/plans/M2-copy-student.md). Ничего личного.
struct SelfOnboardingView: View {
    enum Step: Int { case age, nick }

    let backend: any StudentBackend
    let onBack: @MainActor () -> Void
    let onStarted: @MainActor (Me) -> Void
    var preset: (step: Step, age: AgeBand?, nicks: [NicknameSuggestion]?)?

    @State private var step: Step = .age
    @State private var age: AgeBand?
    @State private var busy = false
    @State private var error: String?

    init(backend: any StudentBackend, onBack: @escaping @MainActor () -> Void, onStarted: @escaping @MainActor (Me) -> Void,
         preset: (step: Step, age: AgeBand?, nicks: [NicknameSuggestion]?)? = nil) {
        self.backend = backend
        self.onBack = onBack
        self.onStarted = onStarted
        self.preset = preset
        _step = State(initialValue: preset?.step ?? .age)
        _age = State(initialValue: preset?.age)
    }

    static let ages: [(AgeBand, String)] = [(.age710, "7–10 лет"), (.age1114, "11–14 лет"), (.age1517, "15–17 лет"), (.adult, "18 и старше")]

    var body: some View {
        VStack(spacing: 0) {
            SimpleTopBar(title: "Учусь сам") {
                if step == .nick { step = .age } else { onBack() }
            }
            TeleTauScroll {
                Column {
                    VStack(alignment: .leading, spacing: TeleTauSpace.s600) {
                        TeleTauProgressBar(value: Double(step.rawValue + 1), total: 2, label: "Шаг")
                            .accessibilityValue(Text("Шаг \(step.rawValue + 1) из 2"))
                        HStack(alignment: .bottom, spacing: TeleTauSpace.s200) {
                            PageTitle(Text(step == .age ? "Сколько тебе лет?" : "Выбери ник"))
                            IllustrationView(step == .age ? .beeRead : .beeThink, width: 84)
                        }
                        switch step {
                        case .age:
                            VStack(spacing: TeleTauSpace.s250) {
                                ForEach(Self.ages, id: \.0) { band, label in
                                    ChoiceRow(title: label, selected: age == band) { age = band }
                                }
                            }
                            TeleTauButton("Дальше") { step = .nick }.disabled(age == nil)
                        case .nick:
                            NicknamePicker(backend: backend, submitLabel: "Начать", submitting: busy, error: error, onPick: { picked in
                                Task { await start(picked) }
                            }, preset: preset?.nicks)
                        }
                    }
                    .padding(.vertical, TeleTauSpace.s400)
                }
            }
        }
        .background(TeleTauColor.bg.ignoresSafeArea())
    }

    private func start(_ nick: NicknameSuggestion) async {
        guard let age else { step = .age; return }
        busy = true
        error = nil
        do {
            onStarted(try await backend.createSelf(nicknameId: nick.id, ageBand: age, dailyGoal: nil))
        } catch {
            self.error = ChildText.describe(APIError.from(error))
            busy = false
        }
    }
}

// MARK: - Личная карточка входа

/// QR из полезной нагрузки (CoreImage `CIQRCodeGenerator`, коррекция M): тёмные модули — непрозрачные, остальное —
/// прозрачное, чтобы закрасить токеном. Без тихой зоны — её даёт отступ в вёрстке.
enum QRImage {
    static func mask(_ payload: String) -> CGImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(payload.utf8)
        filter.correctionLevel = "M"
        guard let qr = filter.outputImage else { return nil }
        let invert = CIFilter.colorInvert()
        invert.inputImage = qr
        let alpha = CIFilter.maskToAlpha()
        alpha.inputImage = invert.outputImage
        guard let out = alpha.outputImage else { return nil }
        return CIContext(options: [.useSoftwareRenderer: true]).createCGImage(out, from: out.extent)
    }
}

/// QR карточки: тёмные модули на белом в обеих темах (камеры не читают «негатив»), тихая зона — 4 модуля.
struct CardQR: View {
    let payload: String
    var side: CGFloat = 220

    var body: some View {
        Group {
            if let mask = QRImage.mask(payload) {
                let modules = CGFloat(mask.width)
                Image(decorative: mask, scale: 1)
                    .resizable()
                    .interpolation(.none)
                    .renderingMode(.template)
                    .foregroundStyle(TeleTauColor.textOnFill)
                    .padding(side / (modules + 8) * 4)
            }
        }
        .frame(width: side, height: side)
        .background(TeleTauColor.highlight)
        .accessibilityElement()
        .accessibilityLabel(Text("QR-код карточки входа"))
        .accessibilityAddTraits(.isImage)
    }
}

/// Картинка карточки для Фото (1080 × 1350 px): название, ник, QR и шаги входа — светлые цвета для печати и фото.
struct LoginCardPoster: View {
    let card: PersonalLoginCard
    let nickname: String
    let site: String

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 28, style: .continuous)
        VStack(spacing: TeleTauSpace.s300) {
            // «ТелеТау» — имя бренда, needs_native_review (docs/native-review-queue.md, №1).
            BashkirText("ТелеТау", size: 42, weight: TeleTauFontWeight.black, alignment: .center).fixedSize()
            Text("Карточка входа").teletauText(TeleTauFontSize.headline, TeleTauFontWeight.semibold).foregroundStyle(TeleTauColor.textSecondary)
            Text(nickname).teletauDisplay(26, TeleTauFontWeight.black).foregroundStyle(TeleTauColor.textPrimary)
            CardQR(payload: card.payload, side: 300)
            VStack(spacing: TeleTauSpace.s150) {
                Text("1. Открой «ТелеТау» или \(site)")
                Text("2. «Я ученик» → «Сканировать карточку»")
                Text("3. Наведи камеру на этот код")
            }
            .teletauText(TeleTauFontSize.bodyLarge, TeleTauFontWeight.semibold)
            .foregroundStyle(TeleTauColor.textSecondary)
            Text("Выпуск \(card.version) · не показывай карточку чужим")
                .teletauText(TeleTauFontSize.footnote, TeleTauFontWeight.semibold)
                .foregroundStyle(TeleTauColor.textSecondary)
        }
        .padding(TeleTauSpace.s800)
        .frame(width: 480, height: 600)
        .background(TeleTauColor.surface, in: shape)
        .background { shape.fill(TeleTauColor.accentLip).offset(y: TeleTauSpace.s200) }
        .padding(TeleTauSpace.s500)
        .frame(width: 540, height: 675)
        .background(TeleTauColor.bgSunken)
        .environment(\.colorScheme, .light)
    }
}

/// «Моя карточка входа»: QR для входа на другом устройстве, «Сохранить картинку» в Фото, «Потерял карточку — сделать
/// новую» (старая перестаёт работать, вход на других устройствах закрывается).
struct LoginCardView: View {
    let backend: any StudentBackend
    let me: Me
    let site: String
    let onBack: @MainActor () -> Void
    var preset: Loadable<PersonalLoginCard?>?

    @State private var card: Loadable<PersonalLoginCard?>

    init(backend: any StudentBackend, me: Me, site: String, onBack: @escaping @MainActor () -> Void, preset: Loadable<PersonalLoginCard?>? = nil) {
        self.backend = backend
        self.me = me
        self.site = site
        self.onBack = onBack
        self.preset = preset
        _card = State(initialValue: preset ?? .loading)
    }
    @State private var busy = false
    @State private var saving = false
    @State private var confirm = false
    @State private var message: (text: String, ok: Bool)?

    var body: some View {
        VStack(spacing: 0) {
            SimpleTopBar(title: "Карточка входа", back: onBack)
            TeleTauScroll {
                Column {
                    content.padding(.vertical, TeleTauSpace.s400)
                }
            }
        }
        .background(TeleTauColor.bg.ignoresSafeArea())
        .overlay {
            if confirm {
                TeleTauDialog(art: .beeThink, title: "Сделать новую карточку?",
                            text: "Старая перестанет работать.") {
                    TeleTauButton("Сделать новую", loading: busy) { Task { await issue() } }
                    LinkButton("Отмена", tone: .neutral) { confirm = false }
                }
            }
        }
        .task {
            if preset != nil { return }
            await load()
        }
    }

    @ViewBuilder
    private var content: some View {
        switch card {
        case .loading:
            LoadingBlock(rows: 2, label: "Загружаем карточку")
        case .failed(let e):
            LoadErrorView(error: e) { Task { await load() } }
        case .loaded(nil):
            EmptyStateView(art: .beeRead, title: "Сделай карточку входа",
                           text: "С ней войдёшь с любого устройства, мёд и серия сохранятся.") {
                TeleTauButton("Сделать карточку", loading: busy) { Task { await issue() } }
                if let message, !message.ok { InlineAlert(message.text, tone: .danger) }
            }
        case .loaded(let value?):
            VStack(alignment: .leading, spacing: TeleTauSpace.s600) {
                PageTitle(Text("Моя карточка входа"), lead: "На другом устройстве: «Я ученик» → «Сканировать карточку».")
                VStack(spacing: TeleTauSpace.s400) {
                    HStack(spacing: TeleTauSpace.s300) {
                        HexAvatar(nickname: me.nickname, size: 44, lip: true)
                        Text(me.nickname ?? "").teletauDisplay(TeleTauFontSize.headline, TeleTauFontWeight.black).foregroundStyle(TeleTauColor.textPrimary)
                    }
                    CardQR(payload: value.payload)
                    Text("Выпуск \(value.version)").teletauText(TeleTauFontSize.footnote).foregroundStyle(TeleTauColor.textTertiary)
                }
                .padding(TeleTauSpace.s600)
                .frame(maxWidth: .infinity)
                .background(TeleTauColor.surface, in: RoundedRectangle(cornerRadius: TeleTauRadius.card, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: TeleTauRadius.card, style: .continuous).strokeBorder(TeleTauColor.accentSoftBorder, lineWidth: TeleTauSpace.s050) }
                .background { RoundedRectangle(cornerRadius: TeleTauRadius.card, style: .continuous).fill(TeleTauColor.accentFill).offset(y: TeleTauSize.lip) }
                HStack(alignment: .top, spacing: TeleTauSpace.s200) {
                    IconView(.identificationCard, size: TeleTauSize.iconSmall).foregroundStyle(TeleTauColor.accentText)
                    Text("Не показывай карточку чужим.")
                        .teletauText(TeleTauFontSize.footnote)
                        .foregroundStyle(TeleTauColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let message { InlineAlert(message.text, tone: message.ok ? .success : .danger) }
                VStack(spacing: TeleTauSpace.s200) {
                    TeleTauButton("Сохранить картинку", icon: .downloadSimple, loading: saving) { Task { await save(value) } }
                    LinkButton("Сделать новую карточку", icon: .arrowsClockwise, tone: .neutral) { confirm = true }
                        .disabled(busy)
                }
            }
        }
    }

    private func load() async {
        card = .loading
        do { card = .loaded(try await backend.loginCard()) } catch { card = .failed(APIError.from(error)) }
    }

    private func issue() async {
        busy = true
        message = nil
        do {
            card = .loaded(try await backend.issueLoginCard())
        } catch {
            message = (ChildText.describe(APIError.from(error)), false)
        }
        busy = false
        confirm = false
    }

    private func save(_ value: PersonalLoginCard) async {
        saving = true
        defer { saving = false }
        let renderer = ImageRenderer(content: LoginCardPoster(card: value, nickname: me.nickname ?? "", site: site))
        renderer.scale = 2
        #if canImport(UIKit)
        guard let image = renderer.uiImage else { message = ("Не получилось сохранить картинку. Сделай снимок экрана.", false); return }
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else {
            message = ("Разреши сохранять в Фото в настройках или сделай снимок экрана.", false)
            return
        }
        do {
            try await PHPhotoLibrary.shared().performChanges { PHAssetChangeRequest.creationRequestForAsset(from: image) }
            message = ("Картинка сохранена в Фото.", true)
        } catch {
            message = ("Не получилось сохранить картинку. Сделай снимок экрана.", false)
        }
        #else
        message = ("Не получилось сохранить картинку. Сделай снимок экрана.", false)
        #endif
    }
}

// MARK: - Вступить в класс

/// «Вступить в класс» (ADR 0022): ученик «Учусь сам» вводит код с доски — учитель видит заявку с его ником и пускает
/// в класс. Аккаунт тот же: мёд, серия и слова остаются.
struct JoinClassView: View {
    let backend: any StudentBackend
    let nickname: String
    let onBack: @MainActor () -> Void
    let onJoined: @MainActor () async -> Void
    @State private var code = ""
    @State private var codeError: String?
    @State private var busy = false
    @State private var ticket: ClassJoinTicket?

    init(backend: any StudentBackend, nickname: String, onBack: @escaping @MainActor () -> Void, onJoined: @escaping @MainActor () async -> Void,
         preset: ClassJoinTicket? = nil) {
        self.backend = backend
        self.nickname = nickname
        self.onBack = onBack
        self.onJoined = onJoined
        _ticket = State(initialValue: preset)
    }
    @State private var pollError: String?

    var body: some View {
        VStack(spacing: 0) {
            SimpleTopBar(title: "Вступить в класс", back: onBack)
            TeleTauScroll {
                Column {
                    content.padding(.vertical, TeleTauSpace.s400)
                }
            }
        }
        .background(TeleTauColor.bg.ignoresSafeArea())
        .task(id: ticket?.requestId) { await poll() }
    }

    @ViewBuilder
    private var content: some View {
        if let ticket, ticket.status == .rejected || ticket.status == .expired {
            let rejected = ticket.status == .rejected
            EmptyStateView(art: .beeSympathy, title: rejected ? "Учитель не принял заявку" : "Заявка устарела",
                           text: rejected ? "Подойди к учителю и попробуй ещё раз." : "Попроси учителя показать код ещё раз.") {
                TeleTauButton("Ввести код", action: again)
            }
        } else if let ticket {
            let runs: [TextRun] = [.ru("Класс ")] + classTitleRuns(ticket._class.title)
                + [.ru(". Скажи учителю свой ник: "), .ru("«\(nickname)»", TeleTauFontWeight.bold), .ru(".")]
            EmptyStateView(art: .beeIdle, title: "Ждём учителя") {
                RichText(runs, size: TeleTauFontSize.body, color: TeleTauColor.textSecondary, alignment: .center)
            } actions: {
                if let pollError { InlineAlert(pollError, tone: .danger) }
                LinkButton("Отменить", tone: .neutral, action: again)
            }
        } else {
            VStack(alignment: .leading, spacing: TeleTauSpace.s600) {
                PageTitle(Text("Введи код класса"), lead: "Он на доске. Мёд и серия останутся с тобой.")
                CodeCells(code: $code, error: codeError) { Task { await submit() } }
                TeleTauButton("Отправить заявку", loading: busy) { Task { await submit() } }
                    .disabled(Crockford.normalizeInput(code).unicodeScalars.count < ClassCodeCodec.length)
            }
        }
    }

    private func again() {
        ticket = nil
        code = ""
        pollError = nil
    }

    private func submit() async {
        switch ClassCodeCodec.parse(code) {
        case .failure(let e):
            codeError = switch e {
            case .empty: "Введи код с доски."
            case .invalidCharacter: "Только латинские буквы и цифры."
            case .invalidLength: "В коде 6 символов."
            }
        case .success(let parsed):
            busy = true
            codeError = nil
            do { ticket = try await backend.joinClass(code: parsed.code) } catch { codeError = ChildText.describe(APIError.from(error)) }
            busy = false
        }
    }

    /// Опрос раз в `pollIntervalSeconds`; учитель пустил — класс уже в `GET /me`.
    private func poll() async {
        guard let current = ticket, current.status == .pending else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(max(1, current.pollIntervalSeconds)))
            guard !Task.isCancelled, let id = ticket?.requestId else { return }
            do {
                let status = try await backend.joinStatus(requestId: id)
                pollError = nil
                if status.status == .approved {
                    await onJoined()
                    return
                }
                if status.status != .pending { ticket = status; return }
            } catch {
                let e = APIError.from(error)
                if e.problem?.status == 404 {
                    ticket?.status = .expired
                    return
                }
                pollError = e.isOffline ? "Нет связи. Заявка не потеряется." : ChildText.describe(e)
            }
        }
    }
}

/// Вкладка «Класс» без класса: ученику — «Вступить в класс» по коду, взрослому — в лигу (класс — для школьников).
struct NoClassView: View {
    let me: Me
    let onJoin: @MainActor () -> Void
    let onLeague: @MainActor () -> Void

    var body: some View {
        if me.kind == .child {
            EmptyStateView(art: .sceneClassHive, title: "Класса пока нет", text: "Попроси у учителя код класса.") {
                TeleTauButton("Вступить в класс", action: onJoin)
            }
            .padding(.top, TeleTauSpace.s1000)
        } else {
            EmptyStateView(art: .beeIdle, title: "Класс — для школьников", text: "Соревнуйся в лиге.") {
                TeleTauButton("В лигу", variant: .secondary, action: onLeague)
            }
            .padding(.top, TeleTauSpace.s1000)
        }
    }
}

/// Чем войти снова — по тому, как ученик сюда попал (ADR 0022).
enum LeaveText {
    /// «Учусь сам» без карточки и без почты: после выхода вернуться в этот аккаунт будет нечем.
    static func noWayBack(_ me: Me) -> Bool {
        // Явно `LoginCardStatus.none`: у Optional `.none` значило бы «поля нет».
        me.loginCard == Components.Schemas.LoginCardStatus.none && me.profile == nil && studentClass(me) == nil
    }

    static func text(_ me: Me) -> String {
        if noWayBack(me) { return "Без неё мёд и серию не вернуть." }
        if me.loginCard == .issued { return "Войти снова можно по твоей карточке." }
        if me.kind == .adult { return "Войти снова можно по почте." }
        return "Войти снова можно по карточке или коду класса."
    }
}

/// «Цель дня» в профиле: 1, 2 или 3 урока (`PATCH /me dailyGoal`).
struct GoalDialog: View {
    @Binding var goal: Int
    let busy: Bool
    let error: String?
    let onSave: @MainActor () -> Void
    let onClose: @MainActor () -> Void

    var body: some View {
        ZStack {
            TeleTauColor.scrim.opacity(0.45).ignoresSafeArea().onTapGesture(perform: onClose)
            VStack(alignment: .leading, spacing: TeleTauSpace.s400) {
                HStack {
                    Text("Цель дня").teletauDisplay(TeleTauFontSize.title3, TeleTauFontWeight.black).foregroundStyle(TeleTauColor.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                    IconButton(.x, label: "Закрыть", action: onClose)
                }
                GoalPicker(goal: $goal)
                if let error { InlineAlert(error, tone: .danger) }
                TeleTauButton("Сохранить", loading: busy, action: onSave)
            }
            .padding(TeleTauSpace.s600)
            .background(TeleTauColor.surface, in: RoundedRectangle(cornerRadius: TeleTauRadius.sheet, style: .continuous))
            .padding(.horizontal, TeleTauSpace.s400)
            .frame(maxWidth: TeleTauSize.columnNarrow)
            .accessibilityAddTraits(.isModal)
        }
    }
}
