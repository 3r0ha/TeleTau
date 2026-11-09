import Foundation
import Testing
@testable import BashkirText

// Общие тест-векторы contracts/test-vectors/bashkir-text/*.json — те же, что гоняет TS (`pnpm vectors`)
// и Kotlin. Векторы не дублируются в Swift: файлы читаются из репозитория при каждом запуске,
// все наборы каталога — без жёсткого списка (новый набор без поддержки порта роняет тест).

// MARK: - Загрузка векторов

struct VectorCase: Decodable, Sendable {
    let id: String
    let input: String
    let expected: String
    let note: String?
}

struct VectorSuite: Decodable, Sendable {
    let suite: String
    let version: Int
    let function: String
    let cases: [VectorCase]
}

/// Кейс вместе с набором — аргумент параметризованного теста.
struct SuiteCase: Sendable, CustomTestStringConvertible {
    let file: String
    let function: String
    let vector: VectorCase

    var testDescription: String { "\(file) \(vector.id): \(vector.note ?? "")" }
}

enum Vectors {
    /// Версии наборов, которые реализует этот порт. Новая версия набора = новое поведение = обновить порт.
    /// Набор, которого нет в этом списке, — ошибка: его нужно явно принять во всех трёх портах.
    static let supportedVersions: [String: Int] = [
        "normalize.json": 3,
        "fold.json": 4,
        "comparable.json": 4,
        "normalize-table.json": 2,
        "fuzz-normalize.json": 2,
        "fuzz-comparable.json": 2,
        "fuzz-fold.json": 2,
    ]

    static let functions: [String: @Sendable (String) -> String] = [
        "normalize": BashkirText.normalize,
        "toComparable": BashkirText.toComparable,
        "fold": BashkirText.fold,
    ]

    /// Корень монорепозитория: поднимаемся от этого файла, пока не найдём contracts/test-vectors.
    static let repoRoot: URL = {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while dir.path != "/" {
            let marker = dir.appendingPathComponent("contracts/test-vectors/bashkir-text", isDirectory: true)
            if FileManager.default.fileExists(atPath: marker.path) { return dir }
            dir.deleteLastPathComponent()
        }
        fatalError("Не найден корень репозитория (contracts/test-vectors) выше \(#filePath)")
    }()

    static var directory: URL { repoRoot.appendingPathComponent("contracts/test-vectors/bashkir-text") }

    static func files() throws -> [String] {
        try FileManager.default.contentsOfDirectory(atPath: directory.path)
            .filter { $0.hasSuffix(".json") }
            .sorted()
    }

    static func load(_ file: String) throws -> VectorSuite {
        try JSONDecoder().decode(VectorSuite.self, from: Data(contentsOf: directory.appendingPathComponent(file)))
    }

    static func allCases() throws -> [SuiteCase] {
        try files().flatMap { file in
            let suite = try load(file)
            return suite.cases.map { SuiteCase(file: file, function: suite.function, vector: $0) }
        }
    }
}

/// Строки сравниваются по скалярам: `String ==` в Swift считает канонически эквивалентные
/// строки равными («и\u{306}» == «й»), а нам нужна точная последовательность кодовых точек, как в TS.
func scalars(_ s: String) -> [UInt32] { s.unicodeScalars.map(\.value) }

func escaped(_ s: String) -> String {
    s.unicodeScalars.map { $0.isASCII && $0.value >= 0x20 && $0.value < 0x7F
        ? String($0)
        : String(format: "\\u{%04X}", $0.value)
    }.joined()
}

// MARK: - Векторы

