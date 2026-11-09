// Порт packages/auth-codes (TS): QR-карточка ученика и код класса (ADR 0016).
// Формат и шаги разбора — contracts/test-vectors/qr-card/README.md; порт проходит те же векторы
// (Tests/AuthCodesTests). Клиенту нужен только разбор: генерация и хеширование секретов — на сервере;
// функции «из байтов» здесь — чтобы проверить на векторах одинаковое преобразование «байты → символы».

/// Наборы векторов, которые реализует этот порт (как `SUPPORTED_VERSIONS` у `bashkir-text`).
public enum AuthCodes {
    public static let supportedVersions: [String: Int] = [
        "qr-card/parse.json": 2,
        "qr-card/build.json": 2,
        "qr-card/generate.json": 2,
        "class-code/parse.json": 1,
        "class-code/generate.json": 1,
        "login-card/parse.json": 2,
        "login-card/build.json": 2,
        "login-card/generate.json": 2,
    ]
}

// MARK: - Crockford base32

/// Алфавит base32 Crockford: 32 символа без I, L, O, U. Значение символа — его индекс.
public enum Crockford {
    public static let alphabet: [Character] = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")

    private static let values: [Unicode.Scalar: Int] = {
        var map: [Unicode.Scalar: Int] = [:]
        for (index, ch) in alphabet.enumerated() { map[ch.unicodeScalars.first!] = index }
        return map
    }()

    /// Значение символа канонического алфавита или nil.
    public static func value(of scalar: Unicode.Scalar) -> Int? { values[scalar] }

    /// Все символы строки — из канонического алфавита (после нормализации).
    public static func isCanonical(_ s: String) -> Bool {
        s.unicodeScalars.allSatisfy { values[$0] != nil }
    }

    /// Символ = байт & 31: 256 делится на 32, поэтому из равномерных байтов получаются равномерные символы.
    public static func symbols(from bytes: some Sequence<UInt8>) -> String {
        String(bytes.map { alphabet[Int($0 & 31)] })
    }

    /// Удаляемые при ручном вводе символы: пробелы (включая неразрывные) и дефисы, тире, минус.
    private static let removed: Set<UInt32> = [
        0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x0020, 0x00A0, 0x2007, 0x202F,
        0x002D, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2212,
    ]

    /// Замены после перевода ASCII в верхний регистр: похожие символы (O→0, I→1, L→1) и кириллические двойники
    /// латинских букв и цифр. Башкирские буквы (Ҡ, Ҙ, Ө…) намеренно не заменяются: это другие буквы.
    private static let substitutes: [UInt32: Unicode.Scalar] = [
        0x4F: "0", 0x49: "1", 0x4C: "1",
        0x0410: "A", 0x0412: "B", 0x0421: "C", 0x0415: "E", 0x041D: "H", 0x041A: "K",
        0x041C: "M", 0x041E: "0", 0x0420: "P", 0x0422: "T", 0x0425: "X", 0x0423: "Y", 0x0417: "3",
        0x0430: "A", 0x0432: "B", 0x0441: "C", 0x0435: "E", 0x043D: "H", 0x043A: "K",
        0x043C: "M", 0x043E: "0", 0x0440: "P", 0x0442: "T", 0x0445: "X", 0x0443: "Y", 0x0437: "3",
    ]

    /// Нормализация ручного ввода кода (общая для полезной нагрузки QR и кода класса):
    /// 1) удалить пробелы и дефисы; 2) ASCII a–z → A–Z; 3) замены двойников. Остальное сохраняется —
    /// его отвергает проверка алфавита. Работает по кодовым точкам, не по графемам.
    public static func normalizeInput(_ input: String) -> String {
        var out = String.UnicodeScalarView()
        for scalar in input.unicodeScalars {
            let cp = scalar.value
            if removed.contains(cp) { continue }
            let upper = (0x61...0x7A).contains(cp) ? cp - 0x20 : cp
            if let sub = substitutes[upper] {
                out.append(sub)
            } else if let s = Unicode.Scalar(upper) {
                out.append(s)
            }
        }
        return String(out)
    }
}

