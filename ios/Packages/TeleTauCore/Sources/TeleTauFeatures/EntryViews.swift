import AuthCodes
import DesignSystem
import TeleTauAPI
import TeleTauSession
import PhotosUI
import SwiftUI

/// Адрес сервера для демо (например, `192.168.1.5:4000`): кнопка-шестерёнка на старте.
struct ServerSettingsView: View {
    let current: URL
    /// Адрес сайта, если его задали здесь (пусто — тот же хост на порту веба).
    let currentWeb: String?
    let defaultWeb: URL
    let onSave: @MainActor (String, String) async -> Bool
    let onClose: @MainActor () -> Void
    @State private var text: String = ""
    @State private var web: String = ""
    @State private var invalid = false

    var body: some View {
        VStack(alignment: .leading, spacing: TeleTauSpace.s400) {
            HStack {
                Text("Адрес сервера")
                    .teletauDisplay(TeleTauFontSize.title3, TeleTauFontWeight.black)
                    .foregroundStyle(TeleTauColor.textPrimary)
                Spacer()
                IconButton(.x, label: "Закрыть", action: onClose)
            }
            field("192.168.1.5:4000", text: $text, label: "Адрес сервера")
            Text("Адрес сайта")
                .teletauDisplay(TeleTauFontSize.headline, TeleTauFontWeight.black)
                .foregroundStyle(TeleTauColor.textPrimary)
            field(defaultWeb.absoluteString, text: $web, label: "Адрес сайта")
            if invalid { InlineAlert("Не похоже на адрес. Пример: 192.168.1.5:4000", tone: .danger) }
            TeleTauButton("Сохранить") {
                Task { if await onSave(text, web) { onClose() } else { invalid = true } }
            }
            Spacer()
        }
        .padding(TeleTauSpace.s400)
        .background(TeleTauColor.bg.ignoresSafeArea())
        .onAppear {
            text = current.absoluteString
            web = currentWeb ?? ""
        }
    }

    private func field(_ placeholder: String, text: Binding<String>, label: String) -> some View {
        TextField(placeholder, text: text)
            .textContentType(.URL)
            #if canImport(UIKit)
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            #endif
            .autocorrectionDisabled()
            .teletauText(TeleTauFontSize.bodyLarge)
            .padding(TeleTauSpace.s300)
            .background(TeleTauColor.surface, in: RoundedRectangle(cornerRadius: TeleTauRadius.tile, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: TeleTauRadius.tile, style: .continuous).strokeBorder(TeleTauColor.borderStrong, lineWidth: TeleTauSpace.s050) }
            .accessibilityLabel(Text(label))
    }
}

// MARK: - Вход по карточке

/// Вход ученика (web `/student`): сканер QR-карточки камерой, фото карточки и путь без карточки — по коду класса.
/// В QR — только полезная нагрузка `TT1.…` (ADR 0016); её проверяет порт `auth-codes` до отправки.
struct ScanView: View {
    let backend: any StudentBackend
    let endedReason: String?
    let onBack: @MainActor () -> Void
    let onNoCard: @MainActor () -> Void
    let onSignedIn: @MainActor (Me) -> Void

    enum Camera: Equatable { case off, on, error(String) }

    @State private var camera: Camera = .off
    @State private var busy = false
    @State private var error: String?
    @State private var photo: PhotosPickerItem?
    @Environment(\.teletauStaticRender) private var staticRender