@Suite("bashkir-text: общие векторы")
struct BashkirTextVectorTests {
    @Test("Каталог содержит ровно известные порту наборы с известными функциями и версиями")
    func suitesAreKnown() throws {
        let files = try Vectors.files()
        #expect(files == Vectors.supportedVersions.keys.sorted(), "наборы в каталоге: \(files)")
        for file in files {
            let suite = try Vectors.load(file)
            #expect(Vectors.functions[suite.function] != nil, "\(file): неизвестная функция \(suite.function)")
            #expect(
                suite.version == Vectors.supportedVersions[file],
                "\(file): версия набора \(suite.version), порт реализует \(Vectors.supportedVersions[file] ?? 0) — обновите BashkirText"
            )
            #expect(!suite.cases.isEmpty, "набор \(file) пуст")
            #expect(Set(suite.cases.map(\.id)).count == suite.cases.count, "в наборе \(file) повторяются id")
        }
    }

    @Test("Вектор", arguments: try Vectors.allCases())
    func vector(_ c: SuiteCase) throws {
        let fn = try #require(Vectors.functions[c.function], "неизвестная функция \(c.function)")
        let actual = fn(c.vector.input)
        #expect(
            scalars(actual) == scalars(c.vector.expected),
            "\(c.file) \(c.vector.id) [\(c.function)] \(c.vector.note ?? ""): input \"\(escaped(c.vector.input))\" → \"\(escaped(actual))\", ожидалось \"\(escaped(c.vector.expected))\""
        )
    }
}

// MARK: - Свойства

/// SplitMix64 — детерминированный генератор: свойства проверяются на одних и тех же строках при каждом запуске.
struct SeededGenerator: RandomNumberGenerator {
    private var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

enum PropertyInput {
    /// Алфавит: всё, что ломало или могло ломать нормализацию (тот же, что в TS-тестах).
    private static let letters: [String] = [
        "абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБЕЁКОРСТХ",
        "әөүғҡңҙҫһӘӨҮҒҠҢҘҪҺ",
        "aeopcxyhkqAEOPCXYHKQ",
        "äöüçğñðəɵÄÖÜÇĞÑÐƏƟ",
        "қҥұґӻӡӧӓӱҟӄӈ",
    ].flatMap { group -> [String] in group.map { String($0) } }
    private static let specials: [String] = [
        "\u{0300}", "\u{0301}", "\u{0306}", "\u{0308}", "\u{0327}",
        "\u{200B}", "\u{200C}", "\u{200D}", "\u{2060}", "\u{FEFF}", "\u{00AD}",
        " ", "\t", "\n", "\u{00A0}", "\u{202F}",
        "🐝", "👨", "👩", "-", ".", "1", "Σ", "\u{0130}", "ß",
    ]
    /// Алфавит: всё, что ломало или могло ломать нормализацию (тот же, что в TS-тестах).
    static let alphabet: [String] = letters + specials

    static func strings(count: Int = 2000, seed: UInt64 = 20_261_102) -> [String] {
        var rng = SeededGenerator(seed: seed)
        return (0..<count).map { _ in
            let length = Int.random(in: 0...40, using: &rng)
            // Склеиваем скалярами: String + String нормализовал бы границы графем.
            var view = String.UnicodeScalarView()
            for _ in 0..<length { view.append(contentsOf: alphabet.randomElement(using: &rng)!.unicodeScalars) }
            return String(view)
        }
    }
}

@Suite("bashkir-text: свойства")
struct BashkirTextPropertyTests {
    static let inputs = PropertyInput.strings()

    private func isNFC(_ s: String) -> Bool { scalars(s) == scalars(s.precomposedStringWithCanonicalMapping) }

    @Test("normalize, toComparable и fold идемпотентны и возвращают NFC (2000 строк)")
    func idempotentAndNFC() {
        for (name, fn) in [("normalize", BashkirText.normalize), ("toComparable", BashkirText.toComparable), ("fold", BashkirText.fold)]
            as [(String, (String) -> String)] {
            for input in Self.inputs {
                let once = fn(input)
                let twice = fn(once)
                #expect(scalars(twice) == scalars(once), "\(name) не идемпотентна на \"\(escaped(input))\": \"\(escaped(once))\" → \"\(escaped(twice))\"")
                #expect(isNFC(once), "\(name)(\"\(escaped(input))\") не в NFC: \"\(escaped(once))\"")
            }
        }
    }

    @Test("Длинный вход (200 000 скаляров)")
    func longInput() {
        let long = String(repeating: "ә", count: 100_000) + String(repeating: "Ҡ", count: 100_000)
        #expect(BashkirText.normalize(long).unicodeScalars.count == 200_000)
        #expect(BashkirText.toComparable(long).unicodeScalars.count == 200_000)
        #expect(BashkirText.fold(long) == String(repeating: "а", count: 100_000) + String(repeating: "к", count: 100_000))
    }