// MARK: - QR-карточка

public struct QrCard: Equatable, Sendable {
    /// Идентификатор места, 10 символов Crockford.
    public let seat: String
    /// Секрет, 26 символов Crockford.
    public let secret: String
    /// Каноническая полезная нагрузка `TT1.<seat>.<secret>.<check>`.
    public let payload: String
}

public enum QrParseError: String, Error, Sendable, CaseIterable {
    case empty
    case unknownPrefix = "unknown_prefix"
    case unsupportedVersion = "unsupported_version"
    case invalidFormat = "invalid_format"
    case invalidCharacter = "invalid_character"
    case badChecksum = "bad_checksum"
}

public enum QrCardCodec {
    public static let prefix = "TT1"
    public static let seatLength = 10
    public static let secretLength = 26
    public static let checkLength = 2
    public static let linkPath = "/q#"
    private static let checkModulus = 1021

    /// Контрольная сумма: число, записанное цифрами base32 строки `seat + secret`, по модулю 1021, двумя символами.
    public static func checksum(seat: String, secret: String) -> String? {
        var r = 0
        for scalar in (seat + secret).unicodeScalars {
            guard let v = Crockford.value(of: scalar) else { return nil }
            r = (r * 32 + v) % checkModulus
        }
        return String([Crockford.alphabet[r / 32], Crockford.alphabet[r % 32]])
    }

    /// Каноническая полезная нагрузка из места и секрета; nil — части не по формату.
    public static func buildPayload(seat: String, secret: String) -> String? {
        guard seat.unicodeScalars.count == seatLength, Crockford.isCanonical(seat),
              secret.unicodeScalars.count == secretLength, Crockford.isCanonical(secret),
              let check = checksum(seat: seat, secret: secret) else { return nil }
        return "\(prefix).\(seat).\(secret).\(check)"
    }

    /// Ссылка `<baseUrl>/q#<payload>`: завершающий `/` базового адреса не удваивается.
    public static func buildLink(baseURL: String, payload: String) -> String {
        var base = Substring(baseURL)
        while base.hasSuffix("/") { base = base.dropLast() }
        return "\(base)\(linkPath)\(payload)"
    }

    /// Карточка из 36 готовых байтов: первые 10 — место, следующие 26 — секрет (детерминированно; для векторов).
    public static func card(fromRandomBytes bytes: [UInt8]) -> QrCard? {
        guard bytes.count == seatLength + secretLength else { return nil }
        let seat = Crockford.symbols(from: bytes[0..<seatLength])
        let secret = Crockford.symbols(from: bytes[seatLength...])
        guard let payload = buildPayload(seat: seat, secret: secret) else { return nil }
        return QrCard(seat: seat, secret: secret, payload: payload)
    }

    /// Разбор того, что дал сканер или ввёл человек: ссылка `…/q#<payload>` или сама полезная нагрузка.
    /// Порядок проверок — как в эталоне: фрагмент после первого `#` → нормализация → префикс/версия →
    /// число сегментов → алфавит → длины → контрольная сумма.
    public static func parse(_ input: String) -> Result<QrCard, QrParseError> {
        let scalars = input.unicodeScalars
        let raw: String
        if let hash = scalars.firstIndex(of: "#") {
            raw = String(scalars[scalars.index(after: hash)...])
        } else {
            raw = input
        }
        let normalized = Crockford.normalizeInput(raw)
        if normalized.unicodeScalars.isEmpty { return .failure(.empty) }

        // Режем по кодовым точкам, а не по графемам: «.» с комбинируемым знаком — всё равно разделитель, как в TS.
        let parts = normalized.unicodeScalars
            .split(separator: ".", omittingEmptySubsequences: false)
            .map { String(String.UnicodeScalarView($0)) }
        let head = parts[0]
        if Array(head.unicodeScalars) != Array(prefix.unicodeScalars) {
            return .failure(isVersionedPrefix(head) ? .unsupportedVersion : .unknownPrefix)
        }
        guard parts.count == 4 else { return .failure(.invalidFormat) }
        let seat = parts[1], secret = parts[2], check = parts[3]
        // Алфавит — раньше длины: после него все символы ASCII, и длина одинакова во всех портах.
        guard Crockford.isCanonical(seat), Crockford.isCanonical(secret), Crockford.isCanonical(check) else {
            return .failure(.invalidCharacter)
        }
        guard seat.unicodeScalars.count == seatLength,
              secret.unicodeScalars.count == secretLength,
              check.unicodeScalars.count == checkLength else { return .failure(.invalidFormat) }
        guard let expected = checksum(seat: seat, secret: secret),
              Array(expected.unicodeScalars) == Array(check.unicodeScalars) else { return .failure(.badChecksum) }
        return .success(QrCard(seat: seat, secret: secret, payload: "\(prefix).\(seat).\(secret).\(check)"))
    }