    var body: some View {
        VStack(spacing: 0) {
            SimpleTopBar(title: "Вход ученика", back: onBack)
            TeleTauScroll {
                Column {
                    VStack(alignment: .leading, spacing: TeleTauSpace.s600) {
                        PageTitle(Text("Покажи карточку камере"))
                        frame
                        VStack(spacing: TeleTauSpace.s250) {
                            if let endedReason, error == nil, !busy {
                                InlineAlert(ChildText.describe(.signedOut(reason: endedReason)), tone: .honey)
                            }
                            if let error { InlineAlert(error, tone: .danger) }
                            if case .error(let message) = camera { InlineAlert(message, tone: .danger) }
                        }
                        VStack(spacing: TeleTauSpace.s250) {
                            PhotosPicker(selection: $photo, matching: .images) {
                                PhotoButtonLabel()
                            }
                            .buttonStyle(LipButtonStyleProxy())
                            .disabled(busy)
                            TeleTauButton("Ввести код класса", icon: .keyboard, variant: .secondary, action: onNoCard)
                        }
                    }
                    .padding(.vertical, TeleTauSpace.s400)
                }
            }
        }
        .background(TeleTauColor.bg.ignoresSafeArea())
        .onChange(of: photo) { _, item in
            guard let item else { return }
            Task { await decodePhoto(item) }
        }
    }

    @ViewBuilder
    private var frame: some View {
        let shape = RoundedRectangle(cornerRadius: TeleTauRadius.card, style: .continuous)
        ZStack {
            if camera == .on && !staticRender {
                #if canImport(UIKit)
                QRCameraView(onCode: { text in camera = .off; Task { await login(text) } }, onError: { failure in
                    camera = .error(Self.cameraText(failure))
                })
                .clipShape(shape)
                #endif
                ScanCorners().padding(TeleTauSpace.s800).allowsHitTesting(false)
                VStack {
                    Spacer()
                    Text("Держи карточку ровно")
                        .teletauDisplay(TeleTauFontSize.callout, TeleTauFontWeight.extrabold)
                        .foregroundStyle(TeleTauColor.textPrimary)
                        .padding(.vertical, TeleTauSpace.s150)
                        .padding(.horizontal, TeleTauSpace.s350)
                        .background(TeleTauColor.surface.opacity(0.9), in: Capsule())
                    LinkButton("Выключить камеру", icon: .cameraSlash, tone: .neutral) { camera = .off }
                        .background(TeleTauColor.surface.opacity(0.9), in: Capsule())
                        .padding(.bottom, TeleTauSpace.s300)
                }
            } else {
                VStack(spacing: TeleTauSpace.s400) {
                    IconView(.qrCode, size: 72).foregroundStyle(TeleTauColor.textTertiary)
                    TeleTauButton(busy ? "Входим…" : "Сканировать карточку", icon: .camera, loading: busy) {
                        error = nil
                        camera = .on
                    }
                    .frame(maxWidth: 280)
                }
                .padding(TeleTauSpace.s600)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 300)
        .background(camera == .on ? TeleTauColor.scrim : TeleTauColor.bgSunken, in: shape)
        .overlay { shape.strokeBorder(TeleTauColor.borderDefault, style: StrokeStyle(lineWidth: TeleTauSpace.s050, dash: camera == .on ? [] : [6, 6])) }
    }

    #if canImport(UIKit)
    static func cameraText(_ failure: QRCameraView.CameraFailure) -> String {
        switch failure {
        case .denied: "Нет доступа к камере. Разреши его в настройках или загрузи фото карточки."
        case .notFound: "Камера не найдена. Загрузи фото карточки."
        case .unavailable: "Камера не включилась. Загрузи фото карточки."
        }
    }
    #endif

    private func decodePhoto(_ item: PhotosPickerItem) async {
        error = nil
        camera = .off
        defer { photo = nil }
        guard let data = try? await item.loadTransferable(type: Data.self), let text = QRDecoder.decode(imageData: data) else {
            error = "QR-код не виден. Сфотографируй карточку ближе и ровнее."
            return
        }
        await login(text)
    }

    /// Вход по тексту из QR: проверка полезной нагрузки до отправки; по виду карточки — `POST /auth/qr` (TT1,
    /// карточка места от учителя) или `POST /auth/login-card` (TP1, личная карточка «Учусь сам»).
    private func login(_ raw: String) async {
        guard case .success(let card) = LoginCardCodec.parse(raw) else {
            error = "Это не карточка ученика. Попробуй ещё раз."
            return
        }
        busy = true
        AccessibilityNotification.Announcement("Карточка найдена, входим").post()
        defer { busy = false }
        do {
            switch card.kind {
            case .seat: onSignedIn(try await backend.loginWithQr(payload: card.payload))
            case .personal: onSignedIn(try await backend.loginWithCard(payload: card.payload))
            }
        } catch {
            let e = APIError.from(error)
            self.error = card.kind == .personal ? e.problem?.code.flatMap { ChildText.personalCard[$0] } ?? ChildText.describe(e) : ChildText.describe(e)
        }
    }
}

private struct PhotoButtonLabel: View {
    @Environment(\.teletauMode) private var mode
    var body: some View {
        HStack(spacing: TeleTauSpace.s200) {
            IconView(.imageSquare, size: TeleTauSize.iconSmall)
            Text("Загрузить фото").teletauDisplay(TeleTauFontSize.button, TeleTauFontWeight.extrabold)
        }
        .padding(.horizontal, TeleTauSpace.s500)
        .frame(maxWidth: .infinity, minHeight: mode.buttonHeight)
    }
}

/// Вторичная кнопка с «губой» для PhotosPicker (у него своя метка, не `TeleTauButton`).
struct LipButtonStyleProxy: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        LipButtonStyleBridge(configuration: configuration)
    }
}

