#if canImport(AppKit)
import AppKit
import CoreText
import Foundation
import SwiftUI
import Testing
@testable import DesignSystem

// Шрифты (башкирские формы Ҫ и Ҙ), иллюстрации и иконки дизайн-системы iOS.

@Suite("DesignSystem: шрифты, картинки, иконки")
struct DesignSystemAssetTests {
    static let repoRoot: URL = {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while dir.path != "/" {
            if FileManager.default.fileExists(atPath: dir.appendingPathComponent("packages/design-tokens/fonts").path) { return dir }
            dir.deleteLastPathComponent()
        }
        fatalError("Не найден корень репозитория")
    }()

    @Test("Шрифты пакета — побайтные копии packages/design-tokens/fonts")
    func fontsMatchTokens() throws {
        let pairs = [
            ("Nunito-VariableFont_wght.ttf", "packages/design-tokens/fonts/nunito/Nunito-VariableFont_wght.ttf"),
            ("GolosText-VariableFont_wght.ttf", "packages/design-tokens/fonts/golos-text/GolosText-VariableFont_wght.ttf"),
        ]
        for (name, source) in pairs {
            let bundled = try #require(TeleTauFonts.Family.allCases.compactMap(\.url).first { $0.lastPathComponent == name })
            #expect(try Data(contentsOf: bundled) == Data(contentsOf: Self.repoRoot.appendingPathComponent(source)), "\(name) разошёлся с design-tokens")
        }
        #expect(TeleTauFonts.register())
    }

    /// Глиф буквы в Nunito при заданном языке набора (kCTLanguageAttributeName → OpenType `locl`).
    func glyph(_ text: String, language: String) -> CGGlyph {
        let font = TeleTauFonts.ctFont(.display, size: 40, weight: .bold)
        let attributed = NSAttributedString(string: text, attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTLanguageAttributeName as String): language,
        ])
        let line = CTLineCreateWithAttributedString(attributed)
        let run = (CTLineGetGlyphRuns(line) as! [CTRun])[0]
        var g = CGGlyph()
        CTRunGetGlyphs(run, CFRange(location: 0, length: 1), &g)
        return g
    }

    @Test("M0-P01: в Nunito с языком ba Ҫ и Ҙ — башкирские формы (locl BSH), а не общие кириллические", arguments: ["\u{04AA}", "\u{04AB}", "\u{0498}", "\u{0499}"])
    func bashkirLocl(letter: String) {
        #expect(glyph(letter, language: "ba") != glyph(letter, language: "ru"), "\(letter): locl BSH не применился")
    }

    @Test("RichText набирает башкирские отрезки глифами loclBSH (тот же путь CTFramesetter, что и на экране)")
    func typesetterUsesBashkirGlyphs() {
        let string = BashkirTypesetter.attributed([.ru("буква "), .ba("Ҫҙ")], size: 20, color: CGColor(gray: 0, alpha: 1)).value
        let frame = CTFramesetterCreateFrame(CTFramesetterCreateWithAttributedString(string), CFRange(), CGPath(rect: CGRect(x: 0, y: 0, width: 400, height: 100), transform: nil), nil)
        var names: [String] = []
        for line in CTFrameGetLines(frame) as! [CTLine] {
            for run in CTLineGetGlyphRuns(line) as! [CTRun] {
                let font = (CTRunGetAttributes(run) as NSDictionary)[kCTFontAttributeName as String] as! CTFont
                var glyphs = [CGGlyph](repeating: 0, count: CTRunGetGlyphCount(run))
                CTRunGetGlyphs(run, CFRange(), &glyphs)
                names += glyphs.compactMap { CTFontCopyNameForGlyph(font, $0) as String? }
            }
        }
        #expect(names.contains("uni04AA.loclBSH") && names.contains("uni0499.loclBSH"), "глифы: \(names)")
    }

    @Test("Nunito: башкирские формы Ҫ, Ҙ совпадают с основными, отличаются только чувашские — шрифт подходит без locl")
    func nunitoDefaultsAreBashkir() {
        let font = TeleTauFonts.ctFont(.display, size: 100, weight: .bold)
        func box(_ name: String) -> CGRect {
            CTFontCreatePathForGlyph(font, CTFontGetGlyphWithName(font, name as CFString), nil)?.boundingBoxOfPath ?? .null
        }
        #expect(box("uni04AA") == box("uni04AA.loclBSH"))
        #expect(box("uni0499") == box("uni0499.loclBSH"))
        #expect(box("uni04AA") != box("uni04AA.loclCHU"))
    }

    @Test("Каждая иллюстрация перечисления есть в ресурсах и читается")
    func illustrationsLoad() {
        for item in Illustration.allCases {
            #expect(IllustrationStore.image(item) != nil, "нет картинки \(item.rawValue)")
        }
    }

    @Test("Все картинки design/assets/approved импортированы (кроме обложки бота и значка)")
    func allApprovedImported() throws {
        let approved = try FileManager.default.contentsOfDirectory(atPath: Self.repoRoot.appendingPathComponent("design/assets/approved").path)
            .filter { $0.hasSuffix(".webp") }
            .map { String($0.dropLast(5)) }
            .filter { !["tg-bot-cover", "app-icon"].contains($0) }
        #expect(Set(approved) == Set(Illustration.allCases.map(\.rawValue)), "перезапустите ios/scripts/import-illustrations.sh")
    }

    @Test("Иконки Phosphor разбираются в непустые контуры внутри сетки 256")
    func iconsParse() {
        for icon in TeleTauIcon.allCases {
            let bounds = TeleTauIconShape(icon).path(in: CGRect(x: 0, y: 0, width: 256, height: 256)).boundingRect
            #expect(bounds.width > 20 && bounds.height > 20, "\(icon): пустой контур")
            #expect(bounds.minX >= -1 && bounds.maxX <= 257 && bounds.minY >= -1 && bounds.maxY <= 257, "\(icon): вне сетки \(bounds)")
        }
    }

    @Test("Дуга SVG: полукруг радиуса 10 даёт рамку 20×10")
    func svgArc() {
        let p = SVGPath.parse("M0,10 A10,10 0 0 1 20,10")
        let b = p.boundingRect
        #expect(abs(b.width - 20) < 0.5 && abs(b.height - 10) < 0.5, "\(b)")
    }

    @Test("Цвет аватара по нику — тот же хеш, что toneFor веба")
    func avatarTone() {
        // toneFor("Смелая пчела") в вебе: h = h·31 + код UTF-16, по модулю 5 тонов.
        var h: UInt32 = 0
        for u in "Смелая пчела".utf16 { h = h &* 31 &+ UInt32(u) }
        #expect(HexTone.forKey("Смелая пчела") == HexTone.avatarTones[Int(h % 5)])
        #expect(NicknameAvatar.illustration(for: "Смелая пчела") == .avatarBee)
        #expect(NicknameAvatar.illustration(for: "Горный еж") == .avatarHedgehog)
        #expect(NicknameAvatar.illustration(for: "Участник") == nil)
    }

    @Test("Панель букв — правильные кодовые точки (CLAUDE.md, правило 7)")
    func letterPanelCodePoints() {
        #expect(bashkirLetters.map { $0.unicodeScalars.first!.value } == [0x04D9, 0x04E9, 0x04AF, 0x0493, 0x04A1, 0x04A3, 0x0499, 0x04AB, 0x04BB])
    }
}
#endif