    /// `TT<цифры>` — другая версия формата.
    private static func isVersionedPrefix(_ s: String) -> Bool {
        let u = Array(s.unicodeScalars)
        guard u.count > 2, u[0] == "T", u[1] == "T" else { return false }
        return u[2...].allSatisfy { (0x30...0x39).contains($0.value) }
    }
}

// MARK: - Код класса

public struct ClassCode: Equatable, Sendable {
    /// Канонический вид: 6 символов без разделителей.
    public let code: String
    /// Для показа: `ABC-DEF`.
    public let display: String
}

public enum ClassCodeParseError: String, Error, Sendable, CaseIterable {
    case empty
    case invalidCharacter = "invalid_character"
    case invalidLength = "invalid_length"
}

public enum ClassCodeCodec {
    public static let length = 6
    /// Срок жизни кода класса, секунд.
    public static let ttlSeconds = 15 * 60

    /// `ABC-DEF` из канонического кода.
    public static func format(_ code: String) -> String {
        let s = Array(code.unicodeScalars)
        let head = String(String.UnicodeScalarView(s.prefix(3)))
        let tail = String(String.UnicodeScalarView(s.dropFirst(3)))
        return "\(head)-\(tail)"
    }

    /// Код из 6 готовых байтов (детерминированно; для векторов).
    public static func code(fromRandomBytes bytes: [UInt8]) -> ClassCode? {
        guard bytes.count == length else { return nil }
        let code = Crockford.symbols(from: bytes)
        return ClassCode(code: code, display: format(code))
    }

    /// Разбор ручного ввода: нормализация → алфавит → длина (недопустимый символ важнее неверной длины).
    public static func parse(_ input: String) -> Result<ClassCode, ClassCodeParseError> {
        let code = Crockford.normalizeInput(input)
        if code.unicodeScalars.isEmpty { return .failure(.empty) }
        guard Crockford.isCanonical(code) else { return .failure(.invalidCharacter) }
        guard code.unicodeScalars.count == length else { return .failure(.invalidLength) }
        return .success(ClassCode(code: code, display: format(code)))
    }
}

// MARK: - Личная карточка входа (ADR 0022)

/// Вид карточки входа: карточка места класса (`TT1`, ADR 0016) или личная карточка «Учусь сам» (`TP1`, ADR 0022).
public enum LoginCardKind: String, Sendable, Equatable {
    case seat
    case personal
}

public struct LoginCard: Equatable, Sendable {
    public let kind: LoginCardKind
    /// Идентификатор: у карточки места — `seat`, у личной — `handle`.
    public let handle: String
    public let secret: String
    /// Каноническая полезная нагрузка.
    public let payload: String
}

