import Foundation
import Testing
@testable import AuthCodes

// Общие векторы contracts/test-vectors/qr-card/*.json и class-code/*.json — те же, что проходит эталон
// packages/auth-codes (TS). Файлы читаются из репозитория; `expected` сравнивается целиком, как структура
// (лишние или недостающие поля — ошибка, contracts/test-vectors/qr-card/README.md).

// MARK: - JSON без схемы

enum JSON: Decodable, Equatable, Sendable, CustomStringConvertible {
    case string(String)
    case bool(Bool)
    case number(Double)
    case object([String: JSON])
    case null

    init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else { self = .object(try c.decode([String: JSON].self)) }
    }

    var string: String? { if case .string(let s) = self { s } else { nil } }
    subscript(key: String) -> JSON? { if case .object(let o) = self { o[key] } else { nil } }

    var description: String {
        switch self {
        case .string(let s): "\"\(s.unicodeScalars.map { $0.isASCII ? String($0) : String(format: "\\u{%04X}", $0.value) }.joined())\""
        case .bool(let b): "\(b)"
        case .number(let n): "\(n)"
        case .null: "null"
        case .object(let o): "{" + o.keys.sorted().map { "\($0): \(o[$0]!)" }.joined(separator: ", ") + "}"
        }
    }
}

/// Строки сравниваются по кодовым точкам: `String ==` считает канонически эквивалентные строки равными.
func scalarsEqual(_ a: JSON, _ b: JSON) -> Bool {
    switch (a, b) {
    case (.string(let x), .string(let y)): Array(x.unicodeScalars) == Array(y.unicodeScalars)
    case (.object(let x), .object(let y)): x.keys.sorted() == y.keys.sorted() && x.keys.allSatisfy { scalarsEqual(x[$0]!, y[$0]!) }
    default: a == b
    }
}

struct Case: Decodable, Sendable {
    let id: String
    let input: JSON
    let expected: JSON
    let note: String?
}

struct Suite: Decodable, Sendable {
    let suite: String
    let version: Int
    let function: String
    let cases: [Case]
}

struct SuiteCase: Sendable, CustomTestStringConvertible {
    let file: String
    let function: String
    let vector: Case
    var testDescription: String { "\(file) \(vector.id): \(vector.note ?? "")" }
}

enum Vectors {
    static let repoRoot: URL = {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while dir.path != "/" {
            if FileManager.default.fileExists(atPath: dir.appendingPathComponent("contracts/test-vectors/qr-card").path) { return dir }
            dir.deleteLastPathComponent()
        }
        fatalError("Не найден корень репозитория (contracts/test-vectors) выше \(#filePath)")
    }()

    static let directories = ["qr-card", "class-code", "login-card"]

    /// Все наборы двух каталогов — без жёсткого списка: новый набор без поддержки порта роняет тест.
    static func files() throws -> [String] {
        try directories.flatMap { dir in
            try FileManager.default.contentsOfDirectory(atPath: repoRoot.appendingPathComponent("contracts/test-vectors/\(dir)").path)
                .filter { $0.hasSuffix(".json") }
                .map { "\(dir)/\($0)" }
        }.sorted()
    }

    static func load(_ file: String) throws -> Suite {
        try JSONDecoder().decode(Suite.self, from: Data(contentsOf: repoRoot.appendingPathComponent("contracts/test-vectors/\(file)")))
    }

    static func allCases() throws -> [SuiteCase] {
        try files().flatMap { file in
            let suite = try load(file)
            return suite.cases.map { SuiteCase(file: file, function: suite.function, vector: $0) }
        }
    }
}

func hexBytes(_ hex: String) -> [UInt8] {
    var out: [UInt8] = []
    var it = hex.makeIterator()
    while let hi = it.next(), let lo = it.next() { out.append(UInt8(String([hi, lo]), radix: 16)!) }
    return out
}