private struct LipButtonStyleBridge: View {
    let configuration: ButtonStyleConfiguration
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: TeleTauRadius.button, style: .continuous)
        configuration.label
            .foregroundStyle(isEnabled ? TeleTauColor.accentText : TeleTauColor.lockedText)
            .background(isEnabled ? TeleTauColor.surface : TeleTauColor.lockedFill, in: shape)
            .overlay { if isEnabled { shape.strokeBorder(TeleTauColor.borderDefault, lineWidth: TeleTauSpace.s050) } }
            .offset(y: configuration.isPressed ? TeleTauSize.lip : 0)
            .padding(.bottom, TeleTauSize.lip)
            .background { shape.fill(isEnabled ? TeleTauColor.borderDefault : TeleTauColor.lockedLip).padding(.top, TeleTauSize.lip) }
    }
}

/// Уголки рамки сканера.
struct ScanCorners: View {
    var body: some View {
        GeometryReader { geo in
            let s = min(geo.size.width, geo.size.height)
            let l: CGFloat = 36
            Path { p in
                let r = CGRect(x: (geo.size.width - s) / 2, y: (geo.size.height - s) / 2, width: s, height: s)
                p.move(to: CGPoint(x: r.minX, y: r.minY + l)); p.addLine(to: CGPoint(x: r.minX, y: r.minY)); p.addLine(to: CGPoint(x: r.minX + l, y: r.minY))
                p.move(to: CGPoint(x: r.maxX - l, y: r.minY)); p.addLine(to: CGPoint(x: r.maxX, y: r.minY)); p.addLine(to: CGPoint(x: r.maxX, y: r.minY + l))
                p.move(to: CGPoint(x: r.maxX, y: r.maxY - l)); p.addLine(to: CGPoint(x: r.maxX, y: r.maxY)); p.addLine(to: CGPoint(x: r.maxX - l, y: r.maxY))
                p.move(to: CGPoint(x: r.minX + l, y: r.maxY)); p.addLine(to: CGPoint(x: r.minX, y: r.maxY)); p.addLine(to: CGPoint(x: r.minX, y: r.maxY - l))
            }
            .stroke(TeleTauColor.accentFill, style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round))
        }
    }
}

// MARK: - Код класса

/// Вход без карточки (ADR 0016 §6): код класса с доски → ник из словаря → заявка учителю.
struct ClassCodeView: View {
    let backend: any StudentBackend
    let onBack: @MainActor () -> Void
    let onTicket: @MainActor (JoinTicket) -> Void

    enum Step { case code, nick }
    @State private var step: Step = .code
    @State private var code = ""
    @State private var codeError: String?
    @State private var submitting = false
    @State private var submitError: String?