/// Личная карточка `TP1.<handle>.<secret>.<check>`: те же длины, алфавит и нормализация, что у `TT1`; контрольная
/// сумма — по строке `P + handle + secret`, поэтому подмена префикса TT1 ↔ TP1 всегда даёт `bad_checksum`
/// (contracts/test-vectors/login-card/README.md).
public enum LoginCardCodec {
    public static let personalPrefix = "TP1"
    /// Разделитель назначения контрольной суммы личной карточки.
    public static let domain = "P"

    public static func personalChecksum(handle: String, secret: String) -> String? {
        QrCardCodec.checksum(seat: domain + handle, secret: secret)
    }

    /// Каноническая полезная нагрузка личной карточки; nil — части не по формату.
    public static func buildPersonal(handle: String, secret: String) -> String? {
        guard handle.unicodeScalars.count == QrCardCodec.seatLength, Crockford.isCanonical(handle),
              secret.unicodeScalars.count == QrCardCodec.secretLength, Crockford.isCanonical(secret),
              let check = personalChecksum(handle: handle, secret: secret) else { return nil }
        return "\(personalPrefix).\(handle).\(secret).\(check)"
    }

    /// Личная карточка из 36 готовых байтов (для векторов; выпускает карточки только сервер).
    public static func personal(fromRandomBytes bytes: [UInt8]) -> LoginCard? {
        guard bytes.count == QrCardCodec.seatLength + QrCardCodec.secretLength else { return nil }
        let handle = Crockford.symbols(from: bytes[0..<QrCardCodec.seatLength])
        let secret = Crockford.symbols(from: bytes[QrCardCodec.seatLength...])
        guard let payload = buildPersonal(handle: handle, secret: secret) else { return nil }
        return LoginCard(kind: .personal, handle: handle, secret: secret, payload: payload)
    }

    /// Общий разбор сканера «Я ученик → Сканировать карточку»: карточка места `TT1.…` (и ссылка `…/q#TT1.…`)
    /// или личная `TP1.…`. Префикс определяет вид и контрольную сумму; `TT<цифры>`/`TP<цифры>` — `unsupported_version`.
    public static func parse(_ input: String) -> Result<LoginCard, QrParseError> {
        let scalars = input.unicodeScalars
        let raw = scalars.firstIndex(of: "#").map { String(scalars[scalars.index(after: $0)...]) } ?? input
        let normalized = Crockford.normalizeInput(raw)
        if normalized.unicodeScalars.isEmpty { return .failure(.empty) }
        let parts = normalized.unicodeScalars
            .split(separator: ".", omittingEmptySubsequences: false)
            .map { String(String.UnicodeScalarView($0)) }
        let head = Array(parts[0].unicodeScalars)
        let kind: LoginCardKind
        if head == Array(QrCardCodec.prefix.unicodeScalars) {
            kind = .seat
        } else if head == Array(personalPrefix.unicodeScalars) {
            kind = .personal
        } else {
            let ours = head.count > 2 && head[0] == "T" && (head[1] == "T" || head[1] == "P") && head[2...].allSatisfy { (0x30...0x39).contains($0.value) }
            return .failure(ours ? .unsupportedVersion : .unknownPrefix)
        }
        guard parts.count == 4 else { return .failure(.invalidFormat) }
        let handle = parts[1], secret = parts[2], check = parts[3]
        guard Crockford.isCanonical(handle), Crockford.isCanonical(secret), Crockford.isCanonical(check) else { return .failure(.invalidCharacter) }
        guard handle.unicodeScalars.count == QrCardCodec.seatLength, secret.unicodeScalars.count == QrCardCodec.secretLength,
              check.unicodeScalars.count == QrCardCodec.checkLength else { return .failure(.invalidFormat) }
        let expected = kind == .seat ? QrCardCodec.checksum(seat: handle, secret: secret) : personalChecksum(handle: handle, secret: secret)
        guard let expected, Array(expected.unicodeScalars) == Array(check.unicodeScalars) else { return .failure(.badChecksum) }
        return .success(LoginCard(kind: kind, handle: handle, secret: secret, payload: "\(String(String.UnicodeScalarView(head))).\(handle).\(secret).\(check)"))
    }
}