/// Результат порта в форме `expected` набора.
func run(_ function: String, _ input: JSON) -> JSON? {
    switch function {
    case "parseQrPayload":
        guard let s = input.string else { return nil }
        switch QrCardCodec.parse(s) {
        case .success(let c): return .object(["ok": .bool(true), "seat": .string(c.seat), "secret": .string(c.secret), "payload": .string(c.payload)])
        case .failure(let e): return .object(["ok": .bool(false), "error": .string(e.rawValue)])
        }
    case "buildQrCard":
        guard let seat = input["seat"]?.string, let secret = input["secret"]?.string, let base = input["baseUrl"]?.string,
              let payload = QrCardCodec.buildPayload(seat: seat, secret: secret) else { return nil }
        return .object(["payload": .string(payload), "link": .string(QrCardCodec.buildLink(baseURL: base, payload: payload))])
    case "qrCardFromRandomBytes":
        guard let hex = input.string, let c = QrCardCodec.card(fromRandomBytes: hexBytes(hex)) else { return nil }
        return .object(["seat": .string(c.seat), "secret": .string(c.secret), "payload": .string(c.payload)])
    case "parseClassCode":
        guard let s = input.string else { return nil }
        switch ClassCodeCodec.parse(s) {
        case .success(let c): return .object(["ok": .bool(true), "code": .string(c.code), "display": .string(c.display)])
        case .failure(let e): return .object(["ok": .bool(false), "error": .string(e.rawValue)])
        }
    case "parseLoginCard":
        guard let s = input.string else { return nil }
        switch LoginCardCodec.parse(s) {
        case .success(let c): return .object(["ok": .bool(true), "kind": .string(c.kind.rawValue), "handle": .string(c.handle), "secret": .string(c.secret), "payload": .string(c.payload)])
        case .failure(let e): return .object(["ok": .bool(false), "error": .string(e.rawValue)])
        }
    case "buildPersonalCard":
        guard let handle = input["handle"]?.string, let secret = input["secret"]?.string,
              let payload = LoginCardCodec.buildPersonal(handle: handle, secret: secret) else { return nil }
        return .object(["payload": .string(payload)])
    case "personalCardFromRandomBytes":
        guard let hex = input.string, let c = LoginCardCodec.personal(fromRandomBytes: hexBytes(hex)) else { return nil }
        return .object(["handle": .string(c.handle), "secret": .string(c.secret), "payload": .string(c.payload)])
    case "classCodeFromRandomBytes":
        guard let hex = input.string, let c = ClassCodeCodec.code(fromRandomBytes: hexBytes(hex)) else { return nil }
        return .object(["code": .string(c.code), "display": .string(c.display)])
    default:
        return nil
    }
}

@Suite("AuthCodes: общие векторы qr-card и class-code")
struct AuthCodesVectorTests {
    @Test("Порт объявляет все наборы каталогов и их версии")
    func versionsAreSupported() throws {
        let files = try Vectors.files()
        #expect(Set(files) == Set(AuthCodes.supportedVersions.keys), "наборы в репозитории: \(files)")
        for file in files {
            let suite = try Vectors.load(file)
            #expect(AuthCodes.supportedVersions[file] == suite.version, "\(file): версия \(suite.version) не поддержана портом")
        }
    }

    @Test("Кейс вектора", arguments: try Vectors.allCases())
    func vector(_ c: SuiteCase) throws {
        let actual = try #require(run(c.function, c.vector.input), "функция \(c.function) не реализована или вход не разобран")
        #expect(scalarsEqual(actual, c.vector.expected), "\(c.file) \(c.vector.id): ожидалось \(c.vector.expected), получено \(actual)")
    }
}

// MARK: - Свойства (как fast-check в эталоне: seed 20261103, 2000 прогонов; генератор — SplitMix64)

struct SplitMix64: RandomNumberGenerator {
    var state: UInt64
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

@Suite("AuthCodes: свойства")
struct AuthCodesPropertyTests {
    static let runs = 2000

    func randomCard(_ rng: inout SplitMix64) -> QrCard {
        QrCardCodec.card(fromRandomBytes: (0..<36).map { _ in UInt8.random(in: 0...255, using: &rng) })!
    }

    @Test("Сборка и разбор взаимно обратны — в том числе через ссылку и в нижнем регистре")
    func roundTrip() {
        var rng = SplitMix64(state: 20_261_103)
        for _ in 0..<Self.runs {
            let card = randomCard(&rng)
            #expect(QrCardCodec.parse(card.payload) == .success(card))
            #expect(QrCardCodec.parse(QrCardCodec.buildLink(baseURL: "https://teletau.study/", payload: card.payload)) == .success(card))
            #expect(QrCardCodec.parse(card.payload.lowercased()) == .success(card))
        }
    }

