import Foundation

/// Нормализация и сравнение башкирского текста.
///
/// Порт эталона `packages/bashkir-text/src/normalize.ts` один в один (алгоритм v3). Правила — в
/// `contracts/shared/bashkir-homoglyphs.json` (таблицы — `BashkirTable.generated.swift`),
/// поведение закреплено общими векторами `contracts/test-vectors/bashkir-text/`.
///
/// Вся обработка идёт по Unicode-скалярам (аналог кодовых точек в TS), а не по
/// `Character`: графемные кластеры склеили бы букву с комбинирующим знаком.
public enum BashkirText {
    private static let space: Unicode.Scalar = " "
    /// Не более стольких применений при поиске неподвижной точки (на практике хватает двух).
    private static let maxFixpointSteps = 4

    /// Каноническая форма башкирского текста (алгоритм v3): NFC → удаление невидимых → NFC →
    /// последовательности → двойники в кириллических словах → пробелы → NFC. Регистр сохраняется.
    public static func normalize(_ input: String) -> String {
        var scalars = removeInvisible(Array(nfc(input).unicodeScalars))
        scalars = Array(nfc(makeString(scalars)).unicodeScalars)
        scalars = replaceSequences(scalars)
        scalars = mapLettersInCyrillicWords(scalars)
        scalars = normalizeSpaces(scalars)
        return nfc(makeString(scalars))
    }

    /// Форма для точного сравнения: неподвижная точка NFC(нижний регистр(normalize(s))).
    public static func toComparable(_ input: String) -> String {
        fixpoint(input) { nfc(makeString(lower(normalize($0).unicodeScalars))) }
    }

    /// Свёртка особых букв (ҡ→к, ғ→г, …): неподвижная точка NFC(foldMap(toComparable(s))).
    public static func fold(_ input: String) -> String {
        fixpoint(input) { s in
            let folded = toComparable(s).unicodeScalars.map { scalar in
                BashkirTable.foldMap[scalar.value].flatMap(Unicode.Scalar.init) ?? scalar
            }
            return nfc(makeString(folded))
        }
    }

    // MARK: - Шаги алгоритма

    /// Шаг 2: невидимые символы. ZWJ/ZWNJ удаляются только рядом с буквами — эмодзи-последовательности сохраняются.
    /// «Рядом» = ближайший слева или справа скаляр, не являющийся ZWJ/ZWNJ, — буква или знак.
    /// Линейно: два прохода (слева направо и справа налево) вместо квадратичного просмотра всей цепочки
    /// для каждого соединителя.
    private static func removeInvisible(_ input: [Unicode.Scalar]) -> [Unicode.Scalar] {
        let scalars = input.filter { !BashkirTable.remove.contains($0.value) }
        let n = scalars.count
        var wordOnLeft = [Bool](repeating: false, count: n)
        var lastIsWord = false
        for i in 0..<n {
            if BashkirTable.removeNearLetters.contains(scalars[i].value) {
                wordOnLeft[i] = lastIsWord
            } else {
                lastIsWord = isWord(scalars[i])
            }
        }
        var keep = [Bool](repeating: true, count: n)
        var nextIsWord = false
        for i in stride(from: n - 1, through: 0, by: -1) {
            if BashkirTable.removeNearLetters.contains(scalars[i].value) {
                keep[i] = !(wordOnLeft[i] || nextIsWord)
            } else {
                nextIsWord = isWord(scalars[i])
            }
        }
        var out: [Unicode.Scalar] = []
        out.reserveCapacity(n)
        for i in 0..<n where keep[i] { out.append(scalars[i]) }
        return out
    }

    /// Шаг 4: пары «буква + комбинирующий знак», которые NFC не сводит к одной кодовой точке.
    private static func replaceSequences(_ scalars: [Unicode.Scalar]) -> [Unicode.Scalar] {
        var out: [Unicode.Scalar] = []
        out.reserveCapacity(scalars.count)
        var i = 0
        while i < scalars.count {
            let a = scalars[i].value
            if i + 1 < scalars.count,
               let seq = BashkirTable.sequences.first(where: { $0.first == a && $0.second == scalars[i + 1].value }),
               let replacement = Unicode.Scalar(seq.replacement) {
                out.append(replacement)
                i += 2
            } else {
                out.append(scalars[i])
                i += 1
            }
        }
        return out
    }

    /// Шаги 5–6: замена двойников — только внутри слов, где есть хотя бы один кириллический скаляр.
    /// Слово — максимальная последовательность скаляров с общей категорией Unicode L* или M*.
    private static func mapLettersInCyrillicWords(_ scalars: [Unicode.Scalar]) -> [Unicode.Scalar] {
        var out: [Unicode.Scalar] = []
        out.reserveCapacity(scalars.count)
        var i = 0
        while i < scalars.count {
            guard isWord(scalars[i]) else {
                out.append(scalars[i])
                i += 1
                continue
            }
            var j = i
            while j < scalars.count, isWord(scalars[j]) { j += 1 }
            let word = scalars[i..<j]
            if word.contains(where: { BashkirTable.cyrillicRange.contains($0.value) }) {
                for scalar in word {
                    out.append(BashkirTable.letterMap[scalar.value].flatMap(Unicode.Scalar.init) ?? scalar)
                }
            } else {
                out.append(contentsOf: word)
            }
            i = j
        }
        return out
    }

    /// Шаг 7: любой пробельный символ → пробел, схлопывание повторов, обрезка по краям.
    private static func normalizeSpaces(_ scalars: [Unicode.Scalar]) -> [Unicode.Scalar] {
        var out: [Unicode.Scalar] = []
        out.reserveCapacity(scalars.count)
        for scalar in scalars {
            if BashkirTable.whitespace.contains(scalar.value) {
                if let last = out.last, last != space {
                    out.append(space)
                }
            } else {
                out.append(scalar)
            }
        }
        if out.last == space { out.removeLast() }
        return out
    }

    /// Нижний регистр по собственной таблице простых соответствий (латиница, греческий, кириллица),
    /// без контекстных правил. Не зависит от версии Unicode платформы.
    private static func lower(_ scalars: String.UnicodeScalarView) -> [Unicode.Scalar] {
        scalars.map { BashkirTable.lowerMap[$0.value].flatMap(Unicode.Scalar.init) ?? $0 }
    }

    // MARK: - Вспомогательное

    private static func fixpoint(_ input: String, _ step: (String) -> String) -> String {
        var current = step(input)
        for _ in 1..<maxFixpointSteps {
            let next = step(current)
            if next.unicodeScalars.elementsEqual(current.unicodeScalars) { break }
            current = next
        }
        return current
    }

    private static func nfc(_ s: String) -> String { s.precomposedStringWithCanonicalMapping }

    private static func isWord(_ scalar: Unicode.Scalar?) -> Bool {
        guard let scalar else { return false }
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .nonspacingMark, .spacingMark, .enclosingMark:
            return true
        default:
            return false
        }
    }

    private static func makeString(_ scalars: some Sequence<Unicode.Scalar>) -> String {
        var view = String.UnicodeScalarView()
        view.append(contentsOf: scalars)
        return String(view)
    }
}