    var body: some View {
        VStack(spacing: 0) {
            SimpleTopBar(title: "Вход по коду класса") {
                if step == .nick { step = .code } else { onBack() }
            }
            TeleTauScroll {
                Column {
                    VStack(alignment: .leading, spacing: TeleTauSpace.s600) {
                        TeleTauProgressBar(value: step == .code ? 1 : 2, total: 2, label: "Шаг входа", valueText: step == .code ? "Шаг 1 из 2" : "Шаг 2 из 2")
                        PageTitle(Text(step == .code ? "Введи код класса" : "Выбери ник"), lead: step == .code ? "Он на доске." : "По нему учитель узнает тебя.")
                        if step == .code {
                            CodeCells(code: $code, error: codeError) { next() }
                            TeleTauButton("Дальше") { next() }
                                .disabled(Crockford.normalizeInput(code).unicodeScalars.count < ClassCodeCodec.length)
                        } else {
                            NicknamePicker(backend: backend, submitLabel: "Отправить заявку", submitting: submitting, error: submitError) { nick in
                                Task { await submit(nick) }
                            }
                        }
                    }
                    .padding(.vertical, TeleTauSpace.s400)
                }
            }
        }
        .background(TeleTauColor.bg.ignoresSafeArea())
    }

    private func next() {
        switch ClassCodeCodec.parse(code) {
        case .success:
            codeError = nil
            step = .nick
        case .failure(let e):
            codeError = switch e {
            case .empty: "Введи код с доски."
            case .invalidCharacter: "Только латинские буквы и цифры."
            case .invalidLength: "В коде 6 символов."
            }
        }
    }

    private func submit(_ nick: NicknameSuggestion) async {
        guard case .success(let parsed) = ClassCodeCodec.parse(code) else { step = .code; return }
        submitting = true
        submitError = nil
        do {
            let t = try await backend.requestClassCode(code: parsed.code, nicknameId: nick.id)
            onTicket(JoinTicket(requestId: t.requestId, pollToken: t.pollToken, expiresAt: t.expiresAt,
                                pollIntervalSeconds: t.pollIntervalSeconds, classTitle: t._class.title, nickname: nick.text))
        } catch {
            submitting = false
            let e = APIError.from(error)
            if e.problem?.code == "class_code_not_found" {
                codeError = ChildText.describe(e)
                step = .code
            } else {
                submitError = ChildText.describe(e)
            }
        }
    }
}

/// Шесть ячеек кода «ABC-DEF»: под ними одно невидимое поле, ввод нормализуется портом `auth-codes`.
struct CodeCells: View {
    @Binding var code: String
    let error: String?
    let onSubmit: @MainActor () -> Void
    @FocusState private var focused: Bool
    @Environment(\.teletauMode) private var mode

