#if canImport(AppKit)
import AppKit
import Foundation
import ImageIO
import SwiftUI
import Testing
@testable import DesignSystem

// Рендер стартового экрана через ImageRenderer на macOS (без рантайма iOS-симулятора) и попиксельная
// сверка с эталонами Tests/DesignSystemTests/__Snapshots__/start-{light,dark}.png (допуск — см. ниже).
// Фактический рендер пишется в .build/snapshots/ пакета (не в репозиторий). Эталоны перезаписываются
// только явно: TELETAU_RECORD_SNAPSHOTS=1 swift test --package-path ios/Packages/TeleTauCore
//
// Проверка содержимого не опирается на сгенерированный Swift: ожидаемые цвета читаются из
// исходников токенов (packages/design-tokens/tokens/color/*.json), т. е. рендер сверяется с первоисточником.

/// Экран iPhone 15/16 в точках; PNG рендерится в масштабе @2x.
private let viewport = CGSize(width: 390, height: 844)
private let renderScale: CGFloat = 2
/// Допуск на канал: сглаживание и преобразование цветовых пространств.
private let channelTolerance = 2
/// Сверка с эталоном: пиксель считается отличающимся, если хоть один канал разошёлся больше чем на столько.
private let snapshotChannelTolerance = 8
/// Сверка с эталоном: допустимая доля отличающихся пикселей (сглаживание шрифтов между версиями macOS).
private let snapshotMaxDiffShare = 0.002
/// Сверка по областям текста: подмена одной буквы (ҙ → з) меняет ~0,01% кадра и тонет в общем
/// допуске, поэтому полосы с текстом сравниваются отдельно и строго: не больше 0,05% пикселей полосы
/// (но не меньше 4 пикселей — шум сглаживания).
private let regionMaxDiffShare = 0.0005
private let regionMinAllowedPixels = 4
/// Пиксель «текстовый», если совпадает с цветом текста темы в пределах этого допуска (ядро глифа, без краёв сглаживания).
private let textCoreTolerance = 24
private let recordSnapshots = ProcessInfo.processInfo.environment["TELETAU_RECORD_SNAPSHOTS"] == "1"

enum Theme: String, CaseIterable, Sendable, CustomTestStringConvertible {
    case light, dark

    var testDescription: String { rawValue }
    var colorScheme: ColorScheme { self == .dark ? .dark : .light }
    var appearanceName: NSAppearance.Name { self == .dark ? .darkAqua : .aqua }
}

@MainActor
@Suite("DesignSystem: стартовый экран", .serialized)
struct StartScreenRenderTests {
    @Test("Рендер совпадает с эталоном и с цветами токенов темы", arguments: Theme.allCases)
    func renderStartScreen(theme: Theme) throws {
        let image = try #require(render(theme), "ImageRenderer не вернул изображение")
        let name = "start-\(theme.rawValue).png"
        let url = try savePNG(image, to: Snapshots.actualDirectory.appendingPathComponent(name))
        if recordSnapshots {
            _ = try savePNG(image, to: Snapshots.referenceDirectory.appendingPathComponent(name))
        }

        #expect(image.width == Int(viewport.width * renderScale))
        #expect(image.height == Int(viewport.height * renderScale))

        let tokens = try TokenSource.colors(theme)
        let bitmap = Bitmap(image)

        // 1. Фон: все четыре угла — токен bg своей темы. Это и есть проверка, что тема применилась.
        let corners = [(0, 0), (bitmap.width - 1, 0), (0, bitmap.height - 1), (bitmap.width - 1, bitmap.height - 1)]
        for (x, y) in corners {
            let pixel = bitmap.pixel(x: x, y: y)
            #expect(
                pixel.matches(tokens.bg, tolerance: channelTolerance),
                "\(theme): пиксель (\(x), \(y)) = \(pixel), ожидался bg \(tokens.bg) ±\(channelTolerance); PNG: \(url.path)"
            )
        }

        // 2. Медовая ячейка и кнопка залиты accentFill своей темы (заметная доля кадра).
        let honeyShare = bitmap.share(of: tokens.accentFill, tolerance: channelTolerance)
        #expect(honeyShare > 0.02, "\(theme): доля пикселей accentFill \(honeyShare) — ячейка и кнопка не отрисованы или не в цвете темы")

        // 3. Текст отрисован основным цветом своей темы (тёмный на светлой, светлый на тёмной).
        let textShare = bitmap.share(of: tokens.textPrimary, tolerance: channelTolerance)
        #expect(textShare > 0.001, "\(theme): доля пикселей textPrimary \(textShare) — текст не отрисован или не в цвете темы")

