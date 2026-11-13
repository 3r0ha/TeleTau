import Foundation
import TeleTauAPI
import TeleTauSession

public typealias NodeKind = Components.Schemas.NodeKind
public typealias LeagueTier = Components.Schemas.LeagueTier
public typealias StreakDay = Components.Schemas.StreakDay
public typealias DuelChoice = Components.Schemas.DuelChoice

/// Тексты и форматы экранов ученика — как в вебе (`apps/web/app/_components/learn/format.ts`).
public enum Format {
    /// Русское множественное число: plural(5, ("день", "дня", "дней")) → «дней».
    public static func plural(_ n: Int, _ forms: (String, String, String)) -> String {
        let a = abs(n) % 100, b = a % 10
        if a > 10 && a < 20 { return forms.2 }
        if b == 1 { return forms.0 }
        if (2...4).contains(b) { return forms.1 }
        return forms.2
    }

    /// «2:41» — время урока.
    public static func duration(_ seconds: Int) -> String {
        let s = max(0, seconds)
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }

    /// Лиги медоносов: именительный («Новая лига — Кипрей!») и родительный («Лига Донника») падежи.
    public static func tierName(_ tier: LeagueTier) -> (nom: String, gen: String) {
        switch tier {
        case .clover: ("Клевер", "Клевера")
        case .buckwheat: ("Гречиха", "Гречихи")
        case .sweetclover: ("Донник", "Донника")
        case .fireweed: ("Кипрей", "Кипрея")
        case .linden: ("Липа", "Липы")
        }
    }

    public static let tiers: [LeagueTier] = [.clover, .buckwheat, .sweetclover, .fireweed, .linden]

    /// «через 3 дня» / «сегодня» до конца недели лиги.
    public static func weekEndsIn(_ endsAt: Date, now: Date = Date()) -> String {
        let days = Int((endsAt.timeIntervalSince(now) / 86_400).rounded(.up))
        if days <= 1 { return "сегодня" }
        return "через \(days) \(plural(days, ("день", "дня", "дней")))"
    }

    private static let weekdays = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]

    /// «Пн» для даты учебных суток YYYY-MM-DD (сутки посчитал сервер по Уфе — здесь только день недели).
    public static func weekdayShort(_ date: String) -> String {
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return "" }
        var c = DateComponents()
        c.year = parts[0]; c.month = parts[1]; c.day = parts[2]; c.hour = 12
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        guard let d = cal.date(from: c) else { return "" }
        return weekdays[cal.component(.weekday, from: d) - 1]
    }

    private static let months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]

    /// «5 ноября» для даты учебных суток YYYY-MM-DD (день посчитал сервер по Уфе).
    public static func dayLong(_ date: String) -> String {
        let p = date.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3, (1...12).contains(p[1]) else { return "" }
        return "\(p[2]) \(months[p[1] - 1])"
    }

    /// «№07» — номер места.
    public static func seat(_ n: Int) -> String { "№" + String(format: "%02d", n) }

    /// Есть ли в строке особые башкирские буквы (литера класса «5 «Ҡ»» — тогда `lang="ba"`).
    public static func hasBashkirLetters(_ s: String) -> Bool {
        s.unicodeScalars.contains { [0x04D9, 0x04D8, 0x04E9, 0x04E8, 0x04AF, 0x04AE, 0x0493, 0x0492, 0x04A1, 0x04A0, 0x04A3, 0x04A2, 0x0499, 0x0498, 0x04AB, 0x04AA, 0x04BB, 0x04BA].contains($0.value) }
    }
}