    var body: some View {
        let chars = Array(Crockford.normalizeInput(code).unicodeScalars.prefix(ClassCodeCodec.length)).map { String($0) }
        VStack(alignment: .leading, spacing: TeleTauSpace.s200) {
            ZStack {
                TextField("", text: $code)
                    .focused($focused)
                    #if canImport(UIKit)
                    .textInputAutocapitalization(.characters)
                    #endif
                    .autocorrectionDisabled()
                    .opacity(0.02)
                    .onSubmit(onSubmit)
                    .onChange(of: code) { _, v in
                        let normalized = String(String.UnicodeScalarView(Crockford.normalizeInput(v).unicodeScalars.prefix(ClassCodeCodec.length)))
                        if normalized != v { code = normalized }
                    }
                    .accessibilityLabel(Text("Код класса"))
                HStack(spacing: TeleTauSpace.s150) {
                    ForEach(0..<ClassCodeCodec.length, id: \.self) { i in
                        if i == 3 {
                            Text("–").teletauDisplay(TeleTauFontSize.title2, TeleTauFontWeight.black).foregroundStyle(TeleTauColor.textTertiary)
                        }
                        let shape = RoundedRectangle(cornerRadius: TeleTauRadius.tile, style: .continuous)
                        Text(i < chars.count ? chars[i] : " ")
                            .teletauDisplay(TeleTauFontSize.title2, TeleTauFontWeight.black)
                            .foregroundStyle(TeleTauColor.textPrimary)
                            .frame(maxWidth: 56, minHeight: max(56, mode.touchTarget))
                            .frame(maxWidth: .infinity)
                            .background(TeleTauColor.surface, in: shape)
                            .overlay {
                                shape.strokeBorder(error != nil ? TeleTauColor.dangerText : (focused && i == min(chars.count, 5) ? TeleTauColor.focus : TeleTauColor.borderStrong),
                                                   lineWidth: TeleTauSpace.s050)
                            }
                    }
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
            .onTapGesture { focused = true }
            if let error { InlineAlert(error, tone: .danger) }
        }
        .onAppear { focused = true }
    }
}

// MARK: - Ник

/// Выбор ника из словаря: три варианта из `GET /nicknames/suggest` и «Другие варианты». Свободного ввода нет (ADR 0009).
struct NicknamePicker: View {
    let backend: any StudentBackend
    let submitLabel: String
    let submitting: Bool
    let error: String?
    let onPick: @MainActor (NicknameSuggestion) -> Void
    var preset: [NicknameSuggestion]?
    @State private var items: Loadable<[NicknameSuggestion]>

    init(backend: any StudentBackend, submitLabel: String, submitting: Bool, error: String?, onPick: @escaping @MainActor (NicknameSuggestion) -> Void,
         preset: [NicknameSuggestion]? = nil) {
        self.backend = backend
        self.submitLabel = submitLabel
        self.submitting = submitting
        self.error = error
        self.onPick = onPick
        self.preset = preset
        _items = State(initialValue: preset.map { .loaded($0) } ?? .loading)
    }
    @State private var picked: String?
    @State private var round = 0

    var body: some View {
        VStack(spacing: TeleTauSpace.s300) {
            switch items {
            case .loading:
                ForEach(0..<3, id: \.self) { _ in Skeleton(height: 60, radius: TeleTauRadius.button) }
            case .failed(let e):
                InlineAlert(ChildText.describe(e), tone: .danger)
                TeleTauButton("Попробовать снова", icon: .arrowsClockwise, variant: .secondary) { round += 1 }
            case .loaded(let list):
                ForEach(list, id: \.id) { nick in
                    NicknameRow(nick: nick, selected: picked == nick.id) { picked = nick.id }
                }
                LinkButton("Другие варианты", icon: .arrowsClockwise) {
                    picked = nil
                    round += 1
                }
                .disabled(submitting)
            }
            if let error { InlineAlert(error, tone: .danger) }
            TeleTauButton(submitLabel, loading: submitting) {
                if let nick = items.value?.first(where: { $0.id == picked }) { onPick(nick) }
            }
            .disabled(picked == nil)
        }
        .task(id: round) {
            if let preset, round == 0 { items = .loaded(preset); return }
            items = .loading
            do { items = .loaded(try await backend.suggestNicknames(count: 3)) } catch { items = .failed(APIError.from(error)) }
        }
    }
}

struct NicknameRow: View {
    let nick: NicknameSuggestion
    let selected: Bool
    let action: @MainActor () -> Void
    @Environment(\.teletauMode) private var mode

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: TeleTauRadius.button, style: .continuous)
        Button(action: action) {
            HStack(spacing: TeleTauSpace.s300) {
                HexAvatar(nickname: nick.text, size: 36)
                Text(nick.text)
                    .teletauText(TeleTauFontSize.bodyLarge, TeleTauFontWeight.semibold)
                    .foregroundStyle(TeleTauColor.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                ZStack {
                    Circle().strokeBorder(selected ? TeleTauColor.accentText : TeleTauColor.borderStrong, lineWidth: TeleTauSpace.s050)
                    if selected { IconView(.check, size: 14).foregroundStyle(TeleTauColor.accentOn).frame(width: 24, height: 24).background(TeleTauColor.accentFill, in: Circle()) }
                }
                .frame(width: 24, height: 24)
            }
            .padding(.horizontal, TeleTauSpace.s400)
            .padding(.vertical, TeleTauSpace.s250)
            .frame(minHeight: max(60, mode.touchTarget))
            .background(selected ? TeleTauColor.accentSoft : TeleTauColor.surface, in: shape)
            .overlay { shape.strokeBorder(selected ? TeleTauColor.accentText : TeleTauColor.borderDefault, lineWidth: TeleTauSpace.s050) }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

/// Первый вход по карточке: выбор ника (`PATCH /me`). Если карточка чужая — можно выйти, не выбирая ник.
struct NicknameView: View {
    let backend: any StudentBackend
    let onChosen: @MainActor (Me) -> Void
    let onNotMine: @MainActor () -> Void
    @State private var submitting = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            SimpleTopBar(title: "Твой ник")
            TeleTauScroll {
                Column {
                    VStack(alignment: .leading, spacing: TeleTauSpace.s600) {
                        PageTitle(Text("Выбери ник"), lead: "Так тебя увидят в классе.")
                        NicknamePicker(backend: backend, submitLabel: "Выбрать", submitting: submitting, error: error) { nick in
                            Task {
                                submitting = true
                                error = nil
                                do { onChosen(try await backend.chooseNickname(nick.id)) } catch {
                                    self.error = ChildText.describe(APIError.from(error))
                                    submitting = false
                                }
                            }
                        }
                        LinkButton("Это не моя карточка", icon: .signOut, tone: .neutral, action: onNotMine)
                            .frame(maxWidth: .infinity)
                    }
                    .padding(.vertical, TeleTauSpace.s400)
                }
            }
        }
        .background(TeleTauColor.bg.ignoresSafeArea())
    }
}

// MARK: - Ожидание учителя

/// «Ждём, пока учитель подтвердит»: опрос заявки раз в `pollIntervalSeconds`; при одобрении — сессия и класс.
struct WaitView: View {
    let backend: any StudentBackend
    let ticket: JoinTicket
    let onApproved: @MainActor (Me) -> Void
    let onAgain: @MainActor () -> Void
    let onLeave: @MainActor () -> Void

    enum Status: Equatable { case pending, missing, rejected, expired, consumed, closed(title: String, text: String) }
    @State private var status: Status = .pending
    @State private var offline = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            SimpleTopBar(title: "Вход по коду класса")
            TeleTauScroll {
                Column {
                    VStack(spacing: TeleTauSpace.s300) {
                        content
                        if offline { InlineAlert("Нет связи. Заявка не потеряется.", tone: .honey) }
                        if let error { InlineAlert(error, tone: .danger) }
                    }
                    .padding(.vertical, TeleTauSpace.s400)
                }
            }
        }
        .background(TeleTauColor.bg.ignoresSafeArea())
        .task(id: ticket.requestId) { await poll() }
    }