    @Test("Замена одного символа и перестановка соседних дают bad_checksum")
    func checksumCatchesTypos() {
        var rng = SplitMix64(state: 20_261_103)
        for _ in 0..<Self.runs {
            let card = randomCard(&rng)
            var body = Array(card.seat + card.secret)
            let i = Int.random(in: 0..<body.count, using: &rng)
            var replacement = body[i]
            while replacement == body[i] { replacement = Crockford.alphabet.randomElement(using: &rng)! }
            body[i] = replacement
            let typo = "TT1.\(String(body[0..<10])).\(String(body[10...])).\(card.payload.suffix(2))"
            #expect(QrCardCodec.parse(typo) == .failure(.badChecksum), "замена: \(typo)")

            var swapped = Array(card.seat + card.secret)
            let j = Int.random(in: 0..<(swapped.count - 1), using: &rng)
            guard swapped[j] != swapped[j + 1] else { continue }
            swapped.swapAt(j, j + 1)
            let transposed = "TT1.\(String(swapped[0..<10])).\(String(swapped[10...])).\(card.payload.suffix(2))"
            #expect(QrCardCodec.parse(transposed) == .failure(.badChecksum), "перестановка: \(transposed)")
        }
    }

    @Test("Разбор не падает на произвольной строке, нормализация идемпотентна")
    func arbitraryInput() {
        var rng = SplitMix64(state: 20_261_103)
        let pool: [Unicode.Scalar] = Array("TT1.#-– абвОоILlҡҠә0123456789ABCDEFXYZ\u{00A0}\u{0301}\u{200D}".unicodeScalars)
        for _ in 0..<Self.runs {
            let length = Int.random(in: 0...60, using: &rng)
            var view = String.UnicodeScalarView()
            for _ in 0..<length { view.append(pool.randomElement(using: &rng)!) }
            let s = String(view)
            _ = QrCardCodec.parse(s)
            _ = ClassCodeCodec.parse(s)
            let once = Crockford.normalizeInput(s)
            #expect(Array(Crockford.normalizeInput(once).unicodeScalars) == Array(once.unicodeScalars))
        }
    }
}

@Suite("AuthCodes: личная карточка — свойства (seed 20261105, как fast-check эталона)")
struct LoginCardPropertyTests {
    @Test("Сборка и разбор обратны; подмена префикса TT1 ↔ TP1 и замена символа ловятся")
    func properties() {
        var rng = SplitMix64(state: 20_261_105)
        for _ in 0..<2000 {
            let card = LoginCardCodec.personal(fromRandomBytes: (0..<36).map { _ in UInt8.random(in: 0...255, using: &rng) })!
            #expect(LoginCardCodec.parse(card.payload) == .success(card))
            #expect(LoginCardCodec.parse(card.payload.lowercased()) == .success(card))
            let swapped = "TT1" + card.payload.dropFirst(3)
            #expect(LoginCardCodec.parse(swapped) == .failure(.badChecksum), "личную не принять за карточку места: \(swapped)")
            var body = Array(card.handle + card.secret)
            let i = Int.random(in: 0..<body.count, using: &rng)
            var replacement = body[i]
            while replacement == body[i] { replacement = Crockford.alphabet.randomElement(using: &rng)! }
            body[i] = replacement
            let typo = "TP1.\(String(body[0..<10])).\(String(body[10...])).\(card.payload.suffix(2))"
            #expect(LoginCardCodec.parse(typo) == .failure(.badChecksum))
        }
    }

    @Test("Сканер различает карточку места и личную")
    func kinds() throws {
        #expect(try LoginCardCodec.parse("TT1.0123456789.ABCDEFGHJKMNPQRSTVWXYZ0123.6V").get().kind == .seat)
        #expect(try LoginCardCodec.parse("TP1.0123456789.ABCDEFGHJKMNPQRSTVWXYZ0123.4S").get().kind == .personal)
    }
}