/// Понятный ребёнку текст ошибки API, на «ты» (`describeProblem(e, "child")` веба). Неизвестный `code` — по статусу.
public enum ChildText {
    static let byCode: [String: String] = [
        "card_invalid": "Карточка не найдена. Покажи её учителю.",
        "card_revoked": "Эта карточка больше не действует. Возьми у учителя новую.",
        "card_reissued": "У тебя новая карточка. Войди по ней.",
        "session_revoked": "Вход завершён. Войди снова по карточке.",
        "account_blocked": "Аккаунт заблокирован. Обратитесь к администрации.",
        "consent_revoked": "Вход по этой карточке закрыт. Подойди к учителю.",
        "class_archived": "Этот класс закрыт. Подойди к учителю.",
        "payload_invalid": "Это не карточка ученика. Покажи свою карточку.",
        "class_code_not_found": "Код не подходит. Проверь буквы или попроси новый код.",
        "rate_limited": "Много попыток. Подожди минуту.",
        "join_queue_full": "У учителя много заявок. Попробуй чуть позже.",
        "nickname_not_allowed": "Этот ник нельзя выбрать. Выбери другой.",
        "join_request_closed": "Заявка закрыта. Введи код ещё раз.",
        "request_in_progress": "Отправляем, подожди секунду.",
        // «Учусь сам» (ADR 0022)
        "already_in_class": "Ты уже в классе.",
        "login_card_unavailable": "Входи по карточке от учителя.",
        // Испытание для перехода: место уже открыто или ещё недоступно
        "jump_unavailable": "Испытание сейчас недоступно.",
    ]

    /// Личная карточка: другие советы, чем у карточки места от учителя.
    static let personalCard: [String: String] = [
        "card_invalid": "Карточка не найдена. Сделай новую в профиле на устройстве, где ты уже вошёл.",
        "card_revoked": "Эта карточка больше не действует: ты сделал новую. Покажи её.",
    ]

    public static func describe(_ error: APIError) -> String {
        switch error {
        case .offline:
            return "Нет связи. Проверь интернет."
        case .signedOut(let reason):
            return reason.flatMap { byCode[$0] } ?? "Нужно войти заново."
        case .unexpected:
            return "Что-то пошло не так. Попробуй ещё раз."
        case .problem(let p):
            if p.status == 429, let after = p.retryAfter, after <= 2 { return "Секунду, много входов. Попробуй ещё раз." }
            if let code = p.code, let text = byCode[code] { return text }
            switch p.status {
            case 401: return "Нужно войти заново."
            case 403: return "Сюда нельзя."
            case 404: return "Ничего не нашлось."
            case 409: return "Так сделать сейчас нельзя."
            case 410: return "Это больше недоступно."
            case 422:
                if let first = p.fieldDetails.first, first.range(of: "[А-Яа-яЁё]", options: .regularExpression) != nil { return first }
                return "Проверь, что всё заполнено."
            case 429: return byCode["rate_limited"]!
            case 503: return "Сервер недоступен. Попробуй через минуту."
            default: return "Что-то сломалось. Попробуй ещё раз."
            }
        }
    }
}

/// Загрузка данных экрана.
public enum Loadable<Value: Sendable>: Sendable {
    case loading
    case loaded(Value)
    case failed(APIError)

    public var value: Value? {
        if case .loaded(let v) = self { v } else { nil }
    }

    public var error: APIError? {
        if case .failed(let e) = self { e } else { nil }
    }
}

/// Задания учителя (ADR 0021): подписи для ученика — как `assignments.ts` веба. Сроки — даты по Уфе (YYYY-MM-DD).
public enum AssignmentText {
    private static func dayNumber(_ date: String) -> Int? {
        let p = date.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        var c = DateComponents()
        c.year = p[0]; c.month = p[1]; c.day = p[2]
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal.date(from: c).map { Int(($0.timeIntervalSince1970 / 86_400).rounded()) }
    }

    /// Что задано: «Привет!», «Испытание места «Уфа»» или «Повторить слова».
    public static func title(_ a: Components.Schemas.StudentAssignment) -> String {
        switch a.kind {
        case .review: a.titleRu
        case .placeTest: a.placeRu.map { "Испытание места «\($0)»" } ?? a.titleRu
        case .lesson: "«\(a.titleRu)»"
        }
    }

    /// Срок для ученика: «до пт», «до завтра», «сегодня последний день», «до 12 ноября».
    public static func due(_ dueOn: String, today: String) -> String {
        guard let d = dayNumber(dueOn), let t = dayNumber(today) else { return "" }
        let days = d - t
        if days <= 0 { return "сегодня последний день" }
        if days == 1 { return "до завтра" }
        if days < 7 { return "до \(Format.weekdayShort(dueOn).lowercased())" }
        return "до \(Format.dayLong(dueOn))"
    }

    /// Учебные сутки по Уфе (Asia/Yekaterinburg) для момента `now`.
    public static func ufaDay(_ now: Date = Date()) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Yekaterinburg")!
        let c = cal.dateComponents([.year, .month, .day], from: now)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }
}