    @ViewBuilder
    private var content: some View {
        switch status {
        case .pending:
            let runs: [TextRun] = [.ru("Класс ")] + classTitleRuns(ticket.classTitle)
                + [.ru(". Скажи учителю свой ник: "), .ru("«\(ticket.nickname)»", TeleTauFontWeight.bold), .ru(".")]
            EmptyStateView(art: .beeIdle, title: "Ждём учителя") {
                RichText(runs, size: TeleTauFontSize.body, color: TeleTauColor.textSecondary, alignment: .center)
            } actions: {
                LinkButton("Выйти", icon: .signOut, tone: .neutral, action: onLeave)
            }
        case .missing:
            EmptyStateView(art: .beeThink, title: "Заявки нет", text: "Введи код класса заново.") {
                TeleTauButton("Ввести код", action: onAgain)
            }
        case .rejected:
            EmptyStateView(art: .beeSympathy, title: "Учитель не принял заявку", text: "Подойди к учителю и попробуй ещё раз.") {
                TeleTauButton("Ввести код", action: onAgain)
            }
        case .expired:
            EmptyStateView(art: .beeSleep, title: "Заявка устарела", text: "Попроси учителя показать код ещё раз.") {
                TeleTauButton("Ввести код", action: onAgain)
            }
        case .consumed:
            EmptyStateView(art: .beeThink, title: "Вход уже выполнен", text: "Если это был не ты, введи код заново.") {
                TeleTauButton("Ввести код", action: onAgain)
            }
        case .closed(let title, let text):
            EmptyStateView(art: .beeSympathy, title: title, text: text) {
                TeleTauButton("Выйти", action: onLeave)
            }
        }
    }