    /// Длинные цепочки ZWJ/ZWNJ: удаление обязано быть линейным — квадратичное на таких длинах не уложится в тест.
    @Test("Цепочки ZWJ/ZWNJ длиной 200 000 обрабатываются корректно")
    func longJoinerChains() {
        let zwj = "\u{200D}", zwnj = "\u{200C}"
        #expect(BashkirText.normalize(String(repeating: zwj, count: 200_000)).unicodeScalars.count == 200_000,
                "соединители без соседей-букв сохраняются")
        #expect(BashkirText.normalize("ҡ" + String(repeating: zwj + zwnj, count: 100_000) + "ы") == "ҡы")
        let emoji = "🐝" + String(repeating: zwj, count: 100_000) + "🍯"
        for out in [BashkirText.normalize(emoji), BashkirText.toComparable(emoji), BashkirText.fold(emoji)] {
            #expect(out.unicodeScalars.count == 100_002)
        }
    }

    /// Линейность проверяется отношением времени t(4n)/t(n), а не абсолютным
    /// порогом: равномерное замедление машины (загруженный CI, debug-сборка) отношение не меняет.
    /// Линейный алгоритм даёт ≈4, квадратичный ≈16; порог 8 — посередине в логарифмической шкале.
    @Test("Цепочки ZWJ/ZWNJ обрабатываются за линейное время: t(4n)/t(n) < 8",
          arguments: JoinerChain.allCases)
    func joinerChainsAreLinear(chain: JoinerChain) {
        let ratio = growthRatio(n: 2_000, make: chain.make, run: chain.run)
        print("bashkir-text perf: \(chain) — t(4n)/t(n) = \(String(format: "%.2f", ratio))")
        #expect(ratio < 8, "\(chain): t(4n)/t(n) = \(ratio)")
    }

    @Test("Разложенные (не NFC) входы векторов доходят до normalize без изменений")
    func jsonKeepsDecomposedInput() throws {
        // Если бы чтение JSON нормализовало строки, векторы на NFC (например, «и» + U+0306) ничего бы не проверяли.
        let decomposed = try Vectors.allCases().filter {
            scalars($0.vector.input) != scalars($0.vector.input.precomposedStringWithCanonicalMapping)
        }
        #expect(!decomposed.isEmpty)
    }
}

// MARK: - Замер роста времени

enum JoinerChain: String, CaseIterable, CustomStringConvertible, Sendable {
    case keptWithoutLetters, betweenLetters, betweenEmoji
    var description: String { rawValue }

    func make(_ n: Int) -> String {
        let zwj = "\u{200D}", zwnj = "\u{200C}"
        switch self {
        case .keptWithoutLetters: return String(repeating: zwj, count: n)
        case .betweenLetters: return "ҡ" + String(repeating: zwj + zwnj, count: n / 2) + "ы"
        case .betweenEmoji: return "🐝" + String(repeating: zwj, count: n) + "🍯"
        }
    }

    /// Возвращает число скаляров результата — чтобы вызовы не считались «мёртвым кодом».
    func run(_ s: String) -> Int {
        switch self {
        case .keptWithoutLetters, .betweenLetters: return BashkirText.normalize(s).unicodeScalars.count
        case .betweenEmoji:
            return BashkirText.normalize(s).unicodeScalars.count
                + BashkirText.toComparable(s).unicodeScalars.count
                + BashkirText.fold(s).unicodeScalars.count
        }
    }
}

/// Время вызова — минимум по многим одиночным замерам, малый и большой вход чередуются: вытеснение потока
/// и прочая нагрузка время только увеличивают, поэтому минимум устойчив к загрузке машины.
private func growthRatio(n: Int, samples: Int = 25, budgetMs: Double = 5_000, make: (Int) -> String, run: (String) -> Int) -> Double {
    func now() -> Double { Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000 }
    let small = make(n), big = make(4 * n)
    var sink = run(small) &+ run(big) // прогрев
    var bestSmall = Double.infinity, bestBig = Double.infinity
    let start = now()
    var i = 0
    while i < samples && now() - start < budgetMs {
        var t = now()
        sink &+= run(small)
        bestSmall = min(bestSmall, now() - t)
        t = now()
        sink &+= run(big)
        bestBig = min(bestBig, now() - t)
        i += 1
    }
    precondition(sink >= 0)
    return bestBig / bestSmall
}