        // 4. Попиксельная сверка с эталоном: ловит регрессии раскладки (обрезка, порядок, размеры), а не только цвета.
        let referenceURL = Snapshots.referenceDirectory.appendingPathComponent(name)
        guard FileManager.default.fileExists(atPath: referenceURL.path) else {
            Issue.record("Нет эталона \(referenceURL.path). Запишите его: TELETAU_RECORD_SNAPSHOTS=1 swift test --package-path ios/Packages/TeleTauCore")
            return
        }
        let reference = Bitmap(try loadPNG(referenceURL))
        try #require(
            reference.width == bitmap.width && reference.height == bitmap.height,
            "\(theme): размер рендера \(bitmap.width)×\(bitmap.height) ≠ эталону \(reference.width)×\(reference.height)"
        )
        // 5. Сверка по областям текста — каждая полоса строго:
        //    textPrimary — заголовок «ТелеТау» и строка башкирских букв;
        //    textSecondary — подзаголовок и подпись «Башкирские буквы»;
        //    accentOn — надпись кнопки; ищется только внутри кнопки (в тёмной теме accentOn совпадает с фоном экрана).
        let primaryBands = reference.textBands(of: tokens.textPrimary, tolerance: textCoreTolerance)
        #expect(primaryBands.count >= 2, "\(theme): в эталоне не найдено строк текста цвета textPrimary (\(primaryBands.count))")
        let secondaryBands = reference.textBands(of: tokens.textSecondary, tolerance: textCoreTolerance)
        #expect(secondaryBands.count >= 2, "\(theme): в эталоне не найдено строк текста цвета textSecondary (\(secondaryBands.count))")
        // Медовые заливки — ячейка и кнопка; кнопка — нижняя.
        let honeyAreas = reference.textBands(of: tokens.accentFill, tolerance: channelTolerance, gap: 2, pad: 0)
        let button = try #require(honeyAreas.last, "\(theme): в эталоне не найдена кнопка (заливка accentFill)")
        let buttonBands = reference.textBands(of: tokens.accentOn, tolerance: textCoreTolerance, in: button)
        #expect(!buttonBands.isEmpty, "\(theme): в кнопке не найден текст цвета accentOn")
        // В светлой теме accentOn совпадает с textPrimary — одинаковые полосы проверяются один раз.
        var seen = Set<String>()
        let bands = (primaryBands + secondaryBands + buttonBands).filter { seen.insert("\($0.x0),\($0.x1),\($0.y0),\($0.y1)").inserted }
        for band in bands {
            let differing = bitmap.differingPixels(from: reference, in: band, tolerance: snapshotChannelTolerance)
            let allowed = max(regionMinAllowedPixels, Int(Double(band.area) * regionMaxDiffShare))
            #expect(
                differing <= allowed,
                "\(theme): в полосе текста y=\(band.y0)…\(band.y1) отличаются \(differing) пикселей (допуск \(allowed)). Рендер: \(url.path). Если изменение намеренное — TELETAU_RECORD_SNAPSHOTS=1"
            )
        }

        let diffShare = bitmap.differenceShare(from: reference, tolerance: snapshotChannelTolerance)
        #expect(
            diffShare <= snapshotMaxDiffShare,
            "\(theme): отличается \(String(format: "%.3f", diffShare * 100))% пикселей от эталона (допуск \(snapshotMaxDiffShare * 100)%). Рендер: \(url.path), эталон: \(referenceURL.path). Если изменение намеренное — TELETAU_RECORD_SNAPSHOTS=1"
        )
    }

    /// Как на Android (glyphLine_usesCorrectBashkirCodePoints): правильные кодовые точки, а не похожие буквы.
    @Test("Строки экрана используют правильные кодовые точки башкирских букв")
    func screenStringsUseCorrectCodePoints() {
        #expect(StartScreen.brandTitle.unicodeScalars.map(\.value) == [0x0422, 0x0435, 0x043B, 0x0435, 0x0422, 0x0430, 0x0443], "«ТелеТау»: кириллические Т е л е Т а у")
        let letters = StartScreen.glyphTestLine.unicodeScalars.map(\.value).filter { $0 != 0x20 }
        #expect(letters == [
            0x04D8, 0x04D9, 0x04E8, 0x04E9, 0x04AE, 0x04AF, 0x0492, 0x0493, 0x04A0,
            0x04A1, 0x04A2, 0x04A3, 0x0498, 0x0499, 0x04AA, 0x04AB, 0x04BA, 0x04BB,
        ], "строка букв: Ә ә Ө ө Ү ү Ғ ғ Ҡ ҡ Ң ң Ҙ ҙ Ҫ ҫ Һ һ")
        #expect(StartScreen.glyphTestLine.unicodeScalars.allSatisfy { $0.value == 0x20 || (0x0400...0x052F).contains($0.value) })
    }

    @Test("Тёмная и светлая темы различаются в рендере")
    func themesDiffer() throws {
        let light = Bitmap(try #require(render(.light)))
        let dark = Bitmap(try #require(render(.dark)))
        #expect(light.pixel(x: 0, y: 0) != dark.pixel(x: 0, y: 0))
    }

    @Test("Шестиугольник вписан в прямоугольник с пропорцией √3/2")
    func hexCellGeometry() {
        let rect = CGRect(x: 0, y: 0, width: 100, height: 200)
        let bounds = HexCell().path(in: rect).boundingRect
        #expect(abs(bounds.width / bounds.height - HexCell.aspectRatio) < 0.001)
        #expect(abs(bounds.midX - rect.midX) < 0.001 && abs(bounds.midY - rect.midY) < 0.001)
        #expect(bounds.width <= rect.width + 0.001 && bounds.height <= rect.height + 0.001)
    }

    // MARK: - Рендер

    private func render(_ theme: Theme) -> CGImage? {
        let view = StartScreen()
            .frame(width: viewport.width, height: viewport.height)
            .environment(\.colorScheme, theme.colorScheme)
        let renderer = ImageRenderer(content: view)
        renderer.proposedSize = ProposedViewSize(viewport)
        renderer.scale = renderScale
        // Динамический NSColor резолвится по текущему NSAppearance — задаём его явно для обеих тем,
        // чтобы результат не зависел от системной темы машины, на которой идут тесты.
        var image: CGImage?
        NSAppearance(named: theme.appearanceName)?.performAsCurrentDrawingAppearance {
            image = renderer.cgImage
        }
        return image
    }

    private func savePNG(_ image: CGImage, to url: URL) throws -> URL {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try #require(NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]))
        try data.write(to: url, options: .atomic)
        return url
    }

    private func loadPNG(_ url: URL) throws -> CGImage {
        let source = try #require(CGImageSourceCreateWithURL(url as CFURL, nil), "не читается \(url.path)")
        return try #require(CGImageSourceCreateImageAtIndex(source, 0, nil), "не декодируется \(url.path)")
    }
}

/// Где лежат эталоны (в репозитории) и фактические рендеры (в .build пакета, не в репозитории).
enum Snapshots {
    static let referenceDirectory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__", isDirectory: true)

    static let actualDirectory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // DesignSystemTests
        .deletingLastPathComponent() // Tests
        .deletingLastPathComponent() // TeleTauCore
        .appendingPathComponent(".build/snapshots", isDirectory: true)
}

// MARK: - Пиксели

struct PixelColor: Equatable, CustomStringConvertible {
    let r: Int, g: Int, b: Int

    func matches(_ other: PixelColor, tolerance: Int) -> Bool {
        abs(r - other.r) <= tolerance && abs(g - other.g) <= tolerance && abs(b - other.b) <= tolerance
    }

    var description: String { "(R \(r), G \(g), B \(b))" }
}

/// Изображение, перерисованное в 8-битный sRGB RGBA, чтобы сравнивать каналы с токенами напрямую.
struct Bitmap {
    let width: Int
    let height: Int
    private let bytes: [UInt8]

    init(_ image: CGImage) {
        let width = image.width
        let height = image.height
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
        bytes.withUnsafeMutableBytes { buffer in
            let context = CGContext(
                data: buffer.baseAddress, width: width, height: height,
                bitsPerComponent: 8, bytesPerRow: width * 4, space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            )!
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
        self.width = width
        self.height = height
        self.bytes = bytes
    }

    func pixel(x: Int, y: Int) -> PixelColor {
        let i = (y * width + x) * 4
        return PixelColor(r: Int(bytes[i]), g: Int(bytes[i + 1]), b: Int(bytes[i + 2]))
    }

    /// Доля пикселей, у которых хоть один канал отличается от эталона больше чем на tolerance.
    func differenceShare(from other: Bitmap, tolerance: Int) -> Double {
        var count = 0
        for i in stride(from: 0, to: min(bytes.count, other.bytes.count), by: 4) {
            if abs(Int(bytes[i]) - Int(other.bytes[i])) > tolerance
                || abs(Int(bytes[i + 1]) - Int(other.bytes[i + 1])) > tolerance
                || abs(Int(bytes[i + 2]) - Int(other.bytes[i + 2])) > tolerance {
                count += 1
            }
        }
        return Double(count) / Double(width * height)
    }

    /// Прямоугольная область в пикселях (границы включительно).
    struct Region {
        let x0: Int, x1: Int, y0: Int, y1: Int
        var area: Int { (x1 - x0 + 1) * (y1 - y0 + 1) }
    }

    /// Горизонтальные полосы текста цвета color: строки, где не меньше двух пикселей совпадают с цветом;
    /// соседние такие строки (разрыв меньше gap) объединяются, область расширяется на pad.
    /// within — искать только внутри области (например, надпись внутри кнопки).
    func textBands(of color: PixelColor, tolerance: Int, gap: Int = 8, pad: Int = 6, in within: Region? = nil) -> [Region] {
        let area = within ?? Region(x0: 0, x1: width - 1, y0: 0, y1: height - 1)
        var bands: [Region] = []
        var current: (x0: Int, x1: Int, y0: Int, y1: Int)?
        for y in area.y0...area.y1 {
            var count = 0, minX = width, maxX = -1
            for x in area.x0...area.x1 where pixel(x: x, y: y).matches(color, tolerance: tolerance) {
                count += 1
                minX = min(minX, x)
                maxX = max(maxX, x)
            }
            guard count >= 2 else { continue }
            if var c = current, y - c.y1 < gap {
                c.x0 = min(c.x0, minX); c.x1 = max(c.x1, maxX); c.y1 = y
                current = c
            } else {
                if let c = current { bands.append(padded(c, pad)) }
                current = (minX, maxX, y, y)
            }
        }
        if let c = current { bands.append(padded(c, pad)) }
        return bands
    }

    private func padded(_ c: (x0: Int, x1: Int, y0: Int, y1: Int), _ pad: Int) -> Region {
        Region(x0: max(0, c.x0 - pad), x1: min(width - 1, c.x1 + pad), y0: max(0, c.y0 - pad), y1: min(height - 1, c.y1 + pad))
    }

    /// Число пикселей области, у которых хоть один канал отличается от эталона больше чем на tolerance.
    func differingPixels(from other: Bitmap, in region: Region, tolerance: Int) -> Int {
        var count = 0
        for y in region.y0...region.y1 {
            for x in region.x0...region.x1 {
                let a = pixel(x: x, y: y), b = other.pixel(x: x, y: y)
                if abs(a.r - b.r) > tolerance || abs(a.g - b.g) > tolerance || abs(a.b - b.b) > tolerance { count += 1 }
            }
        }
        return count
    }

    /// Доля пикселей, совпадающих с цветом в пределах допуска.
    func share(of color: PixelColor, tolerance: Int) -> Double {
        var count = 0
        for i in stride(from: 0, to: bytes.count, by: 4) {
            let pixel = PixelColor(r: Int(bytes[i]), g: Int(bytes[i + 1]), b: Int(bytes[i + 2]))
            if pixel.matches(color, tolerance: tolerance) { count += 1 }
        }
        return Double(count) / Double(width * height)
    }
}

// MARK: - Токены-первоисточник

/// Читает цвета темы из packages/design-tokens/tokens/color/{light,dark}.json (W3C DTCG),
/// разрешая ссылки вида `{color.palette.wax.50}`.
enum TokenSource {
    struct Colors {
        let bg: PixelColor
        let accentFill: PixelColor
        let accentOn: PixelColor
        let textPrimary: PixelColor
        let textSecondary: PixelColor
    }

    enum Failure: Error, CustomStringConvertible {
        case missing(String)
        case badValue(String)
        var description: String {
            switch self {
            case .missing(let path): "токен не найден: \(path)"
            case .badValue(let value): "не цвет: \(value)"
            }
        }
    }

    static func colors(_ theme: Theme) throws -> Colors {
        let url = repoRoot.appendingPathComponent("packages/design-tokens/tokens/color/\(theme.rawValue).json")
        let json = try JSONSerialization.jsonObject(with: Data(contentsOf: url))
        return Colors(
            bg: try color("color.bg", in: json),
            accentFill: try color("color.accent.fill", in: json),
            accentOn: try color("color.accent.on", in: json),
            textPrimary: try color("color.text.primary", in: json),
            textSecondary: try color("color.text.secondary", in: json)
        )
    }

    private static func color(_ path: String, in json: Any, depth: Int = 0) throws -> PixelColor {
        var node: Any? = json
        for key in path.split(separator: ".") {
            node = (node as? [String: Any])?[String(key)]
        }
        guard let value = (node as? [String: Any])?["$value"] as? String else { throw Failure.missing(path) }
        if value.hasPrefix("{"), value.hasSuffix("}"), depth < 8 {
            return try color(String(value.dropFirst().dropLast()), in: json, depth: depth + 1)
        }
        let digits = value.hasPrefix("#") ? String(value.dropFirst()) : value
        guard digits.count == 6, let packed = UInt32(digits, radix: 16) else { throw Failure.badValue(value) }
        return PixelColor(r: Int(packed >> 16 & 255), g: Int(packed >> 8 & 255), b: Int(packed & 255))
    }

    static let repoRoot: URL = {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while dir.path != "/" {
            if FileManager.default.fileExists(atPath: dir.appendingPathComponent("packages/design-tokens/tokens").path) {
                return dir
            }
            dir.deleteLastPathComponent()
        }
        fatalError("Не найден корень репозитория (packages/design-tokens) выше \(#filePath)")
    }()
}
#endif
