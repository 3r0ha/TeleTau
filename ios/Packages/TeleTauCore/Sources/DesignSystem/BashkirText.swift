import CoreText
import Foundation
import SwiftUI

// Башкирский текст с правильными формами Ҫ и Ҙ.
//
// Формы `locl BSH` шрифт Nunito подставляет, только когда язык набора — башкирский. SwiftUI `Text` язык в шейпинг не
// передаёт: ни `typesettingLanguage`, ни `environment(\.locale)`, ни `AttributedString.languageIdentifier` не меняют
// глифы (проверено тестом DesignSystemTests «SwiftUI Text не включает locl»). CoreText — включает
// (`kCTLanguageAttributeName`). Поэтому башкирский текст рисуется CoreText напрямую: `Canvas` + `CTFrame`, раскладка
// по ширине — `CTFramesetter`. Так он одинаково выглядит на устройстве и в эталонных снимках.

/// Отрезок текста: русский (Golos Text) или башкирский (Nunito, язык `ba`).
public struct TextRun: Sendable, Equatable {
    /// `russian` — Golos Text, `display` — русский в Nunito (заголовки), `bashkir` — Nunito с языком `ba`.
    public enum Kind: Sendable, Equatable { case russian, display, bashkir }
    public var text: String
    public var kind: Kind
    public var weight: Font.Weight
    /// Подложка-«метка» (prototype `mark`): буква или слово на белом.
    public var marked: Bool

    public init(_ text: String, _ kind: Kind = .russian, weight: Font.Weight = TeleTauFontWeight.regular, marked: Bool = false) {
        self.text = text
        self.kind = kind
        self.weight = weight
        self.marked = marked
    }

    public static func ru(_ s: String, _ weight: Font.Weight = TeleTauFontWeight.regular) -> TextRun { TextRun(s, .russian, weight: weight) }
    public static func display(_ s: String, _ weight: Font.Weight = TeleTauFontWeight.black) -> TextRun { TextRun(s, .display, weight: weight) }
    public static func ba(_ s: String, _ weight: Font.Weight = TeleTauFontWeight.bold, marked: Bool = false) -> TextRun { TextRun(s, .bashkir, weight: weight, marked: marked) }
}

/// Строка для CoreText: башкирские отрезки — Nunito и `kCTLanguageAttributeName = "ba"`.
public enum BashkirTypesetter {
    public static func attributed(_ runs: [TextRun], size: CGFloat, color: CGColor, alignment: CTTextAlignment = .natural) -> TypesetString {
        let out = NSMutableAttributedString()
        for run in runs {
            // Nunito рядом с Golos выглядит мельче — башкирский отрезок внутри русского текста на 1 pt крупнее.
            let font = TeleTauFonts.ctFont(run.kind == .russian ? .text : .display, size: run.kind == .bashkir ? size + 1 : size, weight: run.weight)
            var attrs: [NSAttributedString.Key: Any] = [
                NSAttributedString.Key(kCTFontAttributeName as String): font,
                NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
            ]
            if run.kind == .bashkir { attrs[NSAttributedString.Key(kCTLanguageAttributeName as String)] = "ba" }
            if run.marked { attrs[.teletauMark] = true }
            out.append(NSAttributedString(string: run.text, attributes: attrs))
        }
        var align = alignment
        let paragraph = withUnsafePointer(to: &align) { pointer in
            var setting = CTParagraphStyleSetting(spec: .alignment, valueSize: MemoryLayout<CTTextAlignment>.size, value: pointer)
            return CTParagraphStyleCreate(&setting, 1)
        }
        out.addAttribute(NSAttributedString.Key(kCTParagraphStyleAttributeName as String), value: paragraph, range: NSRange(location: 0, length: out.length))
        return TypesetString(out)
    }
}

/// Набранная строка: неизменяемая копия NSAttributedString — её безопасно читать из любого потока (раскладка,
/// рисование в Canvas), но Foundation не помечает класс Sendable.
public struct TypesetString: @unchecked Sendable {
    public let value: NSAttributedString

    init(_ mutable: NSMutableAttributedString) {
        value = NSAttributedString(attributedString: mutable)
    }
}

extension NSAttributedString.Key {
    static let teletauMark = NSAttributedString.Key("TeleTauMark")
}

/// Текст, набранный CoreText: башкирские формы Ҫ, Ҙ; переносится по словам в отведённую ширину.
/// Размер масштабируется Dynamic Type и режимом «Пчёлка», как `teletauText`/`teletauDisplay`.
public struct RichText: View {
    let runs: [TextRun]
    let size: CGFloat
    let color: Color
    let alignment: TextAlignment
    let relativeTo: Font.TextStyle

    @Environment(\.self) private var environment
    @Environment(\.teletauMode) private var mode
    @ScaledMetric private var scale: CGFloat

    public init(_ runs: [TextRun], size: CGFloat, color: Color = TeleTauColor.textPrimary, alignment: TextAlignment = .leading, relativeTo: Font.TextStyle = .body) {
        self.runs = runs
        self.size = size
        self.color = color
        self.alignment = alignment
        self.relativeTo = relativeTo
        _scale = ScaledMetric(wrappedValue: 100, relativeTo: relativeTo)
    }