    private func poll() async {
        while !Task.isCancelled {
            var delay = max(1, ticket.pollIntervalSeconds)
            do {
                let res = try await backend.pollClassCode(requestId: ticket.requestId, pollToken: ticket.pollToken)
                offline = false
                error = nil
                if let auth = res.session {
                    onApproved(auth.account)
                    return
                }
                switch res.status {
                case .pending: delay = max(1, res.pollIntervalSeconds)
                case .rejected: status = .rejected; return
                case .expired: status = .expired; return
                case .consumed, .approved: status = .consumed; return
                }
            } catch {
                let e = APIError.from(error)
                if let p = e.problem, p.status == 404 { status = .missing; return }
                if let p = e.problem, p.status == 403 {
                    status = p.code == "class_archived"
                        ? .closed(title: "Класс закрыт", text: ChildText.describe(e))
                        : .closed(title: "Вход закрыт", text: "Подойди к учителю.")
                    return
                }
                offline = e.isOffline
                if !e.isOffline { self.error = ChildText.describe(e) }
                delay = max(3, ticket.pollIntervalSeconds)
            }
            try? await Task.sleep(for: .seconds(delay))
        }
    }
}

// MARK: - Ты в классе

/// «Ты в классе 5 «Б»»: итог первого входа (после выбора ника или одобрения заявки).
struct JoinedView: View {
    let me: Me
    let onTrail: @MainActor () -> Void
    let onLogout: @MainActor () -> Void
    @State private var leaving = false

    var body: some View {
        let klass = studentClass(me)
        VStack(spacing: 0) {
            HStack {
                BashkirText("ТелеТау", size: TeleTauFontSize.headline, weight: TeleTauFontWeight.black).fixedSize()
                Spacer()
                IconButton(.signOut, label: "Выйти") { leaving = true }
            }
            .padding(.horizontal, TeleTauSpace.s400)
            .frame(minHeight: 60)
            TeleTauScroll {
                Column {
                    VStack(spacing: TeleTauSpace.s400) {
                        IllustrationView(.sceneClassHive, width: 200, label: "Пчёлы класса летят к общей борти")
                        RichText(klass.map { [.display("Ты в классе ")] + classTitleRuns($0.title, kind: .display, weight: TeleTauFontWeight.black) } ?? [.display("Вход выполнен")],
                                 size: TeleTauFontSize.title1, alignment: .center)
                            .accessibilityAddTraits(.isHeader)
                        if let klass {
                            Text(klass.schoolName).teletauText(TeleTauFontSize.body).foregroundStyle(TeleTauColor.textSecondary)
                        }
                        HStack(spacing: TeleTauSpace.s400) {
                            HexAvatar(nickname: me.nickname, size: 64, lip: true, badge: klass?.seatNumber.map { String(format: "%02d", $0) })
                            VStack(alignment: .leading, spacing: TeleTauSpace.s200) {
                                Text(me.nickname ?? "Ник не выбран")
                                    .teletauDisplay(TeleTauFontSize.headline, TeleTauFontWeight.black)
                                    .foregroundStyle(TeleTauColor.textPrimary)
                                if let seat = klass?.seatNumber { Chip("Место \(Format.seat(seat))") }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .teletauCard()
                        TeleTauButton("На тропу", icon: .path, action: onTrail)
                            .padding(.top, TeleTauSpace.s400)
                    }
                    .padding(.vertical, TeleTauSpace.s600)
                }
            }
        }
        .background(TeleTauColor.bg.ignoresSafeArea())
        .overlay {
            if leaving {
                TeleTauDialog(art: .beeSympathy, title: "Уже уходишь?", text: "Войти снова можно по карточке или коду класса.") {
                    TeleTauButton("Остаться") { leaving = false }
                    LinkButton("Выйти", tone: .danger, action: onLogout)
                }
            }
        }
    }
}