    public var body: some View {
        let ctAlignment: CTTextAlignment = switch alignment {
        case .center: .center
        case .trailing: .right
        default: .left
        }
        let string = BashkirTypesetter.attributed(
            runs, size: size * scale / 100 * mode.fontScale,
            color: color.resolve(in: environment).cgColor,
            alignment: ctAlignment
        )
        let mark = TeleTauColor.surface.resolve(in: environment).cgColor
        let layout = CoreTextLayout(string: string)
        layout {
            Canvas { context, canvasSize in
                context.withCGContext { cg in
                    CoreTextLayout.draw(string.value, in: cg, size: canvasSize, markColor: mark)
                }
            }
        }
        // Базовые линии из метрик CoreText: рядом с обычным Text (HStack .firstTextBaseline) строки встают ровно.
        .alignmentGuide(.firstTextBaseline) { _ in CoreTextLayout.firstBaseline(string.value) }
        .alignmentGuide(.lastTextBaseline) { d in d.height - CoreTextLayout.lastDescent(string.value) }
        .accessibilityElement()
        .accessibilityLabel(Text(runs.map(\.text).joined()))
        .accessibilityAddTraits(.isStaticText)
    }
}

/// Только башкирский текст (слово, фраза, название места).
public struct BashkirText: View {
    let text: String
    let size: CGFloat
    let weight: Font.Weight
    let color: Color
    let alignment: TextAlignment
    let relativeTo: Font.TextStyle

    public init(_ text: String, size: CGFloat, weight: Font.Weight = TeleTauFontWeight.bold, color: Color = TeleTauColor.textPrimary,
                alignment: TextAlignment = .leading, relativeTo: Font.TextStyle = .body) {
        self.text = text
        self.size = size
        self.weight = weight
        self.color = color
        self.alignment = alignment
        self.relativeTo = relativeTo
    }

    public var body: some View {
        // Размер — ровно `size` (без +1, который добавляется башкирским отрезкам внутри русского текста).
        RichText([TextRun(text, .bashkir, weight: weight)], size: size - 1, color: color, alignment: alignment, relativeTo: relativeTo)
    }
}

/// Раскладка CoreText: размер по ширине предложения (`CTFramesetterSuggestFrameSizeWithConstraints`).
struct CoreTextLayout: Layout {
    let string: TypesetString

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let framesetter = CTFramesetterCreateWithAttributedString(string.value)
        let maxWidth = proposal.width.map { $0.isFinite ? $0 : CGFloat.greatestFiniteMagnitude } ?? .greatestFiniteMagnitude
        let size = CTFramesetterSuggestFrameSizeWithConstraints(framesetter, CFRange(), nil, CGSize(width: maxWidth, height: .greatestFiniteMagnitude), nil)
        let width = ceil(size.width) + 1
        return CGSize(width: proposal.width.map { min($0, width) } ?? width, height: ceil(size.height) + 1)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for view in subviews { view.place(at: bounds.origin, proposal: ProposedViewSize(bounds.size)) }
    }

    /// Базовая линия первой строки от верха (крупнейший восходящий элемент строки).
    static func firstBaseline(_ string: NSAttributedString) -> CGFloat {
        let line = CTLineCreateWithAttributedString(string)
        var ascent: CGFloat = 0
        CTLineGetTypographicBounds(line, &ascent, nil, nil)
        return ascent
    }

    /// Нисходящий элемент строки (расстояние от базовой линии последней строки до низа рамки, без запаса +1).
    static func lastDescent(_ string: NSAttributedString) -> CGFloat {
        let line = CTLineCreateWithAttributedString(string)
        var descent: CGFloat = 0, leading: CGFloat = 0
        CTLineGetTypographicBounds(line, nil, &descent, &leading)
        return descent + leading + 1
    }

    /// Рисует строку в контекст с координатами SwiftUI (ось y вниз).
    static func draw(_ string: NSAttributedString, in cg: CGContext, size: CGSize, markColor: CGColor) {
        let framesetter = CTFramesetterCreateWithAttributedString(string)
        let path = CGPath(rect: CGRect(origin: .zero, size: size), transform: nil)
        let frame = CTFramesetterCreateFrame(framesetter, CFRange(), path, nil)
        cg.saveGState()
        cg.textMatrix = .identity
        cg.translateBy(x: 0, y: size.height)
        cg.scaleBy(x: 1, y: -1)
        drawMarks(frame, in: cg, color: markColor)
        CTFrameDraw(frame, cg)
        cg.restoreGState()
    }

    /// Подложки «меток» под выделенными отрезками (координаты CoreText, ось y вверх).
    private static func drawMarks(_ frame: CTFrame, in cg: CGContext, color: CGColor) {
        let lines = CTFrameGetLines(frame) as! [CTLine]
        var origins = [CGPoint](repeating: .zero, count: lines.count)
        CTFrameGetLineOrigins(frame, CFRange(), &origins)
        for (line, origin) in zip(lines, origins) {
            for run in CTLineGetGlyphRuns(line) as! [CTRun] {
                let attrs = CTRunGetAttributes(run) as NSDictionary
                guard attrs[NSAttributedString.Key.teletauMark] != nil else { continue }
                var ascent: CGFloat = 0, descent: CGFloat = 0
                let width = CTRunGetTypographicBounds(run, CFRange(), &ascent, &descent, nil)
                let range = CTRunGetStringRange(run)
                let x = CTLineGetOffsetForStringIndex(line, range.location, nil)
                let rect = CGRect(x: origin.x + x - 3, y: origin.y - descent - 1, width: CGFloat(width) + 6, height: ascent + descent + 2)
                cg.setFillColor(color)
                cg.addPath(CGPath(roundedRect: rect, cornerWidth: TeleTauRadius.small / 2, cornerHeight: TeleTauRadius.small / 2, transform: nil))
                cg.fillPath()
            }
        }
    }
}
